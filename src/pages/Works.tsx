import React, { useEffect, useMemo, useRef, useState } from 'react';
import WorkspaceDirectory from '../components/WorkspaceDirectory';
import MarkdownEditor from '../components/MarkdownEditor';
import AgentChat from '../components/AgentChat';
import OutlineAssessmentAgentChat from '../components/OutlineAssessmentAgentChat';
import { useWorksStore } from '../stores/useWorksStore';
import { defaultWorkSummaryPrompt, useSettingsStore } from '../stores/useSettingsStore';
import { Button, Cascader, Empty, Form, message, Modal, Popover, Progress, Tree } from 'antd';
import { CheckCircleOutlined, RobotOutlined, SettingOutlined } from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { ScoreDetailsModal } from '../components/ScoreDetailsModal';

const MIN_FILE_TREE_WIDTH = 250;
const MAX_FILE_TREE_WIDTH = 420;
const EDITOR_MIN_WIDTH = 400;
const MIN_AGENT_WIDTH = 380;
const MAX_AGENT_WIDTH = 860;

interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
}

const ARTICLE_TYPE_OPTIONS = [
  {
    value: '男频',
    label: '男频',
    children: [
      {
        value: '长篇',
        label: '长篇',
        children: [{ value: '玄幻脑洞', label: '玄幻脑洞' }],
      },
    ],
  },
  {
    value: '女频',
    label: '女频',
    children: [
      {
        value: '短篇',
        label: '短篇',
        children: [{ value: '虐心婚恋', label: '虐心婚恋' }],
      },
    ],
  },
  {
    value: '公众号',
    label: '公众号',
  },
];

const LONG_SCORE_FIELDS = ['情节架构与长期张力', '人物塑造与代入感', '世界观与设定融合度', '节奏把控与爽点密度', '文笔与叙事连贯性'];
const SHORT_SCORE_FIELDS = ['创意与核心脑洞', '故事完整性与结构', '人物聚焦与情感穿透', '节奏与情绪张力', '语言质感与结尾余韵'];
const PUBLIC_ACCOUNT_SCORE_FIELDS = ['选题与标题吸引力', '内容价值与信息密度', '结构逻辑与可读性', '文风与情绪共鸣', '情绪价值与长尾共鸣'];

const getScoreFields = (articleType: string[]) => {
  if (articleType.includes('公众号')) return PUBLIC_ACCOUNT_SCORE_FIELDS;
  if (articleType.includes('短篇')) return SHORT_SCORE_FIELDS;
  return LONG_SCORE_FIELDS;
};

const getArticleTypeLabel = (articleType: string[]) => articleType.length > 0 ? articleType.join('-') : '默认';

const buildCombinedSummaryPath = (articlePaths: string[], stamp: string) => {
  const firstPath = articlePaths[0] || '';
  const parts = firstPath.split(/[\\/]/);
  parts.pop();
  const targetDir = parts.join('/');
  return `${targetDir}/作品汇总总结_${stamp}.md`;
};

const extractJsonObject = (content: string) => {
  const match = content.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
};

const normalizeSummaryScoreJson = (parsed: Record<string, unknown>, fields: string[]) => {
  const nextScore: Record<string, number | string> = {};
  fields.forEach((field) => {
    const value = parsed[field];
    const score = typeof value === 'number' ? value : Number(value);
    nextScore[field] = Number.isFinite(score) ? score : 0;
  });
  nextScore['优化建议'] = typeof parsed['优化建议'] === 'string' ? parsed['优化建议'] : '';
  return JSON.stringify(nextScore);
};

const Works: React.FC = () => {
  const [isResizingFileTree, setIsResizingFileTree] = useState(false);
  const [isResizingAgent, setIsResizingAgent] = useState(false);
  const [isSummarySettingsOpen, setIsSummarySettingsOpen] = useState(false);
  const [isScoreModalOpen, setIsScoreModalOpen] = useState(false);
  const [articleTree, setArticleTree] = useState<FileNode[]>([]);
  const runArticlePathsRef = useRef<string[]>([]);

  const fileTreeRef = useRef<HTMLDivElement>(null);
  const settings = useSettingsStore();
  const workSummaryPrompt = settings.workSummaryPrompt || defaultWorkSummaryPrompt;
  const {
    selectedFile,
    setSelectedFile,
    fileTreeWidth,
    setFileTreeWidth,
    agentWidth,
    setAgentWidth,
    isAgentVisible,
    setIsAgentVisible,
    isWorkSummaryOpen,
    setIsWorkSummaryOpen,
    workSummarySelectedArticlePaths,
    setWorkSummarySelectedArticlePaths,
    workSummaryMessages,
    setWorkSummaryMessages,
    workSummaryRunning,
    setWorkSummaryRunning,
    workSummaryRun,
    setWorkSummaryRun,
    workSummaryResults,
    setWorkSummaryResult,
  } = useWorksStore();

  const scoreFields = useMemo(() => getScoreFields(settings.articleType), [settings.articleType]);
  const currentSummaryResult = selectedFile ? workSummaryResults[selectedFile] : null;
  let parsedSummaryScore: any = null;
  let totalScore = 0;
  if (currentSummaryResult?.scoreJson) {
    try {
      parsedSummaryScore = JSON.parse(currentSummaryResult.scoreJson);
      totalScore = scoreFields.reduce((sum, field) => {
        const value = parsedSummaryScore?.[field];
        return sum + (typeof value === 'number' ? value : 0);
      }, 0);
    } catch (e) {
      parsedSummaryScore = null;
      totalScore = 0;
    }
  }

  const refreshCurrentSummaryResult = async (path: string | null) => {
    if (!path) return;
    try {
      const scoreJson = await invoke<string | null>('load_work_summary_result', { articlePath: path });
      if (scoreJson) {
        setWorkSummaryResult(path, { scoreJson, updatedAt: Date.now() });
      }
    } catch (e) {
      console.error('加载作品总结结果失败:', e);
    }
  };

  const loadArticleTree = async () => {
    try {
      const root = await invoke<string>('get_workspace_dir', { dirType: 'articles' });
      const loadChildren = async (path: string): Promise<FileNode[]> => {
        const items = await invoke<FileNode[]>('list_dir', { path });
        const visibleItems = items.filter((item) => item.name !== '.versions' && item.name !== '.work-summary-results');
        const children = await Promise.all(visibleItems.map(async (item) => {
          if (!item.is_dir) {
            return item;
          }
          return {
            ...item,
            children: await loadChildren(item.path),
          };
        }));
        return children;
      };
      const tree = await loadChildren(root);
      setArticleTree(tree);
    } catch (e) {
      console.error(e);
      message.error('加载作品目录失败');
    }
  };

  const collectArticleFiles = (nodes: FileNode[], keySet: Set<string>) => {
    const selectedPaths: string[] = [];
    const visit = (node: FileNode, selectedByParent: boolean) => {
      const isSelected = selectedByParent || keySet.has(node.path);
      if (!node.is_dir && isSelected) {
        selectedPaths.push(node.path);
        return;
      }
      node.children?.forEach((child) => visit(child, isSelected));
    };
    nodes.forEach((node) => visit(node, false));
    return selectedPaths;
  };

  const mapArticleTree = (nodes: FileNode[]): any[] => nodes.map((node) => ({
    title: node.name,
    key: node.path,
    isLeaf: !node.is_dir,
    selectable: false,
    children: node.children ? mapArticleTree(node.children) : undefined,
  }));

  // Resize File Tree
  useEffect(() => {
    if (!isResizingFileTree) return;
    const handleMouseMove = (event: MouseEvent) => {
      const fileTreeLeft = fileTreeRef.current?.getBoundingClientRect().left ?? 0;
      const nextWidth = Math.min(Math.max(event.clientX - fileTreeLeft, MIN_FILE_TREE_WIDTH), MAX_FILE_TREE_WIDTH);
      setFileTreeWidth(nextWidth);
    };
    const handleMouseUp = () => setIsResizingFileTree(false);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingFileTree]);

  // Resize Agent
  useEffect(() => {
    if (!isResizingAgent) return;
    const handleMouseMove = (event: MouseEvent) => {
      // agent is on the right, so we calculate from the right edge
      const windowWidth = window.innerWidth;
      const nextWidth = Math.min(Math.max(windowWidth - event.clientX, MIN_AGENT_WIDTH), MAX_AGENT_WIDTH);
      setAgentWidth(nextWidth);
    };
    const handleMouseUp = () => setIsResizingAgent(false);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingAgent]);

  useEffect(() => {
    void refreshCurrentSummaryResult(selectedFile);
  }, [selectedFile]);

  useEffect(() => {
    if (isSummarySettingsOpen) {
      void loadArticleTree();
    }
  }, [isSummarySettingsOpen]);

  const buildWorkSummaryStart = () => {
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const articleTypeLabel = getArticleTypeLabel(settings.articleType);
    const summaryPath = buildCombinedSummaryPath(workSummarySelectedArticlePaths, stamp);
    const targetText = workSummarySelectedArticlePaths.map((path, index) => `${index + 1}. ${path}`).join('\n');
    const scoreText = scoreFields.map((field, index) => `${index + 1}. ${field}：满分 20`).join('\n');
    return {
      content: `请进行作品总结。\n\n文章类型：${articleTypeLabel}\n\n请读取以下所有文章，将这些文章汇总成一篇总的作品总结，写入这个新文件：${summaryPath}。不要修改原文章，不要创建文件版本。\n\n待读取文章：\n${targetText}\n\n本次评分字段如下：\n${scoreText}\n\n完成汇总总结文件写入后，请只返回一段 JSON，字段必须包含以上 5 个评分项和“优化建议”。“优化建议”要尽量详细、具体，指出问题、影响和可执行修改方向。`,
      allowedWritePaths: [summaryPath],
      articlePaths: workSummarySelectedArticlePaths,
    };
  };

  const handleSummaryDone = async (lastMessage: string) => {
    const jsonStr = extractJsonObject(lastMessage);
    if (!jsonStr) {
      message.warning('未能读取作品总结评分，请确认作品总结Agent输出了JSON结果');
      return '由于你未输出正确的 JSON 格式，结果未能成功保存。请务必严格按照要求，只输出一段合法的 JSON，不要包含任何多余的代码块标记、markdown 格式或解释性文字。请重新输出。';
    }
    try {
      const parsed = JSON.parse(jsonStr);
      const normalizedJsonStr = normalizeSummaryScoreJson(parsed, scoreFields);
      const articlePaths = runArticlePathsRef.current;
      await Promise.all(articlePaths.map(async (articlePath) => {
        await invoke('save_work_summary_result', { articlePath, scoreJson: normalizedJsonStr });
        setWorkSummaryResult(articlePath, { scoreJson: normalizedJsonStr, updatedAt: Date.now() });
      }));
      message.success('已保存作品总结评分');
    } catch (e) {
      message.warning('作品总结评分保存或解析失败，已保留原结果');
      return `由于你输出的 JSON 格式解析失败或字段缺失，结果未能成功保存。错误信息：${e}。请检查 JSON 是否存在语法错误（如缺少引号、多余的逗号、非法的格式等），然后重新输出合法的 JSON 格式。`;
    }
  };

  useEffect(() => {
    setIsScoreModalOpen(false);
  }, [selectedFile]);

  return (
    <div style={{ height: '100%', width: '100%', overflowX: 'hidden', overflowY: 'hidden', background: '#faf9f5' }}>
      <div style={{ display: 'flex', height: '100%', minWidth: fileTreeWidth + EDITOR_MIN_WIDTH + (isAgentVisible ? agentWidth : 0) }}>
        {/* Left Column: File Explorer */}
        <div ref={fileTreeRef} style={{
          width: fileTreeWidth,
          minWidth: fileTreeWidth,
          position: 'relative',
          borderRight: '1px solid rgba(0, 0, 0, 0.04)',
          background: 'rgba(255, 255, 255, 0.3)'
        }}>
          <WorkspaceDirectory
            title="作品目录"
            dirType="articles"
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
          />
          <div
            aria-label="调整文件树宽度"
            aria-orientation="vertical"
            role="separator"
            onMouseDown={() => setIsResizingFileTree(true)}
            style={{
              position: 'absolute',
              top: 0,
              right: -3,
              width: 6,
              height: '100%',
              cursor: 'col-resize',
              zIndex: 2,
            }}
          />
        </div>

        {/* Middle Column: Markdown Editor */}
        <div style={{ flex: 1, minWidth: EDITOR_MIN_WIDTH, position: 'relative', display: 'flex', flexDirection: 'column' }}>
          <div className="de-ai-editor-toolbar">
            {selectedFile ? (
              <div className="de-ai-editor-toolbar__primary">
                <Button
                  type={isWorkSummaryOpen ? "default" : "primary"}
                  icon={<CheckCircleOutlined />}
                  onClick={() => setIsWorkSummaryOpen(!isWorkSummaryOpen)}
                  style={{
                    background: isWorkSummaryOpen ? '#fff' : '#d97757',
                    color: isWorkSummaryOpen ? '#333' : '#fff',
                    border: isWorkSummaryOpen ? '1px solid #d9d9d9' : 'none',
                    boxShadow: isWorkSummaryOpen ? 'none' : '0 4px 12px rgba(217, 119, 87, 0.2)'
                  }}
                >
                  作品总结
                </Button>
              </div>
            ) : <span />}

            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flex: '1 1 auto', justifyContent: 'flex-end', minWidth: 0 }}>
              {selectedFile && (
                <>
                  <Popover
                    placement="bottomRight"
                    content={
                      parsedSummaryScore ? (
                        <div style={{ minWidth: 220 }}>
                          {scoreFields.map((field) => (
                            <div key={field} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span>{field}</span><span>{parsedSummaryScore[field] ?? 0}/20</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ padding: '8px 16px', color: '#999' }}>暂无作品评分</div>
                      )
                    }
                  >
                    <button 
                      type="button"
                      className="de-ai-score-pill" 
                      style={{ cursor: 'pointer', border: 0, background: 'transparent', padding: 0 }} 
                      aria-label={`作品评分${parsedSummaryScore ? totalScore : '暂无'}`}
                      onClick={() => {
                        if (parsedSummaryScore) {
                          setIsScoreModalOpen(true);
                        }
                      }}
                    >
                      <span className="de-ai-score-pill__label">作品分</span>
                      <Progress 
                        type="circle" 
                        percent={parsedSummaryScore ? totalScore : 0} 
                        size={30} 
                        format={(p) => parsedSummaryScore ? p : '--'}
                        status={parsedSummaryScore ? (totalScore > 80 ? 'success' : 'normal') : 'normal'}
                        strokeColor={parsedSummaryScore ? undefined : "#e8e8e8"} 
                      />
                    </button>
                  </Popover>
                  <ScoreDetailsModal 
                    isOpen={isScoreModalOpen} 
                    onClose={() => setIsScoreModalOpen(false)} 
                    parsedAssessment={parsedSummaryScore} 
                    totalScore={totalScore} 
                    scoreFields={scoreFields}
                    title="作品综合评分"
                    chartTitle="作品多维评分"
                  />
                </>
              )}
              {!isAgentVisible && (
                <Button
                  type="primary"
                  icon={<RobotOutlined />}
                  onClick={() => setIsAgentVisible(true)}
                  style={{
                    background: '#d97757',
                    border: 'none',
                    boxShadow: '0 4px 12px rgba(217, 119, 87, 0.2)',
                    flexShrink: 0
                  }}
                >
                  打开 Agent
                </Button>
              )}
            </div>
          </div>

          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <MarkdownEditor filePath={selectedFile} />
          </div>

          {isWorkSummaryOpen && (
            <div style={{ height: 350, borderTop: '1px solid #e8e8e8', background: '#fff' }}>
              <OutlineAssessmentAgentChat
                title="作品总结 Agent"
                agentId="workSummary"
                workspaceDirType="articles"
                systemPrompt={workSummaryPrompt}
                allowedTools={['read', 'grep', 'glob', 'write']}
                startContent={workSummarySelectedArticlePaths.length > 0 ? '开始作品总结' : ''}
                startDisabled={workSummarySelectedArticlePaths.length === 0}
                messages={workSummaryMessages}
                setMessages={setWorkSummaryMessages}
                activeRun={workSummaryRun}
                setActiveRun={setWorkSummaryRun}
                isRunning={workSummaryRunning}
                onRunningChange={setWorkSummaryRunning}
                footerLeft={(
                  <Button
                    aria-label="作品总结设置"
                    className="de-ai-agent-settings-button"
                    icon={<SettingOutlined />}
                    onClick={() => setIsSummarySettingsOpen(true)}
                    shape="circle"
                    title="作品总结设置"
                    type={workSummarySelectedArticlePaths.length > 0 ? 'primary' : 'default'}
                  />
                )}
                onBeforeStart={async () => {
                  if (workSummarySelectedArticlePaths.length === 0) {
                    message.warning('请先选择文章');
                    return undefined;
                  }
                  const start = buildWorkSummaryStart();
                  runArticlePathsRef.current = start.articlePaths;
                  return {
                    content: start.content,
                    allowedWritePaths: start.allowedWritePaths,
                  };
                }}
                onDone={handleSummaryDone}
              />
            </div>
          )}

          <Modal
            title="作品总结 Agent 设置"
            open={isSummarySettingsOpen}
            okText="确定"
            cancelText="取消"
            width={640}
            onCancel={() => setIsSummarySettingsOpen(false)}
            onOk={() => setIsSummarySettingsOpen(false)}
            destroyOnClose
          >
            <Form layout="vertical">
              <Form.Item label="文章类型">
                <Cascader
                  value={settings.articleType}
                  onChange={(val) => settings.setArticleType(val as string[])}
                  options={ARTICLE_TYPE_OPTIONS}
                  placeholder="请选择文章类型"
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item label="文章选择" style={{ marginBottom: 0 }}>
                <div className="de-ai-reference-picker">
                  {articleTree.length > 0 ? (
                    <Tree
                      blockNode
                      checkable
                      checkedKeys={workSummarySelectedArticlePaths}
                      className="de-ai-reference-picker__tree"
                      onCheck={(checkedKeys) => {
                        const keys = Array.isArray(checkedKeys) ? checkedKeys : checkedKeys.checked;
                        setWorkSummarySelectedArticlePaths(collectArticleFiles(articleTree, new Set(keys.map(String))));
                      }}
                      selectable={false}
                      treeData={mapArticleTree(articleTree)}
                    />
                  ) : (
                    <Empty description="作品目录暂无可选文章" />
                  )}
                </div>
              </Form.Item>
            </Form>
          </Modal>
        </div>

        {/* Right Column: Agent Chat */}
        {isAgentVisible && (
          <div style={{
            width: agentWidth,
            minWidth: agentWidth,
            position: 'relative',
            borderLeft: '1px solid rgba(0, 0, 0, 0.04)',
            background: '#fff',
          }}>
            <div
              aria-label="调整 Agent 宽度"
              aria-orientation="vertical"
              role="separator"
              onMouseDown={() => setIsResizingAgent(true)}
              style={{
                position: 'absolute',
                top: 0,
                left: -3,
                width: 6,
                height: '100%',
                cursor: 'col-resize',
                zIndex: 2,
              }}
            />
            <AgentChat title="写文章Agent" onClose={() => setIsAgentVisible(false)} />
          </div>
        )}
      </div>
    </div>
  );
};

export default Works;
