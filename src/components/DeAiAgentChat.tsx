import React, { useCallback, useEffect, useRef } from 'react';
import { Button, Tooltip, Input, Dropdown, message } from 'antd';
import { BulbOutlined, CloseOutlined, HistoryOutlined, InfoCircleOutlined, PlayCircleOutlined, ReloadOutlined, RobotOutlined, StopOutlined, ToolOutlined, DeleteOutlined } from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSettingsStore } from '../stores/useSettingsStore';
import { Message, AgentToolEntry, AgentSessionSummary, AgentSessionRecord, SessionContextCompaction } from '../stores/useAgentStore';
import { createStableContentKey, createStableToolKey } from '../utils/renderKeys';
import { useStateGroup } from '../utils/reducerState';
import { getEffectiveMessagesForContextStats } from '../utils/contextCompaction';

interface ChatStreamEvent {
  runId: string;
  eventType: 'start' | 'delta' | 'thinking_delta' | 'thinking_signature' | 'tool_start' | 'tool_output' | 'tool_end' | 'todo_update' | 'context_compacted' | 'done' | 'error';
  delta?: string;
  message?: string;
  toolCallId?: string;
  toolName?: string;
  toolStatus?: string;
  toolArguments?: string;
  contextCompaction?: SessionContextCompaction;
}

interface DeAiAgentChatProps {
  title: string;
  agentId: 'detector' | 'remover';
  systemPrompt: string;
  allowedTools: string[];
  startContent: string;
  startDisabled?: boolean;
  onBeforeStart?: () => Promise<string | StartOverride | undefined | void>;
  footerLeft?: React.ReactNode;
  onStartBlocked?: () => void;
  messages: Message[];
  setMessages: (messages: Message[] | ((messages: Message[]) => Message[])) => void;
  activeRun: { runId: string | null; messageId: string | null };
  setActiveRun: (run: { runId: string | null; messageId: string | null }) => void;
  onDone?: (lastAgentMessage: string) => void | string | Promise<void | string>;
  isRunning?: boolean;
  onRunningChange?: (running: boolean) => void;
  onClose?: () => void;
}

interface StartOverride {
  content: string;
  allowedWritePaths?: string[];
}

interface DeAiAgentChatUiState {
  expandedBlocks: Record<string, boolean>;
  fullSystemPrompt: string;
  input: string;
  sessionId: string;
  sessionTitle: string;
  sessions: AgentSessionSummary[];
  contextCompaction: SessionContextCompaction | null;
}

const savedAtFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const useDeAiAgentChatView = ({ 
  title, 
  agentId,
  systemPrompt, 
  allowedTools,
  startContent,
  startDisabled,
  onBeforeStart,
  footerLeft,
  onStartBlocked,
  messages,
  setMessages,
  activeRun,
  setActiveRun,
  onDone,
  isRunning,
  onRunningChange,
  onClose,
}: DeAiAgentChatProps) => {
  const [uiState, patchUiState, setUiField] = useStateGroup<DeAiAgentChatUiState>(() => ({
    expandedBlocks: {},
    fullSystemPrompt: '',
    input: '',
    sessionId: `deai-${crypto.randomUUID?.() || `session-${Date.now()}-${Math.random().toString(16).slice(2)}`}`,
    sessionTitle: '新对话',
    sessions: [],
    contextCompaction: null,
  }));
  const {
    expandedBlocks,
    fullSystemPrompt,
    input,
    sessionId,
    sessionTitle,
    sessions,
    contextCompaction,
  } = uiState;
  const setExpandedBlocks = useCallback((expandedBlocks: React.SetStateAction<Record<string, boolean>>) => setUiField('expandedBlocks', expandedBlocks), [setUiField]);
  const setInput = useCallback((input: React.SetStateAction<string>) => setUiField('input', input), [setUiField]);
  const setSessionId = useCallback((sessionId: string) => setUiField('sessionId', sessionId), [setUiField]);
  const setSessionTitle = useCallback((sessionTitle: string) => setUiField('sessionTitle', sessionTitle), [setUiField]);
  const setContextCompaction = useCallback((contextCompaction: SessionContextCompaction | null) => setUiField('contextCompaction', contextCompaction), [setUiField]);
  const stopRequestedRef = useRef(false);
  const currentThinkingIdRef = useRef<string | null>(null);
  const messagesRef = useRef(messages);
  const activeRunRef = useRef(activeRun);
  const handleSendRef = useRef<(overrideInput?: string) => Promise<void>>(async () => {});
  const onDoneRef = useRef(onDone);
  const onRunningChangeRef = useRef(onRunningChange);
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const accumulatedContentRef = useRef('');
  const settings = useSettingsStore();
  const hasStarted = messages.length > 0;

  const isRemover = agentId === 'remover';
  const sessionIdRef = useRef(sessionId);
  const sessionTitleRef = useRef(sessionTitle);
  const contextCompactionRef = useRef<SessionContextCompaction | null>(contextCompaction);

  useEffect(() => {
    const build = async () => {
      try {
        const full = await invoke<string>('build_full_system_prompt', {
          systemPrompt,
          workspacePath: settings.worksDirectory,
          selectedReferenceFiles: [],
        });
        patchUiState({ fullSystemPrompt: full });
      } catch (e) {
        console.error(e);
      }
    };
    build();
  }, [patchUiState, systemPrompt, settings.worksDirectory]);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { activeRunRef.current = activeRun; }, [activeRun]);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  useEffect(() => { onRunningChangeRef.current = onRunningChange; }, [onRunningChange]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { sessionTitleRef.current = sessionTitle; }, [sessionTitle]);
  useEffect(() => { contextCompactionRef.current = contextCompaction; }, [contextCompaction]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const setSyncedMessages = useCallback((updater: Message[] | ((messages: Message[]) => Message[])) => {
    setMessages((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      messagesRef.current = next;
      return next;
    });
  }, [setMessages]);

  const refreshSessions = useCallback(async () => {
    if (!isRemover) return;
    try {
      const summaries = await invoke<AgentSessionSummary[]>('list_agent_sessions', { prefix: 'deai-' });
      patchUiState({ sessions: summaries });
    } catch (err) {
      console.error('读取历史会话失败:', err);
    }
  }, [isRemover, patchUiState]);

  const saveCurrentSession = useCallback(async () => {
    if (!isRemover) return;
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
          selectedReferenceFiles: [],
          selectedOutlineFile: null,
          todos: [],
          contextCompaction: contextCompactionRef.current,
        },
      });
      await refreshSessions();
    } catch (err) {
      console.error('保存会话失败:', err);
    }
  }, [isRemover, refreshSessions]);

  const openSession = async (id: string) => {
    try {
      const session = await invoke<AgentSessionRecord>('load_agent_session', { id });
      activeRunRef.current = { runId: null, messageId: null };
      setActiveRun({ runId: null, messageId: null });
      setSessionId(session.id);
      setSessionTitle(session.title);
      setMessages(session.messages);
      contextCompactionRef.current = session.contextCompaction ?? null;
      setContextCompaction(session.contextCompaction ?? null);
      setExpandedBlocks({});
      setInput('');
      onRunningChangeRef.current?.(false);
      if (chatHistoryRef.current) {
        chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
      }
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

  const createNewSession = () => {
    if (!isRemover) {
      setMessages([]);
      return;
    }
    setActiveRun({ runId: null, messageId: null });
    setMessages([]);
    setInput('');
    setExpandedBlocks({});
    contextCompactionRef.current = null;
    setContextCompaction(null);
    setSessionId(`deai-${crypto.randomUUID?.() || `session-${Date.now()}-${Math.random().toString(16).slice(2)}`}`);
    setSessionTitle('新对话');
  };

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
        accumulatedContentRef.current += payload.delta;
        setSyncedMessages((prev) => prev.map((msg) => (
          msg.id === activeRun.messageId
            ? { ...msg, content: msg.content + payload.delta }
            : msg
        )));
        return;
      }

      if (payload.eventType === 'thinking_delta' && payload.delta) {
        setSyncedMessages((prev) => prev.map((msg) => {
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
        setSyncedMessages((prev) => prev.map((msg) => {
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
        setSyncedMessages((prev) => {
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
        setSyncedMessages((prev) => updateMessageTool(prev, activeRun.messageId!, {
          id: payload.toolCallId,
          name: payload.toolName || '未知工具',
          result: payload.message || payload.delta || '',
          status: payload.toolStatus || (payload.eventType === 'tool_end' ? 'success' : 'running'),
        }, payload.eventType === 'tool_end' ? 'end' : 'output'));
        return;
      }

      if (payload.eventType === 'context_compacted' && payload.contextCompaction) {
        contextCompactionRef.current = payload.contextCompaction;
        setContextCompaction(payload.contextCompaction);
        return;
      }

      if (payload.eventType === 'error') {
        currentThinkingIdRef.current = null;
        setSyncedMessages((prev) => prev.map((msg) => (
          msg.id === activeRun.messageId
            ? { ...msg, content: payload.message ? `请求模型失败：${payload.message}` : '请求模型失败' }
            : msg
        )));
        activeRunRef.current = { runId: null, messageId: null };
        setActiveRun({ runId: null, messageId: null });
        onRunningChangeRef.current?.(false);
        return;
      }

      if (payload.eventType === 'done') {
        currentThinkingIdRef.current = null;
        activeRunRef.current = { runId: null, messageId: null };
        setActiveRun({ runId: null, messageId: null });
        onRunningChangeRef.current?.(false);
        window.setTimeout(() => {
          void saveCurrentSession();
        }, 0);
        if (onDoneRef.current) {
          const result = onDoneRef.current(accumulatedContentRef.current);
          const handleResult = (res: any) => {
            if (typeof res === 'string' && res.trim() !== '') {
              // Using timeout to ensure state is clean before next send
              setTimeout(() => {
                void handleSendRef.current(res);
              }, 100);
            }
          };
          if (result && typeof result === 'object' && 'then' in result) {
            result.then(handleResult).catch(console.error);
          } else {
            handleResult(result);
          }
        }
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
  }, [saveCurrentSession, setActiveRun, setContextCompaction, setSyncedMessages]);

  const scrollToBottomOnce = () => {
    window.requestAnimationFrame(() => {
      if (chatHistoryRef.current) {
        chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
      }
    });
  };

  const handleSend = async (overrideInput?: string) => {
    let resolvedInput = overrideInput;
    let resolvedAllowedWritePaths: string[] | undefined;
    
    if (onBeforeStart && !hasStarted) {
      try {
        const result = await onBeforeStart();
        if (result === undefined) {
          return;
        }
        if (typeof result === 'string') {
          resolvedInput = result || undefined;
        } else {
          resolvedInput = result.content || undefined;
          resolvedAllowedWritePaths = result.allowedWritePaths;
        }
      } catch (err) {
        console.error('onBeforeStart failed:', err);
        return;
      }
    }
    
    const textToSend = resolvedInput ?? (hasStarted ? input.trim() : startContent.trim());
    if (!hasStarted && !resolvedInput && startDisabled) {
      onStartBlocked?.();
      return;
    }
    if (!textToSend || isRunning) {
      return;
    }
    
    const shouldResetContext = !hasStarted;
    stopRequestedRef.current = false;

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: textToSend,
      tools: [],
    };
    const agentMessageId = `msg-${Date.now() + 1}`;
    const pendingAgentMessage: Message = {
      id: agentMessageId,
      role: 'agent',
      content: '',
      tools: [],
    };
    const historyMessages = shouldResetContext ? [] : messagesRef.current;
    const nextMessages = [...historyMessages, userMessage, pendingAgentMessage];

    if (shouldResetContext) {
      setExpandedBlocks({});
      contextCompactionRef.current = null;
      setContextCompaction(null);
    }
    accumulatedContentRef.current = '';
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setInput('');
    onRunningChange?.(true);
    scrollToBottomOnce();

    if (isRemover && shouldResetContext) {
      const fallbackTitle = summarizeSessionTitle(textToSend);
      sessionTitleRef.current = fallbackTitle;
      setSessionTitle(fallbackTitle);
      void saveCurrentSession();

      invoke<string>('summarize_text', {
        request: {
          modelInterface: settings.modelInterface,
          baseUrl: settings.llmBaseUrl,
          apiKey: settings.llmApiKey,
          model: settings.llmModel,
          temperature: settings.agentConfigs?.[agentId]?.temperature ?? 0.3,
          maxOutputTokens: 64,
          text: textToSend,
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

    try {
      const runId = await invoke<string>('start_chat_completion_stream', {
        request: {
          modelInterface: settings.modelInterface,
          baseUrl: settings.llmBaseUrl,
          apiKey: settings.llmApiKey,
          model: settings.llmModel,
          temperature: settings.agentConfigs?.[agentId]?.temperature ?? 0.3,
          maxOutputTokens: settings.agentConfigs?.[agentId]?.maxOutputTokens ?? 32000,
          maxContextTokens: settings.agentConfigs?.[agentId]?.maxContextTokens ?? 200000,
          thinkingDepth: settings.agentConfigs?.[agentId]?.thinkingDepth ?? 'off',
          systemPrompt: systemPrompt,
          workspacePath: settings.worksDirectory,
          messages: [...historyMessages, userMessage].map(m => ({
            id: m.id,
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content,
            thinkingBlocks: m.thinkingBlocks,
          })),
          contextCompaction: shouldResetContext ? null : contextCompactionRef.current,
          allowedTools: allowedTools,
          allowedWritePaths: resolvedAllowedWritePaths,
        },
      });
      if (stopRequestedRef.current) {
        await invoke('stop_chat_stream', { runId });
        activeRunRef.current = { runId: null, messageId: null };
        setActiveRun({ runId: null, messageId: null });
        onRunningChange?.(false);
        return;
      }
      activeRunRef.current = { runId, messageId: agentMessageId };
      setActiveRun({ runId, messageId: agentMessageId });
    } catch (err) {
      activeRunRef.current = { runId: null, messageId: null };
      setActiveRun({ runId: null, messageId: null });
      onRunningChange?.(false);
      setMessages((prev) => prev.map((msg) => (
        msg.id === agentMessageId
          ? { ...msg, content: `请求模型失败：${String(err)}` }
          : msg
      )));
    }
  };

  handleSendRef.current = handleSend;

  const handleStop = async () => {
    stopRequestedRef.current = true;
    const runId = activeRunRef.current.runId;
    activeRunRef.current = { runId: null, messageId: null };
    setActiveRun({ runId: null, messageId: null });
    if (runId) {
      try {
        await invoke('stop_chat_stream', { runId });
      } catch (err) {
        console.error('停止流失败:', err);
      }
    }
    onRunningChange?.(false);
  };

  const handleRefresh = async () => {
    await handleStop();
    if (isRemover) {
      createNewSession();
    } else {
      setMessages([]);
      setExpandedBlocks({});
      setInput('');
    }
  };

  const toggleBlock = (id: string) => {
    setExpandedBlocks((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const effectiveContextMessages = getEffectiveMessagesForContextStats(messages, contextCompaction);
  const contextStats = estimateContextUsage({
    systemPrompt: fullSystemPrompt,
    workspacePath: settings.worksDirectory,
    messages: effectiveContextMessages,
    draft: input,
  });
  const contextUsed = contextStats.total;
  const maxContext = settings.agentConfigs?.[agentId]?.maxContextTokens ?? 200000;
  const contextPercent = maxContext > 0
    ? Math.min(100, Math.round((contextUsed / maxContext) * 100))
    : 0;

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
      <div className="agent-context-popover__divider" />
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">消息数：</span>
        <span className="agent-context-popover__value">{contextStats.messageCount} 条</span>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">总 token：</span>
        <span className="agent-context-popover__value agent-context-popover__value--highlight">{contextStats.total} / {settings.agentConfigs?.[agentId]?.maxContextTokens || 128000}</span>
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
    <div className="agent-chat" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="agent-chat__header">
        <div className="agent-chat__title">
          <RobotOutlined />
          <h3>{title}</h3>
        </div>
        <div className="agent-chat__header-actions">
          <Tooltip title="清除当前上下文">
            <Button type="text" icon={<ReloadOutlined />} onClick={handleRefresh} />
          </Tooltip>
          {isRemover && (
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
              onOpenChange={(open) => {
                if (open) {
                  void refreshSessions();
                }
              }}
              placement="bottomRight"
              trigger={['click']}
            >
              <Tooltip title="历史 Session">
                <Button type="text" icon={<HistoryOutlined />} onClick={() => void refreshSessions()} />
              </Tooltip>
            </Dropdown>
          )}
          {onClose && (
            <Tooltip title="隐藏 Agent">
              <Button type="text" icon={<CloseOutlined />} onClick={onClose} />
            </Tooltip>
          )}
        </div>
      </div>

      <div ref={chatHistoryRef} className="agent-chat__history" style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
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
          <div className={`agent-message-row agent-message-row--${msg.role}`} key={msg.id}>
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
                const parts = msg.content ? msg.content.split(/(\[\[(?:TOOL|THINKING):[^\]]+\]\])/) : [msg.role === 'agent' && isRunning ? ' ' : ''];
                const renderedToolIds = new Set<string>();
                const getMarkdownPartKey = createStableContentKey(`${msg.id}-md`);
                const getToolKey = createStableToolKey(`${msg.id}-tool`);
                
                const renderedParts = parts.map((part) => {
                  const toolMatch = part.match(/^\[\[TOOL:([^\]]+)\]\]$/);
                  if (toolMatch) {
                    const toolId = toolMatch[1];
                    const toolIndex = msg.tools?.findIndex(t => t.id === toolId);
                    if (toolIndex !== undefined && toolIndex >= 0) {
                      const tool = msg.tools![toolIndex];
                      const toolKey = getToolKey(tool);
                      renderedToolIds.add(toolId);
                      return (
                        <FoldBlock
                          icon={<ToolOutlined />}
                          variant="tool"
                          key={toolKey}
                          title={`工具：${tool.name}`}
                          preview={tool.result}
                          expanded={Boolean(expandedBlocks[toolKey])}
                          onToggle={() => toggleBlock(toolKey)}
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
                  
                  return part.trim() ? (
                    <div className="agent-markdown" key={getMarkdownPartKey(part)}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {part}
                      </ReactMarkdown>
                    </div>
                  ) : null;
                });
                
                const unrenderedTools = msg.tools?.map((tool) => {
                  if (tool.id && renderedToolIds.has(tool.id)) return null;
                  const toolKey = getToolKey(tool);
                  return (
                    <FoldBlock
                      icon={<ToolOutlined />}
                      variant="tool"
                      key={toolKey}
                      title={`工具：${tool.name}`}
                      preview={tool.result}
                      expanded={Boolean(expandedBlocks[toolKey])}
                      onToggle={() => toggleBlock(toolKey)}
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

      <div
        className="agent-composer"
        style={agentId === 'detector' ? { padding: '8px 12px', background: 'transparent' } : { padding: 12, borderTop: '1px solid #e8e8e8' }}
      >
        <div
          id="agent-composer-box"
          className={agentId === 'detector' ? '' : 'agent-composer__box'}
          style={agentId === 'detector' ? { position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } : { position: 'relative' }}
        >
          {hasStarted && agentId !== 'detector' ? (
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
          ) : agentId !== 'detector' ? (
            <div style={{ height: 24 }} />
          ) : null}
          <div className="agent-composer__actions" style={agentId === 'detector' ? { width: '100%', padding: 0 } : {}}>
            {footerLeft}
            <div className="agent-send-cluster">
              {agentId !== 'detector' && (
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
              )}
              <Tooltip title={isRunning ? '停止' : '开始'}>
                <Button
                  aria-label={isRunning ? '停止' : '开始'}
                  className="de-ai-agent-run-button"
                  disabled={!isRunning && ((!hasStarted && startDisabled) || (!hasStarted && !startContent.trim()) || (hasStarted && agentId !== 'detector' && !input.trim()))}
                  icon={isRunning ? <StopOutlined /> : <PlayCircleOutlined />}
                  onClick={isRunning ? handleStop : () => handleSend()}
                  shape="circle"
                  type={isRunning ? "default" : "primary"}
                  danger={isRunning}
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
    tools[index] = {
      ...current,
      name: tool.name || current.name,
      status: tool.status || current.status,
      arguments: tool.arguments || current.arguments,
      result: mode === 'output'
        ? `${current.result}${tool.result ? `\n${tool.result}` : ''}`
        : tool.result || current.result,
    };
    return { ...msg, tools };
  });
}

function estimateContextUsage({
  systemPrompt,
  workspacePath,
  messages,
  draft,
}: {
  systemPrompt: string;
  workspacePath: string | null;
  messages: Message[];
  draft: string;
}) {
  let userText = draft;
  let assistantText = '';
  let toolText = '';
  for (const message of messages) {
    if (message.role === 'user') {
      userText += message.content;
    }
    if (message.role === 'agent') {
      assistantText += message.content.replace(/\[\[TOOL:[^\]]+\]\]/g, '');
    }
    for (const tool of message.tools ?? []) {
      toolText += `${tool.name}\n${tool.arguments || ''}\n${tool.result}`;
    }
  }
  const stats = {
    system: estimateTokens(buildEstimatedSystemPrompt(systemPrompt, workspacePath)),
    user: estimateTokens(userText),
    assistant: estimateTokens(assistantText),
    tool: estimateTokens(toolText),
  };

  return {
    ...stats,
    messageCount: messages.length,
    total: stats.system + stats.user + stats.assistant + stats.tool,
  };
}

function estimateTokens(text: string) {
  return Math.max(0, Math.ceil(text.length * 1.5));
}

function buildEstimatedSystemPrompt(
  systemPrompt: string,
  workspacePath: string | null,
) {
  const lines = [systemPrompt.trim()];
  const workspaceLines = [
    '## 当前环境',
    workspacePath?.trim()
      ? `当前工作空间路径：${workspacePath.trim()}`
      : '当前工作空间路径：未选择',
  ];
  lines.push(workspaceLines.join('\n'));
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
  return savedAtFormatter.format(new Date(value));
}

const DeAiAgentChat: React.FC<DeAiAgentChatProps> = (props) => useDeAiAgentChatView(props);

export default DeAiAgentChat;
