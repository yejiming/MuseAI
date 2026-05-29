import React, { useEffect, useRef, useState } from 'react';
import { Button, Tooltip } from 'antd';
import { BulbOutlined, InfoCircleOutlined, PlayCircleOutlined, ReloadOutlined, RobotOutlined, StopOutlined, ToolOutlined } from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSettingsStore } from '../stores/useSettingsStore';
import { Message, AgentToolEntry } from '../stores/useAgentStore';

interface ChatStreamEvent {
  runId: string;
  eventType: 'start' | 'delta' | 'thinking_delta' | 'thinking_signature' | 'tool_start' | 'tool_output' | 'tool_end' | 'todo_update' | 'done' | 'error';
  delta?: string;
  message?: string;
  toolCallId?: string;
  toolName?: string;
  toolStatus?: string;
  toolArguments?: string;
}

interface OutlineAssessmentAgentChatProps {
  title: string;
  agentId: 'outlineAssessment' | 'workSummary';
  workspaceDirType?: 'articles' | 'outline';
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
  autoTriggerContent?: string;
  onDone?: (lastAgentMessage: string) => void | string | Promise<void | string>;
  isRunning?: boolean;
  onRunningChange?: (running: boolean) => void;
}

interface StartOverride {
  content: string;
  allowedWritePaths?: string[];
}

const OutlineAssessmentAgentChat: React.FC<OutlineAssessmentAgentChatProps> = ({ 
  title, 
  agentId,
  workspaceDirType,
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
  autoTriggerContent,
  onDone,
  isRunning,
  onRunningChange
}) => {
  const resolvedWorkspaceDirType = workspaceDirType ?? 'outline';
  const [expandedBlocks, setExpandedBlocks] = useState<Record<string, boolean>>({});
  const stopRequestedRef = useRef(false);
  const currentThinkingIdRef = useRef<string | null>(null);
  const messagesRef = useRef(messages);
  const activeRunRef = useRef(activeRun);
  const onDoneRef = useRef(onDone);
  const onRunningChangeRef = useRef(onRunningChange);
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const settings = useSettingsStore();
  const [fullSystemPrompt, setFullSystemPrompt] = useState('');

  useEffect(() => {
    const build = async () => {
      try {
        const workspaceDir = await invoke<string>('get_workspace_dir', { dirType: resolvedWorkspaceDirType });
        const full = await invoke<string>('build_full_system_prompt', {
          systemPrompt,
          workspacePath: workspaceDir,
          selectedReferenceFiles: [],
        });
        setFullSystemPrompt(full);
      } catch (e) {
        console.error(e);
      }
    };
    build();
  }, [systemPrompt, resolvedWorkspaceDirType]);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { activeRunRef.current = activeRun; }, [activeRun]);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);
  useEffect(() => { onRunningChangeRef.current = onRunningChange; }, [onRunningChange]);

  const setSyncedMessages = (updater: Message[] | ((messages: Message[]) => Message[])) => {
    setMessages((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      messagesRef.current = next;
      return next;
    });
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
        const lastMsg = messagesRef.current.find(m => m.id === activeRun.messageId);
        if (lastMsg && onDoneRef.current) {
          const result = onDoneRef.current(lastMsg.content);
          const handleResult = (res: any) => {
            if (typeof res === 'string' && res.trim() !== '') {
              // Using timeout to ensure state is clean before next send
              setTimeout(() => {
                void handleSend(res);
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
  }, []);

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
    if (onBeforeStart) {
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
    
    const textToSend = resolvedInput ?? startContent.trim();
    if (!resolvedInput && startDisabled) {
      onStartBlocked?.();
      return;
    }
    if (!textToSend || isRunning) {
      return;
    }
    const shouldResetContext = !resolvedInput;
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
    }
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    onRunningChange?.(true);
    scrollToBottomOnce();

    try {
      const workspaceDir = await invoke<string>('get_workspace_dir', { dirType: resolvedWorkspaceDirType });
      const runId = await invoke<string>('start_chat_completion_stream', {
        request: {
          modelInterface: settings.modelInterface,
          baseUrl: settings.llmBaseUrl,
          apiKey: settings.llmApiKey,
          model: settings.llmModel,
          temperature: settings.agentConfigs?.[agentId]?.temperature ?? settings.temperature,
          maxOutputTokens: settings.agentConfigs?.[agentId]?.maxOutputTokens ?? settings.maxOutputTokens,
          maxContextTokens: settings.agentConfigs?.[agentId]?.maxContextTokens ?? settings.maxContextTokens,
          thinkingDepth: settings.agentConfigs?.[agentId]?.thinkingDepth ?? settings.thinkingDepth,
          systemPrompt: systemPrompt,
          workspacePath: workspaceDir,
          messages: [...historyMessages, userMessage].map(m => ({
            role: m.role,
            content: m.content,
            thinkingBlocks: m.thinkingBlocks,
          })),
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

  useEffect(() => {
    if (autoTriggerContent && !isRunning) {
      handleSend(autoTriggerContent);
    }
  }, [autoTriggerContent]);

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
    setMessages([]);
    setExpandedBlocks({});
  };

  const toggleBlock = (id: string) => {
    setExpandedBlocks((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="agent-chat" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="agent-chat__header" style={{ padding: '8px 12px', borderBottom: '1px solid #e8e8e8' }}>
        <div className="agent-chat__title">
          <RobotOutlined style={{ color: '#d97757' }} />
          <h3 style={{ fontSize: 14, margin: 0, marginLeft: 8 }}>{title}</h3>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={handleRefresh}
          size="small"
          title="清除当前上下文"
          type="text"
        />
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
                  
                  return part.trim() ? (
                    <div className="agent-markdown" key={`md-${i}`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {part}
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

      <div className="agent-composer" style={{ padding: 12, borderTop: '1px solid #e8e8e8' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minHeight: 32, display: 'flex', alignItems: 'center' }}>
            {footerLeft}
          </div>
          <Tooltip title={isRunning ? '停止' : '开始'}>
          <Button
            aria-label={isRunning ? '停止' : '开始'}
            className="de-ai-agent-run-button"
            disabled={!isRunning && (startDisabled || !startContent.trim())}
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

export default OutlineAssessmentAgentChat;
