import React, { useEffect, useRef, useState } from 'react';
import { Button, Tooltip, Select, Dropdown, Tag, Mentions } from 'antd';
import { BulbOutlined, CloseOutlined, HistoryOutlined, PlusCircleOutlined, RobotOutlined, SendOutlined, StopOutlined, ToolOutlined, UnorderedListOutlined } from '@ant-design/icons';
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
  createWelcomeMessage
} from '../stores/useAgentStore';

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
}

const AgentChat: React.FC<AgentChatProps> = ({ onClose }) => {
  const {
    messages, setMessages,
    input, setInput,
    isStreaming, setIsStreaming,
    expandedBlocks, setExpandedBlocks,
    selectedLibraryIds, setSelectedLibraryIds,
    todos, setTodos,
    isTodoOpen, setIsTodoOpen,
    sessions, setSessions,
    skills, setSkills,
    sessionId, setSessionId,
    sessionTitle, setSessionTitle,
    activeRun, setActiveRun,
    createNewSession
  } = useAgentStore();

  const settings = useSettingsStore();
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const [textareaScroll, setTextareaScroll] = useState(0);

  const activeRunRef = useRef(activeRun);
  const messagesRef = useRef(messages);
  const selectedLibraryIdsRef = useRef(selectedLibraryIds);
  const sessionIdRef = useRef(sessionId);
  const sessionTitleRef = useRef(sessionTitle);
  const todosRef = useRef(todos);

  useEffect(() => { activeRunRef.current = activeRun; }, [activeRun]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  React.useEffect(() => {
    invoke<SkillDefinition[]>('get_skills').then(setSkills).catch(console.error);
    void refreshSessions();
  }, []);

  React.useEffect(() => {
    const textarea = document.querySelector('.agent-composer__textarea textarea');
    if (textarea) {
      const handleScroll = (e: any) => setTextareaScroll(e.target.scrollTop);
      textarea.addEventListener('scroll', handleScroll);
      return () => textarea.removeEventListener('scroll', handleScroll);
    }
  }, [input]);

  useEffect(() => {
    selectedLibraryIdsRef.current = selectedLibraryIds;
  }, [selectedLibraryIds]);

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
    const unlistenPromise = listen<ChatStreamEvent>('agent-chat-stream', (event) => {
      const active = activeRunRef.current;
      const payload = event.payload;
      if (!active.runId || payload.runId !== active.runId || !active.messageId) {
        return;
      }

      if (payload.eventType === 'delta' && payload.delta) {
        setMessages((prev) => prev.map((msg) => (
          msg.id === active.messageId
            ? { ...msg, content: msg.content + payload.delta }
            : msg
        )));
        return;
      }

      if (payload.eventType === 'thinking_delta' && payload.delta) {
        setMessages((prev) => prev.map((msg) => (
          msg.id === active.messageId
            ? { ...msg, thinking: `${msg.thinking ?? ''}${payload.delta}` }
            : msg
        )));
        return;
      }

      if (payload.eventType === 'tool_start') {
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
        activeRunRef.current = { runId: null, messageId: null };
        setActiveRun({ runId: null, messageId: null });
        setIsStreaming(false);
        window.setTimeout(() => {
          void saveCurrentSession();
        }, 0);
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

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

    const isFirstUserMessage = !messages.some((message) => message.role === 'user');
    if (isFirstUserMessage) {
      const fallbackTitle = summarizeSessionTitle(trimmed);
      sessionTitleRef.current = fallbackTitle;
      setSessionTitle(fallbackTitle);

      // Background LLM title generation
      invoke<string>('summarize_text', {
        request: {
          modelInterface: settings.modelInterface,
          baseUrl: settings.llmBaseUrl,
          apiKey: settings.llmApiKey,
          model: settings.llmModel,
          temperature: settings.temperature,
          maxOutputTokens: 64,
          text: trimmed,
        },
      }).then((generatedTitle) => {
        const currentId = sessionIdRef.current;
        sessionTitleRef.current = generatedTitle;
        setSessionTitle(generatedTitle);
        void invoke('update_agent_session_title', { id: currentId, title: generatedTitle });
        void refreshSessions();
      }).catch(() => {
        // Keep fallback title on generation failure
      });
    }

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: trimmed,
      tools: [],
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

    const mentionedSkills = skills.filter(s => trimmed.includes(`/${s.name}`));

    try {
      const runId = await invoke<string>('start_chat_completion_stream', {
        request: {
          modelInterface: settings.modelInterface,
          baseUrl: settings.llmBaseUrl,
          apiKey: settings.llmApiKey,
          model: settings.llmModel,
          temperature: settings.temperature,
          maxOutputTokens: settings.maxOutputTokens,
          maxContextTokens: settings.maxContextTokens,
          systemPrompt: settings.systemPrompt,
          workspacePath: settings.worksDirectory,
          messages: buildModelMessages(messages.concat(userMessage), userMessage.id, mentionedSkills),
          referenceLibraries: settings.referenceLibraries,
          selectedReferenceLibraryIds: selectedLibraryIds,
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
      const summaries = await invoke<AgentSessionSummary[]>('list_agent_sessions');
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
          selectedReferenceLibraryIds: selectedLibraryIdsRef.current,
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
      setMessages(session.messages.length > 0 ? session.messages : [createWelcomeMessage()]);
      setSelectedLibraryIds(session.selectedReferenceLibraryIds ?? []);
      setTodos(session.todos ?? []);
      setIsTodoOpen(false);
      setIsStreaming(false);
      setInput('');
      scrollToBottomOnce();
    } catch (err) {
      console.error('打开历史会话失败:', err);
    }
  };

  const selectedLibraries = settings.referenceLibraries
    .filter(lib => selectedLibraryIds.includes(lib.id));
  const contextStats = estimateContextUsage({
    systemPrompt: settings.systemPrompt,
    workspacePath: settings.worksDirectory,
    selectedLibraries,
    skills,
    messages,
    draft: input,
  });
  const contextUsed = contextStats.total;
  const contextPercent = settings.maxContextTokens > 0
    ? Math.min(100, Math.round((contextUsed / settings.maxContextTokens) * 100))
    : 0;

  const selectedLibNames = selectedLibraries
    .map(lib => lib.name)
    .join(', ');

  const contextTooltip = (
    <div className="agent-context-popover">
      <strong>上下文详情</strong>
      <span>模型：{settings.llmModel || '未设置'}</span>
      <span style={{ display: 'flex', wordBreak: 'break-all' }}>
        <span style={{ flexShrink: 0 }}>工作空间：</span>
        <span>{settings.worksDirectory || '未选择'}</span>
      </span>
      <span>范文库：{selectedLibNames || '未选择'}，首轮自动读取</span>
      <span>消息：{messages.length} 条</span>
      <span>总 token 数：{contextStats.total} / {settings.maxContextTokens || 0}</span>
      <span>用户消息 token 数：{contextStats.user}</span>
      <span>assistant 消息 token 数：{contextStats.assistant}</span>
      <span>系统提示词 token 数：{contextStats.system}</span>
      <span>tool 消息 token 数：{contextStats.tool}</span>
    </div>
  );

  return (
    <div className="agent-chat">
      <div className="agent-chat__header">
        <div className="agent-chat__title">
          <RobotOutlined />
          <h3>{sessionTitle}</h3>
        </div>
        <div className="agent-chat__header-actions">
          <Tooltip title="新建 Session">
            <Button type="text" icon={<PlusCircleOutlined />} onClick={createNewSession} />
          </Tooltip>
          <Dropdown
            menu={{
              items: sessions.length > 0
                ? sessions.map((session) => ({
                    key: session.id,
                    label: (
                      <div className="agent-session-menu-item">
                        <strong>{session.title}</strong>
                        <span>{formatSavedAt(session.savedAt)}</span>
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
        {messages.map((msg) => (
          <div
            className={`agent-message-row agent-message-row--${msg.role}`}
            key={msg.id}
          >
            <div className={`agent-message-bubble agent-message-bubble--${msg.role}`}>
              {msg.thinking && (
                <FoldBlock
                  icon={<BulbOutlined />}
                  title="思考"
                  preview={msg.thinking}
                  expanded={Boolean(expandedBlocks[`${msg.id}-thinking`])}
                  onToggle={() => toggleBlock(`${msg.id}-thinking`)}
                />
              )}

              {(() => {
                const parts = msg.content ? msg.content.split(/(\[\[TOOL:[^\]]+\]\])/) : [msg.role === 'agent' && isStreaming ? ' ' : ''];
                const renderedToolIds = new Set<string>();
                
                const renderedParts = parts.map((part, i) => {
                  const match = part.match(/^\[\[TOOL:([^\]]+)\]\]$/);
                  if (match) {
                    const toolId = match[1];
                    const toolIndex = msg.tools?.findIndex(t => t.id === toolId);
                    if (toolIndex !== undefined && toolIndex >= 0) {
                      const tool = msg.tools![toolIndex];
                      renderedToolIds.add(toolId);
                      return (
                        <FoldBlock
                          icon={<ToolOutlined />}
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
                  
                  let displayPart = part;
                  if (skills.length > 0) {
                    const skillNamesPattern = skills.map(s => s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
                    displayPart = displayPart.replace(new RegExp(`(/(${skillNamesPattern}))\\b`, 'g'), '[$1](#skill)');
                  }

                  return part.trim() ? (
                    <div className="agent-markdown" key={`md-${i}`}>
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({node, ...props}) => {
                            if (props.href === '#skill') {
                              return <Tag color="purple" style={{ margin: '0 2px' }}>{props.children}</Tag>;
                            }
                            return <a {...props} />
                          }
                        }}
                      >
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
          <div 
            className="agent-composer__highlights"
            style={{
              position: 'absolute',
              top: 12, left: 12, right: 12, bottom: 50, // bottom padding space for actions
              pointerEvents: 'none',
              overflow: 'hidden',
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
              color: 'transparent',
              zIndex: 1,
            }}
          >
            <div style={{ transform: `translateY(-${textareaScroll}px)` }}>
              {(() => {
                if (!skills.length || !input) return input;
                const skillNamesPattern = skills.map(s => s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
                const regex = new RegExp(`(/(${skillNamesPattern}))\\b`, 'g');
                const parts = input.split(regex);
                const result = [];
                let i = 0;
                while (i < parts.length) {
                  result.push(parts[i]);
                  if (i + 1 < parts.length) {
                    result.push(
                      <span key={i} style={{ backgroundColor: 'rgba(217, 119, 87, 0.2)', borderRadius: 4 }}>
                        {parts[i + 1]}
                      </span>
                    );
                  }
                  i += 3;
                }
                return result;
              })()}
              {/* add trailing space to ensure empty lines measure correctly */}
              {'\n'}
            </div>
          </div>

          <Mentions
            prefix="/"
            placement="top"
            popupClassName="agent-chat-skill-popup"
            getPopupContainer={() => document.getElementById('agent-composer-box') as HTMLElement}
            className="agent-composer__textarea"
            autoSize={{ minRows: 1, maxRows: 8 }}
            onChange={setInput}
            style={{ zIndex: 2, position: 'relative', background: 'transparent' }}
            onKeyDown={(event) => {
              if (event.key === 'Tab') {
                const target = event.target as HTMLTextAreaElement;
                const cursorPosition = target.selectionStart;
                const textBeforeCursor = input.slice(0, cursorPosition);
                const match = textBeforeCursor.match(/\/([a-zA-Z0-9_-]*)$/);
                if (match) {
                  const query = match[1];
                  const matchedSkill = skills.find(s => s.name.toLowerCase().startsWith(query.toLowerCase()));
                  if (matchedSkill) {
                    event.preventDefault();
                    const newText = input.slice(0, cursorPosition - query.length) + matchedSkill.name + ' ' + input.slice(cursorPosition);
                    setInput(newText);
                    setTimeout(() => {
                      const newPos = cursorPosition - query.length + matchedSkill.name.length + 1;
                      target.setSelectionRange(newPos, newPos);
                    }, 0);
                    return;
                  }
                }
              }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void handleSend();
              }
            }}
            placeholder="与 Agent 对话，或使用 / 唤起技能..."
            value={input}
            options={skills.map(skill => ({
              value: skill.name,
              label: (
                <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                  <strong style={{ flexShrink: 0 }}>{skill.name}</strong>
                  <span style={{ flex: 1, fontSize: 12, color: '#888', marginLeft: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {skill.description}
                  </span>
                </div>
              ),
            }))}
          />
          <div className="agent-composer__actions">
            <Select
              allowClear
              className="agent-library-select"
              maxTagCount="responsive"
              mode="multiple"
              onChange={setSelectedLibraryIds}
              options={settings.referenceLibraries.map((library) => ({
                label: library.name,
                value: library.id,
              }))}
              placeholder="选择范文库"
              size="small"
              value={selectedLibraryIds}
            />
            <div className="agent-send-cluster">
              <Tooltip color="#fff" placement="topRight" title={contextTooltip}>
                <button
                  aria-label="查看上下文详情"
                  className="agent-context-ring"
                  style={{ '--context-fill': `${contextPercent}%` } as React.CSSProperties}
                  type="button"
                >
                  <span>{contextPercent}%</span>
                </button>
              </Tooltip>
              <Button
                className="agent-send-button"
                disabled={!isStreaming && !input.trim()}
                icon={isStreaming ? <StopOutlined /> : <SendOutlined />}
                onClick={isStreaming ? handleStop : handleSend}
                shape="circle"
                type={isStreaming ? "default" : "primary"}
                danger={isStreaming}
              />
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
  expanded,
  onToggle,
}: {
  icon: React.ReactNode;
  title: string;
  preview: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="agent-fold-block">
      <button className="agent-fold-block__summary" onClick={onToggle} type="button">
        <span className="agent-fold-block__title">{icon}{title}</span>
        <span className="agent-fold-block__preview">{preview || '暂无内容'}</span>
      </button>
      {expanded && <pre className="agent-fold-block__detail">{preview}</pre>}
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

function buildModelMessages(
  messages: Message[],
  currentUserMessageId: string,
  mentionedSkills: SkillDefinition[],
): ModelMessage[] {
  return messages.flatMap((message) => {
    if (message.role === 'user') {
      let content = message.content;
      if (message.id === currentUserMessageId && mentionedSkills.length > 0) {
        content += `\n\n【系统指令】用户明确要求你在本轮回答中，必须优先调用以下技能：${mentionedSkills.map((skill) => skill.name).join(', ')}`;
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
  selectedLibraries,
  skills,
  messages,
  draft,
}: {
  systemPrompt: string;
  workspacePath: string | null;
  selectedLibraries: Array<{ name: string; path: string }>;
  skills: SkillDefinition[];
  messages: Message[];
  draft: string;
}) {
  const stats = {
    system: estimateTokens(buildEstimatedSystemPrompt(systemPrompt, workspacePath, selectedLibraries, skills)),
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
  selectedLibraries: Array<{ name: string; path: string }>,
  skills: SkillDefinition[],
) {
  const lines = [systemPrompt.trim()];
  const workspaceLines = [
    '## 当前环境',
    workspacePath?.trim()
      ? `当前工作空间路径：${workspacePath.trim()}`
      : '当前工作空间路径：未选择',
  ];

  if (selectedLibraries.length === 0) {
    workspaceLines.push('当前选中的范文库：无');
  } else {
    workspaceLines.push('当前选中的范文库：');
    selectedLibraries.forEach((library) => {
      workspaceLines.push(`- ${library.name}：${library.path}`);
    });
    workspaceLines.push('');
    workspaceLines.push('【重要指令】用户已选择上述范文库。在首轮对话中，你必须首先使用工具（如 list_dir, read, glob 等）主动读取并吸收这些范文库中的文章内容，然后再正式回答用户的问题。');
  }

  const systemLines = [
    '## 系统信息',
    `- **当前时间戳**：${Math.floor(Date.now() / 1000)}`,
    '- **操作系统**：darwin',
    '- **Python 环境**：已配置',
    '- **可用 Skills**：',
  ];

  if (skills.length === 0) {
    systemLines.push('  （无可用 skill）');
  } else {
    skills.forEach((skill) => {
      systemLines.push(`  - \`${skill.name}\`: ${skill.description}`);
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
