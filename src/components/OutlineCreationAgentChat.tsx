import React, { useEffect, useRef, useState } from 'react';
import { Button, Tooltip, Tag, Input, Cascader, Form, Modal, Tree, TreeSelect, Select, Empty } from 'antd';
import { BulbOutlined, CloseOutlined, InfoCircleOutlined, PlusCircleOutlined, RobotOutlined, StopOutlined, ToolOutlined, UnorderedListOutlined, SettingOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSettingsStore } from '../stores/useSettingsStore';
import { 
  useAgentStore, 
  Message, 
  AgentToolEntry, 
  AgentTodo, 
  SkillDefinition,
} from '../stores/useAgentStore';
import { useOutlineStore } from '../stores/useOutlineStore';

interface ChatStreamEvent {
  runId: string;
  eventType: 'start' | 'delta' | 'thinking_delta' | 'tool_start' | 'tool_output' | 'tool_end' | 'todo_update' | 'done' | 'error';
  delta?: string;
  message?: string;
  toolCallId?: string;
  toolName?: string;
  toolStatus?: string;
  toolArguments?: string;
  todos?: AgentTodo[];
}

interface AgentToolCallPayload {
  id: string;
  name: string;
  arguments: string;
}

interface ModelMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: AgentToolCallPayload[];
}

interface AgentChatProps {
  onClose?: () => void;
  title?: string;
}

const OutlineCreationAgentChat: React.FC<AgentChatProps> = ({ onClose, title = '大纲制作Agent' }) => {
  const {
    creationMessages: messages, setCreationMessages: setMessages,
    creationInput: input, setCreationInput: setInput,
    isCreationStreaming: isStreaming, setIsCreationStreaming: setIsStreaming,
    creationExpandedBlocks: expandedBlocks, setCreationExpandedBlocks: setExpandedBlocks,
    creationTodos: todos, setCreationTodos: setTodos,
    isCreationTodoOpen: isTodoOpen, setIsCreationTodoOpen: setIsTodoOpen,
    creationRun: activeRun, setCreationRun: setActiveRun,
    creationSelectedReferenceFiles: selectedReferenceFiles, setCreationSelectedReferenceFiles: setSelectedReferenceFiles,
    creationSelectedOutlineFile: selectedOutlineFile, setCreationSelectedOutlineFile: setAgentSelectedOutlineFile,
    creationActiveVersionId: activeVersionId, setCreationActiveVersionId: setActiveVersionId,
    creationVersions: versions,
  } = useOutlineStore();
  const { skills, setSkills } = useAgentStore();



  const settings = useSettingsStore();
  const chatHistoryRef = useRef<HTMLDivElement>(null);

  const currentThinkingIdRef = useRef<string | null>(null);
  const activeRunRef = useRef(activeRun);
  const messagesRef = useRef(messages);
  const selectedReferenceFilesRef = useRef(selectedReferenceFiles);
  const todosRef = useRef(todos);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [allReferenceFiles, setAllReferenceFiles] = useState<string[]>([]);
  const [referenceTree, setReferenceTree] = useState<any[]>([]);
  const [referenceFilesLoaded, setReferenceFilesLoaded] = useState(false);
  const [outlineDir, setOutlineDir] = useState<string>('');
  const [outlineTree, setOutlineTree] = useState<any[]>([]);
  const [fullSystemPrompt, setFullSystemPrompt] = useState('');

  const systemPrompt = `${settings.outlineCreationPrompt}\n\n【系统指令】请将产出的大纲保存到系统工作区 ~/Documents/MuseAI/outline 文件夹中。`;

  useEffect(() => {
    const build = async () => {
      try {
        const full = await invoke<string>('build_full_system_prompt', {
          systemPrompt,
          workspacePath: outlineDir,
          selectedReferenceFiles,
        });
        setFullSystemPrompt(full);
      } catch (e) {
        console.error(e);
      }
    };
    build();
  }, [systemPrompt, outlineDir, selectedReferenceFiles]);

  useEffect(() => { activeRunRef.current = activeRun; }, [activeRun]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  React.useEffect(() => {
    invoke<SkillDefinition[]>('get_skills').then(setSkills).catch(console.error);
    invoke<string>('get_workspace_dir', { dirType: 'outline' }).then(async (dir) => {
      setOutlineDir(dir);
      const fetchTree = async (path: string): Promise<any[]> => {
        const items = await invoke<any[]>('list_dir', { path });
        return Promise.all(items
          .filter((item) => item.name !== '.versions')
          .map(async (item) => (
            item.is_dir
              ? { ...item, children: await fetchTree(item.path) }
              : item
          )));
      };
      try {
        const tree = await fetchTree(dir);
        setOutlineTree(tree);
      } catch (e) {
        console.error(e);
      }
    }).catch(console.error);
  }, []);

  useEffect(() => {
    selectedReferenceFilesRef.current = selectedReferenceFiles;
  }, [selectedReferenceFiles]);



  useEffect(() => {
    todosRef.current = todos;
  }, [todos]);

  useEffect(() => {
    const unlistenPromise = listen<ChatStreamEvent>('agent-chat-stream', (event) => {
      const active = activeRunRef.current;
      const payload = event.payload;
      if (!active.runId || payload.runId !== active.runId || !active.messageId) {
        return;
      }

      if (payload.eventType === 'delta' && payload.delta) {
        currentThinkingIdRef.current = null;
        setMessages((prev) => prev.map((msg) => (
          msg.id === active.messageId
            ? { ...msg, content: msg.content + payload.delta }
            : msg
        )));
        return;
      }

      if (payload.eventType === 'thinking_delta' && payload.delta) {
        setMessages((prev) => prev.map((msg) => {
          if (msg.id !== active.messageId) return msg;
          let newContent = msg.content;
          const newThinkingBlocks = [...(msg.thinkingBlocks ?? [])];
          
          if (!currentThinkingIdRef.current) {
            currentThinkingIdRef.current = `thinking-${Date.now()}`;
            newContent += `\n\n[[THINKING:${currentThinkingIdRef.current}]]\n\n`;
            newThinkingBlocks.push({ id: currentThinkingIdRef.current, content: payload.delta! });
          } else {
            const blockIndex = newThinkingBlocks.findIndex(b => b.id === currentThinkingIdRef.current);
            if (blockIndex >= 0) {
              newThinkingBlocks[blockIndex] = {
                ...newThinkingBlocks[blockIndex],
                content: newThinkingBlocks[blockIndex].content + payload.delta!
              };
            }
          }

          return { 
            ...msg, 
            content: newContent, 
            thinkingBlocks: newThinkingBlocks,
            thinking: `${msg.thinking ?? ''}${payload.delta}` 
          };
        }));
        return;
      }

      if (payload.eventType === 'tool_start') {
        currentThinkingIdRef.current = null;
        const toolId = payload.toolCallId || `tool-${Date.now()}`;
        setMessages((prev) => {
          const next = updateMessageTool(prev, active.messageId!, {
            id: toolId,
            name: payload.toolName || '未知工具',
            result: payload.message || '正在执行工具',
            status: payload.toolStatus || 'running',
            arguments: payload.toolArguments || '{}',
          }, 'start');
          return next.map((msg) =>
            msg.id === active.messageId
              ? { ...msg, content: msg.content + `\n\n[[TOOL:${toolId}]]\n\n` }
              : msg
          );
        });
        return;
      }

      if (payload.eventType === 'tool_output' || payload.eventType === 'tool_end') {
        setMessages((prev) => updateMessageTool(prev, active.messageId!, {
          id: payload.toolCallId,
          name: payload.toolName || '未知工具',
          result: payload.message || payload.delta || '',
          status: payload.toolStatus || (payload.eventType === 'tool_end' ? 'success' : 'running'),
        }, payload.eventType === 'tool_end' ? 'end' : 'output'));
        return;
      }

      if (payload.eventType === 'todo_update') {
        const nextTodos = payload.todos ?? [];
        setTodos(nextTodos);
        if (nextTodos.length === 0) {
          setIsTodoOpen(false);
        }
        return;
      }

      if (payload.eventType === 'error') {
        currentThinkingIdRef.current = null;
        setMessages((prev) => prev.map((msg) => (
          msg.id === active.messageId
            ? { ...msg, content: payload.message ? `请求模型失败：${payload.message}` : '请求模型失败' }
            : msg
        )));
        activeRunRef.current = { runId: null, messageId: null };
        setActiveRun({ runId: null, messageId: null });
        setIsStreaming(false);
        return;
      }

      if (payload.eventType === 'done') {
        currentThinkingIdRef.current = null;
        activeRunRef.current = { runId: null, messageId: null };
        setActiveRun({ runId: null, messageId: null });
        setIsStreaming(false);
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const fetchRef = async () => {
      try {
        setReferenceFilesLoaded(false);
        const dir = await invoke<string>('get_workspace_dir', { dirType: 'references' });
        
        const fetchTree = async (path: string): Promise<any[]> => {
          const items = await invoke<any[]>('list_dir', { path });
          return Promise.all(items
            .filter((item) => item.name !== '.versions')
            .map(async (item) => (
              item.is_dir
                ? { ...item, children: await fetchTree(item.path) }
                : item
            )));
        };
        
        const collectFiles = (nodes: any[]): string[] => {
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
    if (isSettingsOpen && !referenceFilesLoaded) {
      fetchRef();
    }
  }, [isSettingsOpen, referenceFilesLoaded]);



  useEffect(() => {
    if (!referenceFilesLoaded) return;
    setSelectedReferenceFiles(
      selectedReferenceFiles.filter((file) => allReferenceFiles.includes(file))
    );
  }, [allReferenceFiles, referenceFilesLoaded]);

  useEffect(() => {
    if (selectedOutlineFile) {
      invoke('list_file_versions', { path: selectedOutlineFile })
        .then((v: any) => {
          const sorted = v.sort((a: any, b: any) => b.timestamp - a.timestamp);
          useOutlineStore.getState().setCreationVersions(sorted);
          if (sorted.length > 0) {
            useOutlineStore.getState().setCreationActiveVersionId(sorted[0].id);
          } else {
            useOutlineStore.getState().setCreationActiveVersionId(null);
          }
        })
        .catch(console.error);
    } else {
      useOutlineStore.getState().setCreationVersions([]);
      useOutlineStore.getState().setCreationActiveVersionId(null);
    }
  }, [selectedOutlineFile]);

  const scrollToBottomOnce = () => {
    window.requestAnimationFrame(() => {
      if (chatHistoryRef.current) {
        chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
      }
    });
  };

  const [isConfirming, setIsConfirming] = useState(false);
  const [assessmentData, setAssessmentData] = useState<any>(null);

  const startAgent = async (finalInputText: string) => {
    let { creationSelectedOutlineFile: selectedOutlineFile, creationActiveVersionId: activeVersionId } = useOutlineStore.getState();
    const isFirstUserMessage = !messages.some((message) => message.role === 'user');

    if (isFirstUserMessage && selectedOutlineFile) {
      try {
        const newVersion: any = await invoke('create_file_version', { path: selectedOutlineFile });
        const v: any = await invoke('list_file_versions', { path: selectedOutlineFile });
        const sorted = v.sort((a: any, b: any) => b.timestamp - a.timestamp);
        useOutlineStore.getState().setCreationVersions(sorted);
        useOutlineStore.getState().setCreationActiveVersionId(newVersion.id);
        activeVersionId = newVersion.id;
      } catch (err) {
        console.error('Failed to create file version:', err);
      }
    }

    const versionPath = (selectedOutlineFile && activeVersionId) 
      ? (() => {
          const parts = selectedOutlineFile.split(/[\\/]/);
          const fileName = parts.pop();
          const parentDir = parts.join('/');
          return `${parentDir}/.versions/${fileName}/${activeVersionId}`;
        })()
      : selectedOutlineFile;

    const contextPrefix = versionPath
      ? `【当前正在编辑的大纲文件】：${versionPath}\n（如果你需要读取、修改或优化现有大纲，请直接操作此文件）\n\n`
      : '';

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: contextPrefix + finalInputText,
      tools: [],
      articleType: settings.articleType?.join('-') || '默认',
    };
    const agentMessageId = `msg-${Date.now() + 1}`;
    const pendingAgentMessage: Message = {
      id: agentMessageId,
      role: 'agent',
      content: '',
      tools: [],
    };
    const nextMessages = [...messages, userMessage, pendingAgentMessage];

    setMessages(nextMessages);
    setInput('');
    setIsStreaming(true);
    scrollToBottomOnce();

    const articleTypeStr = settings.articleType?.join('-') || '';
    const mentionedSkillNames: string[] = [];
    if (articleTypeStr === '男频-长篇-玄幻脑洞') {
      mentionedSkillNames.push('fanqie-xuanhuan-outline');
    } else if (articleTypeStr === '女频-短篇-虐心婚恋') {
      mentionedSkillNames.push('fanqie-short-nuexin-outline');
    }
    const mentionedSkills = skills.filter(s => mentionedSkillNames.includes(s.name));

    try {
      const outlineDir = await invoke<string>('get_workspace_dir', { dirType: 'outline' });
      const runId = await invoke<string>('start_chat_completion_stream', {
        request: {
          modelInterface: settings.modelInterface,
          baseUrl: settings.llmBaseUrl,
          apiKey: settings.llmApiKey,
          model: settings.llmModel,
          temperature: settings.agentConfigs?.outlineCreation?.temperature ?? settings.temperature,
          maxOutputTokens: settings.agentConfigs?.outlineCreation?.maxOutputTokens ?? settings.maxOutputTokens,
          maxContextTokens: settings.agentConfigs?.outlineCreation?.maxContextTokens ?? settings.maxContextTokens,
          thinkingDepth: settings.agentConfigs?.outlineCreation?.thinkingDepth ?? settings.thinkingDepth,
          systemPrompt: systemPrompt,
          workspacePath: outlineDir,
          messages: buildModelMessages(messages.concat(userMessage), userMessage.id, mentionedSkills),
          selectedReferenceFiles: selectedReferenceFiles,
          allowedTools: ['read', 'write', 'edit', 'grep', 'glob', 'skill'],
        },
      });
      activeRunRef.current = { runId, messageId: agentMessageId };
      setActiveRun({ runId, messageId: agentMessageId });
    } catch (err) {
      activeRunRef.current = { runId: null, messageId: null };
      setActiveRun({ runId: null, messageId: null });
      setIsStreaming(false);
      setMessages((prev) => prev.map((msg) => (
        msg.id === agentMessageId
          ? { ...msg, content: `请求模型失败：${String(err)}` }
          : msg
      )));
    }
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) {
      return;
    }

    const { creationSelectedOutlineFile: selectedOutlineFile, creationActiveVersionId: activeVersionId, creationVersions: versions } = useOutlineStore.getState();

    if (!selectedOutlineFile) {
      await startAgent(trimmed);
      return;
    }

    const currentVersion = activeVersionId ? versions.find(v => v.id === activeVersionId) : versions.length > 0 ? versions[0] : null;

    if (currentVersion?.suggestion) {
      try {
        const parsed = JSON.parse(currentVersion.suggestion);
        setAssessmentData(parsed);
        setIsConfirming(true);
        return;
      } catch (e) {
        console.error('Failed to parse suggestion', e);
      }
    }
    
    // No assessment data, directly start
    await startAgent(`${trimmed}`);
  };

  const confirmAssessmentSend = async () => {
    setIsConfirming(false);
    try {
      const promptAddon = `\n\n参考以下大纲评估意见进行优化：\n${JSON.stringify(assessmentData, null, 2)}`;
      await startAgent(`${input.trim()}${promptAddon}`);
    } catch (err) {
      console.error(err);
    }
  };

  const handleStop = async () => {
    if (activeRunRef.current.runId) {
      try {
        await invoke('stop_chat_stream', { runId: activeRunRef.current.runId });
      } catch (err) {
        console.error('停止流失败:', err);
      }
    }
    setIsStreaming(false);
  };

  const toggleBlock = (id: string) => {
    setExpandedBlocks((prev) => ({ ...prev, [id]: !prev[id] }));
  };





  const contextStats = estimateContextUsage({
    systemPrompt: systemPrompt,
    workspacePath: outlineDir,
    selectedReferenceFiles,
    skills,
    messages,
    draft: input,
  });
  const contextUsed = contextStats.total;
  const contextPercent = settings.maxContextTokens > 0
    ? Math.min(100, Math.round((contextUsed / settings.maxContextTokens) * 100))
    : 0;

  const selectedLibNames = selectedReferenceFiles.length > 0 ? `${selectedReferenceFiles.length} 篇` : '';

  const mapReferenceTreeData = (nodes: any[]): any[] => nodes.map((node) => ({
    title: <span title={node.path}>{node.name}</span>,
    key: node.path,
    selectable: false,
    children: node.children ? mapReferenceTreeData(node.children) : undefined,
  }));

  const mapOutlineTreeData = (nodes: any[]): any[] => nodes.map((node) => ({
    title: <span title={node.path}>{node.name}</span>,
    key: node.path,
    value: node.path,
    selectable: !node.is_dir && (node.name.endsWith('.md') || node.name.endsWith('.txt')),
    children: node.children ? mapOutlineTreeData(node.children) : undefined,
  }));

  const contextTooltip = (
    <div className="agent-context-popover">
      <div className="agent-context-popover__header">
        <strong>上下文详情</strong>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">模型：</span>
        <span className="agent-context-popover__value">{settings.llmModel || '未设置'}</span>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">工作空间：</span>
        <span className="agent-context-popover__value" style={{ wordBreak: 'break-all' }}>{outlineDir || '加载中...'}</span>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">范文：</span>
        <span className="agent-context-popover__value">{selectedLibNames || '未选择'}</span>
      </div>
      <div className="agent-context-popover__divider" />
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">消息数：</span>
        <span className="agent-context-popover__value">{messages.length} 条</span>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">总 token：</span>
        <span className="agent-context-popover__value agent-context-popover__value--highlight">{contextStats.total} / {settings.maxContextTokens || 0}</span>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">用户消息：</span>
        <span className="agent-context-popover__value">{contextStats.user}</span>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">AI 回复：</span>
        <span className="agent-context-popover__value">{contextStats.assistant}</span>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">系统设定：</span>
        <span className="agent-context-popover__value">{contextStats.system}</span>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">工具消耗：</span>
        <span className="agent-context-popover__value">{contextStats.tool}</span>
      </div>
    </div>
  );

  return (
    <div className="agent-chat">
      <Modal
        title="发现大纲评估意见"
        open={isConfirming}
        onOk={confirmAssessmentSend}
        onCancel={() => setIsConfirming(false)}
        okText="确认并发送"
        cancelText="取消"
      >
        <p>系统检测到所选大纲存在评估建议，是否带上以下建议进行优化？</p>
        <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, maxHeight: 300, overflowY: 'auto' }}>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {JSON.stringify(assessmentData, null, 2)}
          </pre>
        </div>
      </Modal>

      <Modal
        title="大纲制作 Agent 设置"
        open={isSettingsOpen}
        okText="确定"
        cancelText="取消"
        width={640}
        onCancel={() => setIsSettingsOpen(false)}
        onOk={() => setIsSettingsOpen(false)}
      >
        <Form layout="vertical">
          <Form.Item label="文章类型">
            <Cascader
              value={settings.articleType}
              onChange={(val) => settings.setArticleType(val as string[])}
              options={[
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

              ]}
              placeholder="请选择文章类型"
              style={{ width: '100%' }}
            />
          </Form.Item>
          
          <Form.Item label="选择现有大纲">
            <TreeSelect
              allowClear
              treeExpandAction="click"
              treeData={mapOutlineTreeData(outlineTree)}
              value={selectedOutlineFile}
              onChange={(val) => {
                setAgentSelectedOutlineFile(val ? String(val) : null);
              }}
              placeholder="留空为创建新大纲，选择已有文件为优化大纲"
            />
          </Form.Item>

          {selectedOutlineFile && (
            <Form.Item label="选择大纲版本">
              <Select
                value={activeVersionId || 'original'}
                onChange={(val) => {
                  setActiveVersionId(val === 'original' ? null : String(val));
                }}
                options={[
                  { value: 'original', label: '原文件' },
                  ...versions.map(v => ({
                    value: v.id,
                    label: `版本 ${new Date(v.timestamp).toLocaleString()}`
                  }))
                ]}
              />
            </Form.Item>
          )}

          <Form.Item label="选择参考范文" style={{ marginBottom: 0 }}>
            <div className="de-ai-reference-picker">
              {allReferenceFiles.length > 0 ? (
                <Tree
                  blockNode
                  checkable
                  checkedKeys={selectedReferenceFiles}
                  className="de-ai-reference-picker__tree"
                  onCheck={(checkedKeys) => {
                    const keys = Array.isArray(checkedKeys) ? checkedKeys : checkedKeys.checked;
                    setSelectedReferenceFiles(keys.map(String).filter((key) => allReferenceFiles.includes(key)));
                  }}
                  selectable={false}
                  treeData={mapReferenceTreeData(referenceTree)}
                />
              ) : (
                <Empty description="范文目录暂无可选文件" />
              )}
            </div>
          </Form.Item>

        </Form>
      </Modal>

      <div className="agent-chat__header">
        <div className="agent-chat__title">
          <RobotOutlined />
          <h3>{title}</h3>
        </div>
        <div className="agent-chat__header-actions">
          <Tooltip title="清除当前对话">
            <Button type="text" icon={<PlusCircleOutlined />} onClick={() => setMessages([])} />
          </Tooltip>
          {onClose && (
            <Tooltip title="隐藏 Agent">
              <Button type="text" icon={<CloseOutlined />} onClick={onClose} />
            </Tooltip>
          )}
        </div>
      </div>

      <div ref={chatHistoryRef} className="agent-chat__history">
        {messages.some((m) => m.role === 'user') && (
          <div className="agent-message-row agent-message-row--system">
            <div className="agent-message-bubble agent-message-bubble--system">
              <FoldBlock
                icon={<InfoCircleOutlined />}
                variant="thinking"
                title="系统提示词"
                preview={fullSystemPrompt.slice(0, 80) + (fullSystemPrompt.length > 80 ? '...' : '')}
                detail={fullSystemPrompt}
                expanded={Boolean(expandedBlocks['system-prompt'])}
                onToggle={() => toggleBlock('system-prompt')}
              />
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <div
            className={`agent-message-row agent-message-row--${msg.role}`}
            key={msg.id}
          >
            <div className={`agent-message-bubble agent-message-bubble--${msg.role}`}>
              {msg.thinking && (!msg.thinkingBlocks || msg.thinkingBlocks.length === 0) && (
                <FoldBlock
                  icon={<BulbOutlined />}
                  variant="thinking"
                  title="思考"
                  preview={msg.thinking}
                  expanded={Boolean(expandedBlocks[`${msg.id}-thinking`])}
                  onToggle={() => toggleBlock(`${msg.id}-thinking`)}
                />
              )}

              {(() => {
                const parts = msg.content ? msg.content.split(/(\[\[(?:TOOL|THINKING):[^\]]+\]\])/) : [msg.role === 'agent' && isStreaming ? ' ' : ''];
                const renderedToolIds = new Set<string>();
                
                const renderedParts = parts.map((part, i) => {
                  const toolMatch = part.match(/^\[\[TOOL:([^\]]+)\]\]$/);
                  if (toolMatch) {
                    const toolId = toolMatch[1];
                    const toolIndex = msg.tools?.findIndex(t => t.id === toolId);
                    if (toolIndex !== undefined && toolIndex >= 0) {
                      const tool = msg.tools![toolIndex];
                      renderedToolIds.add(toolId);
                      return (
                        <FoldBlock
                          icon={<ToolOutlined />}
                          variant="tool"
                          key={`tool-${tool.id || i}`}
                          title={`工具：${tool.name}`}
                          preview={tool.result}
                          expanded={Boolean(expandedBlocks[`${msg.id}-tool-${toolIndex}`])}
                          onToggle={() => toggleBlock(`${msg.id}-tool-${toolIndex}`)}
                        />
                      );
                    }
                    return null;
                  }

                  const thinkingMatch = part.match(/^\[\[THINKING:([^\]]+)\]\]$/);
                  if (thinkingMatch) {
                    const thinkingId = thinkingMatch[1];
                    const block = msg.thinkingBlocks?.find(b => b.id === thinkingId);
                    if (block) {
                      return (
                        <FoldBlock
                          icon={<BulbOutlined />}
                          variant="thinking"
                          key={`thinking-${thinkingId}`}
                          title="思考"
                          preview={block.content}
                          expanded={Boolean(expandedBlocks[`${msg.id}-thinking-${thinkingId}`])}
                          onToggle={() => toggleBlock(`${msg.id}-thinking-${thinkingId}`)}
                        />
                      );
                    }
                    return null;
                  }
                  
                  let displayPart = part;

                  return part.trim() ? (
                    <div className="agent-markdown" key={`md-${i}`}>
                      {i === 0 && msg.articleType && msg.articleType !== '默认' && (
                        <div style={{ marginBottom: 8 }}>
                          <Tag style={{ border: 'none', background: msg.role === 'user' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(217, 119, 87, 0.1)', color: msg.role === 'user' ? '#fff' : '#d97757', fontWeight: 500 }}>
                            {msg.articleType}
                          </Tag>
                        </div>
                      )}
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {displayPart}
                      </ReactMarkdown>
                    </div>
                  ) : null;
                });
                
                const unrenderedTools = msg.tools?.map((tool, index) => {
                  if (tool.id && renderedToolIds.has(tool.id)) return null;
                  return (
                    <FoldBlock
                      icon={<ToolOutlined />}
                      variant="tool"
                      key={`unrendered-tool-${index}`}
                      title={`工具：${tool.name}`}
                      preview={tool.result}
                      expanded={Boolean(expandedBlocks[`${msg.id}-tool-${index}`])}
                      onToggle={() => toggleBlock(`${msg.id}-tool-${index}`)}
                    />
                  );
                });

                return (
                  <>
                    {unrenderedTools}
                    {renderedParts}
                  </>
                );
              })()}
            </div>
          </div>
        ))}
      </div>

      <div className="agent-composer">
        {todos.length > 0 && (
          <button
            className="agent-todo-toggle"
            onClick={() => setIsTodoOpen((open) => !open)}
            type="button"
          >
            <UnorderedListOutlined />
            Todo
          </button>
        )}
        {todos.length > 0 && isTodoOpen && (
          <div className="agent-todo-panel">
            {todos.map((todo, index) => (
              <div className="agent-todo-item" key={`${todo.content}-${index}`}>
                <span>{todo.status}</span>
                <strong>{todo.content}</strong>
              </div>
            ))}
          </div>
        )}
        <div id="agent-composer-box" className="agent-composer__box" style={{ position: 'relative' }}>
          {settings.articleType && settings.articleType.length > 0 && settings.articleType.join('-') !== '默认' && (
            <div style={{ padding: '12px 12px 0 12px' }}>
              <Tag color="orange" style={{ border: 'none', background: 'rgba(217, 119, 87, 0.1)', color: '#d97757', fontWeight: 500 }}>
                {settings.articleType.join('-')}
              </Tag>
            </div>
          )}
          <Input.TextArea
            className="agent-composer__textarea"
            autoSize={{ minRows: 1, maxRows: 8 }}
            onChange={(e) => setInput(e.target.value)}
            style={{ zIndex: 2, position: 'relative', background: 'transparent', boxShadow: 'none', border: 'none' }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void handleSend();
              }
            }}
            placeholder="与 Agent 对话，或按 Cmd/Ctrl + Enter 发送..."
            value={input}
          />
          <div className="agent-composer__actions">
            <Button
              aria-label="Agent 设置"
              className="de-ai-agent-settings-button"
              icon={<SettingOutlined />}
              onClick={() => setIsSettingsOpen(true)}
              shape="circle"
              title="Agent 设置"
              type={selectedReferenceFiles.length > 0 ? 'primary' : 'default'}
            />
            <div className="agent-send-cluster">
              <Tooltip color="#fff" placement="topRight" title={contextTooltip} overlayInnerStyle={{ width: 'max-content', maxWidth: 320, padding: '8px 12px' }}>
                <button
                  aria-label="查看上下文详情"
                  className="agent-context-ring"
                  style={{ '--context-fill': `${contextPercent}%` } as React.CSSProperties}
                  type="button"
                >
                  <span>{contextPercent}%</span>
                </button>
              </Tooltip>
              <Tooltip title={isStreaming ? '停止' : '开始'}>
                <Button
                  className="de-ai-agent-run-button"
                  disabled={!isStreaming && !input.trim()}
                  icon={isStreaming ? <StopOutlined /> : <PlayCircleOutlined />}
                  onClick={isStreaming ? handleStop : handleSend}
                  shape="circle"
                  type={isStreaming ? "default" : "primary"}
                  danger={isStreaming}
                />
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

function FoldBlock({
  icon,
  title,
  preview,
  detail,
  expanded,
  onToggle,
  variant = 'tool',
}: {
  icon: React.ReactNode;
  title: string;
  preview: string;
  detail?: string;
  expanded: boolean;
  onToggle: () => void;
  variant?: 'tool' | 'thinking';
}) {
  return (
    <div className={`agent-fold-block agent-fold-block--${variant}`}>
      <button className="agent-fold-block__summary" onClick={onToggle} type="button">
        <span className="agent-fold-block__title">{icon}{title}</span>
        <span className="agent-fold-block__preview">{preview || '暂无内容'}</span>
      </button>
      {expanded && <pre className="agent-fold-block__detail">{detail ?? preview}</pre>}
    </div>
  );
}

function updateMessageTool(
  messages: Message[],
  messageId: string,
  tool: AgentToolEntry,
  mode: 'start' | 'output' | 'end',
) {
  return messages.map((msg) => {
    if (msg.id !== messageId) {
      return msg;
    }
    const tools = [...(msg.tools ?? [])];
    const index = tool.id
      ? tools.findIndex((entry) => entry.id === tool.id)
      : tools.length - 1;
    if (mode === 'start' || index < 0) {
      return { ...msg, tools: [...tools, tool] };
    }

    const current = tools[index];
    const prevResult = current.result === '正在执行工具' ? '' : current.result;
    tools[index] = {
      ...current,
      name: tool.name || current.name,
      status: tool.status || current.status,
      arguments: tool.arguments || current.arguments,
      result: mode === 'output'
        ? `${prevResult}${tool.result}`
        : tool.result || current.result,
    };
    return { ...msg, tools };
  });
}

function buildModelMessages(
  messages: Message[],
  currentUserMessageId: string,
  mentionedSkills: SkillDefinition[],
): ModelMessage[] {
  return messages.flatMap((message) => {
    if (message.role === 'user') {
      let content = message.content;
      if (message.id === currentUserMessageId && mentionedSkills.length > 0) {
        const skillNames = mentionedSkills.map((skill) => skill.name);
        const slashCommands = skillNames.map((name) => `/${name}`).join('\n');
        content = `${slashCommands}\n【系统指令】本轮必须优先调用以下技能：${skillNames.join(', ')}\n\n${content}`;
      }
      return [{ role: 'user', content }];
    }

    return buildAssistantHistoryMessages(message);
  });
}

function buildAssistantHistoryMessages(message: Message): ModelMessage[] {
  const tools = message.tools ?? [];
  const toolsById = new Map(tools.filter((tool) => tool.id).map((tool) => [tool.id!, tool]));
  const emittedToolIds = new Set<string>();
  const modelMessages: ModelMessage[] = [];
  const parts = message.content.split(/(\[\[TOOL:[^\]]+\]\])/);
  let assistantText = '';

  parts.forEach((part) => {
    const match = part.match(/^\[\[TOOL:([^\]]+)\]\]$/);
    if (!match) {
      assistantText += part;
      return;
    }

    const tool = toolsById.get(match[1]);
    if (!tool) {
      return;
    }

    modelMessages.push(buildAssistantToolCallMessage(assistantText, [tool]));
    modelMessages.push(buildToolResultMessage(tool));
    emittedToolIds.add(match[1]);
    assistantText = '';
  });

  const remainingTools = tools.filter((tool) => !tool.id || !emittedToolIds.has(tool.id));
  if (remainingTools.length > 0) {
    modelMessages.push(buildAssistantToolCallMessage(assistantText, remainingTools));
    remainingTools.forEach((tool) => modelMessages.push(buildToolResultMessage(tool)));
    assistantText = '';
  }

  if (assistantText.trim()) {
    modelMessages.push({
      role: 'assistant',
      content: assistantText,
    });
  }

  return modelMessages;
}

function buildAssistantToolCallMessage(content: string, tools: AgentToolEntry[]): ModelMessage {
  return {
    role: 'assistant',
    content,
    toolCalls: tools.map((tool, index) => ({
      id: tool.id || `tool-${index}`,
      name: tool.name,
      arguments: tool.arguments || '{}',
    })),
  };
}

function buildToolResultMessage(tool: AgentToolEntry): ModelMessage {
  return {
    role: 'tool',
    content: tool.result,
    toolCallId: tool.id,
  };
}

function estimateContextUsage({
  systemPrompt,
  workspacePath,
  selectedReferenceFiles,
  skills,
  messages,
  draft,
}: {
  systemPrompt: string;
  workspacePath: string | null;
  selectedReferenceFiles: string[];
  skills: SkillDefinition[];
  messages: Message[];
  draft: string;
}) {
  const stats = {
    system: estimateTokens(buildEstimatedSystemPrompt(systemPrompt, workspacePath, selectedReferenceFiles, skills)),
    user: estimateTokens([draft, ...messages.filter((message) => message.role === 'user').map((message) => message.content)].join('')),
    assistant: estimateTokens(messages
      .filter((message) => message.role === 'agent')
      .map((message) => message.content.replace(/\[\[TOOL:[^\]]+\]\]/g, ''))
      .join('')),
    tool: estimateTokens(messages
      .flatMap((message) => message.tools ?? [])
      .map((tool) => `${tool.name}\n${tool.arguments || ''}\n${tool.result}`)
      .join('')),
  };

  return {
    ...stats,
    total: stats.system + stats.user + stats.assistant + stats.tool,
  };
}

function estimateTokens(text: string) {
  return Math.max(0, Math.ceil(text.length * 1.5));
}

function buildEstimatedSystemPrompt(
  systemPrompt: string,
  workspacePath: string | null,
  selectedReferenceFiles: string[],
  skills: SkillDefinition[],
) {
  const lines = [systemPrompt.trim()];
  const workspaceLines = [
    '## 当前环境',
    workspacePath?.trim()
      ? `当前工作空间路径：${workspacePath.trim()}`
      : '当前工作空间路径：未选择',
  ];

  if (selectedReferenceFiles.length === 0) {
    workspaceLines.push('当前选中的范文：无');
  } else {
    workspaceLines.push('当前选中的范文：');
    workspaceLines.push(`- 共选中 ${selectedReferenceFiles.length} 篇范文`);
    workspaceLines.push('');
    workspaceLines.push('【重要指令】用户已选择上述范文作为写作参考，请仔细研读并在写作中参考其风格和结构。');
  }

  const systemLines = [
    '## 系统信息',
    `- **当前时间**：${new Date().toLocaleString('sv-SE', { hour12: false })}`,
    '- **操作系统**：由桌面端注入系统版本号',
    '- **Python 环境**：已配置',
    '- **可用 Skills**：',
  ];

  if (skills.length === 0) {
    systemLines.push('  （无可用 skill）');
  } else {
    skills.forEach((skill) => {
      systemLines.push(`  - \`${skill.name}\`: ${skill.description}（路径：${skill.path}）`);
    });
  }

  lines.push(workspaceLines.join('\n'), systemLines.join('\n'));
  return lines.filter(Boolean).join('\n\n');
}

export default OutlineCreationAgentChat;
