import React, { useState, useEffect, useRef } from 'react';
import { Select, Button, Input, Modal, Spin, message } from 'antd';
import {
  PlusOutlined,
  SendOutlined,
  CloseCircleOutlined,
  BulbOutlined,
  HistoryOutlined,
  BookOutlined,
  SmileOutlined,
  SaveOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { usePartnerChatStore } from '../stores/usePartnerChatStore';
import { usePartnerStore } from '../stores/usePartnerStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { appInvoke, listenStream } from '../utils/runtime';
import { parseArchiveAnalysisResponse } from '../utils/archiveAnalysis';
import type { Message, AgentSessionSummary } from '../stores/useAgentStore';

const MobileChat: React.FC = () => {
  const {
    messages,
    input,
    isStreaming,
    expandedBlocks,
    selectedWorldBookId,
    selectedCharacterCardId,
    sessions,
    sessionId,
    sessionTitle,
    activeRun,
    isSessionArchived,
    setMessages,
    setInput,
    setIsStreaming,
    setExpandedBlocks,
    setSelectedWorldBookId,
    setSelectedCharacterCardId,
    setSessions,
    setSessionId,
    setSessionTitle,
    setActiveRun,
    setIsSessionArchived,
    setContextCompaction,
    createNewSession,
  } = usePartnerChatStore();

  const { characterCards, worldBooks } = usePartnerStore();
  const settings = useSettingsStore();

  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [archiveAnalysis, setArchiveAnalysis] = useState<any>(null);

  // Archive fields
  const [editedTitle, setEditedTitle] = useState('');
  const [editedRelationType, setEditedRelationType] = useState('');
  const [editedRelationModel, setEditedRelationModel] = useState('');
  const [editedRelationBottomLine, setEditedRelationBottomLine] = useState('');
  const [editedEvents, setEditedEvents] = useState('');

  const chatListRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>(messages);
  const activeRunRef = useRef(activeRun);
  const currentThinkingIdRef = useRef<string | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    activeRunRef.current = activeRun;
  }, [activeRun]);

  const scrollToBottom = () => {
    if (chatListRef.current) {
      chatListRef.current.scrollTo({
        top: chatListRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, isStreaming]);

  // Load session list on mount
  useEffect(() => {
    appInvoke<AgentSessionSummary[]>('list_agent_sessions', { prefix: 'partner-session-' })
      .then((list) => setSessions(list))
      .catch((e) => console.error('加载会话列表失败:', e));
  }, []);

  const saveCurrentSession = async (customMessages?: Message[]) => {
    const list = customMessages || messagesRef.current;
    if (list.length === 0) return false;
    try {
      const record = {
        id: sessionId,
        title: sessionTitle,
        messages: list,
        savedAt: Date.now(),
        selectedReferenceFiles: [],
        selectedOutlineFile: null,
        todos: [],
        contextCompaction: null,
        isArchived: isSessionArchived,
        characterCardId: selectedCharacterCardId,
        selectedWorldBookId,
      };
      await appInvoke<AgentSessionSummary>('save_agent_session', { session: record });
      
      // Update session summary list
      const listRes = await appInvoke<AgentSessionSummary[]>('list_agent_sessions', { prefix: 'partner-session-' });
      setSessions(listRes);
      return true;
    } catch (e) {
      console.error('保存会话失败:', e);
      return false;
    }
  };

  const handleSelectSession = async (id: string) => {
    if (isStreaming) {
      message.warning('请先停止当前对话生成');
      return;
    }
    try {
      const record = await appInvoke<any>('load_agent_session', { id });
      setSessionId(record.id);
      setSessionTitle(record.title);
      setMessages(record.messages || []);
      setSelectedCharacterCardId(record.characterCardId ?? record.character_card_id ?? null);
      setSelectedWorldBookId(record.selectedWorldBookId ?? record.selected_world_book_id ?? null);
      setIsSessionArchived(record.isArchived ?? record.is_archived ?? false);
    } catch (e) {
      message.error('加载会话失败');
    }
  };

  const handleDeleteSession = async (id: string) => {
    Modal.confirm({
      title: '确认删除会话',
      content: '删除后无法恢复，是否确认？',
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        try {
          await appInvoke('delete_agent_session', { id });
          message.success('会话已删除');
          if (sessionId === id) {
            createNewSession();
          }
          const listRes = await appInvoke<AgentSessionSummary[]>('list_agent_sessions', { prefix: 'partner-session-' });
          setSessions(listRes);
        } catch (e) {
          message.error('删除会话失败');
        }
      }
    });
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming || isSessionArchived) return;

    if (!selectedCharacterCardId) {
      message.warning('请选择对话伴侣');
      return;
    }

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: trimmed,
      tools: [],
    };

    const agentMsgId = `msg-${Date.now() + 1}`;
    const pendingAgentMsg: Message = {
      id: agentMsgId,
      role: 'agent',
      content: '',
      tools: [],
    };

    const nextMessages = [...messages, userMsg, pendingAgentMsg];
    setMessages(nextMessages);
    setInput('');
    setIsStreaming(true);

    const isFirstMsg = !messages.some(m => m.role === 'user');
    if (isFirstMsg) {
      const fallbackTitle = trimmed.length > 15 ? `${trimmed.slice(0, 15)}...` : trimmed;
      setSessionTitle(fallbackTitle);
      await saveCurrentSession(nextMessages);

      // Background title summarization
      appInvoke<{ title: string }>('summarize_text', {
        request: { text: trimmed }
      }).then(async (res) => {
        const generatedTitle = res.title;
        setSessionTitle(generatedTitle);
        await appInvoke('update_agent_session_title', { id: sessionId, title: generatedTitle });
        await saveCurrentSession();
      }).catch((e) => {
        console.error('生成伴侣会话标题失败:', e);
      });
    }

    // Compile Prompt
    const selectedCharacterCard = characterCards.find(cc => cc.id === selectedCharacterCardId);
    const selectedWorldBook = worldBooks.find(wb => wb.id === selectedWorldBookId);
    
    const filterBlankMarkdownFields = (content: string): string => {
      const lines = content.split('\n');
      const afterListFilter = lines.filter(line => !/^\s*-\s*\*\*[^*]+\*\*：\s*$/.test(line));
      const result: string[] = [];
      let i = 0;
      while (i < afterListFilter.length) {
        const line = afterListFilter[i];
        if (/^##\s/.test(line)) {
          let j = i + 1;
          while (j < afterListFilter.length && afterListFilter[j].trim() === '') {
            j++;
          }
          if (j >= afterListFilter.length || /^##\s/.test(afterListFilter[j]) || /^# /.test(afterListFilter[j])) {
            i = j;
            continue;
          }
        }
        result.push(line);
        i++;
      }
      return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    };

    let systemPrompt = settings.partnerChatPrompt || '你是一个体贴温和的伴侣，请用温暖、真实而细节丰富的语言与用户交谈，避免机器感。';
    if (selectedWorldBook?.content) {
      systemPrompt += `\n\n## 伴侣对话世界设定\n${filterBlankMarkdownFields(selectedWorldBook.content)}`;
    }
    if (selectedCharacterCard?.content) {
      systemPrompt += `\n\n## 你的角色人设设定（伴侣设定）\n${filterBlankMarkdownFields(selectedCharacterCard.content)}`;
    }

    const modelMessages = nextMessages.slice(0, -1).map(msg => ({
      id: msg.id,
      role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
      content: msg.content,
    }));

    try {
      const { runId } = await appInvoke<{ runId: string }>('start_chat_completion_stream', {
        request: {
          modelInterface: settings.modelInterface,
          baseUrl: '', // Stripped, server-merged
          apiKey: '',  // Stripped, server-merged
          model: '',   // Stripped, server-merged
          temperature: settings.agentConfigs?.partnerChat?.temperature ?? 0.3,
          maxOutputTokens: settings.agentConfigs?.partnerChat?.maxOutputTokens ?? 32000,
          maxContextTokens: settings.agentConfigs?.partnerChat?.maxContextTokens ?? 200000,
          thinkingDepth: settings.agentConfigs?.partnerChat?.thinkingDepth ?? 'off',
          systemPrompt,
          messages: modelMessages,
        }
      });

      setActiveRun({ runId, messageId: agentMsgId });

      const unsubscribe = listenStream(
        runId,
        (event) => {
          const payload = event.payload;
          if (payload.runId !== runId) return;

          if (payload.eventType === 'delta' && payload.delta) {
            currentThinkingIdRef.current = null;
            setMessages((prev) => prev.map((msg) =>
              msg.id === agentMsgId ? { ...msg, content: msg.content + payload.delta } : msg
            ));
          } else if (payload.eventType === 'thinking_delta' && payload.delta) {
            setMessages((prev) => prev.map((msg) => {
              if (msg.id !== agentMsgId) return msg;
              let newContent = msg.content;
              const newThinkingBlocks = [...(msg.thinkingBlocks ?? [])];
              if (!currentThinkingIdRef.current) {
                currentThinkingIdRef.current = `thinking-${Date.now()}`;
                newContent += `\n\n[[THINKING:${currentThinkingIdRef.current}]]\n\n`;
                newThinkingBlocks.push({ id: currentThinkingIdRef.current, content: payload.delta! });
              } else {
                const idx = newThinkingBlocks.findIndex(b => b.id === currentThinkingIdRef.current);
                if (idx >= 0) {
                  newThinkingBlocks[idx] = {
                    ...newThinkingBlocks[idx],
                    content: newThinkingBlocks[idx].content + payload.delta!
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
          } else if (payload.eventType === 'thinking_signature' && payload.delta) {
            setMessages((prev) => prev.map((msg) => {
              if (msg.id !== agentMsgId) return msg;
              const newThinkingBlocks = [...(msg.thinkingBlocks ?? [])];
              if (newThinkingBlocks.length > 0) {
                newThinkingBlocks[newThinkingBlocks.length - 1] = {
                  ...newThinkingBlocks[newThinkingBlocks.length - 1],
                  signature: payload.delta
                };
              }
              return { ...msg, thinkingBlocks: newThinkingBlocks };
            }));
          } else if (payload.eventType === 'context_compacted' && payload.contextCompaction) {
            setContextCompaction(payload.contextCompaction);
          } else if (payload.eventType === 'error') {
            currentThinkingIdRef.current = null;
            setIsStreaming(false);
            setActiveRun({ runId: null, messageId: null });
            setMessages((prev) => prev.map((msg) =>
              msg.id === agentMsgId ? { ...msg, content: payload.message ? `请求模型失败：${payload.message}` : '请求模型失败' } : msg
            ));
          } else if (payload.eventType === 'done') {
            currentThinkingIdRef.current = null;
            setIsStreaming(false);
            setActiveRun({ runId: null, messageId: null });
            saveCurrentSession();
          }
        },
        (err) => {
          setIsStreaming(false);
          setActiveRun({ runId: null, messageId: null });
          message.error(`连接中断：${err}`);
        }
      );

      // Save unsubscribe handler on window for cancellation
      (window as any)._activeUnsubscribe = unsubscribe;
    } catch (e) {
      setIsStreaming(false);
      message.error(`启动对话生成失败：${e}`);
    }
  };

  const handleStopStream = async () => {
    if (!activeRunRef.current.runId) return;
    try {
      if ((window as any)._activeUnsubscribe) {
        (window as any)._activeUnsubscribe();
      }
      await appInvoke('stop_chat_stream', { runId: activeRunRef.current.runId });
      setIsStreaming(false);
      setActiveRun({ runId: null, messageId: null });
      message.success('已中止生成');
      saveCurrentSession();
    } catch (e) {
      console.error('停止生成失败:', e);
    }
  };

  const handleStartArchive = async () => {
    if (messages.length === 0) return;
    setIsArchiveModalOpen(true);
    setIsAnalyzing(true);
    setArchiveAnalysis(null);

    try {
      const saved = await saveCurrentSession();
      if (!saved) {
        message.error('保存当前会话失败，请稍后重试');
        setIsArchiveModalOpen(false);
        return;
      }

      const result = await appInvoke<string | Record<string, any>>('analyze_character_memory', { sessionId });
      const parsed = parseArchiveAnalysisResponse(result);
      setArchiveAnalysis(parsed);
      setEditedTitle(parsed.sessionTitle || parsed.recommendedSessionTitle || sessionTitle);
      setEditedRelationType(parsed.userRelationType || '');
      setEditedRelationModel(parsed.userInteractionModel || '');
      setEditedRelationBottomLine(parsed.userRelationBottomLine || '');
      setEditedEvents(parsed.keyEvents || '');
    } catch (e) {
      message.error(`分析失败：${e}`);
      setIsArchiveModalOpen(false);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleConfirmArchive = async () => {
    try {
      await appInvoke('archive_agent_session', {
        sessionId,
        payload: {
          title: editedTitle,
          userRelationType: editedRelationType,
          userInteractionModel: editedRelationModel,
          userRelationBottomLine: editedRelationBottomLine,
          keyEvents: editedEvents,
        }
      });
      setIsSessionArchived(true);
      setSessionTitle(editedTitle);
      setIsArchiveModalOpen(false);
      message.success('伴侣记忆封存成功！该会话已归档锁定。');

      // Reload sessions
      const sessList = await appInvoke<AgentSessionSummary[]>('list_agent_sessions', { prefix: 'partner-session-' });
      setSessions(sessList);

      // Reload partner store
      const partnerStoreContent = await appInvoke<string>('load_app_state', { name: 'partner-store' });
      if (partnerStoreContent) {
        const parsed = JSON.parse(partnerStoreContent);
        if (parsed.state) {
          usePartnerStore.setState(parsed.state);
        }
      }
    } catch (e) {
      message.error(`封存归档失败: ${e}`);
    }
  };

  const toggleBlock = (key: string) => {
    setExpandedBlocks({
      ...expandedBlocks,
      [key]: !expandedBlocks[key],
    });
  };

  const selectedCharacterCard = characterCards.find(cc => cc.id === selectedCharacterCardId);

  const selectOptions = sessions.map(s => ({ value: s.id, label: s.title }));
  if (sessionId && !sessions.some(s => s.id === sessionId)) {
    selectOptions.unshift({ value: sessionId, label: sessionTitle || '当前对话' });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#faf9f5', overflow: 'hidden' }}>
      {/* Session selector & Control Panel */}
      <div style={{
        padding: '12px 16px',
        backgroundColor: '#fff',
        borderBottom: '1px solid rgba(217, 119, 87, 0.05)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexShrink: 0,
      }}>
        <Select
          value={sessionId}
          onChange={handleSelectSession}
          style={{ flex: 1, fontSize: '16px', minWidth: 0 }}
          placeholder="切换聊天会话..."
          options={selectOptions.map(opt => ({
            value: opt.value,
            label: (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{opt.label}</span>
                {sessions.some(s => s.id === opt.value) && (
                  <DeleteOutlined
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSession(opt.value);
                    }}
                    style={{ color: '#ff4d4f', cursor: 'pointer', marginLeft: '8px' }}
                  />
                )}
              </div>
            )
          }))}
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={createNewSession}
          style={{ backgroundColor: '#d97757', borderColor: '#d97757', flexShrink: 0 }}
        >
          新建
        </Button>
      </div>

      {/* Main chat flow */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selectedCharacterCardId ? (
          /* Companion Selection */
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px 24px',
            backgroundColor: '#faf9f5',
          }}>
            <SmileOutlined style={{ fontSize: '48px', color: '#d97757', marginBottom: '16px' }} />
            <h3 style={{ fontSize: '15px', color: '#33312e', marginBottom: '24px', fontWeight: 600 }}>请选择要交谈的智能伴侣</h3>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              width: '100%',
              maxHeight: '300px',
              overflowY: 'auto',
            }}>
              {characterCards.map((card) => (
                <div
                  key={card.id}
                  onClick={() => {
                    setSelectedCharacterCardId(card.id);
                    saveCurrentSession();
                  }}
                  style={{
                    backgroundColor: '#fff',
                    borderRadius: '12px',
                    padding: '16px',
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.01)',
                    border: '1px solid rgba(217, 119, 87, 0.05)',
                    textAlign: 'center',
                    fontWeight: 500,
                  }}
                >
                  {card.name}
                </div>
              ))}
              {characterCards.length === 0 && (
                <div style={{ color: '#8c8880', fontSize: '13px', textAlign: 'center' }}>
                  暂无角色卡，请先在桌面端创建。
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Active Chat Thread */
          <>
            {/* Companion bar */}
            <div style={{
              padding: '8px 16px',
              backgroundColor: '#faf9f5',
              borderBottom: '1px solid rgba(217, 119, 87, 0.05)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <BookOutlined style={{ color: '#d97757' }} />
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#33312e' }}>伴侣：{selectedCharacterCard?.name}</span>
              </div>
              <Select
                value={selectedWorldBookId}
                onChange={(id) => {
                  setSelectedWorldBookId(id);
                  saveCurrentSession();
                }}
                style={{ width: '120px', fontSize: '16px' }}
                placeholder="世界书背景..."
                allowClear
                options={worldBooks.map(wb => ({ value: wb.id, label: wb.name }))}
              />
            </div>

            {/* Chat list */}
            <div
              ref={chatListRef}
              style={{
                flex: 1,
                padding: '16px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
            >
              {messages.length === 0 && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: '#8c8880',
                  fontSize: '13px',
                }}>
                  与 {selectedCharacterCard?.name} 聊点什么吧...
                </div>
              )}
              {messages.map((msg) => {
                const isUser = msg.role === 'user';
                return (
                  <div
                    key={msg.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: isUser ? 'flex-end' : 'flex-start',
                    }}
                  >
                    <div style={{
                      maxWidth: '85%',
                      backgroundColor: isUser ? '#d97757' : '#fff',
                      color: isUser ? '#fff' : '#33312e',
                      borderRadius: '16px',
                      padding: '12px 16px',
                      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.01)',
                      border: isUser ? 'none' : '1px solid rgba(217, 119, 87, 0.05)',
                      fontSize: '14px',
                      lineHeight: 1.6,
                    }}>
                      {isUser ? (
                        <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                      ) : (
                        /* Parse Thinking and Text */
                        (() => {
                          const parts = msg.content.split(/(\[\[THINKING:[^\]]+\]\])/g);
                          return parts.map((part, idx) => {
                            const thinkingMatch = part.match(/\[\[THINKING:([^\]]+)\]\]/);
                            if (thinkingMatch) {
                              const thinkingId = thinkingMatch[1];
                              const block = msg.thinkingBlocks?.find(b => b.id === thinkingId);
                              if (block) {
                                const isExpanded = !!expandedBlocks[`${msg.id}-${thinkingId}`];
                                return (
                                  <div
                                    key={thinkingId}
                                    style={{
                                      backgroundColor: '#f6f5f0',
                                      borderLeft: '3px solid #d97757',
                                      padding: '8px 12px',
                                      borderRadius: '4px',
                                      margin: '8px 0',
                                    }}
                                  >
                                    <div
                                      onClick={() => toggleBlock(`${msg.id}-${thinkingId}`)}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        fontSize: '12px',
                                        color: '#d97757',
                                        cursor: 'pointer',
                                        fontWeight: 600,
                                      }}
                                    >
                                      <BulbOutlined />
                                      <span>思考过程 (点击{isExpanded ? '折叠' : '展开'})</span>
                                    </div>
                                    {isExpanded && (
                                      <div style={{
                                        fontSize: '12px',
                                        color: '#7f7a72',
                                        marginTop: '6px',
                                        whiteSpace: 'pre-wrap',
                                      }}>
                                        {block.content}
                                      </div>
                                    )}
                                  </div>
                                );
                              }
                              return null;
                            }
                            return part.trim() ? (
                              <ReactMarkdown key={idx} remarkPlugins={[remarkGfm]}>
                                {part}
                              </ReactMarkdown>
                            ) : null;
                          });
                        })()
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>

            {/* Input & Action buttons */}
            <div style={{
              padding: '12px 16px',
              backgroundColor: '#fff',
              borderTop: '1px solid rgba(217, 119, 87, 0.05)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <Input.TextArea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={isSessionArchived ? "当前对话已归档锁定" : "说点什么吧..."}
                  disabled={isSessionArchived}
                  autoSize={{ minRows: 1, maxRows: 3 }}
                  style={{ borderRadius: '8px', borderColor: 'rgba(217, 119, 87, 0.15)', fontSize: '16px' }}
                  onPressEnter={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                />
                {isStreaming ? (
                  <Button
                    type="primary"
                    shape="circle"
                    danger
                    icon={<CloseCircleOutlined />}
                    onClick={handleStopStream}
                    style={{ height: '36px', width: '36px', flexShrink: 0, minWidth: '36px' }}
                  />
                ) : (
                  <Button
                    type="primary"
                    shape="circle"
                    icon={<SendOutlined />}
                    onClick={handleSend}
                    disabled={isSessionArchived || !input.trim()}
                    style={{
                      height: '36px',
                      width: '36px',
                      minWidth: '36px',
                      flexShrink: 0,
                      backgroundColor: '#d97757',
                      borderColor: '#d97757',
                    }}
                  />
                )}
              </div>

              {/* Archive Trigger Button */}
              {messages.length > 0 && !isSessionArchived && !isStreaming && (
                <Button
                  type="link"
                  icon={<SaveOutlined />}
                  onClick={handleStartArchive}
                  style={{ color: '#d97757', padding: 0, fontSize: '13px', alignSelf: 'flex-end' }}
                >
                  封存记忆并归档会话
                </Button>
              )}
              {isSessionArchived && (
                <div style={{ fontSize: '11px', color: '#8c8880', textAlign: 'center', display: 'flex', justifyContent: 'center', gap: '4px', alignItems: 'center' }}>
                  <HistoryOutlined />
                  <span>此对话已归档封存，记忆已存入角色卡</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Memory Archiving Modal */}
      <Modal
        title="伴侣记忆归档分析"
        open={isArchiveModalOpen}
        onCancel={() => !isAnalyzing && setIsArchiveModalOpen(false)}
        footer={isAnalyzing ? null : [
          <Button key="cancel" onClick={() => setIsArchiveModalOpen(false)}>取消</Button>,
          <Button key="confirm" type="primary" onClick={handleConfirmArchive} style={{ backgroundColor: '#d97757', borderColor: '#d97757' }}>确认封存</Button>
        ]}
        width="90%"
        style={{ top: 20 }}
      >
        {isAnalyzing ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 0', gap: '16px' }}>
            <Spin size="large" style={{ color: '#d97757' }} />
            <span style={{ fontSize: '13px', color: '#8c8880' }}>正在深度分析会话，提炼人际羁绊与关键事件...</span>
          </div>
        ) : archiveAnalysis ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '60vh', overflowY: 'auto', paddingRight: '4px' }}>
            <div style={{ padding: '10px 12px', background: '#faf6f0', borderRadius: '8px', border: '1px solid #f2e8dc', color: '#8c8882', fontSize: '12px' }}>
              <strong>提示：</strong>大模型已深入剖析本场对话，为您生成了伴侣人设立场的变化修改点。请在同步前仔细确认，您也可以直接在下方编辑框中进行微调润色。
            </div>

            {/* Changes Analysis */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ border: '1px solid rgba(0,0,0,0.04)', padding: '10px', borderRadius: '6px', background: '#fafafa' }}>
                <div style={{ color: '#d97757', fontWeight: 600, fontSize: '12px', marginBottom: '6px' }}>关系变化分析</div>
                <div style={{ fontSize: '12px', color: '#33312e', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{archiveAnalysis.relationChanges}</div>
              </div>
              <div style={{ border: '1px solid rgba(0,0,0,0.04)', padding: '10px', borderRadius: '6px', background: '#fafafa' }}>
                <div style={{ color: '#d97757', fontWeight: 600, fontSize: '12px', marginBottom: '6px' }}>共同事件分析</div>
                <div style={{ fontSize: '12px', color: '#33312e', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{archiveAnalysis.eventChanges}</div>
              </div>
            </div>

            <div style={{ height: '1px', background: 'rgba(0,0,0,0.03)' }} />

            {/* Editable fields */}
            <div>
              <div style={{ fontSize: '12px', color: '#8c8880', marginBottom: '4px' }}>会话归档标题</div>
              <Input
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                style={{ borderRadius: '6px', fontSize: '16px' }}
              />
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#8c8880', marginBottom: '4px' }}>与用户关系类型</div>
              <Input
                value={editedRelationType}
                onChange={(e) => setEditedRelationType(e.target.value)}
                style={{ borderRadius: '6px', fontSize: '16px' }}
              />
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#8c8880', marginBottom: '4px' }}>与用户相处模式</div>
              <Input.TextArea
                value={editedRelationModel}
                onChange={(e) => setEditedRelationModel(e.target.value)}
                autoSize={{ minRows: 2, maxRows: 4 }}
                style={{ borderRadius: '6px', fontSize: '16px' }}
              />
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#8c8880', marginBottom: '4px' }}>与用户关系底线</div>
              <Input.TextArea
                value={editedRelationBottomLine}
                onChange={(e) => setEditedRelationBottomLine(e.target.value)}
                autoSize={{ minRows: 2, maxRows: 4 }}
                style={{ borderRadius: '6px', fontSize: '16px' }}
              />
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#8c8880', marginBottom: '4px' }}>关键事件记录</div>
              <Input.TextArea
                value={editedEvents}
                onChange={(e) => setEditedEvents(e.target.value)}
                autoSize={{ minRows: 4, maxRows: 8 }}
                style={{ borderRadius: '6px', fontSize: '16px' }}
              />
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
};

export default MobileChat;
