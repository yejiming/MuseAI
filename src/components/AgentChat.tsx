import React, { useEffect, useRef, useState } from 'react';
import { Button, Tooltip, Dropdown, Tag, Input, Cascader, Form, Modal, Tree, TreeSelect, Empty, message } from 'antd';
import { BulbOutlined, CloseOutlined, HistoryOutlined, ReloadOutlined, RobotOutlined, StopOutlined, ToolOutlined, UnorderedListOutlined, SettingOutlined, PlayCircleOutlined, InfoCircleOutlined, DeleteOutlined } from '@ant-design/icons';
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
  AgentSessionSummary,
  AgentSessionRecord,
  ThinkingBlock
} from '../stores/useAgentStore';

interface ChatStreamEvent {
  runId: string;
  eventType: 'start' | 'delta' | 'thinking_delta' | 'thinking_signature' | 'tool_start' | 'tool_output' | 'tool_end' | 'todo_update' | 'done' | 'error';
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
  thinkingBlocks?: ThinkingBlock[];
}

interface AgentChatProps {
  onClose?: () => void;
  title?: string;
}

const AgentChat: React.FC<AgentChatProps> = ({ onClose, title = '写文章Agent' }) => {
  const {
    messages, setMessages,
    input, setInput,
    isStreaming, setIsStreaming,
    expandedBlocks, setExpandedBlocks,
    todos, setTodos,
    isTodoOpen, setIsTodoOpen,
    sessions, setSessions,
    skills, setSkills,
    sessionId, setSessionId,
    sessionTitle, setSessionTitle,
    activeRun, setActiveRun,
    createNewSession,
    selectedReferenceFiles, setSelectedReferenceFiles,
    selectedOutlineFile, setSelectedOutlineFile
  } = useAgentStore();

  const settings = useSettingsStore();
  const chatHistoryRef = useRef<HTMLDivElement>(null);

  const currentThinkingIdRef = useRef<string | null>(null);
  const activeRunRef = useRef(activeRun);
  const messagesRef = useRef(messages);
  const selectedReferenceFilesRef = useRef(selectedReferenceFiles);
  const selectedOutlineFileRef = useRef(selectedOutlineFile);
  const sessionIdRef = useRef(sessionId);
  const sessionTitleRef = useRef(sessionTitle);
  const todosRef = useRef(todos);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [allReferenceFiles, setAllReferenceFiles] = useState<string[]>([]);
  const [referenceTree, setReferenceTree] = useState<any[]>([]);
  const [referenceFilesLoaded, setReferenceFilesLoaded] = useState(false);
  const [outlineTree, setOutlineTree] = useState<any[]>([]);
  const [outlineFilesLoaded, setOutlineFilesLoaded] = useState(false);

  useEffect(() => { activeRunRef.current = activeRun; }, [activeRun]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  React.useEffect(() => {
    invoke<SkillDefinition[]>('get_skills').then(setSkills).catch(console.error);
    void refreshSessions();
  }, []);

  useEffect(() => {
    selectedReferenceFilesRef.current = selectedReferenceFiles;
  }, [selectedReferenceFiles]);

  useEffect(() => {
    selectedOutlineFileRef.current = selectedOutlineFile;
  }, [selectedOutlineFile]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    sessionTitleRef.current = sessionTitle;
  }, [sessionTitle]);

  useEffect(() => {
    todosRef.current = todos;
  }, [todos]);

  useEffect(() => {
    let isMounted = true;
    let unlistenFn: (() => void) | null = null;

    listen<ChatStreamEvent>('agent-chat-stream', (event) => {
      if (!isMounted) return;
      const activeRun = activeRunRef.current;
      const payload = event.payload;
      if (!activeRun.runId || payload.runId !== activeRun.runId || !activeRun.messageId) {
        return;
      }

      if (payload.eventType === 'delta' && payload.delta) {
        currentThinkingIdRef.current = null;
        setMessages((prev) => prev.map((msg) => (
          msg.id === activeRun.messageId
            ? { ...msg, content: msg.content + payload.delta }
            : msg
        )));
        return;
      }

      if (payload.eventType === 'thinking_delta' && payload.delta) {
        setMessages((prev) => prev.map((msg) => {
          if (msg.id !== activeRun.messageId) return msg;
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

      if (payload.eventType === 'thinking_signature' && payload.delta) {
        setMessages((prev) => prev.map((msg) => {
          if (msg.id !== activeRun.messageId) return msg;
          const newThinkingBlocks = [...(msg.thinkingBlocks ?? [])];
          if (newThinkingBlocks.length > 0) {
            newThinkingBlocks[newThinkingBlocks.length - 1] = {
              ...newThinkingBlocks[newThinkingBlocks.length - 1],
              signature: payload.delta
            };
          }
          return { ...msg, thinkingBlocks: newThinkingBlocks };
        }));
        return;
      }

      if (payload.eventType === 'tool_start') {
        currentThinkingIdRef.current = null;
        const toolId = payload.toolCallId || `tool-${Date.now()}`;
        setMessages((prev) => {
          const next = updateMessageTool(prev, activeRun.messageId!, {
            id: toolId,
            name: payload.toolName || '未知工具',
            result: payload.message || '正在执行工具',
            status: payload.toolStatus || 'running',
            arguments: payload.toolArguments || '{}',
          }, 'start');
          return next.map((msg) =>
            msg.id === activeRun.messageId
              ? { ...msg, content: msg.content + `\n\n[[TOOL:${toolId}]]\n\n` }
              : msg
          );
        });
        return;
      }

      if (payload.eventType === 'tool_output' || payload.eventType === 'tool_end') {
        setMessages((prev) => updateMessageTool(prev, activeRun.messageId!, {
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
          msg.id === activeRun.messageId
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
        window.setTimeout(() => {
          void saveCurrentSession();
        }, 0);
      }
    }).then((fn) => {
      unlistenFn = fn;
      if (!isMounted) {
        fn();
      }
    });

    return () => {
      isMounted = false;
      if (unlistenFn) {
        unlistenFn();
      }
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
    const fetchOutline = async () => {
      try {
        setOutlineFilesLoaded(false);
        const dir = await invoke<string>('get_workspace_dir', { dirType: 'outline' });

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

        const tree = await fetchTree(dir);
        setOutlineTree(tree);
        setOutlineFilesLoaded(true);
      } catch (e) {
        console.error(e);
        setOutlineFilesLoaded(true);
      }
    };
    if (isSettingsOpen && !outlineFilesLoaded) {
      fetchOutline();
    }
  }, [isSettingsOpen, outlineFilesLoaded]);

  const scrollToBottomOnce = () => {
    window.requestAnimationFrame(() => {
      if (chatHistoryRef.current) {
        chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
      }
    });
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) {
      return;
    }

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: trimmed,
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
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setInput('');
    setIsStreaming(true);
    scrollToBottomOnce();

    const isFirstUserMessage = !messages.some((message) => message.role === 'user');
    if (isFirstUserMessage) {
      const fallbackTitle = summarizeSessionTitle(trimmed);
      sessionTitleRef.current = fallbackTitle;
      setSessionTitle(fallbackTitle);
      void saveCurrentSession();

      // Background LLM title generation
      invoke<string>('summarize_text', {
        request: {
          modelInterface: settings.modelInterface,
          baseUrl: settings.llmBaseUrl,
          apiKey: settings.llmApiKey,
          model: settings.llmModel,
          temperature: settings.agentConfigs?.writer?.temperature ?? 0.7,
          maxOutputTokens: 64,
          text: trimmed,
        },
      }).then(async (generatedTitle) => {
        const currentId = sessionIdRef.current;
        sessionTitleRef.current = generatedTitle;
        setSessionTitle(generatedTitle);
        await invoke('update_agent_session_title', { id: currentId, title: generatedTitle });
        await saveCurrentSession();
      }).catch((e) => {
        console.error('生成会话标题失败:', e);
      });
    }

    const articleTypeStr = settings.articleType?.join('-') || '';
    const mentionedSkillNames: string[] = [];
    if (articleTypeStr === '男频-长篇-玄幻脑洞') {
      mentionedSkillNames.push('fanqie-xuanhuan-writer');
    } else if (articleTypeStr === '女频-短篇-追妻火葬场') {
      mentionedSkillNames.push('fanqie-short-zhuiqi-writer');
    } else if (articleTypeStr === '女频-短篇-大女主') {
      mentionedSkillNames.push('fanqie-short-danvzhu-writer');
    } else if (articleTypeStr === '女频-短篇-系统穿越') {
      mentionedSkillNames.push('fanqie-short-xitong-writer');
    } else if (articleTypeStr === '女频-短篇-真假千金') {
      mentionedSkillNames.push('fanqie-short-qianjin-writer');
    } else if (articleTypeStr === '女频-短篇-规则怪谈') {
      mentionedSkillNames.push('fanqie-short-guize-writer');
    } else if (articleTypeStr === '公众号') {
      mentionedSkillNames.push('kitt-writer');
    }
    const mentionedSkills = skills.filter(s => mentionedSkillNames.includes(s.name));

    const effectiveSystemPrompt = selectedOutlineFile
      ? `${settings.systemPrompt}\n\n【大纲文件】请根据以下大纲文件进行写作：${selectedOutlineFile}`
      : settings.systemPrompt;

    try {
      const runId = await invoke<string>('start_chat_completion_stream', {
        request: {
          modelInterface: settings.modelInterface,
          baseUrl: settings.llmBaseUrl,
          apiKey: settings.llmApiKey,
          model: settings.llmModel,
          temperature: settings.agentConfigs?.writer?.temperature ?? 0.7,
          maxOutputTokens: settings.agentConfigs?.writer?.maxOutputTokens ?? 4096,
          maxContextTokens: settings.agentConfigs?.writer?.maxContextTokens ?? 128000,
          thinkingDepth: settings.agentConfigs?.writer?.thinkingDepth ?? 'off',
          systemPrompt: effectiveSystemPrompt,
          workspacePath: settings.worksDirectory,
          messages: buildModelMessages(messages.concat(userMessage), userMessage.id, mentionedSkills),
          selectedReferenceFiles: selectedReferenceFiles,
          allowedTools: ['read', 'write', 'edit', 'grep', 'glob', 'skill', 'subagent', 'todo'],
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

  const refreshSessions = async () => {
    try {
      const summaries = await invoke<AgentSessionSummary[]>('list_agent_sessions', { prefix: 'session-' });
      setSessions(summaries);
    } catch (err) {
      console.error('读取历史会话失败:', err);
    }
  };

  const saveCurrentSession = async () => {
    const userMessages = messagesRef.current.filter((message) => message.role === 'user');
    if (userMessages.length === 0) {
      return;
    }

    try {
      await invoke<AgentSessionSummary>('save_agent_session', {
        session: {
          id: sessionIdRef.current,
          title: sessionTitleRef.current,
          savedAt: 0,
          messages: messagesRef.current,
          selectedReferenceFiles: selectedReferenceFilesRef.current,
          selectedOutlineFile: selectedOutlineFileRef.current,
          todos: todosRef.current,
        },
      });
      await refreshSessions();
    } catch (err) {
      console.error('保存会话失败:', err);
    }
  };

  const openSession = async (id: string) => {
    try {
      const session = await invoke<AgentSessionRecord>('load_agent_session', { id });
      activeRunRef.current = { runId: null, messageId: null };
      setActiveRun({ runId: null, messageId: null });
      setSessionId(session.id);
      setSessionTitle(session.title);
      setMessages(session.messages);
      setSelectedReferenceFiles(session.selectedReferenceFiles ?? []);
      setSelectedOutlineFile(session.selectedOutlineFile ?? null);
      setTodos(session.todos ?? []);
      setIsTodoOpen(false);
      setIsStreaming(false);
      setInput('');
      scrollToBottomOnce();
    } catch (err) {
      console.error('打开历史会话失败:', err);
    }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await invoke('delete_agent_session', { id });
      message.success('已删除历史会话');
      if (id === sessionIdRef.current) {
        createNewSession();
      }
      await refreshSessions();
    } catch (err) {
      console.error('删除会话失败:', err);
      message.error('删除会话失败');
    }
  };

  const effectiveSystemPrompt = selectedOutlineFile
    ? `${settings.systemPrompt}\n\n【大纲文件】请根据以下大纲文件进行写作：${selectedOutlineFile}`
    : settings.systemPrompt;

  const [fullSystemPrompt, setFullSystemPrompt] = useState('');

  useEffect(() => {
    const build = async () => {
      try {
        const full = await invoke<string>('build_full_system_prompt', {
          systemPrompt: effectiveSystemPrompt,
          workspacePath: settings.worksDirectory,
          selectedReferenceFiles,
        });
        setFullSystemPrompt(full);
      } catch (e) {
        console.error(e);
      }
    };
    build();
  }, [effectiveSystemPrompt, settings.worksDirectory, selectedReferenceFiles]);

  const contextStats = estimateContextUsage({
    systemPrompt: effectiveSystemPrompt,
    workspacePath: settings.worksDirectory,
    selectedReferenceFiles,
    skills,
    messages,
    draft: input,
  });
  const contextUsed = contextStats.total;
  const maxContext = settings.agentConfigs?.writer?.maxContextTokens ?? 128000;
  const contextPercent = maxContext > 0
    ? Math.min(100, Math.round((contextUsed / maxContext) * 100))
    : 0;

  const selectedLibNames = selectedReferenceFiles.length > 0 ? `${selectedReferenceFiles.length} 篇` : '';

  const mapReferenceTreeData = (nodes: any[]): any[] => nodes.map((node) => ({
    title: <span title={node.path}>{node.name}</span>,
    key: node.path,
    selectable: false,
    children: node.children ? mapReferenceTreeData(node.children) : undefined,
  }));

  const mapOutlineTreeForSelect = (nodes: any[]): any[] =>
    nodes
      .filter((node) => node.name !== '.versions')
      .map((node) => ({
        title: node.name,
        value: node.is_dir ? undefined : node.path,
        children: node.children ? mapOutlineTreeForSelect(node.children) : undefined,
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
        <span className="agent-context-popover__value" style={{ wordBreak: 'break-all' }}>{settings.worksDirectory || '未选择'}</span>
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
        <span className="agent-context-popover__value agent-context-popover__value--highlight">{contextStats.total} / {settings.agentConfigs?.writer?.maxContextTokens || 128000}</span>
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
        title="写文章 Agent 设置"
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
                      children: [
                        { value: '追妻火葬场', label: '追妻火葬场' },
                        { value: '大女主', label: '大女主' },
                        { value: '系统穿越', label: '系统穿越' },
                        { value: '真假千金', label: '真假千金' },
                        { value: '规则怪谈', label: '规则怪谈' },
                      ],
                    },
                  ],
                },
                {
                  value: '公众号',
                  label: '公众号',
                },
              ]}
              placeholder="请选择文章类型"
              style={{ width: '100%' }}
            />
          </Form.Item>
          
          <Form.Item label="选择参考范文">
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
          <Form.Item label="选择大纲文件" style={{ marginBottom: 0 }}>
            {outlineTree.length > 0 ? (
              <TreeSelect
                allowClear
                placeholder="请选择大纲文件（可选）"
                style={{ width: '100%' }}
                treeData={mapOutlineTreeForSelect(outlineTree)}
                value={selectedOutlineFile}
                onChange={(val) => setSelectedOutlineFile(val || null)}
                treeDefaultExpandAll
              />
            ) : (
              <Empty description="大纲目录暂无可选文件" />
            )}
          </Form.Item>
        </Form>
      </Modal>

      <div className="agent-chat__header">
        <div className="agent-chat__title">
          <RobotOutlined />
          <h3>{title}</h3>
        </div>
        <div className="agent-chat__header-actions">
          <Tooltip title="清除当前上下文">
            <Button type="text" icon={<ReloadOutlined />} onClick={createNewSession} />
          </Tooltip>
          <Dropdown
            menu={{
              items: sessions.length > 0
                ? sessions.map((session) => ({
                    key: session.id,
                    label: (
                      <div className="agent-session-menu-item" style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', minWidth: 180, padding: '4px 0' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', marginRight: 16 }}>
                          <strong style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{session.title}</strong>
                          <span style={{ fontSize: '11px', color: '#999', marginTop: 2 }}>{formatSavedAt(session.savedAt)}</span>
                        </div>
                        <Button
                          type="text"
                          danger
                          size="small"
                          icon={<DeleteOutlined />}
                          style={{ flexShrink: 0 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDeleteSession(session.id);
                          }}
                        />
                      </div>
                    ),
                  }))
                : [{ key: 'empty', disabled: true, label: '暂无历史 Session' }],
              onClick: ({ key }) => {
                if (key !== 'empty') {
                  void openSession(String(key));
                }
              },
            }}
            placement="bottomRight"
            trigger={['click']}
          >
            <Tooltip title="历史 Session">
              <Button type="text" icon={<HistoryOutlined />} onClick={() => void refreshSessions()} />
            </Tooltip>
          </Dropdown>
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
              <Tag style={{ border: 'none', background: 'rgba(217, 119, 87, 0.1)', color: '#d97757', fontWeight: 500 }}>
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

    modelMessages.push(buildAssistantToolCallMessage(assistantText, [tool], message.thinkingBlocks));
    modelMessages.push(buildToolResultMessage(tool));
    emittedToolIds.add(match[1]);
    assistantText = '';
  });

  const remainingTools = tools.filter((tool) => !tool.id || !emittedToolIds.has(tool.id));
  if (remainingTools.length > 0) {
    modelMessages.push(buildAssistantToolCallMessage(assistantText, remainingTools, message.thinkingBlocks));
    remainingTools.forEach((tool) => modelMessages.push(buildToolResultMessage(tool)));
    assistantText = '';
  }

  if (assistantText.trim()) {
    modelMessages.push({
      role: 'assistant',
      content: assistantText,
      thinkingBlocks: message.thinkingBlocks,
    });
  }

  return modelMessages;
}

function buildAssistantToolCallMessage(content: string, tools: AgentToolEntry[], thinkingBlocks?: ThinkingBlock[]): ModelMessage {
  return {
    role: 'assistant',
    content,
    toolCalls: tools.map((tool, index) => ({
      id: tool.id || `tool-${index}`,
      name: tool.name,
      arguments: tool.arguments || '{}',
    })),
    thinkingBlocks,
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

function summarizeSessionTitle(firstMessage: string) {
  const normalized = firstMessage.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '新对话';
  }
  return normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized;
}

function formatSavedAt(value: number) {
  if (!value) {
    return '未保存';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export default AgentChat;
