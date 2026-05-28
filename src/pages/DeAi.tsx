import React, { useEffect, useRef, useState } from 'react';
import WorkspaceDirectory from '../components/WorkspaceDirectory';
import MarkdownEditor from '../components/MarkdownEditor';
import DeAiAgentChat from '../components/DeAiAgentChat';
import { useDeAiStore } from '../stores/useDeAiStore';
import { defaultDeAiDetectorPrompt, defaultDeAiRemoverPrompt, useSettingsStore } from '../stores/useSettingsStore';
import { Button, Empty, Modal, Popconfirm, Progress, Select, Tree, Typography, message } from 'antd';
import { DeleteOutlined, PlayCircleOutlined, SettingOutlined, StopOutlined } from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';

const MAX_LOOP_COUNT = 5;
const MIN_DIRECTORY_WIDTH = 250;
const DEFAULT_AGENT_WIDTH = 420;
const MIN_AGENT_WIDTH = 380;
const MAX_AGENT_WIDTH = 860;
const EDITOR_MIN_WIDTH = 400;

interface VersionInfo {
  id: string;
  timestamp: number;
  aiScore?: number | null;
  suggestion?: string | null;
}

interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
}

const DeAi: React.FC = () => {
  const { 
    selectedWorkFile, 
    selectedReferenceFile,
    setSelectedWorkFile,
    activePreviewFile,
    suggestion,
    aiScore,
    setAiScore,
    setSuggestion,
    isAutoLooping,
    setIsAutoLooping,
    autoLoopCount,
    setAutoLoopCount,
    detectorRunning,
    setDetectorRunning,
    removerRunning,
    setRemoverRunning,
    detectorMessages,
    setDetectorMessages,
    removerMessages,
    setRemoverMessages,
    detectorRun,
    setDetectorRun,
    removerRun,
    setRemoverRun,
    activeVersionId,
    setActiveVersionId,
    versions,
    setVersions,
    selectedDetectorReferences,
    setSelectedDetectorReferences,
  } = useDeAiStore();

  const [detectorInput, setDetectorInput] = useState<string | undefined>();
  const [removerInput, setRemoverInput] = useState<string | undefined>();
  const [directoryWidth, setDirectoryWidth] = useState(MIN_DIRECTORY_WIDTH);
  const [agentWidth, setAgentWidth] = useState(DEFAULT_AGENT_WIDTH);
  const [isResizingDirectory, setIsResizingDirectory] = useState(false);
  const [isResizingAgent, setIsResizingAgent] = useState(false);
  const [isDetectorSettingsOpen, setIsDetectorSettingsOpen] = useState(false);
  const [referenceFilesLoaded, setReferenceFilesLoaded] = useState(false);
  const directoryRef = useRef<HTMLDivElement>(null);
  const detectorTargetVersionIdRef = useRef<string | null>(null);
  const deAiDetectorPrompt = useSettingsStore(state => state.deAiDetectorPrompt) || defaultDeAiDetectorPrompt;
  const deAiRemoverPrompt = useSettingsStore(state => state.deAiRemoverPrompt) || defaultDeAiRemoverPrompt;
  const getVersionPath = (workPath: string, versionId: string) => {
    const parts = workPath.split(/[\\/]/);
    const fileName = parts.pop();
    const parentDir = parts.join('/');
    return `${parentDir}/.versions/${fileName}/${versionId}`;
  };

  const [allReferenceFiles, setAllReferenceFiles] = useState<string[]>([]);
  const [referenceTree, setReferenceTree] = useState<FileNode[]>([]);
  const activeVersion = activeVersionId ? versions.find((version: VersionInfo) => version.id === activeVersionId) : null;
  const persistedSuggestion = activeVersion?.suggestion?.trim() || null;

  const syncActiveVersionResult = (version: VersionInfo | null) => {
    setAiScore(version?.aiScore ?? null);
    setSuggestion(version?.suggestion?.trim() || null);
  };

  const refreshVersions = async (nextActiveVersionId = activeVersionId) => {
    if (!selectedWorkFile) return [];
    const result = await invoke<VersionInfo[]>('list_file_versions', { path: selectedWorkFile });
    const sorted = result.sort((a, b) => b.timestamp - a.timestamp);
    setVersions(sorted);
    const currentVersion = nextActiveVersionId
      ? sorted.find(version => version.id === nextActiveVersionId) ?? null
      : null;
    syncActiveVersionResult(currentVersion);
    return sorted;
  };

  useEffect(() => {
    const fetchRef = async () => {
      try {
        setReferenceFilesLoaded(false);
        const dir = await invoke<string>('get_workspace_dir', { dirType: 'references' });
        
        const fetchTree = async (path: string): Promise<FileNode[]> => {
          const items = await invoke<FileNode[]>('list_dir', { path });
          return Promise.all(items
            .filter((item) => item.name !== '.versions')
            .map(async (item) => (
              item.is_dir
                ? { ...item, children: await fetchTree(item.path) }
                : item
            )));
        };
        
        const collectFiles = (nodes: FileNode[]): string[] => {
          let res: string[] = [];
          for (const item of nodes) {
            if (item.is_dir) {
              res = res.concat(collectFiles(item.children ?? []));
            } else {
              res.push(item.path);
            }
          }
          return res;
        };

        const tree = await fetchTree(dir);
        setReferenceTree(tree);
        setAllReferenceFiles(collectFiles(tree));
        setReferenceFilesLoaded(true);
      } catch (e) {
        console.error(e);
        setReferenceFilesLoaded(true);
      }
    };
    fetchRef();
  }, []);

  useEffect(() => {
    if (!referenceFilesLoaded) return;
    setSelectedDetectorReferences((selected) =>
      selected.filter((file) => allReferenceFiles.includes(file))
    );
  }, [allReferenceFiles, referenceFilesLoaded, setSelectedDetectorReferences]);

  useEffect(() => {
    if (selectedWorkFile) {
      invoke('list_file_versions', { path: selectedWorkFile })
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
  }, [selectedWorkFile, setVersions, setActiveVersionId, setAiScore, setSuggestion]);

  const detectorReferenceText = selectedDetectorReferences.join('\n');
  const detectorStartContent = selectedWorkFile
    ? `请分析作品: ${activeVersionId ? getVersionPath(selectedWorkFile, activeVersionId) : selectedWorkFile}\n范例参考: ${detectorReferenceText}`
    : '';
  const removerStartContent = selectedWorkFile
    ? `请根据以下修改意见，直接修改作品 ${activeVersionId ? getVersionPath(selectedWorkFile, activeVersionId) : selectedWorkFile}，降低AI味：\n${suggestion || ''}`
    : '';

  const buildRecentSuggestionText = (sourceVersions: VersionInfo[], excludedSuggestion?: string) => {
    const normalizedExcludedSuggestion = excludedSuggestion?.trim();
    const recentSuggestions = sourceVersions
      .filter((version) => {
        const versionSuggestion = version.suggestion?.trim();
        return versionSuggestion && versionSuggestion !== normalizedExcludedSuggestion;
      })
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 3);

    if (recentSuggestions.length === 0) {
      return '暂无历史修改建议。';
    }

    return recentSuggestions
      .map((version, index) => (
        `${index + 1}. 版本 ${new Date(version.timestamp).toLocaleString()}：\n${version.suggestion!.trim()}`
      ))
      .join('\n\n');
  };

  const buildDetectorPrompt = (versionId: string, sourceVersions: VersionInfo[]) => (
    `请分析作品: ${getVersionPath(selectedWorkFile!, versionId)}\n\n本次检测使用以下范文路径作为参考：\n${selectedDetectorReferences.join('\n')}\n\n近3次该文章检测AI味Agent给出的修改建议（含所有版本），请作为本次判断参考：\n${buildRecentSuggestionText(sourceVersions)}\n\n请重点判断当前文章是否仍然存在这些旧问题，或是否因为此前修改出现矫枉过正。`
  );

  const confirmDetectorWithoutReferences = async () => {
    if (selectedDetectorReferences.length > 0) return true;
    return new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: '当前没有选择任何范文',
        content: '本次检测不会嵌入范文路径作为参考，是否确认开始检测？',
        okText: '开始检测',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  };

  const handleDetectorBeforeStart = async () => {
    if (!selectedWorkFile) return;
    const confirmed = await confirmDetectorWithoutReferences();
    if (!confirmed) return;
    const latestVersions = await refreshVersions(activeVersionId);
    if (activeVersionId) {
      detectorTargetVersionIdRef.current = activeVersionId;
      return buildDetectorPrompt(activeVersionId, latestVersions);
    }
    try {
      const newVersion = await invoke<VersionInfo>('create_file_version', { path: selectedWorkFile });
      setVersions([newVersion, ...latestVersions]);
      setActiveVersionId(newVersion.id);
      syncActiveVersionResult(newVersion);
      detectorTargetVersionIdRef.current = newVersion.id;
      return buildDetectorPrompt(newVersion.id, latestVersions);
    } catch (e) {
      message.error(`创建检测版本失败: ${e}`);
      throw e;
    }
  };

  const handleRemoverBeforeStart = async () => {
    if (!selectedWorkFile) return;
    const confirmedSuggestion = persistedSuggestion;
    if (!confirmedSuggestion) return;
    if (!isAutoLooping) {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: '确认使用以下修改建议？',
          width: 720,
          content: (
            <div className="de-ai-remover-confirm-content">
              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                {confirmedSuggestion}
              </Typography.Paragraph>
            </div>
          ),
          okText: '开始任务',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }
    try {
      const latestVersions = await refreshVersions(activeVersionId);
      const recentSuggestionText = buildRecentSuggestionText(latestVersions, confirmedSuggestion);
      const newVersion: any = await invoke('create_file_version', { path: selectedWorkFile });
      setVersions([newVersion, ...latestVersions]);
      setActiveVersionId(newVersion.id);
      syncActiveVersionResult(newVersion);
      const newVersionPath = getVersionPath(selectedWorkFile, newVersion.id);
      return {
        content: `请根据以下修改意见，直接修改作品 ${newVersionPath}，降低AI味：\n${confirmedSuggestion}\n\n近3次该文章检测AI味Agent给出的修改建议（含所有版本，不含本次建议），请作为本次改写的避坑参考，防止重复出现旧问题：\n${recentSuggestionText}\n\n只能修改这个文件：${newVersionPath}`,
        allowedWritePaths: [newVersionPath],
      };
    } catch (e) {
      message.error(`创建新版本失败: ${e}`);
      throw e;
    }
  };

  useEffect(() => {
    if (!isResizingDirectory) return;
    const handleMouseMove = (event: MouseEvent) => {
      const directoryLeft = directoryRef.current?.getBoundingClientRect().left ?? 0;
      setDirectoryWidth(Math.max(event.clientX - directoryLeft, MIN_DIRECTORY_WIDTH));
    };
    const handleMouseUp = () => setIsResizingDirectory(false);
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
  }, [isResizingDirectory]);

  useEffect(() => {
    if (!isResizingAgent) return;
    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth = Math.min(Math.max(window.innerWidth - event.clientX, MIN_AGENT_WIDTH), MAX_AGENT_WIDTH);
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
    if (isAutoLooping && !detectorRunning && !removerRunning) {
      if (autoLoopCount < MAX_LOOP_COUNT) {
        if (aiScore === null || aiScore > 30) {
          // Trigger detector
          setDetectorInput('Trigger');
        } else {
          // Score is good enough, stop loop
          setIsAutoLooping(false);
        }
      } else {
        // Max loops reached
        setIsAutoLooping(false);
      }
    }
  }, [isAutoLooping, detectorRunning, removerRunning, autoLoopCount, aiScore, detectorReferenceText]);

  const handleDetectorDone = (lastAgentMessage: string) => {
    const jsonText = lastAgentMessage.match(/\{[\s\S]*\}/)?.[0];
    let jsonResult: { ai_score?: number; suggestion?: string } | null = null;
    if (jsonText) {
      try {
        jsonResult = JSON.parse(jsonText);
      } catch (err) {
        console.error('Failed to parse detector JSON:', err);
      }
    }
    const scoreMatch = lastAgentMessage.match(/<score>(\d+(?:\.\d+)?)<\/score>/);
    const suggestionMatch = lastAgentMessage.match(/<suggestion>([\s\S]*?)<\/suggestion>/);
    const parsedScore = typeof jsonResult?.ai_score === 'number'
      ? jsonResult.ai_score
      : scoreMatch
        ? Number(scoreMatch[1])
        : null;
    const parsedSuggestion = typeof jsonResult?.suggestion === 'string'
      ? jsonResult.suggestion.trim()
      : suggestionMatch?.[1]?.trim();
    
    if (parsedScore !== null && parsedSuggestion) {
      const roundedScore = Math.round(parsedScore);
      setAiScore(roundedScore);
      setSuggestion(parsedSuggestion);
      const targetVersionId = detectorTargetVersionIdRef.current ?? activeVersionId;
      if (selectedWorkFile && targetVersionId) {
        setVersions(versions.map((version: VersionInfo) => (
          version.id === targetVersionId
            ? { ...version, aiScore: roundedScore, suggestion: parsedSuggestion }
            : version
        )));
        invoke('update_version_ai_result', {
          path: selectedWorkFile,
          versionId: targetVersionId,
          score: roundedScore,
          suggestion: parsedSuggestion,
        })
          .then(() => refreshVersions(targetVersionId))
          .catch((err) => {
            console.error(err);
            message.error(`保存检测结果失败: ${err}`);
          });
      }
    } else {
      message.warning('未能读取检测结果，请确认检测AI味Agent输出了AI评分和修改建议');
    }

    if (isAutoLooping && parsedSuggestion && parsedScore !== null && parsedScore > 30) {
      setRemoverInput(`Trigger`);
    } else if (isAutoLooping) {
      setIsAutoLooping(false);
    }
    
    detectorTargetVersionIdRef.current = null;
    setDetectorInput(undefined);
  };

  const handleRemoverDone = (_message: string) => {
    if (isAutoLooping) {
      setAutoLoopCount(autoLoopCount + 1);
    }
    setRemoverInput(undefined);
  };

  const handleStartAutoLoop = () => {
    if (!selectedWorkFile) return;
    setAutoLoopCount(0);
    setAiScore(null);
    setSuggestion(null);
    setIsAutoLooping(true);
    setDetectorInput('Trigger');
  };

  const handleStopAutoLoop = () => {
    setIsAutoLooping(false);
  };

  const mapReferenceTreeData = (nodes: FileNode[]): any[] => nodes.map((node) => ({
    title: <span title={node.path}>{node.name}</span>,
    key: node.path,
    selectable: false,
    children: node.children ? mapReferenceTreeData(node.children) : undefined,
  }));

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden', background: '#faf9f5' }}>
      <Modal
        title="选择检测范文"
        open={isDetectorSettingsOpen}
        okText="确定"
        cancelText="取消"
        width={640}
        onCancel={() => setIsDetectorSettingsOpen(false)}
        onOk={() => setIsDetectorSettingsOpen(false)}
      >
        <div className="de-ai-reference-picker">
          {allReferenceFiles.length > 0 ? (
            <Tree
              blockNode
              checkable
              checkedKeys={selectedDetectorReferences}
              className="de-ai-reference-picker__tree"
              defaultExpandAll
              onCheck={(checkedKeys) => {
                const keys = Array.isArray(checkedKeys) ? checkedKeys : checkedKeys.checked;
                setSelectedDetectorReferences(keys.map(String).filter((key) => allReferenceFiles.includes(key)));
              }}
              selectable={false}
              treeData={mapReferenceTreeData(referenceTree)}
            />
          ) : (
            <Empty description="范文目录暂无可选文件" />
          )}
        </div>
      </Modal>
      <div ref={directoryRef} style={{ width: directoryWidth, minWidth: directoryWidth, borderRight: '1px solid rgba(0, 0, 0, 0.04)', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <div style={{ flex: 1, borderBottom: '1px solid #e8e8e8' }}>
          <WorkspaceDirectory 
            title="作品目录" 
            dirType="articles"
            selectedFile={selectedWorkFile}
            onSelectFile={setSelectedWorkFile}
          />
        </div>
        <div style={{ flex: 1 }}>
        </div>
        <div
          aria-label="调整目录宽度"
          aria-orientation="vertical"
          role="separator"
          onMouseDown={() => setIsResizingDirectory(true)}
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
      <div style={{ flex: 1, minWidth: EDITOR_MIN_WIDTH, display: 'flex', flexDirection: 'column' }}>
        <div className="de-ai-editor-toolbar">
          {selectedWorkFile ? (
            <div className="de-ai-editor-toolbar__primary">
              {isAutoLooping ? (
                <Button className="de-ai-editor-toolbar__action" type="primary" danger icon={<StopOutlined />} onClick={handleStopAutoLoop}>
                  停止自动去AI味
                </Button>
              ) : (
                <Button className="de-ai-editor-toolbar__action" type="primary" icon={<PlayCircleOutlined />} onClick={handleStartAutoLoop} disabled={detectorRunning || removerRunning}>
                  一键自动去AI味
                </Button>
              )}
              <Typography.Text className="de-ai-editor-toolbar__loop" type="secondary">
                当前循环: {autoLoopCount}/{MAX_LOOP_COUNT}
              </Typography.Text>
            </div>
          ) : <span />}
          {selectedWorkFile && (
            <div className="de-ai-editor-toolbar__meta">
              <Select
                className="de-ai-version-select"
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
                    label: `版本 ${new Date(v.timestamp).toLocaleString()} ${v.aiScore != null ? `(AI味: ${v.aiScore})` : ''}`
                  }))
                ]}
              />
              {activeVersionId && (
                <Popconfirm title="确定删除该版本？" onConfirm={async () => {
                  try {
                    await invoke('delete_file_version', { path: selectedWorkFile, versionId: activeVersionId });
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
              <div className="de-ai-score-pill" aria-label={`AI味评分${aiScore === null ? '暂无' : aiScore}`}>
                <span className="de-ai-score-pill__label">AI味</span>
                <Progress 
                  type="circle" 
                  percent={aiScore ?? 0} 
                  size={30} 
                  status={aiScore === null ? 'normal' : (aiScore > 50 ? 'exception' : (aiScore > 30 ? 'normal' : 'success'))} 
                  format={() => aiScore === null ? '--' : `${aiScore}`}
                  strokeColor={aiScore === null ? '#e8e8e8' : undefined}
                />
              </div>
            </div>
          )}
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <MarkdownEditor
            filePath={activeVersionId && selectedWorkFile ? getVersionPath(selectedWorkFile, activeVersionId) : activePreviewFile}
            readOnly={activePreviewFile === selectedReferenceFile}
          />
        </div>
      </div>
      <div style={{ width: agentWidth, minWidth: agentWidth, borderLeft: '1px solid rgba(0, 0, 0, 0.04)', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
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
        <div style={{ flex: 1, borderBottom: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <DeAiAgentChat 
            title="检测AI味 Agent"
            agentId="detector"
            systemPrompt={deAiDetectorPrompt}
            allowedTools={['read', 'grep', 'glob']}
            startContent={detectorStartContent}
            onBeforeStart={handleDetectorBeforeStart}
            startDisabled={!selectedWorkFile}
            footerLeft={
              <Button
                aria-label="选择检测范文"
                className="de-ai-agent-settings-button"
                icon={<SettingOutlined />}
                onClick={() => setIsDetectorSettingsOpen(true)}
                shape="circle"
                title="选择检测范文"
                type={selectedDetectorReferences.length > 0 ? 'primary' : 'default'}
              />
            }
            messages={detectorMessages}
            setMessages={setDetectorMessages}
            activeRun={detectorRun}
            setActiveRun={setDetectorRun}
            onRunningChange={setDetectorRunning}
            isRunning={detectorRunning}
            autoTriggerContent={detectorInput}
            onDone={handleDetectorDone}
          />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <DeAiAgentChat 
            title="去除AI味 Agent"
            agentId="remover"
            systemPrompt={deAiRemoverPrompt}
            allowedTools={['read', 'edit', 'write']}
            startContent={removerStartContent}
            onBeforeStart={handleRemoverBeforeStart}
            startDisabled={!selectedWorkFile || !persistedSuggestion}
            onStartBlocked={() => {
              message.warning('请先完成AI味检测，获得修改意见后再启动去除AI味Agent');
            }}
            messages={removerMessages}
            setMessages={setRemoverMessages}
            activeRun={removerRun}
            setActiveRun={setRemoverRun}
            onRunningChange={setRemoverRunning}
            isRunning={removerRunning}
            autoTriggerContent={removerInput}
            onDone={handleRemoverDone}
          />
        </div>
      </div>
    </div>
  );
};

export default DeAi;
