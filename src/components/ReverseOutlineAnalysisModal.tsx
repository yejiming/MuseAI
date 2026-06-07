import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  Alert,
  Button,
  Checkbox,
  Empty,
  Input,
  Modal,
  Progress,
  Radio,
  Space,
  Spin,
  Tree,
  Typography,
  message,
} from 'antd';
import { FileSearchOutlined, SaveOutlined, RedoOutlined } from '@ant-design/icons';
import { useSettingsStore } from '../stores/useSettingsStore';

interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
}

interface SourceTreeNode {
  title: React.ReactNode;
  key: string;
  path?: string;
  is_dir: boolean;
  children?: SourceTreeNode[];
}

interface SourceTree {
  nodes: SourceTreeNode[];
  filePaths: string[];
  nodePaths: string[];
}

interface ChapterPreview {
  title: string;
  path: string;
  charCount: number;
}

interface ProgressEvent {
  runId: string;
  phase: 'short' | 'distributed' | 'final';
  totalChapters: number;
  successChapters: number;
  failedChapters: number;
  message?: string | null;
}

interface ResultEvent {
  runId: string;
  title?: string | null;
  content?: string | null;
  error?: string | null;
  failedBatchIndices?: number[] | null;
  failedBatchErrors?: FailedBatchError[] | null;
  partialSummaries?: Array<Record<string, unknown>> | null;
}

interface StreamEvent {
  runId: string;
  delta: string;
}

interface FailedBatchError {
  index: number;
  range: string;
  error: string;
}

interface ReverseOutlineStageConfig {
  modelInterface: 'OpenAI-compatible' | 'Anthropic-compatible';
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  maxContextTokens?: number;
  thinkingDepth?: 'off' | 'low' | 'medium' | 'high';
  systemPrompt: string;
}

interface ReverseOutlineAnalysisModalProps {
  open: boolean;
  onClose: () => void;
}

type ArticleType = 'short' | 'long';
type Stage = 'idle' | 'running' | 'preview' | 'retry';

const isTextFile = (path: string) => /\.(md|txt)$/i.test(path);

const fileNameWithoutExt = (name: string) => name.replace(/\.[^.]+$/, '');

const buildSourceTree = async (path: string): Promise<SourceTree> => {
  const items = await invoke<FileNode[]>('list_dir', { path });
  const sortedItems = [...items].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const nodes: SourceTreeNode[] = [];
  const filePaths: string[] = [];
  const nodePaths: string[] = [];

  for (const item of sortedItems) {
    if (item.is_dir) {
      const childTree = await buildSourceTree(item.path);
      if (childTree.nodes.length === 0) continue;
      nodePaths.push(item.path, ...childTree.nodePaths);
      nodes.push({
        title: <span title={item.path}>{item.name}</span>,
        key: item.path,
        path: item.path,
        is_dir: true,
        children: childTree.nodes,
      });
      filePaths.push(...childTree.filePaths);
      continue;
    }

    if (!isTextFile(item.path)) continue;
    nodePaths.push(item.path);
    nodes.push({
      title: <span title={item.path}>{fileNameWithoutExt(item.name)}</span>,
      key: item.path,
      path: item.path,
      is_dir: false,
    });
    filePaths.push(item.path);
  }

  return { nodes, filePaths, nodePaths };
};

const collectCheckedFilePaths = (nodes: SourceTreeNode[], keySet: Set<string>) => {
  const paths: string[] = [];
  const visit = (node: SourceTreeNode, selectedByParent: boolean) => {
    const isSelected = keySet.has(node.key);
    if (node.is_dir && node.path && isSelected) {
      paths.push(node.path);
      return;
    }
    if (!node.is_dir && node.path && (selectedByParent || isSelected)) {
      paths.push(node.path);
      return;
    }
    node.children?.forEach(child => visit(child, isSelected));
  };
  nodes.forEach(node => visit(node, false));
  return paths;
};

const countSelectedFiles = (tree: SourceTree, selectedPaths: string[]) => {
  const selectedFilePaths = new Set<string>();
  for (const selectedPath of selectedPaths) {
    if (tree.filePaths.includes(selectedPath)) {
      selectedFilePaths.add(selectedPath);
      continue;
    }
    const dirPrefix = `${selectedPath}/`;
    tree.filePaths
      .filter(filePath => filePath.startsWith(dirPrefix))
      .forEach(filePath => selectedFilePaths.add(filePath));
  }
  return selectedFilePaths.size;
};

const sourceListStyle: React.CSSProperties = {
  minHeight: 180,
  maxHeight: 260,
  overflowY: 'auto',
  padding: 12,
  border: '1px solid rgba(217, 119, 87, 0.16)',
  borderRadius: 8,
  background: '#fffdfa',
};

const sectionTitleStyle: React.CSSProperties = {
  marginBottom: 8,
  color: '#33312e',
  fontWeight: 600,
};

const ReverseOutlineAnalysisModal: React.FC<ReverseOutlineAnalysisModalProps> = ({ open, onClose }) => {
  const settings = useSettingsStore();
  const [articleType, setArticleType] = useState<ArticleType>('short');
  const [articleSourceTree, setArticleSourceTree] = useState<SourceTree>({ nodes: [], filePaths: [], nodePaths: [] });
  const [referenceSourceTree, setReferenceSourceTree] = useState<SourceTree>({ nodes: [], filePaths: [], nodePaths: [] });
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [stage, setStage] = useState<Stage>('idle');
  const [chapters, setChapters] = useState<ChapterPreview[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [orderConfirmed, setOrderConfirmed] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [outlineTitle, setOutlineTitle] = useState('');
  const [outlineContent, setOutlineContent] = useState('');
  const [finalStreamContent, setFinalStreamContent] = useState('');
  const [failedBatchIndices, setFailedBatchIndices] = useState<number[]>([]);
  const [failedBatchErrors, setFailedBatchErrors] = useState<FailedBatchError[]>([]);
  const [partialSummaries, setPartialSummaries] = useState<Array<Record<string, unknown>>>([]);
  const activeRunIdRef = useRef<string | null>(null);

  const resetTransientState = () => {
    setStage('idle');
    setChapters([]);
    setLoadingPreview(false);
    setOrderConfirmed(false);
    setProgress(null);
    setOutlineTitle('');
    setOutlineContent('');
    setFinalStreamContent('');
    setFailedBatchIndices([]);
    setFailedBatchErrors([]);
    setPartialSummaries([]);
    activeRunIdRef.current = null;
  };

  useEffect(() => {
    if (!open) return;
    setLoadingSources(true);
    Promise.all([
      invoke<string>('get_workspace_dir', { dirType: 'articles' }),
      invoke<string>('get_workspace_dir', { dirType: 'references' }),
    ])
      .then(async ([articlesRoot, referencesRoot]) => {
        const [articles, references] = await Promise.all([
          buildSourceTree(articlesRoot),
          buildSourceTree(referencesRoot),
        ]);
        setArticleSourceTree(articles);
        setReferenceSourceTree(references);
      })
      .catch(error => {
        console.error(error);
        message.error(`加载文章失败: ${error}`);
      })
      .finally(() => setLoadingSources(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    let progressUnlisten: UnlistenFn | null = null;
    let resultUnlisten: UnlistenFn | null = null;
    let streamUnlisten: UnlistenFn | null = null;

    const acceptsRun = (runId: string) => {
      if (activeRunIdRef.current && runId !== activeRunIdRef.current) return false;
      if (!activeRunIdRef.current) activeRunIdRef.current = runId;
      return true;
    };

    listen<ProgressEvent>('reverse-outline-progress', event => {
      if (!active || !acceptsRun(event.payload.runId)) return;
      setProgress(event.payload);
      if (event.payload.phase === 'final') {
        setFinalStreamContent('');
      }
    }).then(fn => {
      progressUnlisten = fn;
    });

    listen<StreamEvent>('reverse-outline-stream', event => {
      if (!active || !acceptsRun(event.payload.runId)) return;
      setFinalStreamContent(current => `${current}${event.payload.delta}`);
    }).then(fn => {
      streamUnlisten = fn;
    });

    listen<ResultEvent>('reverse-outline-result', event => {
      if (!active || !acceptsRun(event.payload.runId)) return;
      if (event.payload.error) {
        if (event.payload.failedBatchIndices && event.payload.failedBatchIndices.length > 0) {
          setFailedBatchIndices(event.payload.failedBatchIndices);
          setFailedBatchErrors(event.payload.failedBatchErrors || []);
          setPartialSummaries(event.payload.partialSummaries || []);
          setStage('retry');
          return;
        }
        message.error(event.payload.error);
        setStage('idle');
        return;
      }
      setOutlineTitle(event.payload.title || '反向大纲');
      setOutlineContent(event.payload.content || '');
      setFinalStreamContent('');
      setFailedBatchIndices([]);
      setFailedBatchErrors([]);
      setPartialSummaries([]);
      setStage('preview');
    }).then(fn => {
      resultUnlisten = fn;
    });

    return () => {
      active = false;
      progressUnlisten?.();
      streamUnlisten?.();
      resultUnlisten?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open || articleType !== 'long' || selectedPaths.length === 0) {
      setChapters([]);
      setOrderConfirmed(false);
      return;
    }
    setLoadingPreview(true);
    invoke<ChapterPreview[]>('preview_reverse_outline_chapters', { filePaths: selectedPaths })
      .then(result => setChapters(result))
      .catch(error => {
        console.error(error);
        message.error(`章节预览失败: ${error}`);
      })
      .finally(() => setLoadingPreview(false));
    setOrderConfirmed(false);
  }, [open, articleType, selectedPaths]);

  const closeModal = () => {
    setSelectedPaths([]);
    setArticleType('short');
    resetTransientState();
    onClose();
  };

  const updateSelectedSource = (tree: SourceTree, checkedKeys: React.Key[] | { checked: React.Key[] }) => {
    const keys = Array.isArray(checkedKeys) ? checkedKeys : checkedKeys.checked;
    const nextSourcePaths = collectCheckedFilePaths(tree.nodes, new Set(keys.map(String)));
    setSelectedPaths(current => {
      const sourcePathSet = new Set(tree.nodePaths);
      return [...current.filter(path => !sourcePathSet.has(path)), ...nextSourcePaths];
    });
  };

  const buildStageConfig = (
    agentId: string,
    systemPrompt: string,
  ): ReverseOutlineStageConfig => {
    const agentConfig = settings.agentConfigs?.[agentId] || {};

    return {
      modelInterface: settings.modelInterface,
      baseUrl: settings.llmBaseUrl,
      apiKey: settings.llmApiKey,
      model: settings.llmModel,
      temperature: agentConfig.temperature,
      maxOutputTokens: agentConfig.maxOutputTokens,
      maxContextTokens: agentConfig.maxContextTokens,
      thinkingDepth: agentConfig.thinkingDepth,
      systemPrompt,
    };
  };

  const buildReverseOutlineRequestBase = () => {
    const shortConfig = buildStageConfig('reverseOutlineShort', settings.reverseOutlineShortPrompt);
    const longSummaryConfig = buildStageConfig('reverseOutlineLongSummary', settings.reverseOutlineLongSummaryPrompt);
    const longFinalConfig = buildStageConfig('reverseOutlineLongFinal', settings.reverseOutlineLongFinalPrompt);
    return {
      primaryConfig: articleType === 'short' ? shortConfig : longSummaryConfig,
      shortConfig,
      longSummaryConfig,
      longFinalConfig,
    };
  };

  const startAnalysis = async () => {
    if (selectedPaths.length === 0) {
      message.warning('请先选择文章');
      return;
    }
    if (articleType === 'long' && !orderConfirmed) {
      message.warning('请先确认章节顺序');
      return;
    }
    const reverseOutlineConfig = settings.agentConfigs?.reverseOutline;
    const {
      primaryConfig,
      shortConfig,
      longSummaryConfig,
      longFinalConfig,
    } = buildReverseOutlineRequestBase();
    setStage('running');
    setProgress(null);
    setFinalStreamContent('');
    activeRunIdRef.current = null;
    try {
      const result = await invoke<{ runId: string }>('start_reverse_outline_analysis', {
        request: {
          modelInterface: primaryConfig.modelInterface,
          baseUrl: primaryConfig.baseUrl,
          apiKey: primaryConfig.apiKey,
          model: primaryConfig.model,
          articleType,
          filePaths: selectedPaths,
          temperature: primaryConfig.temperature,
          maxOutputTokens: primaryConfig.maxOutputTokens,
          maxContextTokens: primaryConfig.maxContextTokens,
          thinkingDepth: primaryConfig.thinkingDepth,
          systemPrompt: primaryConfig.systemPrompt,
          concurrency: reverseOutlineConfig?.concurrency,
          shortConfig,
          longSummaryConfig,
          longFinalConfig,
        },
      });
      activeRunIdRef.current = result.runId;
    } catch (error) {
      setStage('idle');
      message.error(`反向分析失败: ${error}`);
    }
  };

  const retryAnalysis = async () => {
    if (failedBatchIndices.length === 0) return;
    const reverseOutlineConfig = settings.agentConfigs?.reverseOutline;
    const longSummaryConfig = buildStageConfig('reverseOutlineLongSummary', settings.reverseOutlineLongSummaryPrompt);
    const longFinalConfig = buildStageConfig('reverseOutlineLongFinal', settings.reverseOutlineLongFinalPrompt);
    setStage('running');
    setProgress(null);
    setFinalStreamContent('');
    activeRunIdRef.current = null;
    try {
      const result = await invoke<{ runId: string }>('retry_and_finalize_reverse_outline', {
        request: {
          modelInterface: longSummaryConfig.modelInterface,
          baseUrl: longSummaryConfig.baseUrl,
          apiKey: longSummaryConfig.apiKey,
          model: longSummaryConfig.model,
          filePaths: selectedPaths,
          temperature: longSummaryConfig.temperature,
          maxOutputTokens: longSummaryConfig.maxOutputTokens,
          maxContextTokens: longSummaryConfig.maxContextTokens,
          thinkingDepth: longSummaryConfig.thinkingDepth,
          systemPrompt: longSummaryConfig.systemPrompt,
          concurrency: reverseOutlineConfig?.concurrency,
          longSummaryConfig,
          longFinalConfig,
          failedBatchIndices,
          partialSummaries,
        },
      });
      activeRunIdRef.current = result.runId;
    } catch (error) {
      setStage('retry');
      message.error(`重试失败: ${error}`);
    }
  };

  const finalizeWithPartialSummaries = async () => {
    if (partialSummaries.length === 0) {
      message.warning('暂无可用于汇总的成功段落');
      return;
    }
    const reverseOutlineConfig = settings.agentConfigs?.reverseOutline;
    const longSummaryConfig = buildStageConfig('reverseOutlineLongSummary', settings.reverseOutlineLongSummaryPrompt);
    const longFinalConfig = buildStageConfig('reverseOutlineLongFinal', settings.reverseOutlineLongFinalPrompt);
    setStage('running');
    setFinalStreamContent('');
    activeRunIdRef.current = null;
    setProgress({
      runId: '',
      phase: 'final',
      totalChapters: partialSummaries.length,
      successChapters: partialSummaries.length,
      failedChapters: failedBatchIndices.length,
      message: '正在汇总生成长篇反向大纲',
    });
    try {
      const result = await invoke<{ runId: string }>('retry_and_finalize_reverse_outline', {
        request: {
          modelInterface: longFinalConfig.modelInterface,
          baseUrl: longFinalConfig.baseUrl,
          apiKey: longFinalConfig.apiKey,
          model: longFinalConfig.model,
          filePaths: selectedPaths,
          temperature: longFinalConfig.temperature,
          maxOutputTokens: longFinalConfig.maxOutputTokens,
          maxContextTokens: longFinalConfig.maxContextTokens,
          thinkingDepth: longFinalConfig.thinkingDepth,
          systemPrompt: longFinalConfig.systemPrompt,
          concurrency: reverseOutlineConfig?.concurrency,
          longSummaryConfig,
          longFinalConfig,
          failedBatchIndices: [],
          partialSummaries,
        },
      });
      activeRunIdRef.current = result.runId;
    } catch (error) {
      setStage('retry');
      message.error(`汇总失败: ${error}`);
    }
  };

  const saveOutline = async () => {
    if (!outlineTitle.trim()) {
      message.warning('请填写大纲标题');
      return;
    }
    if (!outlineContent.trim()) {
      message.warning('请填写大纲内容');
      return;
    }
    try {
      await invoke('save_reverse_outline', {
        request: {
          title: outlineTitle,
          content: outlineContent,
        },
      });
      message.success('大纲已保存');
      closeModal();
    } catch (error) {
      message.error(`保存失败: ${error}`);
    }
  };

  const renderSourceGroup = (title: string, tree: SourceTree) => (
    <div>
      <div style={sectionTitleStyle}>{title}</div>
      <div style={sourceListStyle}>
        {tree.nodes.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可选文章" />
        ) : (
          <Tree
            blockNode
            checkable
            checkedKeys={selectedPaths.filter(path => tree.nodePaths.includes(path))}
            onCheck={checkedKeys => updateSelectedSource(tree, checkedKeys)}
            selectable={false}
            treeData={tree.nodes}
          />
        )}
      </div>
    </div>
  );

  const renderSelection = () => (
    <Space orientation="vertical" size={18} style={{ width: '100%' }}>
      <Radio.Group
        value={articleType}
        onChange={event => setArticleType(event.target.value)}
        optionType="button"
        buttonStyle="solid"
      >
        <Radio.Button value="short">短篇</Radio.Button>
        <Radio.Button value="long">长篇</Radio.Button>
      </Radio.Group>

      <Spin spinning={loadingSources}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {renderSourceGroup('作品目录', articleSourceTree)}
          {renderSourceGroup('范文目录', referenceSourceTree)}
        </div>
      </Spin>

      {articleType === 'long' && (
        <Space orientation="vertical" size={10} style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            title="此为字母顺序排列，如果顺序不对，请重命名文件"
          />
          <Spin spinning={loadingPreview}>
            <div style={{ ...sourceListStyle, maxHeight: 190, minHeight: 100 }}>
              {chapters.length === 0 ? (
                <Typography.Text type="secondary">选择文章后展示章节顺序</Typography.Text>
              ) : (
                chapters.map((chapter, index) => (
                  <div key={chapter.path} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0' }}>
                    <span>{index + 1}. {chapter.title}</span>
                    <Typography.Text type="secondary">{chapter.charCount} 字</Typography.Text>
                  </div>
                ))
              )}
            </div>
          </Spin>
          <Checkbox checked={orderConfirmed} onChange={event => setOrderConfirmed(event.target.checked)}>
            我已确认章节顺序正确
          </Checkbox>
        </Space>
      )}
    </Space>
  );

  const renderRunning = () => {
    if (articleType === 'short') {
      return (
        <div style={{ padding: '42px 0', textAlign: 'center' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#6f6861' }}>正在生成短篇反向大纲</div>
        </div>
      );
    }

    const total = progress?.totalChapters || 0;
    const done = (progress?.successChapters || 0) + (progress?.failedChapters || 0);
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;

    return (
      <Space orientation="vertical" size={18} style={{ width: '100%' }}>
        <Progress percent={percent} status={progress?.failedChapters ? 'exception' : 'active'} />
        <div style={{ display: 'flex', gap: 18, color: '#6f6861' }}>
          <span>总批次：{total}</span>
          <span>成功：{progress?.successChapters || 0}</span>
          <span>失败：{progress?.failedChapters || 0}</span>
        </div>
        {progress?.phase === 'final' ? (
          <Space orientation="vertical" size={10} style={{ width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#6f6861' }}>
              <Spin size="small" />
              <span>正在汇总生成长篇反向大纲</span>
            </div>
            <Input.TextArea
              value={finalStreamContent || '等待模型输出...'}
              readOnly
              rows={10}
              style={{
                background: '#faf9f5',
                color: finalStreamContent ? '#33312e' : '#8c8178',
                borderColor: '#eadfd6',
                resize: 'none',
              }}
            />
          </Space>
        ) : (
          <Typography.Text type="secondary">正在分布式分析每 10 段内容</Typography.Text>
        )}
      </Space>
    );
  };

  const renderPreview = () => (
    <Space orientation="vertical" size={14} style={{ width: '100%' }}>
      <Input
        aria-label="大纲标题"
        value={outlineTitle}
        onChange={event => setOutlineTitle(event.target.value)}
        placeholder="大纲标题"
      />
      <Input.TextArea
        aria-label="大纲内容"
        value={outlineContent}
        onChange={event => setOutlineContent(event.target.value)}
        autoSize={{ minRows: 14, maxRows: 22 }}
        placeholder="大纲内容"
      />
    </Space>
  );

  const renderRetry = () => {
    const total = progress?.totalChapters || 0;
    const success = progress?.successChapters || 0;
    const failed = progress?.failedChapters || 0;
    const percent = total > 0 ? Math.round((success / total) * 100) : 0;
    const visibleFailures = failedBatchErrors.length > 0
      ? failedBatchErrors
      : failedBatchIndices.map(index => ({
        index,
        range: `${index * 10 + 1}-${index * 10 + 10}`,
        error: '未返回失败原因',
      }));

    return (
      <Space orientation="vertical" size={18} style={{ width: '100%' }}>
        <Progress percent={percent} status="exception" />
        <div style={{ display: 'flex', gap: 18, color: '#6f6861' }}>
          <span>总段落：{total}</span>
          <span>成功：{success}</span>
          <span>失败：{failed}</span>
        </div>
        <Alert
          type="warning"
          showIcon
          message="部分段落分析失败"
          description={
            <Space orientation="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text>
                以下段落分析失败，可以重试失败段落，也可以直接汇总已成功段落。
              </Typography.Text>
              <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                {visibleFailures.map(failure => (
                  <div
                    key={`${failure.index}-${failure.range}`}
                    style={{
                      padding: '8px 0',
                      borderBottom: '1px solid rgba(217, 119, 87, 0.12)',
                    }}
                  >
                    <Typography.Text strong>批次 {failure.index + 1}（段落 {failure.range}）</Typography.Text>
                    <Typography.Paragraph style={{ margin: '4px 0 0', color: '#8c5140', whiteSpace: 'pre-wrap' }}>
                      {failure.error}
                    </Typography.Paragraph>
                  </div>
                ))}
              </div>
            </Space>
          }
        />
      </Space>
    );
  };

  const selectedArticleCount = countSelectedFiles(articleSourceTree, selectedPaths);
  const selectedReferenceCount = countSelectedFiles(referenceSourceTree, selectedPaths);

  const renderFooter = () => {
    if (stage === 'preview') {
      return (
        <Space>
          <Button onClick={closeModal}>取消</Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={saveOutline}>保存到大纲目录</Button>
        </Space>
      );
    }
    if (stage === 'retry') {
      return (
        <Space>
          <Button onClick={closeModal}>取消</Button>
          <Button
            onClick={finalizeWithPartialSummaries}
            disabled={partialSummaries.length === 0}
          >
            继续汇总已成功段落
          </Button>
          <Button
            type="primary"
            icon={<RedoOutlined />}
            onClick={retryAnalysis}
          >
            重试失败段落
          </Button>
        </Space>
      );
    }
    return (
      <Space>
        <Button onClick={closeModal} disabled={stage === 'running'}>取消</Button>
        <Button
          type="primary"
          loading={stage === 'running'}
          disabled={selectedPaths.length === 0 || (articleType === 'long' && !orderConfirmed)}
          onClick={startAnalysis}
        >
          开始分析
        </Button>
      </Space>
    );
  };

  return (
    <Modal
      title={<span><FileSearchOutlined style={{ color: '#d97757', marginRight: 8 }} />AI反向分析大纲</span>}
      open={open}
      onCancel={closeModal}
      width={820}
      destroyOnHidden
      footer={renderFooter()}
      maskClosable={stage !== 'running'}
      keyboard={stage !== 'running'}
      closable={stage !== 'running'}
    >
      {stage === 'idle' && renderSelection()}
      {stage === 'running' && renderRunning()}
      {stage === 'retry' && renderRetry()}
      {stage === 'preview' && renderPreview()}
      {(stage === 'idle' || stage === 'retry') && selectedPaths.length > 0 && (
        <div style={{ marginTop: 12, color: '#8c8178' }}>
          已选择作品 {selectedArticleCount} 篇，范文 {selectedReferenceCount} 篇
        </div>
      )}
    </Modal>
  );
};

export default ReverseOutlineAnalysisModal;
