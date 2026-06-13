import React, { useCallback, useEffect, useRef, useState } from 'react';
import WorkspaceDirectory from '../components/WorkspaceDirectory';
import MarkdownEditor from '../components/MarkdownEditor';
import OutlineCreationAgentChat from '../components/OutlineCreationAgentChat';
import OutlineAssessmentAgentChat from '../components/OutlineAssessmentAgentChat';
import ReverseOutlineAnalysisModal from '../components/ReverseOutlineAnalysisModal';
import { useOutlineStore } from '../stores/useOutlineStore';
import { defaultOutlineAssessmentPrompt, useSettingsStore } from '../stores/useSettingsStore';
import { Button, Popover, Progress, Select, Popconfirm, message } from 'antd';
import { RobotOutlined, CheckCircleOutlined, DeleteOutlined, FileSearchOutlined } from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { ScoreDetailsModal } from '../components/ScoreDetailsModal';

const MIN_FILE_TREE_WIDTH = 250;
const MAX_FILE_TREE_WIDTH = 420;
const EDITOR_MIN_WIDTH = 400;
const MIN_AGENT_WIDTH = 380;
const MAX_AGENT_WIDTH = 860;
const RESIZE_KEYBOARD_STEP = 16;
const OUTLINE_SCORE_KEYS = ['引流能力', '开局钩子', '设定新鲜感', '情绪爽点密度', '人设代入与话题性'];

const clampDimension = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

interface VersionInfo {
  id: string;
  timestamp: number;
  aiScore?: number | null;
  suggestion?: string | null;
}

const getVersionPath = (workPath: string, versionId: string) => {
  const parts = workPath.split(/[\\/]/);
  const fileName = parts.pop();
  const parentDir = parts.join('/');
  return `${parentDir}/.versions/${fileName}/${versionId}`;
};

const Outline: React.FC = () => {
  const [scoreModalFile, setScoreModalFile] = useState<string | null>(null);
  const [isReverseOutlineOpen, setIsReverseOutlineOpen] = useState(false);

  const fileTreeRef = useRef<HTMLDivElement>(null);
  const fileTreeResizeCleanupRef = useRef<(() => void) | null>(null);
  const agentResizeCleanupRef = useRef<(() => void) | null>(null);
  const {
    selectedOutlineFile,
    setSelectedOutlineFile,
    fileTreeWidth,
    setFileTreeWidth,
    agentWidth,
    setAgentWidth,
    isAgentVisible,
    setIsAgentVisible,
    isAssessmentOpen,
    setIsAssessmentOpen,
    versions, setVersions,
    activeVersionId, setActiveVersionId,
    suggestion, setSuggestion,
    assessmentRunning, setAssessmentRunning,
    assessmentMessages, setAssessmentMessages,
    assessmentRun, setAssessmentRun
  } = useOutlineStore();

  const outlineAssessmentPrompt = useSettingsStore(state => state.outlineAssessmentPrompt) || defaultOutlineAssessmentPrompt;
  const isScoreModalOpen = Boolean(scoreModalFile && scoreModalFile === selectedOutlineFile && suggestion);

  const syncActiveVersionResult = useCallback((version: VersionInfo | null) => {
    setSuggestion(version?.suggestion?.trim() || null);
  }, [setSuggestion]);

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
  }, [selectedOutlineFile, setVersions, setActiveVersionId, syncActiveVersionResult]);

  const stopFileTreeResize = useCallback(() => {
    fileTreeResizeCleanupRef.current?.();
    fileTreeResizeCleanupRef.current = null;
  }, []);

  const stopAgentResize = useCallback(() => {
    agentResizeCleanupRef.current?.();
    agentResizeCleanupRef.current = null;
  }, []);

  const startFileTreeResize = useCallback(() => {
    if (fileTreeResizeCleanupRef.current) return;
    stopAgentResize();
    const handleMouseMove = (event: MouseEvent) => {
      const fileTreeLeft = fileTreeRef.current?.getBoundingClientRect().left ?? 0;
      const nextWidth = Math.min(Math.max(event.clientX - fileTreeLeft, MIN_FILE_TREE_WIDTH), MAX_FILE_TREE_WIDTH);
      setFileTreeWidth(nextWidth);
    };
    const handleMouseUp = () => stopFileTreeResize();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    fileTreeResizeCleanupRef.current = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [setFileTreeWidth, stopAgentResize, stopFileTreeResize]);

  const startAgentResize = useCallback(() => {
    if (agentResizeCleanupRef.current) return;
    stopFileTreeResize();
    const handleMouseMove = (event: MouseEvent) => {
      // agent is on the right, so we calculate from the right edge
      const windowWidth = window.innerWidth;
      const nextWidth = Math.min(Math.max(windowWidth - event.clientX, MIN_AGENT_WIDTH), MAX_AGENT_WIDTH);
      setAgentWidth(nextWidth);
    };
    const handleMouseUp = () => stopAgentResize();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    agentResizeCleanupRef.current = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [setAgentWidth, stopAgentResize, stopFileTreeResize]);

  useEffect(() => () => {
    stopFileTreeResize();
    stopAgentResize();
  }, [stopAgentResize, stopFileTreeResize]);

  let parsedAssessment: any = null;
  let totalScore = 0;
  if (suggestion) {
    try {
      parsedAssessment = JSON.parse(suggestion);
      let sum = 0;
      OUTLINE_SCORE_KEYS.forEach(k => {
        if (typeof parsedAssessment[k] === 'number') {
          sum += parsedAssessment[k];
        }
      });
      totalScore = Number(sum.toFixed(1));
    } catch (e) {
      // Ignore parse error
    }
  }

  const assessmentStartContent = selectedOutlineFile
    ? `请分析大纲: ${activeVersionId ? getVersionPath(selectedOutlineFile, activeVersionId) : selectedOutlineFile}`
    : '';

  const handleVersionChange = (val: string) => {
    if (val === 'original') {
      setActiveVersionId(null);
      syncActiveVersionResult(null);
      return;
    }
    setActiveVersionId(val);
    const version = versions.find((item) => item.id === val);
    syncActiveVersionResult(version ?? null);
  };

  const handleDeleteActiveVersion = async () => {
    if (!selectedOutlineFile || !activeVersionId) return;
    try {
      await invoke('delete_file_version', { path: selectedOutlineFile, versionId: activeVersionId });
      setVersions(versions.filter((version) => version.id !== activeVersionId));
      setActiveVersionId(null);
      syncActiveVersionResult(null);
      message.success('已删除版本');
    } catch (e) {
      message.error(`删除失败: ${e}`);
    }
  };

  const handleBeforeAssessmentStart = async () => {
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
  };

  const handleAssessmentDone = async (lastMessage: string) => {
    const state = useOutlineStore.getState();
    if (!state.selectedOutlineFile) return;
    const versionToUpdate = state.activeVersionId;
    if (!versionToUpdate) return;
    try {
      const jsonMatch = lastMessage.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return '未能提取到合法的 JSON 格式。请务必严格按照要求，只输出一段 JSON 数据，不要包含任何前缀、代码块标记或解释性文字。请重新输出。';
      }
      const jsonStr = jsonMatch[0];
      const parsed = JSON.parse(jsonStr);
      let sum = 0;
      OUTLINE_SCORE_KEYS.forEach((key) => {
        if (typeof parsed[key] === 'number') sum += parsed[key];
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
    } catch (e) {
      console.error('Failed to parse assessment JSON', e);
      return `JSON 解析失败：${e}。请检查 JSON 语法是否有误（如缺少引号、多余逗号等），然后重新输出合法的 JSON 格式。`;
    }
  };

  const handleFileTreeSeparatorKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? RESIZE_KEYBOARD_STEP : -RESIZE_KEYBOARD_STEP;
    setFileTreeWidth(clampDimension(fileTreeWidth + delta, MIN_FILE_TREE_WIDTH, MAX_FILE_TREE_WIDTH));
  };

  const handleAgentSeparatorKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? RESIZE_KEYBOARD_STEP : -RESIZE_KEYBOARD_STEP;
    setAgentWidth(clampDimension(agentWidth + delta, MIN_AGENT_WIDTH, MAX_AGENT_WIDTH));
  };

  return (
    <OutlineLayout
      activeVersionId={activeVersionId}
      agentWidth={agentWidth}
      assessmentMessages={assessmentMessages}
      assessmentPrompt={outlineAssessmentPrompt}
      assessmentRun={assessmentRun}
      assessmentRunning={assessmentRunning}
      assessmentStartContent={assessmentStartContent}
      editorFilePath={activeVersionId ? getVersionPath(selectedOutlineFile!, activeVersionId) : selectedOutlineFile}
      fileTreeRef={fileTreeRef}
      fileTreeWidth={fileTreeWidth}
      layoutState={{ isAgentVisible, isAssessmentOpen, isReverseOutlineOpen, isScoreModalOpen }}
      parsedAssessment={parsedAssessment}
      selectedOutlineFile={selectedOutlineFile}
      totalScore={totalScore}
      versions={versions}
      onAgentResizeKeyDown={handleAgentSeparatorKeyDown}
      onBeforeAssessmentStart={handleBeforeAssessmentStart}
      onCloseAgent={() => setIsAgentVisible(false)}
      onCloseReverseOutline={() => setIsReverseOutlineOpen(false)}
      onCloseScoreModal={() => setScoreModalFile(null)}
      onDeleteActiveVersion={handleDeleteActiveVersion}
      onDoneAssessment={handleAssessmentDone}
      onOpenAgent={() => setIsAgentVisible(true)}
      onOpenReverseOutline={() => setIsReverseOutlineOpen(true)}
      onSelectFile={setSelectedOutlineFile}
      onSetAssessmentMessages={setAssessmentMessages}
      onSetAssessmentRun={setAssessmentRun}
      onSetAssessmentRunning={setAssessmentRunning}
      onSetScoreModalFile={setScoreModalFile}
      onStartAgentResize={startAgentResize}
      onStartFileTreeResize={startFileTreeResize}
      onToggleAssessment={() => setIsAssessmentOpen(!isAssessmentOpen)}
      onTreeResizeKeyDown={handleFileTreeSeparatorKeyDown}
      onVersionChange={handleVersionChange}
    />
  );
};

interface OutlineLayoutProps {
  activeVersionId: string | null;
  agentWidth: number;
  assessmentMessages: any;
  assessmentPrompt: string;
  assessmentRun: any;
  assessmentRunning: boolean;
  assessmentStartContent: string;
  editorFilePath: string | null;
  fileTreeRef: React.RefObject<HTMLDivElement | null>;
  fileTreeWidth: number;
  layoutState: {
    isAgentVisible: boolean;
    isAssessmentOpen: boolean;
    isReverseOutlineOpen: boolean;
    isScoreModalOpen: boolean;
  };
  parsedAssessment: any;
  selectedOutlineFile: string | null;
  totalScore: number;
  versions: VersionInfo[];
  onAgentResizeKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onBeforeAssessmentStart: () => Promise<{ content: string } | undefined>;
  onCloseAgent: () => void;
  onCloseReverseOutline: () => void;
  onCloseScoreModal: () => void;
  onDeleteActiveVersion: () => void;
  onDoneAssessment: (lastMessage: string) => Promise<string | undefined>;
  onOpenAgent: () => void;
  onOpenReverseOutline: () => void;
  onSelectFile: (file: string | null) => void;
  onSetAssessmentMessages: any;
  onSetAssessmentRun: any;
  onSetAssessmentRunning: (running: boolean) => void;
  onSetScoreModalFile: (file: string | null) => void;
  onStartAgentResize: () => void;
  onStartFileTreeResize: () => void;
  onToggleAssessment: () => void;
  onTreeResizeKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onVersionChange: (versionId: string) => void;
}

const OutlineLayout: React.FC<OutlineLayoutProps> = ({
  activeVersionId,
  agentWidth,
  assessmentMessages,
  assessmentPrompt,
  assessmentRun,
  assessmentRunning,
  assessmentStartContent,
  editorFilePath,
  fileTreeRef,
  fileTreeWidth,
  layoutState,
  parsedAssessment,
  selectedOutlineFile,
  totalScore,
  versions,
  onAgentResizeKeyDown,
  onBeforeAssessmentStart,
  onCloseAgent,
  onCloseReverseOutline,
  onCloseScoreModal,
  onDeleteActiveVersion,
  onDoneAssessment,
  onOpenAgent,
  onOpenReverseOutline,
  onSelectFile,
  onSetAssessmentMessages,
  onSetAssessmentRun,
  onSetAssessmentRunning,
  onSetScoreModalFile,
  onStartAgentResize,
  onStartFileTreeResize,
  onToggleAssessment,
  onTreeResizeKeyDown,
  onVersionChange,
}) => {
  const { isAgentVisible, isAssessmentOpen, isReverseOutlineOpen, isScoreModalOpen } = layoutState;

  return (
  <div style={{ height: '100%', width: '100%', overflowX: 'hidden', overflowY: 'hidden', background: '#faf9f5' }}>
    <div style={{ display: 'flex', height: '100%', minWidth: fileTreeWidth + EDITOR_MIN_WIDTH + (isAgentVisible ? agentWidth : 0) }}>
      <div ref={fileTreeRef} style={{ width: fileTreeWidth, minWidth: fileTreeWidth, position: 'relative', borderRight: '1px solid rgba(0, 0, 0, 0.04)', background: 'rgba(255, 255, 255, 0.3)' }}>
        <WorkspaceDirectory
          title="大纲目录"
          dirType="outline"
          selectedFile={selectedOutlineFile}
          onSelectFile={onSelectFile}
          footer={
            <Button block icon={<FileSearchOutlined />} onClick={onOpenReverseOutline} style={{ borderColor: 'rgba(217, 119, 87, 0.28)', color: '#9f513a', background: '#fffdfa', height: 38, boxShadow: '0 4px 12px rgba(217, 119, 87, 0.08)' }}>
              AI反向分析大纲
            </Button>
          }
        />
        <div
          aria-label="调整文件树宽度"
          aria-orientation="vertical"
          role="separator"
          tabIndex={0}
          onMouseDown={onStartFileTreeResize}
          onKeyDown={onTreeResizeKeyDown}
          style={{ position: 'absolute', top: 0, right: -3, width: 6, height: '100%', cursor: 'col-resize', zIndex: 2 }}
        />
      </div>

      <div style={{ flex: 1, minWidth: EDITOR_MIN_WIDTH, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <div className="de-ai-editor-toolbar">
          {selectedOutlineFile ? (
            <div className="de-ai-editor-toolbar__primary">
              <Button
                type={isAssessmentOpen ? "default" : "primary"}
                icon={<CheckCircleOutlined />}
                onClick={onToggleAssessment}
                style={{ background: isAssessmentOpen ? '#fff' : '#d97757', color: isAssessmentOpen ? '#333' : '#fff', border: isAssessmentOpen ? '1px solid #d9d9d9' : 'none', boxShadow: isAssessmentOpen ? 'none' : '0 4px 12px rgba(217, 119, 87, 0.2)' }}
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
                  onChange={onVersionChange}
                  options={[
                    { value: 'original', label: '原文件' },
                    ...versions.map((version) => ({ value: version.id, label: `版本 ${new Date(version.timestamp).toLocaleString()}` }))
                  ]}
                />
                {activeVersionId && (
                  <Popconfirm title="确定删除该版本？" onConfirm={onDeleteActiveVersion}>
                    <Button className="de-ai-delete-version" type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                )}
                <Popover
                  placement="bottomRight"
                  content={parsedAssessment ? (
                    <div style={{ minWidth: 200 }}>
                      {OUTLINE_SCORE_KEYS.map((key) => (
                        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span>{key}</span><span>{parsedAssessment[key]}/20</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: '8px 16px', color: '#999' }}>暂无评估结果</div>
                  )}
                >
                  <button
                    type="button"
                    className="de-ai-score-pill"
                    style={{ cursor: 'pointer', border: 0, background: 'transparent', padding: 0 }}
                    aria-label={`大纲评分${parsedAssessment ? totalScore : '暂无'}`}
                    onClick={() => {
                      if (parsedAssessment && selectedOutlineFile) onSetScoreModalFile(selectedOutlineFile);
                    }}
                  >
                    <span className="de-ai-score-pill__label">大纲分</span>
                    <Progress type="circle" percent={parsedAssessment ? totalScore : 0} size={30} format={(p) => parsedAssessment ? p : '--'} status={parsedAssessment ? (totalScore > 80 ? 'success' : 'normal') : 'normal'} strokeColor={parsedAssessment ? undefined : "#e8e8e8"} />
                  </button>
                </Popover>
                <ScoreDetailsModal isOpen={isScoreModalOpen} onClose={onCloseScoreModal} parsedAssessment={parsedAssessment} totalScore={totalScore} />
              </div>
            )}
            {!isAgentVisible && (
              <Button type="primary" icon={<RobotOutlined />} onClick={onOpenAgent} style={{ background: '#d97757', border: 'none', boxShadow: '0 4px 12px rgba(217, 119, 87, 0.2)', flexShrink: 0 }}>
                打开 Agent
              </Button>
            )}
          </div>
        </div>

        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <MarkdownEditor filePath={editorFilePath} />
        </div>

        {isAssessmentOpen && (
          <div style={{ height: 350, borderTop: '1px solid #e8e8e8', background: '#fff' }}>
            <OutlineAssessmentAgentChat
              title="大纲评估 Agent"
              agentId="outlineAssessment"
              systemPrompt={assessmentPrompt}
              allowedTools={['read', 'grep', 'glob']}
              startContent={assessmentStartContent}
              startDisabled={!selectedOutlineFile}
              messages={assessmentMessages}
              setMessages={onSetAssessmentMessages}
              activeRun={assessmentRun}
              setActiveRun={onSetAssessmentRun}
              isRunning={assessmentRunning}
              onRunningChange={onSetAssessmentRunning}
              onBeforeStart={onBeforeAssessmentStart}
              onDone={onDoneAssessment}
            />
          </div>
        )}
      </div>

      {isAgentVisible && (
        <div style={{ width: agentWidth, minWidth: agentWidth, position: 'relative', borderLeft: '1px solid rgba(0, 0, 0, 0.04)', background: '#fff' }}>
          <div
            aria-label="调整 Agent 宽度"
            aria-orientation="vertical"
            role="separator"
            tabIndex={0}
            onMouseDown={onStartAgentResize}
            onKeyDown={onAgentResizeKeyDown}
            style={{ position: 'absolute', top: 0, left: -3, width: 6, height: '100%', cursor: 'col-resize', zIndex: 2 }}
          />
          <OutlineCreationAgentChat title="大纲制作 Agent" onClose={onCloseAgent} />
        </div>
      )}
    </div>
    <ReverseOutlineAnalysisModal open={isReverseOutlineOpen} onClose={onCloseReverseOutline} />
  </div>
  );
};

export default Outline;
