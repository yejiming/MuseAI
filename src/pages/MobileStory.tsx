import React, { useEffect, useRef } from 'react';
import { Select, Button, Input, Modal, Spin, message, Radio, Switch, Checkbox } from 'antd';
import {
  PlusOutlined,
  SendOutlined,
  CloseCircleOutlined,
  BulbOutlined,
  HistoryOutlined,
  BookOutlined,
  SaveOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStoryStore } from '../stores/useStoryStore';
import { usePartnerStore } from '../stores/usePartnerStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { appInvoke, listenStream } from '../utils/runtime';
import { parseArchiveAnalysisResponse } from '../utils/archiveAnalysis';
import { createStableContentKey, createStableToolKey } from '../utils/renderKeys';
import { useStateGroup } from '../utils/reducerState';
import { ensureSessionId } from '../utils/sessionIds';
import {
  compileStorySystemPrompt,
  buildStoryModelMessages,
  getStoryAllowedTools,
  getRolePlayCharacterName,
} from './storyAgent';
import type { Message, AgentSessionSummary, AgentToolEntry } from '../stores/useAgentStore';

interface MobileStoryUiState {
  isArchiveModalOpen: boolean;
  isAnalyzing: boolean;
  isSavingConversation: boolean;
  archiveAnalyses: Record<string, any>;
  hasStartedAnalysis: boolean;
  tempSelectedCardIds: string[];
  selectedTargetCardId: string;
  editedTitle: string;
  editedRelationTypes: Record<string, string>;
  editedRelationModels: Record<string, string>;
  editedRelationBottomLines: Record<string, string>;
  editedEventsMap: Record<string, string>;
}

const MOBILE_STORY_COLLAPSIBLE_BUTTON_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '12px',
  cursor: 'pointer',
  fontWeight: 600,
  border: 'none',
  background: 'transparent',
  padding: 0,
  font: 'inherit',
  width: '100%',
  textAlign: 'left',
};

const MOBILE_STORY_ACTIVE_COMPANIONS_BAR_STYLE: React.CSSProperties = {
  padding: '6px 16px',
  backgroundColor: '#fff',
  borderBottom: '1px solid rgba(217, 119, 87, 0.05)',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '11px',
  color: '#8c8880',
  flexShrink: 0,
};

const MOBILE_STORY_MESSAGE_BUBBLE_BASE_STYLE: React.CSSProperties = {
  maxWidth: '90%',
  borderRadius: '16px',
  padding: '12px 16px',
  boxShadow: '0 2px 10px rgba(0, 0, 0, 0.01)',
  fontSize: '14px',
  lineHeight: 1.6,
};

const useMobileStoryView = () => {
  const {
    messages,
    input,
    inputMode,
    isStreaming,
    expandedBlocks,
    selectedWorldBookId,
    selectedCharacterCardIds,
    sessions,
    sessionId,
    sessionTitle,
    activeRun,
    isSessionArchived,
    initialPlot,
    contextCompaction,
    dynamicRoleLoadingEnabled,
    setMessages,
    setInput,
    setInputMode,
    setIsStreaming,
    setExpandedBlocks,
    setSelectedWorldBookId,
    setSelectedCharacterCardIds,
    setSessions,
    setSessionId,
    setSessionTitle,
    setActiveRun,
    setIsSessionArchived,
    setInitialPlot,
    setContextCompaction,
    setDynamicRoleLoadingEnabled,
    createNewSession,
  } = useStoryStore();

  const { characterCards, worldBooks } = usePartnerStore();
  const settings = useSettingsStore();

  const [uiState, , setUiField] = useStateGroup<MobileStoryUiState>({
    isArchiveModalOpen: false,
    isAnalyzing: false,
    isSavingConversation: false,
    archiveAnalyses: {},
    hasStartedAnalysis: false,
    tempSelectedCardIds: [],
    selectedTargetCardId: '',
    editedTitle: '',
    editedRelationTypes: {},
    editedRelationModels: {},
    editedRelationBottomLines: {},
    editedEventsMap: {},
  });
  const {
    isArchiveModalOpen,
    isAnalyzing,
    isSavingConversation,
    archiveAnalyses,
    hasStartedAnalysis,
    tempSelectedCardIds,
    selectedTargetCardId,
    editedTitle,
    editedRelationTypes,
    editedRelationModels,
    editedRelationBottomLines,
    editedEventsMap,
  } = uiState;
  const setIsArchiveModalOpen = (isArchiveModalOpen: boolean) => setUiField('isArchiveModalOpen', isArchiveModalOpen);
  const setIsAnalyzing = (isAnalyzing: boolean) => setUiField('isAnalyzing', isAnalyzing);
  const setIsSavingConversation = (isSavingConversation: boolean) => setUiField('isSavingConversation', isSavingConversation);
  const setArchiveAnalyses = (archiveAnalyses: Record<string, any>) => setUiField('archiveAnalyses', archiveAnalyses);
  const setHasStartedAnalysis = (hasStartedAnalysis: boolean) => setUiField('hasStartedAnalysis', hasStartedAnalysis);
  const setTempSelectedCardIds = (tempSelectedCardIds: React.SetStateAction<string[]>) => setUiField('tempSelectedCardIds', tempSelectedCardIds);
  const setSelectedTargetCardId = (selectedTargetCardId: string) => setUiField('selectedTargetCardId', selectedTargetCardId);
  const setEditedTitle = (editedTitle: string) => setUiField('editedTitle', editedTitle);
  const setEditedRelationTypes = (editedRelationTypes: React.SetStateAction<Record<string, string>>) => setUiField('editedRelationTypes', editedRelationTypes);
  const setEditedRelationModels = (editedRelationModels: React.SetStateAction<Record<string, string>>) => setUiField('editedRelationModels', editedRelationModels);
  const setEditedRelationBottomLines = (editedRelationBottomLines: React.SetStateAction<Record<string, string>>) => setUiField('editedRelationBottomLines', editedRelationBottomLines);
  const setEditedEventsMap = (editedEventsMap: React.SetStateAction<Record<string, string>>) => setUiField('editedEventsMap', editedEventsMap);

  const chatListRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>(messages);
  const activeRunRef = useRef(activeRun);
  const contextCompactionRef = useRef(contextCompaction);
  const currentThinkingIdRef = useRef<string | null>(null);
  const selectedCards = characterCards.filter(cc => selectedCharacterCardIds.includes(cc.id));

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    activeRunRef.current = activeRun;
  }, [activeRun]);

  useEffect(() => {
    contextCompactionRef.current = contextCompaction;
  }, [contextCompaction]);

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
    appInvoke<AgentSessionSummary[]>('list_agent_sessions', { prefix: 'story-session-' })
      .then((list) => setSessions(list))
      .catch((e) => console.error('加载故事列表失败:', e));
  }, [setSessions]);

  const saveCurrentSession = async (customMessages?: Message[]) => {
    const list = customMessages || messagesRef.current;
    if (list.length === 0) return false;
    const currentSessionId = ensureSessionId(sessionId, 'story-session');
    if (currentSessionId !== sessionId) {
      setSessionId(currentSessionId);
    }
    try {
      const record = {
        id: currentSessionId,
        title: sessionTitle,
        messages: list,
        savedAt: Date.now(),
        selectedReferenceFiles: [],
        selectedOutlineFile: null,
        todos: [],
        contextCompaction: contextCompactionRef.current,
        isArchived: isSessionArchived,
        characterCardIds: selectedCharacterCardIds,
        selectedWorldBookId,
        dynamicRoleLoadingEnabled,
      };
      await appInvoke<AgentSessionSummary>('save_agent_session', { session: record });
      
      // Update session summary list
      const listRes = await appInvoke<AgentSessionSummary[]>('list_agent_sessions', { prefix: 'story-session-' });
      setSessions(listRes);
      return true;
    } catch (e) {
      console.error('保存故事会话失败:', e);
      return false;
    }
  };

  const handleSaveConversation = async () => {
    if (messages.length === 0 || isStreaming || isSessionArchived) {
      message.warning('当前无可保存的对话内容');
      return;
    }
    setIsSavingConversation(true);
    try {
      const chatHistoryLines: string[] = [];
      for (const m of messages) {
        if (m.role === 'user' || m.role === 'agent') {
          chatHistoryLines.push(`${m.role === 'user' ? '我' : '故事旁白与NPC'}: ${m.content.replace(/\[\[THINKING:[^\]]+\]\]/g, '').trim()}`);
        }
      }
      const chatHistoryText = chatHistoryLines.join('\n\n');
      const res = await appInvoke<{ title: string }>('summarize_text', {
        request: { text: chatHistoryText }
      });
      const generatedTitle = res.title;
      setSessionTitle(generatedTitle);
      const saved = await saveCurrentSession();
      if (!saved) {
        message.error('保存对话失败，请稍后重试');
        return;
      }
      message.success('对话已保存');
    } catch (err) {
      console.error('保存对话失败:', err);
      message.error(`保存对话失败：${String(err)}`);
    } finally {
      setIsSavingConversation(false);
    }
  };

  const handleSelectSession = async (id: string) => {
    if (isStreaming) {
      message.warning('请先停止当前故事生成');
      return;
    }
    try {
      const record = await appInvoke<any>('load_agent_session', { id });
      setSessionId(record.id);
      setSessionTitle(record.title);
      setMessages(record.messages || []);
      setSelectedCharacterCardIds(record.characterCardIds ?? record.character_card_ids ?? []);
      setSelectedWorldBookId(record.selectedWorldBookId ?? record.selected_world_book_id ?? null);
      const loadedContextCompaction = record.contextCompaction ?? record.context_compaction ?? null;
      contextCompactionRef.current = loadedContextCompaction;
      setContextCompaction(loadedContextCompaction);
      setIsSessionArchived(record.isArchived ?? record.is_archived ?? false);
      setDynamicRoleLoadingEnabled(record.dynamicRoleLoadingEnabled ?? record.dynamic_role_loading_enabled ?? false);
    } catch (e) {
      message.error('加载故事会话失败');
    }
  };

  const handleDeleteSession = async (id: string) => {
    Modal.confirm({
      title: '确认删除故事',
      content: '删除后无法恢复，是否确认？',
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        try {
          await appInvoke('delete_agent_session', { id });
          message.success('故事已删除');
          if (sessionId === id) {
            createNewSession();
          }
          const listRes = await appInvoke<AgentSessionSummary[]>('list_agent_sessions', { prefix: 'story-session-' });
          setSessions(listRes);
        } catch (e) {
          message.error('删除故事会话失败');
        }
      }
    });
  };

  const handleStartAdventure = async () => {
    const trimmedPlot = initialPlot.trim();
    if (!trimmedPlot) {
      message.warning('请先输入故事初始起因');
      return;
    }
    if (selectedCharacterCardIds.length === 0) {
      message.warning('请至少选择一个参与故事的角色');
      return;
    }

    const formattedPlot = `[故事起点] ${trimmedPlot}`;
    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: formattedPlot,
      tools: [],
    };
    const agentMsgId = `msg-${Date.now() + 1}`;
    const pendingAgentMsg: Message = {
      id: agentMsgId,
      role: 'agent',
      content: '',
      tools: [],
    };

    const nextMessages = [userMsg, pendingAgentMsg];
    contextCompactionRef.current = null;
    setContextCompaction(null);
    setMessages(nextMessages);
    setIsStreaming(true);

    const fallbackTitle = trimmedPlot.length > 15 ? `${trimmedPlot.slice(0, 15)}...` : trimmedPlot;
    setSessionTitle(fallbackTitle);

    // Call stream initiator
    await triggerStoryStream(nextMessages, agentMsgId, formattedPlot, userMsg);
  };

  const triggerStoryStream = async (
    currentMessages: Message[],
    agentMsgId: string,
    formattedText: string,
    userMsg: Message
  ) => {
    const selectedWorldBook = worldBooks.find(wb => wb.id === selectedWorldBookId);
    const selectedCards = characterCards.filter(cc => selectedCharacterCardIds.includes(cc.id));

    // Construct settings from partner-store locally if empty
    const partnerChatUserInfo = {};

    const basePrompt = dynamicRoleLoadingEnabled
      ? settings.storyDynamicAgentPrompt || '你是一个充满创意的小说家，负责为用户主持这一场文字冒险，遇到多名角色时应合理调用 role_play 工具。'
      : settings.storyAgentPrompt || '你是一个充满创意的小说家，负责为用户主持这一场文字冒险。';

    const systemPrompt = compileStorySystemPrompt({
      basePrompt,
      worldBookContent: selectedWorldBook?.content || null,
      characterCards: selectedCards.map(c => ({ name: c.name, content: c.content })),
      userInfo: partnerChatUserInfo,
      dynamicRoleLoadingEnabled,
    });

    const isFirstRun = currentMessages.length === 2;
    const modelMessages = isFirstRun
      ? [{ id: userMsg.id, role: 'user' as const, content: formattedText }]
      : buildStoryModelMessages(currentMessages.slice(0, -1));

    const rolePlayContext = dynamicRoleLoadingEnabled ? {
      chatSystemPrompt: settings.partnerChatPrompt || '',
      worldBookContent: selectedWorldBook?.content || '',
      userInfo: partnerChatUserInfo,
      characterCards: selectedCards.map(c => ({ id: c.id, name: c.name, content: c.content })),
    } : null;

    try {
      const { runId } = await appInvoke<{ runId: string }>('start_chat_completion_stream', {
        request: {
          modelInterface: settings.modelInterface,
          baseUrl: '',
          apiKey: '',
          model: '',
          temperature: settings.agentConfigs?.storyAgent?.temperature ?? 0.3,
          maxOutputTokens: settings.agentConfigs?.storyAgent?.maxOutputTokens ?? 32000,
          maxContextTokens: settings.agentConfigs?.storyAgent?.maxContextTokens ?? 200000,
          thinkingDepth: settings.agentConfigs?.storyAgent?.thinkingDepth ?? 'off',
          systemPrompt,
          messages: modelMessages,
          contextCompaction: contextCompactionRef.current,
          allowedTools: getStoryAllowedTools(dynamicRoleLoadingEnabled),
          rolePlayContext,
        }
      });

      setActiveRun({ runId, messageId: agentMsgId });

      const unsubscribe = listenStream(
        runId,
        (event) => {
          const payload = event.payload;
          if (payload.runId !== runId) return;

          if (payload.eventType === 'context_compacted' && payload.contextCompaction) {
            contextCompactionRef.current = payload.contextCompaction;
            setContextCompaction(payload.contextCompaction);
            return;
          }

          if (payload.eventType === 'error') {
            currentThinkingIdRef.current = null;
            setIsStreaming(false);
            setActiveRun({ runId: null, messageId: null });
          } else if (payload.eventType === 'done') {
            currentThinkingIdRef.current = null;
            setIsStreaming(false);
            setActiveRun({ runId: null, messageId: null });
          }

          setMessages((prev) => {
            const msgIndex = prev.findIndex(m => m.id === agentMsgId);
            if (msgIndex === -1) return prev;

            const targetMsg = prev[msgIndex];
            let content = targetMsg.content;
            let tools = [...(targetMsg.tools || [])];
            let thinkingBlocks = [...(targetMsg.thinkingBlocks || [])];
            let thinking = targetMsg.thinking || '';

            if (payload.eventType === 'delta' && payload.delta) {
              currentThinkingIdRef.current = null;
              content += payload.delta;
            } else if (payload.eventType === 'thinking_delta' && payload.delta) {
              thinking += payload.delta;
              if (!currentThinkingIdRef.current) {
                currentThinkingIdRef.current = `thinking-${Date.now()}`;
                content += `\n\n[[THINKING:${currentThinkingIdRef.current}]]\n\n`;
                thinkingBlocks.push({ id: currentThinkingIdRef.current, content: payload.delta! });
              } else {
                const tIdx = thinkingBlocks.findIndex(b => b.id === currentThinkingIdRef.current);
                if (tIdx >= 0) {
                  thinkingBlocks[tIdx] = {
                    ...thinkingBlocks[tIdx],
                    content: thinkingBlocks[tIdx].content + payload.delta!
                  };
                }
              }
            } else if (payload.eventType === 'thinking_signature' && payload.delta) {
              if (thinkingBlocks.length > 0) {
                thinkingBlocks[thinkingBlocks.length - 1] = {
                  ...thinkingBlocks[thinkingBlocks.length - 1],
                  signature: payload.delta
                };
              }
            } else if (payload.eventType === 'tool_start' && payload.toolCallId && payload.toolName) {
              content += `\n\n[[TOOL:${payload.toolCallId}]]\n\n`;
              tools.push({
                id: payload.toolCallId,
                name: payload.toolName,
                arguments: payload.toolArguments || '{}',
                result: '',
                status: 'running',
              });
            } else if (payload.eventType === 'tool_delta' && payload.toolCallId && payload.delta) {
              const tIdx = tools.findIndex(t => t.id === payload.toolCallId);
              if (tIdx >= 0) {
                tools[tIdx] = {
                  ...tools[tIdx],
                  result: tools[tIdx].result + payload.delta,
                };
              }
            } else if (payload.eventType === 'tool_done' && payload.toolCallId) {
              const tIdx = tools.findIndex(t => t.id === payload.toolCallId);
              if (tIdx >= 0) {
                tools[tIdx] = {
                  ...tools[tIdx],
                  status: 'success',
                };
              }
            } else if (payload.eventType === 'error') {
              content += payload.message ? `\n\n[冒险故障] ${payload.message}` : '\n\n[冒险故障] 请求大模型失败';
            }

            const updated = [...prev];
            updated[msgIndex] = {
              ...targetMsg,
              content,
              tools,
              thinkingBlocks,
              thinking,
            };
            return updated;
          });
        },
        (err) => {
          setIsStreaming(false);
          setActiveRun({ runId: null, messageId: null });
          message.error(`冒险生成中断: ${err}`);
        }
      );

      (window as any)._activeStoryUnsubscribe = unsubscribe;
    } catch (e) {
      setIsStreaming(false);
      message.error(`启动故事生成失败: ${e}`);
    }
  };

  const handleSendAction = async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming || isSessionArchived) return;

    let formattedText = trimmed;
    if (inputMode === 'speech') {
      formattedText = `我：“${trimmed}”`;
    } else if (inputMode === 'behavior') {
      formattedText = `（我 ${trimmed}）`;
    } else if (inputMode === 'plot') {
      formattedText = `[剧情推进] ${trimmed}`;
    }

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: formattedText,
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

    await triggerStoryStream(nextMessages, agentMsgId, formattedText, userMsg);
  };

  const handleStopStream = async () => {
    if (!activeRun.runId) return;
    try {
      if ((window as any)._activeStoryUnsubscribe) {
        (window as any)._activeStoryUnsubscribe();
      }
      await appInvoke('stop_chat_stream', { runId: activeRun.runId });
      setIsStreaming(false);
      setActiveRun({ runId: null, messageId: null });
      message.success('已暂停冒险生成');
    } catch (e) {
      console.error('停止冒险失败:', e);
    }
  };

  const handleStartArchive = async () => {
    if (messages.length === 0) return;
    if (selectedCards.length === 0) {
      message.warning('当前冒险尚未绑定任何角色卡，无法封存记忆');
      return;
    }

    setIsArchiveModalOpen(true);
    setIsAnalyzing(false);
    setHasStartedAnalysis(false);
    setArchiveAnalyses({});
    setTempSelectedCardIds(selectedCards.map(c => c.id));
    setSelectedTargetCardId(selectedCards[0]?.id || '');
    setEditedRelationTypes({});
    setEditedRelationModels({});
    setEditedRelationBottomLines({});
    setEditedEventsMap({});
  };

  const startAnalyzingSelectedCards = async () => {
    if (tempSelectedCardIds.length === 0) return;

    setIsAnalyzing(true);
    setHasStartedAnalysis(true);
    setSelectedTargetCardId(tempSelectedCardIds[0]);

    try {
      const saved = await saveCurrentSession();
      if (!saved) {
        message.error('保存当前故事失败，请稍后重试');
        setIsArchiveModalOpen(false);
        return;
      }

      const filteredCards = selectedCards.filter(card => tempSelectedCardIds.includes(card.id));
      const results = await Promise.all(filteredCards.map(async (card) => {
        const result = await appInvoke<string | Record<string, any>>('analyze_character_memory', {
          sessionId,
          characterCardId: card.id,
        });
        return { cardId: card.id, analysis: parseArchiveAnalysisResponse(result) };
      }));

      const analyses: Record<string, any> = {};
      const relationTypes: Record<string, string> = {};
      const relationModels: Record<string, string> = {};
      const relationBottomLines: Record<string, string> = {};
      const events: Record<string, string> = {};
      let firstTitle = '';

      for (const item of results) {
        analyses[item.cardId] = item.analysis;
        relationTypes[item.cardId] = item.analysis.userRelationType || '';
        relationModels[item.cardId] = item.analysis.userInteractionModel || '';
        relationBottomLines[item.cardId] = item.analysis.userRelationBottomLine || '';
        events[item.cardId] = item.analysis.keyEvents || '';
        if (!firstTitle) {
          firstTitle = item.analysis.sessionTitle || item.analysis.recommendedSessionTitle || '';
        }
      }

      setArchiveAnalyses(analyses);
      setEditedTitle(firstTitle || sessionTitle);
      setEditedRelationTypes(relationTypes);
      setEditedRelationModels(relationModels);
      setEditedRelationBottomLines(relationBottomLines);
      setEditedEventsMap(events);
    } catch (e) {
      message.error(`记忆提取分析失败：${e}`);
      setIsArchiveModalOpen(false);
      setHasStartedAnalysis(false);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleConfirmArchive = async () => {
    try {
      const filteredCards = selectedCards.filter(card => tempSelectedCardIds.includes(card.id));
      await appInvoke('archive_agent_session', {
        sessionId,
        payload: {
          title: editedTitle,
          characterMemories: filteredCards.map(card => ({
            characterCardId: card.id,
            userRelationType: editedRelationTypes[card.id] || '',
            userInteractionModel: editedRelationModels[card.id] || '',
            userRelationBottomLine: editedRelationBottomLines[card.id] || '',
            keyEvents: editedEventsMap[card.id] || '',
          })),
        }
      });
      setIsSessionArchived(true);
      setSessionTitle(editedTitle);
      setIsArchiveModalOpen(false);
      message.success('记忆封存成功！故事已锁定归档。');

      // Reload sessions
      const listRes = await appInvoke<AgentSessionSummary[]>('list_agent_sessions', { prefix: 'story-session-' });
      setSessions(listRes);

      // Reload partner store
      const partnerStoreContent = await appInvoke<string>('load_app_state', { name: 'partner-store' });
      if (partnerStoreContent) {
        const parsed = JSON.parse(partnerStoreContent);
        if (parsed.state) {
          usePartnerStore.setState(parsed.state);
        }
      }
    } catch (e) {
      message.error(`封存记忆归档失败: ${e}`);
    }
  };

  const toggleBlock = (key: string) => {
    setExpandedBlocks({
      ...expandedBlocks,
      [key]: !expandedBlocks[key],
    });
  };

  const renderToolResult = (tool: AgentToolEntry, toolKey: string) => {
    if (tool.name === 'role_play') {
      if (!tool.result.trim()) return null;
      const characterName = getRolePlayCharacterName(tool.arguments);
      return (
        <div key={toolKey} style={{
          width: '100%',
          border: '1px solid rgba(217, 119, 87, 0.15)',
          borderRadius: '12px',
          background: '#fffaf6',
          padding: '12px 14px',
          margin: '8px 0',
        }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#d97757', marginBottom: '6px' }}>
            {characterName}
          </div>
          <div className="agent-markdown" style={{ fontSize: '13.5px', lineHeight: 1.6 }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {tool.result}
            </ReactMarkdown>
          </div>
        </div>
      );
    }

    const isExpanded = !!expandedBlocks[toolKey];
    return (
      <div key={toolKey} style={{
        border: '1px solid #eae6df',
        borderRadius: '8px',
        padding: '8px 12px',
        margin: '8px 0',
        backgroundColor: '#f6f5f0',
      }}>
        <button
          type="button"
          onClick={() => toggleBlock(toolKey)}
          style={{ ...MOBILE_STORY_COLLAPSIBLE_BUTTON_STYLE, color: '#8c8880' }}
        >
          <InfoCircleOutlined />
          <span>系统工具调用：{tool.name} (点击{isExpanded ? '折叠' : '展开'})</span>
        </button>
        {isExpanded && (
          <pre style={{
            fontSize: '11px',
            color: '#555',
            marginTop: '6px',
            whiteSpace: 'pre-wrap',
            margin: '6px 0 0 0',
          }}>
            {tool.result || '执行中...'}
          </pre>
        )}
      </div>
    );
  };

  const selectOptions = sessions.map(s => ({ value: s.id, label: s.title }));
  if (sessionId && !sessions.some(s => s.id === sessionId)) {
    selectOptions.unshift({ value: sessionId, label: sessionTitle || '当前故事' });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#faf9f5', overflow: 'hidden' }}>
      {/* Session selector */}
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
          placeholder="选择我的故事冒险..."
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

      {/* Main Container */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {messages.length === 0 ? (
          /* Initial Configuration Setup */
          <div style={{
            flex: 1,
            padding: '24px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            backgroundColor: '#faf9f5',
          }}>
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#33312e', marginBottom: '12px' }}>第一步：选择参与本次冒险的角色</h3>
              <Select
                mode="multiple"
                placeholder="选择多名参与冒险的角色 NPC..."
                value={selectedCharacterCardIds}
                onChange={setSelectedCharacterCardIds}
                style={{ width: '100%', fontSize: '16px' }}
                options={characterCards.map(cc => ({ value: cc.id, label: cc.name }))}
              />
            </div>

            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#33312e', marginBottom: '12px' }}>第二步：选择故事的世界书背景（可选）</h3>
              <Select
                placeholder="选择世界书设定..."
                value={selectedWorldBookId}
                onChange={setSelectedWorldBookId}
                style={{ width: '100%', fontSize: '16px' }}
                allowClear
                options={worldBooks.map(wb => ({ value: wb.id, label: wb.name }))}
              />
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: '#fff',
              borderRadius: '12px',
              padding: '14px 16px',
              border: '1px solid rgba(217, 119, 87, 0.05)',
            }}>
              <div>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#33312e' }}>开启动态角色加载</span>
                <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: '#8c8880' }}>开启后，允许大模型在剧情需要时调用角色发言。</p>
              </div>
              <Switch
                checked={dynamicRoleLoadingEnabled}
                onChange={setDynamicRoleLoadingEnabled}
                style={{ backgroundColor: dynamicRoleLoadingEnabled ? '#d97757' : undefined }}
              />
            </div>

            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#33312e', marginBottom: '12px' }}>第三步：设定冒险起因 (剧情开端)</h3>
              <Input.TextArea
                value={initialPlot}
                onChange={(e) => setInitialPlot(e.target.value)}
                placeholder="例如：林逸和陆雪莹身处一片被迷雾笼罩的古老密林，远方突然传来悠长沉闷的钟声..."
                autoSize={{ minRows: 4, maxRows: 8 }}
                style={{ borderRadius: '8px', borderColor: 'rgba(217, 119, 87, 0.15)', fontSize: '16px' }}
              />
            </div>

            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={handleStartAdventure}
              style={{
                backgroundColor: '#d97757',
                borderColor: '#d97757',
                borderRadius: '8px',
                height: '52px',
                fontSize: '16px',
                fontWeight: 600,
                marginTop: '12px',
              }}
            >
              开启冒险之旅
            </Button>
          </div>
        ) : (
          /* Active Adventure Flow */
          <>
            {/* Active companions info bar */}
            <div style={MOBILE_STORY_ACTIVE_COMPANIONS_BAR_STYLE}>
              <BookOutlined style={{ color: '#d97757' }} />
              <span>
                参与角色：{characterCards.reduce<string[]>((names, c) => {
                  if (selectedCharacterCardIds.includes(c.id)) {
                    names.push(c.name);
                  }
                  return names;
                }, []).join('，')}
              </span>
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
                      ...MOBILE_STORY_MESSAGE_BUBBLE_BASE_STYLE,
                      backgroundColor: isUser ? '#d97757' : '#fff',
                      color: isUser ? '#fff' : '#33312e',
                      border: isUser ? 'none' : '1px solid rgba(217, 119, 87, 0.05)',
                    }}>
                      {isUser ? (
                        <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                      ) : (
                        /* Parse thinking and tools */
                        (() => {
                          const parts = msg.content.split(/(\[\[TOOL:[^\]]+\]\])/);
                          const getMarkdownPartKey = createStableContentKey(`${msg.id}-md`);
                          const getToolKey = createStableToolKey(`${msg.id}-tool`);
                          return parts.map((part) => {
                            const match = part.match(/^\[\[TOOL:([^\]]+)\]\]$/);
                            if (match) {
                              const toolId = match[1];
                              const tool = msg.tools?.find(t => t.id === toolId);
                              if (tool) {
                                return renderToolResult(tool, getToolKey(tool));
                              }
                              return null;
                            }

                            // Render thinking blocks if embedded thinking text is found
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
                                    <button
                                      type="button"
                                      onClick={() => toggleBlock(`${msg.id}-${thinkingId}`)}
                                      style={{ ...MOBILE_STORY_COLLAPSIBLE_BUTTON_STYLE, color: '#d97757' }}
                                    >
                                      <BulbOutlined />
                                      <span>冒险思考过程 (点击{isExpanded ? '折叠' : '展开'})</span>
                                    </button>
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
                              <ReactMarkdown key={getMarkdownPartKey(part)} remarkPlugins={[remarkGfm]}>
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

            {/* Input & Mode Selector Panel */}
            <div style={{
              padding: '12px 16px',
              backgroundColor: '#fff',
              borderTop: '1px solid rgba(217, 119, 87, 0.05)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              flexShrink: 0,
            }}>
              {/* Input Mode Selector */}
              <div style={{ display: 'flex', justifyContent: 'flex-start', borderBottom: '1px solid rgba(0,0,0,0.02)', paddingBottom: '6px' }}>
                <Radio.Group
                  value={inputMode}
                  onChange={(e) => setInputMode(e.target.value)}
                  size="small"
                  style={{ display: 'flex', gap: '6px' }}
                >
                  <Radio.Button value="speech" style={{ fontSize: '12px', borderRadius: '12px', border: '1px solid rgba(217, 119, 87, 0.2)', background: inputMode === 'speech' ? '#d97757' : '#faf9f5', color: inputMode === 'speech' ? '#fff' : '#8c8880' }}>说话</Radio.Button>
                  <Radio.Button value="behavior" style={{ fontSize: '12px', borderRadius: '12px', border: '1px solid rgba(217, 119, 87, 0.2)', background: inputMode === 'behavior' ? '#d97757' : '#faf9f5', color: inputMode === 'behavior' ? '#fff' : '#8c8880' }}>行为</Radio.Button>
                  <Radio.Button value="plot" style={{ fontSize: '12px', borderRadius: '12px', border: '1px solid rgba(217, 119, 87, 0.2)', background: inputMode === 'plot' ? '#d97757' : '#faf9f5', color: inputMode === 'plot' ? '#fff' : '#8c8880' }}>剧情</Radio.Button>
                </Radio.Group>
              </div>

              {/* Input Box & Buttons */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <Input.TextArea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={isSessionArchived ? "当前故事已归档封存" : "采取行动、剧情或对话推进..."}
                  disabled={isSessionArchived}
                  autoSize={{ minRows: 1, maxRows: 3 }}
                  style={{ borderRadius: '8px', borderColor: 'rgba(217, 119, 87, 0.15)', fontSize: '16px' }}
                  onPressEnter={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendAction();
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
                    onClick={handleSendAction}
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

              {/* Archive triggers */}
              {messages.length > 0 && !isSessionArchived && !isStreaming && (
                <div style={{ display: 'flex', gap: '12px', alignSelf: 'flex-end' }}>
                  <Button
                    type="link"
                    loading={isSavingConversation}
                    disabled={isSavingConversation}
                    icon={<SaveOutlined />}
                    onClick={() => void handleSaveConversation()}
                    style={{ color: '#d97757', padding: 0, fontSize: '13px' }}
                  >
                    保存对话
                  </Button>
                  <Button
                    type="link"
                    icon={<SaveOutlined />}
                    onClick={handleStartArchive}
                    style={{ color: '#d97757', padding: 0, fontSize: '13px' }}
                  >
                    提炼记忆并锁定存档
                  </Button>
                </div>
              )}
              {isSessionArchived && (
                <div style={{ fontSize: '11px', color: '#8c8880', textAlign: 'center', display: 'flex', justifyContent: 'center', gap: '4px', alignItems: 'center' }}>
                  <HistoryOutlined />
                  <span>故事已存档封存，人物记忆已更新</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Memory Archiving Modal */}
      <Modal
        title="冒险记忆提炼归档"
        open={isArchiveModalOpen}
        onCancel={() => !isAnalyzing && setIsArchiveModalOpen(false)}
        footer={isAnalyzing ? null : [
          <Button key="cancel" onClick={() => setIsArchiveModalOpen(false)}>取消</Button>,
          !hasStartedAnalysis ? (
            <Button
              key="analyze"
              type="primary"
              disabled={tempSelectedCardIds.length === 0}
              onClick={startAnalyzingSelectedCards}
              style={{ backgroundColor: '#d97757', borderColor: '#d97757' }}
            >
              开始分析封存
            </Button>
          ) : (
            <Button key="confirm" type="primary" onClick={handleConfirmArchive} style={{ backgroundColor: '#d97757', borderColor: '#d97757' }}>确认封存</Button>
          )
        ]}
        width="90%"
        style={{ top: 20 }}
      >
        {!hasStartedAnalysis ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '8px 0' }}>
            <div style={{ fontSize: '13px', color: '#5c5751', fontWeight: 500 }}>
              请选择本次要同步记忆的角色卡：
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              {selectedCards.map((card) => {
                const isChecked = tempSelectedCardIds.includes(card.id);
                return (
                  <Checkbox
                    key={card.id}
                    checked={isChecked}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setTempSelectedCardIds((prev) =>
                        checked ? [...prev, card.id] : prev.filter((id) => id !== card.id)
                      );
                    }}
                    style={{
                      margin: 0,
                      padding: '8px 12px',
                      border: isChecked ? '1px solid #d97757' : '1px solid #eae6df',
                      borderRadius: '8px',
                      backgroundColor: isChecked ? '#fff7f2' : '#faf9f5',
                      color: isChecked ? '#d97757' : '#5c5751',
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: 500 }}>{card.name}</span>
                  </Checkbox>
                );
              })}
            </div>
          </div>
        ) : isAnalyzing ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 0', gap: '16px' }}>
            <Spin size="large" style={{ color: '#d97757' }} />
            <span style={{ fontSize: '13px', color: '#8c8880' }}>正在深度提取冒险经历，提炼角色记忆与羁绊变更...</span>
          </div>
        ) : archiveAnalyses[selectedTargetCardId] ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '60vh', overflowY: 'auto', paddingRight: '4px' }}>
            <div>
              <div style={{ fontSize: '12px', color: '#8c8880', marginBottom: '4px' }}>当前同步角色</div>
              <Select
                value={selectedTargetCardId}
                onChange={setSelectedTargetCardId}
                style={{ width: '100%' }}
                options={selectedCards.reduce<{ value: string; label: string }[]>((options, card) => {
                  if (tempSelectedCardIds.includes(card.id)) {
                    options.push({ value: card.id, label: card.name });
                  }
                  return options;
                }, [])}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ border: '1px solid rgba(0,0,0,0.04)', padding: '10px', borderRadius: '6px', background: '#fafafa' }}>
                <div style={{ color: '#d97757', fontWeight: 600, fontSize: '12px', marginBottom: '6px' }}>关系变化提炼</div>
                <div style={{ fontSize: '13px', color: '#33312e', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                  {archiveAnalyses[selectedTargetCardId]?.relationChanges || '无修改'}
                </div>
              </div>
              <div style={{ border: '1px solid rgba(0,0,0,0.04)', padding: '10px', borderRadius: '6px', background: '#fafafa' }}>
                <div style={{ color: '#d97757', fontWeight: 600, fontSize: '12px', marginBottom: '6px' }}>里程碑事件提炼</div>
                <div style={{ fontSize: '13px', color: '#33312e', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                  {archiveAnalyses[selectedTargetCardId]?.eventChanges || '无修改'}
                </div>
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#8c8880', marginBottom: '4px' }}>故事存档标题</div>
              <Input
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                style={{ borderRadius: '6px', fontSize: '16px' }}
              />
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#8c8880', marginBottom: '4px' }}>更新后的与用户关系类型</div>
              <Input
                value={editedRelationTypes[selectedTargetCardId] || ''}
                onChange={(e) => setEditedRelationTypes(prev => ({ ...prev, [selectedTargetCardId]: e.target.value }))}
                style={{ borderRadius: '6px', fontSize: '16px' }}
              />
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#8c8880', marginBottom: '4px' }}>更新后的与用户相处模式</div>
              <Input.TextArea
                value={editedRelationModels[selectedTargetCardId] || ''}
                onChange={(e) => setEditedRelationModels(prev => ({ ...prev, [selectedTargetCardId]: e.target.value }))}
                autoSize={{ minRows: 2, maxRows: 4 }}
                style={{ borderRadius: '6px', fontSize: '16px' }}
              />
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#8c8880', marginBottom: '4px' }}>更新后的与用户关系底线</div>
              <Input.TextArea
                value={editedRelationBottomLines[selectedTargetCardId] || ''}
                onChange={(e) => setEditedRelationBottomLines(prev => ({ ...prev, [selectedTargetCardId]: e.target.value }))}
                autoSize={{ minRows: 2, maxRows: 4 }}
                style={{ borderRadius: '6px', fontSize: '16px' }}
              />
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#8c8880', marginBottom: '4px' }}>关键事件记录</div>
              <Input.TextArea
                value={editedEventsMap[selectedTargetCardId] || ''}
                onChange={(e) => setEditedEventsMap(prev => ({ ...prev, [selectedTargetCardId]: e.target.value }))}
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

const MobileStory: React.FC = () => useMobileStoryView();

export default MobileStory;
