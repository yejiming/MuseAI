import React, { useEffect, useRef, useState } from 'react';
import WorkspaceDirectory from '../components/WorkspaceDirectory';
import MarkdownEditor from '../components/MarkdownEditor';
import OutlineCreationAgentChat from '../components/OutlineCreationAgentChat';
import OutlineAssessmentAgentChat from '../components/OutlineAssessmentAgentChat';
import { useOutlineStore } from '../stores/useOutlineStore';
import { defaultOutlineAssessmentPrompt, useSettingsStore } from '../stores/useSettingsStore';
import { Button, Popover, Progress, Select, Popconfirm, message } from 'antd';
import { RobotOutlined, CheckCircleOutlined, DeleteOutlined } from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { ScoreDetailsModal } from '../components/ScoreDetailsModal';

const MIN_FILE_TREE_WIDTH = 250;
const MAX_FILE_TREE_WIDTH = 420;
const EDITOR_MIN_WIDTH = 400;
const MIN_AGENT_WIDTH = 380;
const MAX_AGENT_WIDTH = 860;

interface VersionInfo {
  id: string;
  timestamp: number;
  aiScore?: number | null;
  suggestion?: string | null;
}

const Outline: React.FC = () => {
  const [isResizingFileTree, setIsResizingFileTree] = useState(false);
  const [isResizingAgent, setIsResizingAgent] = useState(false);
  const [isAssessmentOpen, setIsAssessmentOpen] = useState(false);
  const [isScoreModalOpen, setIsScoreModalOpen] = useState(false);

  const fileTreeRef = useRef<HTMLDivElement>(null);
  const {
    selectedOutlineFile,
    setSelectedOutlineFile,
    fileTreeWidth,
    setFileTreeWidth,
    agentWidth,
    setAgentWidth,
    isAgentVisible,
    setIsAgentVisible,
    versions, setVersions,
    activeVersionId, setActiveVersionId,
    suggestion, setSuggestion,
    assessmentRunning, setAssessmentRunning,
    assessmentMessages, setAssessmentMessages,
    assessmentRun, setAssessmentRun
  } = useOutlineStore();

  const outlineAssessmentPrompt = useSettingsStore(state => state.outlineAssessmentPrompt) || defaultOutlineAssessmentPrompt;

  const getVersionPath = (workPath: string, versionId: string) => {
    const parts = workPath.split(/[\\/]/);
    const fileName = parts.pop();
    const parentDir = parts.join('/');
    return `${parentDir}/.versions/${fileName}/${versionId}`;
  };

  const syncActiveVersionResult = (version: VersionInfo | null) => {
    setSuggestion(version?.suggestion?.trim() || null);
  };

  const refreshVersions = async (nextActiveVersionId = activeVersionId) => {
    if (!selectedOutlineFile) return [];
    const result = await invoke<VersionInfo[]>('list_file_versions', { path: selectedOutlineFile });
    const sorted = result.sort((a, b) => b.timestamp - a.timestamp);
    setVersions(sorted);
    const currentVersion = nextActiveVersionId
      ? sorted.find(version => version.id === nextActiveVersionId) ?? null
      : null;
    syncActiveVersionResult(currentVersion);
    return sorted;
  };

  useEffect(() => {
    if (selectedOutlineFile) {
      invoke('list_file_versions', { path: selectedOutlineFile })
        .then((v: any) => {
          const sorted = v.sort((a: any, b: any) => b.timestamp - a.timestamp);
          setVersions(sorted);
          if (sorted.length > 0) {
            setActiveVersionId(sorted[0].id);
            syncActiveVersionResult(sorted[0]);
          } else {
            setActiveVersionId(null);
            syncActiveVersionResult(null);
          }
        })
        .catch(console.error);
    } else {
      setVersions([]);
      setActiveVersionId(null);
      syncActiveVersionResult(null);
    }
  }, [selectedOutlineFile, setVersions, setActiveVersionId, setSuggestion]);

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

  let parsedAssessment: any = null;
  let totalScore = 0;
  if (suggestion) {
    try {
      parsedAssessment = JSON.parse(suggestion);
      const keys = ['引流能力', '开局钩子', '设定新鲜感', '情绪爽点密度', '人设代入与话题性'];
      let sum = 0;
      keys.forEach(k => {
        if (typeof parsedAssessment[k] === 'number') {
          sum += parsedAssessment[k];
        }
      });
      totalScore = sum;
    } catch (e) {
      // Ignore parse error
    }
  }

  const assessmentStartContent = selectedOutlineFile
    ? `请分析大纲: ${activeVersionId ? getVersionPath(selectedOutlineFile, activeVersionId) : selectedOutlineFile}`
    : '';

  useEffect(() => {
    setIsScoreModalOpen(false);
  }, [selectedOutlineFile]);

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
            title="大纲目录"
            dirType="outline"
            selectedFile={selectedOutlineFile}
            onSelectFile={setSelectedOutlineFile}
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
            {selectedOutlineFile ? (
              <div className="de-ai-editor-toolbar__primary">
                <Button
                  type={isAssessmentOpen ? "default" : "primary"}
                  icon={<CheckCircleOutlined />}
                  onClick={() => setIsAssessmentOpen(!isAssessmentOpen)}
                  style={{
                    background: isAssessmentOpen ? '#fff' : '#d97757',
                    color: isAssessmentOpen ? '#333' : '#fff',
                    border: isAssessmentOpen ? '1px solid #d9d9d9' : 'none',
                    boxShadow: isAssessmentOpen ? 'none' : '0 4px 12px rgba(217, 119, 87, 0.2)'
                  }}
                >
                  大纲评分
                </Button>
              </div>
            ) : <span />}

            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flex: '1 1 auto', justifyContent: 'flex-end', minWidth: 0 }}>
              {selectedOutlineFile && (
                <div className="de-ai-editor-toolbar__meta" style={{ flex: '0 1 auto' }}>
                  <Select
                    className="de-ai-version-select"
                    style={{ width: 240 }}
                    value={activeVersionId || 'original'}
                    onChange={(val) => {
                      if (val === 'original') {
                        setActiveVersionId(null);
                        syncActiveVersionResult(null);
                      } else {
                        setActiveVersionId(val);
                        const v = versions.find(x => x.id === val);
                        syncActiveVersionResult(v ?? null);
                      }
                    }}
                    options={[
                      { value: 'original', label: '原文件' },
                      ...versions.map(v => ({
                        value: v.id,
                        label: `版本 ${new Date(v.timestamp).toLocaleString()}`
                      }))
                    ]}
                  />
                  {activeVersionId && (
                    <Popconfirm title="确定删除该版本？" onConfirm={async () => {
                      try {
                        await invoke('delete_file_version', { path: selectedOutlineFile, versionId: activeVersionId });
                        setVersions(versions.filter(v => v.id !== activeVersionId));
                        setActiveVersionId(null);
                        syncActiveVersionResult(null);
                        message.success('已删除版本');
                      } catch (e) {
                        message.error(`删除失败: ${e}`);
                      }
                    }}>
                      <Button className="de-ai-delete-version" type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  )}
                  <Popover
                    placement="bottomRight"
                    content={
                      parsedAssessment ? (
                        <div style={{ minWidth: 200 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span>引流能力</span><span>{parsedAssessment['引流能力']}/20</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span>开局钩子</span><span>{parsedAssessment['开局钩子']}/20</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span>设定新鲜感</span><span>{parsedAssessment['设定新鲜感']}/20</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span>情绪爽点密度</span><span>{parsedAssessment['情绪爽点密度']}/20</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span>人设代入与话题性</span><span>{parsedAssessment['人设代入与话题性']}/20</span>
                          </div>
                        </div>
                      ) : (
                        <div style={{ padding: '8px 16px', color: '#999' }}>暂无评估结果</div>
                      )
                    }
                  >
                    <div 
                      className="de-ai-score-pill" 
                      style={{ cursor: 'pointer' }} 
                      aria-label={`大纲评分${parsedAssessment ? totalScore : '暂无'}`}
                      onClick={() => {
                        if (parsedAssessment) {
                          setIsScoreModalOpen(true);
                        }
                      }}
                    >
                      <span className="de-ai-score-pill__label">大纲分</span>
                      <Progress 
                        type="circle" 
                        percent={parsedAssessment ? totalScore : 0} 
                        size={30} 
                        format={(p) => parsedAssessment ? p : '--'}
                        status={parsedAssessment ? (totalScore > 80 ? 'success' : 'normal') : 'normal'}
                        strokeColor={parsedAssessment ? undefined : "#e8e8e8"} 
                      />
                    </div>
                  </Popover>
                  
                  <ScoreDetailsModal 
                    isOpen={isScoreModalOpen} 
                    onClose={() => setIsScoreModalOpen(false)} 
                    parsedAssessment={parsedAssessment} 
                    totalScore={totalScore} 
                  />
                </div>
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
            <MarkdownEditor filePath={activeVersionId ? getVersionPath(selectedOutlineFile!, activeVersionId) : selectedOutlineFile} />
          </div>

          {isAssessmentOpen && (
            <div style={{ height: 350, borderTop: '1px solid #e8e8e8', background: '#fff' }}>
              <OutlineAssessmentAgentChat
                title="大纲评估 Agent"
                agentId="outlineAssessment"
                systemPrompt={outlineAssessmentPrompt}
                allowedTools={['read', 'grep', 'glob']}
                startContent={assessmentStartContent}
                startDisabled={!selectedOutlineFile}
                messages={assessmentMessages}
                setMessages={setAssessmentMessages}
                activeRun={assessmentRun}
                setActiveRun={setAssessmentRun}
                isRunning={assessmentRunning}
                onRunningChange={setAssessmentRunning}
                onBeforeStart={async () => {
                  if (activeVersionId) {
                    return {
                      content: `请分析大纲: ${getVersionPath(selectedOutlineFile!, activeVersionId)}`,
                    };
                  }
                  const newVersion = await invoke<VersionInfo>('create_file_version', { path: selectedOutlineFile! });
                  setActiveVersionId(newVersion.id);
                  await refreshVersions(newVersion.id);
                  return {
                    content: `请分析大纲: ${getVersionPath(selectedOutlineFile!, newVersion.id)}`,
                  };
                }}
                onDone={async (lastMessage: string) => {
                  const state = useOutlineStore.getState();
                  if (!state.selectedOutlineFile) return;
                  const versionToUpdate = state.activeVersionId;
                  if (!versionToUpdate) return;
                  try {
                    const jsonMatch = lastMessage.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                      const jsonStr = jsonMatch[0];
                      // Verify it is parsable
                      const parsed = JSON.parse(jsonStr);
                      // Calculate total score for aiScore field (optional, we use suggestion for JSON)
                      let sum = 0;
                      ['引流能力', '开局钩子', '设定新鲜感', '情绪爽点密度', '人设代入与话题性'].forEach(k => {
                        if (typeof parsed[k] === 'number') sum += parsed[k];
                      });
                      
                      try {
                        await invoke('update_version_ai_result', {
                          path: state.selectedOutlineFile,
                          versionId: versionToUpdate,
                          score: Math.round(sum),
                          suggestion: jsonStr,
                        });
                        await refreshVersions(versionToUpdate);
                      } catch (err) {
                        console.error('update_version_ai_result error:', err);
                        return `保存结果到本地失败：${err}。请检查 JSON 格式是否完全合法，然后重新输出。`;
                      }
                    } else {
                      return '未能提取到合法的 JSON 格式。请务必严格按照要求，只输出一段 JSON 数据，不要包含任何前缀、代码块标记或解释性文字。请重新输出。';
                    }
                  } catch (e) {
                    console.error('Failed to parse assessment JSON', e);
                    return `JSON 解析失败：${e}。请检查 JSON 语法是否有误（如缺少引号、多余逗号等），然后重新输出合法的 JSON 格式。`;
                  }
                }}
              />
            </div>
          )}

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
            <OutlineCreationAgentChat title="大纲制作 Agent" onClose={() => setIsAgentVisible(false)} />
          </div>
        )}
      </div>
    </div>
  );
};

export default Outline;
