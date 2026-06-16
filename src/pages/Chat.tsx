import React, { useCallback, useEffect, useRef } from 'react';
import { Button, Tooltip, Tag, Input, message, Modal, Spin } from 'antd';
import {
  BulbOutlined,
  HistoryOutlined,
  ReloadOutlined,
  MessageOutlined,
  StopOutlined,
  SettingOutlined,
  PlayCircleOutlined,
  InfoCircleOutlined,
  UserOutlined,
  BookOutlined,
  FileProtectOutlined,
  SaveOutlined,
  RedoOutlined,
  EditOutlined
} from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useSettingsStore } from '../stores/useSettingsStore';
import { usePartnerStore } from '../stores/usePartnerStore';
import { usePartnerChatStore } from '../stores/usePartnerChatStore';
import { Message, AgentSessionSummary, AgentSessionRecord, SessionContextCompaction } from '../stores/useAgentStore';
import { PartnerChatSettingsModal } from '../components/PartnerChatSettingsModal';
import { SessionHistoryModal } from '../components/SessionHistoryModal';
import { parseArchiveAnalysisResponse } from '../utils/archiveAnalysis';
import { createStableContentKey } from '../utils/renderKeys';
import { useStateGroup } from '../utils/reducerState';
import { ensureSessionId } from '../utils/sessionIds';
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

interface ChatUiState {
  isSettingsOpen: boolean;
  isHistoryOpen: boolean;
  isArchiveModalOpen: boolean;
  isAnalyzing: boolean;
  isSavingConversation: boolean;
  archiveAnalysis: any;
  editedTitle: string;
  editedRelationType: string;
  editedRelationModel: string;
  editedRelationBottomLine: string;
  editedEvents: string;
  editingMessageId: string | null;
  editingContent: string;
}

const USER_INFO_LABELS: Record<string, string> = {
  name: '姓名',
  age: '年龄',
  gender: '性别',
  race: '种族',
  birthplace: '出生地',
  occupation: '职业',
  socialClass: '社会阶层',
  heightBuild: '身高体型',
  iconicFeatures: '标志性特征',
  clothingStyle: '衣着风格',
  overallVibe: '整体气质',
  externalPersonality: '外在性格',
  internalPersonality: '内在性格',
  coreDesire: '核心欲望',
  fearWeakness: '恐惧与弱点',
  moralValues: '道德观念',
  quirk: '怪癖',
  skills: '技能专长',
  backgroundStory: '背景故事',
  relationships: '人际关系',
  speakingStyle: '说话方式',
  typicalReactions: '典型反应'
};

const CHAT_EMPTY_STATE_STYLE: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  padding: '0 24px',
  maxWidth: '800px',
  margin: '0 auto',
  width: '100%',
};

const CHAT_COMPOSER_ACTIONS_STYLE: React.CSSProperties = {
  position: 'absolute',
  bottom: '12px',
  left: '16px',
  right: '16px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  zIndex: 3,
};

const filterBlankMarkdownFields = (content: string): string => {
  const lines = content.split('\n');

  // 第一轮：移除值为空的列表项行
  const afterListFilter = lines.filter(line => !/^\s*-\s*\*\*[^*]+\*\*：\s*$/.test(line));

  // 第二轮：移除后面没有实质内容的空二级标题区块
  const result: string[] = [];
  let i = 0;
  while (i < afterListFilter.length) {
    const line = afterListFilter[i];
    if (/^##\s/.test(line)) {
      let j = i + 1;
      while (j < afterListFilter.length && afterListFilter[j].trim() === '') {
        j++;
      }
      // 如果后面直接是另一个标题或文件结尾，这个区块是空的，跳过
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

const compileEffectiveSystemPrompt = (
  basePrompt: string,
  worldBookContent: string | null,
  characterCardContent: string | null,
  userInfo: Record<string, any>
): string => {
  let prompt = basePrompt.trim();

  if (worldBookContent && worldBookContent.trim()) {
    prompt += `\n\n## 伴侣对话世界设定\n请严格遵守以下世界背景设定展开对话，不要脱离该设定范围：\n${filterBlankMarkdownFields(worldBookContent.trim())}`;
  }

  if (characterCardContent && characterCardContent.trim()) {
    prompt += `\n\n## 你的角色人设设定（伴侣设定）\n你必须始终扮演此角色，语气、动作、口吻、心防与性格应与本卡高度一致：\n${filterBlankMarkdownFields(characterCardContent.trim())}`;
  }

  const userFieldLines: string[] = [];
  for (const [k, v] of Object.entries(userInfo)) {
    if (USER_INFO_LABELS[k] && typeof v === 'string' && v.trim() !== '') {
      userFieldLines.push(`- **${USER_INFO_LABELS[k]}**：${v}`);
    }
  }
  const userFields = userFieldLines.join('\n');

  if (userFields) {
    prompt += `\n\n## 我（用户）的角色人设设定\n这是与你对话的用户人设背景，请记住并据此采取对应的人物关系态度和说话方式：\n${userFields}`;
  }

  return prompt;
};

const estimateContextUsage = (systemPrompt: string, messages: Message[], draft: string) => {
  let userText = draft;
  let assistantText = '';
  for (const message of messages) {
    if (message.role === 'user') {
      userText += message.content;
    }
    if (message.role === 'agent') {
      assistantText += message.content;
    }
  }
  const stats = {
    system: Math.max(0, Math.ceil(systemPrompt.length * 1.5)),
    user: Math.max(0, Math.ceil(userText.length * 1.5)),
    assistant: Math.max(0, Math.ceil(assistantText.length * 1.5))
  };
  return {
    ...stats,
    messageCount: messages.length,
    total: stats.system + stats.user + stats.assistant,
  };
};

const useChatView = () => {
  const {
    messages, setMessages,
    input, setInput,
    isStreaming, setIsStreaming,
    expandedBlocks, setExpandedBlocks,
    selectedWorldBookId, selectedCharacterCardId,
    setSelectedWorldBookId, setSelectedCharacterCardId,
    userInfo,
    sessions, setSessions,
    sessionId, setSessionId,
    sessionTitle, setSessionTitle,
    activeRun, setActiveRun,
    createNewSession,
    isSessionArchived, setIsSessionArchived,
    contextCompaction, setContextCompaction
  } = usePartnerChatStore();

  const { worldBooks, characterCards, updateItemFields } = usePartnerStore();
  const settings = useSettingsStore();

  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const currentThinkingIdRef = useRef<string | null>(null);

  const activeRunRef = useRef(activeRun);
  const messagesRef = useRef(messages);
  const sessionIdRef = useRef(sessionId);
  const sessionTitleRef = useRef(sessionTitle);
  const isSessionArchivedRef = useRef(isSessionArchived);
  const selectedWorldBookIdRef = useRef(selectedWorldBookId);
  const selectedCharacterCardIdRef = useRef(selectedCharacterCardId);
  const contextCompactionRef = useRef<SessionContextCompaction | null>(contextCompaction);

  const [uiState, , setUiField] = useStateGroup<ChatUiState>({
    isSettingsOpen: false,
    isHistoryOpen: false,
    isArchiveModalOpen: false,
    isAnalyzing: false,
    isSavingConversation: false,
    archiveAnalysis: null,
    editedTitle: '',
    editedRelationType: '',
    editedRelationModel: '',
    editedRelationBottomLine: '',
    editedEvents: '',
    editingMessageId: null,
    editingContent: '',
  });
  const {
    isSettingsOpen,
    isHistoryOpen,
    isArchiveModalOpen,
    isAnalyzing,
    isSavingConversation,
    archiveAnalysis,
    editedTitle,
    editedRelationType,
    editedRelationModel,
    editedRelationBottomLine,
    editedEvents,
    editingMessageId,
    editingContent,
  } = uiState;
  const setIsSettingsOpen = (isSettingsOpen: boolean) => setUiField('isSettingsOpen', isSettingsOpen);
  const setIsHistoryOpen = (isHistoryOpen: boolean) => setUiField('isHistoryOpen', isHistoryOpen);
  const setIsArchiveModalOpen = (isArchiveModalOpen: boolean) => setUiField('isArchiveModalOpen', isArchiveModalOpen);
  const setIsAnalyzing = (isAnalyzing: boolean) => setUiField('isAnalyzing', isAnalyzing);
  const setIsSavingConversation = (isSavingConversation: boolean) => setUiField('isSavingConversation', isSavingConversation);
  const setArchiveAnalysis = (archiveAnalysis: any) => setUiField('archiveAnalysis', archiveAnalysis);
  const setEditedTitle = (editedTitle: string) => setUiField('editedTitle', editedTitle);
  const setEditedRelationType = (editedRelationType: string) => setUiField('editedRelationType', editedRelationType);
  const setEditedRelationModel = (editedRelationModel: string) => setUiField('editedRelationModel', editedRelationModel);
  const setEditedRelationBottomLine = (editedRelationBottomLine: string) => setUiField('editedRelationBottomLine', editedRelationBottomLine);
  const setEditedEvents = (editedEvents: string) => setUiField('editedEvents', editedEvents);
  const setEditingMessageId = (editingMessageId: string | null) => setUiField('editingMessageId', editingMessageId);
  const setEditingContent = (editingContent: string) => setUiField('editingContent', editingContent);

  const refreshSessions = useCallback(async () => {
    try {
      const summaries = await invoke<AgentSessionSummary[]>('list_agent_sessions', { prefix: 'partner-session-' });
      setSessions(summaries);
    } catch (err) {
      console.error('读取历史会话失败:', err);
    }
  }, [setSessions]);

  const ensureCurrentSessionId = useCallback(() => {
    const nextSessionId = ensureSessionId(sessionIdRef.current, 'partner-session');
    if (nextSessionId !== sessionIdRef.current) {
      sessionIdRef.current = nextSessionId;
      setSessionId(nextSessionId);
    }
    return nextSessionId;
  }, [setSessionId]);

  const saveCurrentSession = useCallback(async () => {
    const userMessages = messagesRef.current.filter(m => m.role === 'user');
    if (userMessages.length === 0) return false;
    const currentSessionId = ensureCurrentSessionId();

    try {
      await invoke<AgentSessionSummary>('save_agent_session', {
        session: {
          id: currentSessionId,
          title: sessionTitleRef.current,
          savedAt: Date.now(),
          messages: messagesRef.current,
          selectedReferenceFiles: [],
          selectedOutlineFile: null,
          todos: [],
          contextCompaction: contextCompactionRef.current,
          isArchived: isSessionArchivedRef.current,
          characterCardId: selectedCharacterCardIdRef.current,
          selectedWorldBookId: selectedWorldBookIdRef.current
        }
      });
      await refreshSessions();
      return true;
    } catch (err) {
      console.error('保存会话失败:', err);
      return false;
    }
  }, [ensureCurrentSessionId, refreshSessions]);

  useEffect(() => { activeRunRef.current = activeRun; }, [activeRun]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { sessionTitleRef.current = sessionTitle; }, [sessionTitle]);
  useEffect(() => { isSessionArchivedRef.current = isSessionArchived; }, [isSessionArchived]);
  useEffect(() => { selectedWorldBookIdRef.current = selectedWorldBookId; }, [selectedWorldBookId]);
  useEffect(() => { selectedCharacterCardIdRef.current = selectedCharacterCardId; }, [selectedCharacterCardId]);
  useEffect(() => { contextCompactionRef.current = contextCompaction; }, [contextCompaction]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  // Listen to stream events from tauri backend
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

      if (payload.eventType === 'context_compacted' && payload.contextCompaction) {
        contextCompactionRef.current = payload.contextCompaction;
        setContextCompaction(payload.contextCompaction);
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
      }
    }).then((fn) => {
      unlistenFn = fn;
      if (!isMounted) fn();
    });

    return () => {
      isMounted = false;
      if (unlistenFn) unlistenFn();
    };
  }, [setActiveRun, setContextCompaction, setIsStreaming, setMessages]);

  const scrollToBottomOnce = () => {
    window.requestAnimationFrame(() => {
      if (chatHistoryRef.current) {
        chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
      }
    });
  };

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottomOnce();
    }
  }, [messages.length]);

  const selectedWorldBook = worldBooks.find(wb => wb.id === selectedWorldBookId) || null;
  const selectedCharacterCard = characterCards.find(cc => cc.id === selectedCharacterCardId) || null;

  // Compile final Prompt
  const baseSystemPrompt = settings.partnerChatPrompt || '';
  const effectiveSystemPrompt = compileEffectiveSystemPrompt(
    baseSystemPrompt,
    selectedWorldBook ? selectedWorldBook.content : null,
    selectedCharacterCard ? selectedCharacterCard.content : null,
    userInfo
  );

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: trimmed,
      tools: []
    };
    const agentMessageId = `msg-${Date.now() + 1}`;
    const pendingAgentMessage: Message = {
      id: agentMessageId,
      role: 'agent',
      content: '',
      tools: []
    };

    const nextMessages = [...messages, userMessage, pendingAgentMessage];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setInput('');
    setIsStreaming(true);
    scrollToBottomOnce();

    try {
      // Map Zustand Messages to LLM API message schema
      const modelMessages = nextMessages.slice(0, -1).map(msg => ({
        id: msg.id,
        role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
        content: msg.content
      }));

      const runId = await invoke<string>('start_chat_completion_stream', {
        request: {
          agentId: 'partnerChat',
          modelInterface: settings.modelInterface,
          baseUrl: settings.llmBaseUrl,
          apiKey: settings.llmApiKey,
          model: settings.llmModel,
          temperature: settings.agentConfigs?.partnerChat?.temperature ?? 0.3,
          maxOutputTokens: settings.agentConfigs?.partnerChat?.maxOutputTokens ?? 32000,
          maxContextTokens: settings.agentConfigs?.partnerChat?.maxContextTokens ?? 200000,
          compactionTurnThreshold: settings.agentConfigs?.partnerChat?.compactionTurnThreshold ?? 20,
          frequencyPenalty: settings.agentConfigs?.partnerChat?.frequencyPenalty ?? 0.3,
          presencePenalty: settings.agentConfigs?.partnerChat?.presencePenalty ?? 0.2,
          topP: settings.agentConfigs?.partnerChat?.topP ?? 0.9,
          thinkingDepth: settings.agentConfigs?.partnerChat?.thinkingDepth ?? 'off',
          systemPrompt: effectiveSystemPrompt,
          workspacePath: null,
          messages: modelMessages,
          contextCompaction: contextCompactionRef.current,
          selectedReferenceFiles: [],
          allowedTools: [] // Companion has no tools!
        }
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

  const handleStartEdit = (msg: Message) => {
    setEditingMessageId(msg.id);
    setEditingContent(msg.content);
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditingContent('');
  };

  const handleSaveEdit = async (msg: Message) => {
    if (!editingContent.trim()) return;

    if (msg.role === 'agent') {
      const nextMessages = messages.map(m => m.id === msg.id ? { ...m, content: editingContent } : m);
      setMessages(nextMessages);
      messagesRef.current = nextMessages;
      setEditingMessageId(null);
      setEditingContent('');
    } else {
      const userIdx = messages.findIndex(m => m.id === msg.id);
      if (userIdx === -1) return;

      const baseMessages = messages.slice(0, userIdx + 1);
      baseMessages[userIdx] = {
        ...baseMessages[userIdx],
        content: editingContent
      };

      const agentMessageId = `msg-${Date.now()}`;
      const pendingAgentMessage: Message = {
        id: agentMessageId,
        role: 'agent',
        content: '',
        tools: []
      };

      const nextMessages = [...baseMessages, pendingAgentMessage];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      setEditingMessageId(null);
      setEditingContent('');
      setIsStreaming(true);
      scrollToBottomOnce();

      try {
        const modelMessages = baseMessages.map(m => ({
          id: m.id,
          role: m.role === 'user' ? 'user' as const : 'assistant' as const,
          content: m.content
        }));

        const runId = await invoke<string>('start_chat_completion_stream', {
          request: {
            agentId: 'partnerChat',
            modelInterface: settings.modelInterface,
            baseUrl: settings.llmBaseUrl,
            apiKey: settings.llmApiKey,
            model: settings.llmModel,
            temperature: settings.agentConfigs?.partnerChat?.temperature ?? 0.3,
            maxOutputTokens: settings.agentConfigs?.partnerChat?.maxOutputTokens ?? 32000,
            maxContextTokens: settings.agentConfigs?.partnerChat?.maxContextTokens ?? 200000,
            compactionTurnThreshold: settings.agentConfigs?.partnerChat?.compactionTurnThreshold ?? 20,
            frequencyPenalty: settings.agentConfigs?.partnerChat?.frequencyPenalty ?? 0.3,
            presencePenalty: settings.agentConfigs?.partnerChat?.presencePenalty ?? 0.2,
            topP: settings.agentConfigs?.partnerChat?.topP ?? 0.9,
            thinkingDepth: settings.agentConfigs?.partnerChat?.thinkingDepth ?? 'off',
            systemPrompt: effectiveSystemPrompt,
            workspacePath: null,
            messages: modelMessages,
            contextCompaction: contextCompactionRef.current,
            selectedReferenceFiles: [],
            allowedTools: []
          }
        });

        activeRunRef.current = { runId, messageId: agentMessageId };
        setActiveRun({ runId, messageId: agentMessageId });
      } catch (err) {
        activeRunRef.current = { runId: null, messageId: null };
        setActiveRun({ runId: null, messageId: null });
        setIsStreaming(false);
        setMessages((prev) => prev.map((m) => (
          m.id === agentMessageId
            ? { ...m, content: `请求模型失败：${String(err)}` }
            : m
        )));
      }
    }
  };

  const handleRegenerateAssistantMessage = async () => {
    if (isStreaming) return;

    const lastAgentIndex = [...messages].reverse().findIndex(m => m.role === 'agent');
    const realLastAgentIndex = lastAgentIndex !== -1 ? messages.length - 1 - lastAgentIndex : -1;
    if (realLastAgentIndex === -1) return;

    const baseMessages = messages.slice(0, realLastAgentIndex);
    const agentMessageId = messages[realLastAgentIndex].id;
    const pendingAgentMessage: Message = {
      id: agentMessageId,
      role: 'agent',
      content: '',
      tools: []
    };

    const nextMessages = [...baseMessages, pendingAgentMessage];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setIsStreaming(true);
    scrollToBottomOnce();

    try {
      const modelMessages = baseMessages.map(msg => ({
        id: msg.id,
        role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
        content: msg.content
      }));

      const runId = await invoke<string>('start_chat_completion_stream', {
        request: {
          agentId: 'partnerChat',
          modelInterface: settings.modelInterface,
          baseUrl: settings.llmBaseUrl,
          apiKey: settings.llmApiKey,
          model: settings.llmModel,
          temperature: settings.agentConfigs?.partnerChat?.temperature ?? 0.3,
          maxOutputTokens: settings.agentConfigs?.partnerChat?.maxOutputTokens ?? 32000,
          maxContextTokens: settings.agentConfigs?.partnerChat?.maxContextTokens ?? 200000,
          compactionTurnThreshold: settings.agentConfigs?.partnerChat?.compactionTurnThreshold ?? 20,
          frequencyPenalty: settings.agentConfigs?.partnerChat?.frequencyPenalty ?? 0.3,
          presencePenalty: settings.agentConfigs?.partnerChat?.presencePenalty ?? 0.2,
          topP: settings.agentConfigs?.partnerChat?.topP ?? 0.9,
          thinkingDepth: settings.agentConfigs?.partnerChat?.thinkingDepth ?? 'off',
          systemPrompt: effectiveSystemPrompt,
          workspacePath: null,
          messages: modelMessages,
          contextCompaction: contextCompactionRef.current,
          selectedReferenceFiles: [],
          allowedTools: []
        }
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

  const toggleBlock = (id: string) => {
    setExpandedBlocks((prev) => ({ ...prev, [id]: !prev[id] }));
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
      const generatedTitle = await invoke<string>('summarize_text', {
        request: {
          modelInterface: settings.modelInterface,
          baseUrl: settings.llmBaseUrl,
          apiKey: settings.llmApiKey,
          model: settings.llmModel,
          temperature: settings.agentConfigs?.partnerChat?.temperature ?? 0.3,
          maxOutputTokens: 64,
          text: chatHistoryText,
        },
      });
      sessionTitleRef.current = generatedTitle;
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

  const openSession = async (id: string) => {
    try {
      const session = await invoke<AgentSessionRecord>('load_agent_session', { id });
      activeRunRef.current = { runId: null, messageId: null };
      setActiveRun({ runId: null, messageId: null });
      setSessionId(session.id);
      setSessionTitle(session.title);
      setMessages(session.messages);
      setSelectedWorldBookId(session.selectedWorldBookId ?? null);
      setSelectedCharacterCardId(session.characterCardId ?? null);
      contextCompactionRef.current = session.contextCompaction ?? null;
      setContextCompaction(session.contextCompaction ?? null);
      setIsStreaming(false);
      setInput('');
      setIsSessionArchived(session.isArchived ?? false);
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

  const handleArchiveMemory = async () => {
    if (!selectedCharacterCard || messages.length === 0 || isStreaming || isSessionArchived) return;

    setIsAnalyzing(true);
    setIsArchiveModalOpen(true);
    setArchiveAnalysis(null);

    const chatHistoryLines: string[] = [];
    for (const m of messages) {
      if (m.role !== 'user' && m.role !== 'agent') {
        continue;
      }
        const sender = m.role === 'user' ? '我' : (selectedCharacterCard.name);
        const cleanContent = m.content.replace(/\[\[THINKING:[^\]]+\]\]/g, '').trim();
      if (cleanContent !== '') {
        chatHistoryLines.push(`${sender}: ${cleanContent}`);
      }
    }
    const chatHistoryText = chatHistoryLines.join('\n\n');

    try {
      const archiveConfig = settings.agentConfigs?.chatArchive || {};
      const resultStr = await invoke<string | Record<string, any>>('analyze_character_memory', {
        request: {
          modelInterface: settings.modelInterface,
          baseUrl: settings.llmBaseUrl,
          apiKey: settings.llmApiKey,
          model: settings.llmModel,
          temperature: archiveConfig.temperature ?? 0.3,
          maxOutputTokens: archiveConfig.maxOutputTokens ?? 32000,
          thinkingDepth: archiveConfig.thinkingDepth ?? 'off',
          systemPrompt: settings.chatArchivePrompt || undefined,
          chatHistory: chatHistoryText,
          targetCharacterName: selectedCharacterCard.name,
          targetCharacterContent: selectedCharacterCard.content,
          currentUserRelationType: selectedCharacterCard.fields?.userRelationType || '',
          currentUserInteractionModel: selectedCharacterCard.fields?.userInteractionModel || '',
          currentUserRelationBottomLine: selectedCharacterCard.fields?.userRelationBottomLine || '',
          currentEvents: selectedCharacterCard.fields?.keyEvents || '暂无共同经历的关键事件。'
        }
      });

      const analysis = parseArchiveAnalysisResponse(resultStr);
      setArchiveAnalysis(analysis);
      setEditedTitle(analysis.sessionTitle || sessionTitle || '未命名会话');
      setEditedRelationType(analysis.userRelationType || '');
      setEditedRelationModel(analysis.userInteractionModel || '');
      setEditedRelationBottomLine(analysis.userRelationBottomLine || '');
      setEditedEvents(analysis.keyEvents || '');
    } catch (err) {
      console.error('分析记忆失败:', err);
      message.error(`记忆分析失败：${String(err)}`);
      setIsArchiveModalOpen(false);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleConfirmArchive = async () => {
    if (!selectedCharacterCard) return;

    try {
      // 1. Update character card fields in usePartnerStore
      updateItemFields(selectedCharacterCard.id, 'character_card', {
        userRelationType: editedRelationType,
        userInteractionModel: editedRelationModel,
        userRelationBottomLine: editedRelationBottomLine,
        keyEvents: editedEvents
      });

      // 2. Set current session archive status to true
      setIsSessionArchived(true);

      // 3. Set the new session title
      const finalTitle = editedTitle.trim() || '未命名会话';
      setSessionTitle(finalTitle);
      sessionTitleRef.current = finalTitle;
      isSessionArchivedRef.current = true;

      // 4. Save the archived session
      const saved = await saveCurrentSession();
      if (!saved) {
        throw new Error('保存归档会话失败');
      }

      message.success('伴侣记忆封存成功！当前会话已锁定归档。');
      setIsArchiveModalOpen(false);
    } catch (err) {
      console.error('封存记忆失败:', err);
      message.error(`封存记忆失败：${String(err)}`);
    }
  };

  // Context ring stats
  const effectiveContextMessages = getEffectiveMessagesForContextStats(messages, contextCompaction);
  const contextStats = estimateContextUsage(effectiveSystemPrompt, effectiveContextMessages, input);
  const maxContext = settings.agentConfigs?.partnerChat?.maxContextTokens ?? 200000;
  const contextPercent = maxContext > 0
    ? Math.min(100, Math.round((contextStats.total / maxContext) * 100))
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
        <span className="agent-context-popover__label">世界书：</span>
        <span className="agent-context-popover__value">{selectedWorldBook?.name || '未绑定'}</span>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">角色卡：</span>
        <span className="agent-context-popover__value">{selectedCharacterCard?.name || '未绑定'}</span>
      </div>
      <div className="agent-context-popover__divider" />
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">消息数：</span>
        <span className="agent-context-popover__value">{contextStats.messageCount} 条</span>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">总 token：</span>
        <span className="agent-context-popover__value agent-context-popover__value--highlight">{contextStats.total} / {maxContext}</span>
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
        <span className="agent-context-popover__value">0</span>
      </div>
    </div>
  );

  const hasMessages = messages.length > 0;

  return (
    <div className="agent-chat" style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#faf9f5' }}>

      {/* Settings Modal */}
      <PartnerChatSettingsModal
        open={isSettingsOpen}
        onCancel={() => setIsSettingsOpen(false)}
      />

      {/* Archive Memory Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#33312e', fontSize: '18px', fontWeight: 600 }}>
            <FileProtectOutlined style={{ color: '#d97757' }} />
            <span>记忆封存与设定同步</span>
          </div>
        }
        open={isArchiveModalOpen}
        onCancel={() => !isAnalyzing && setIsArchiveModalOpen(false)}
        onOk={handleConfirmArchive}
        okText="确认同步并封存"
        cancelText="取消"
        confirmLoading={isAnalyzing}
        width={720}
        okButtonProps={{ disabled: isAnalyzing }}
        styles={{
          body: { padding: '16px 24px' }
        }}
      >
        {isAnalyzing ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: '16px' }}>
            <Spin size="large" />
            <div style={{ color: '#8c8882', fontSize: '14px' }}>
              正在召回对话历史，深度剖析并提炼伴侣长期记忆...
            </div>
          </div>
        ) : archiveAnalysis ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ padding: '12px 16px', background: '#faf6f0', borderRadius: '8px', border: '1px solid #f2e8dc', color: '#8c8882', fontSize: '13px' }}>
              <strong>提示：</strong>大模型已深入剖析本场对话，为您生成了伴侣人设立场的变化修改点。请在同步前仔细确认，您也可以直接在下方编辑框中进行微调润色。
            </div>

            {/* Changes Analysis */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div style={{ border: '1px solid rgba(0,0,0,0.04)', padding: '12px', borderRadius: '6px', background: '#fafafa' }}>
                <div style={{ color: '#d97757', fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>关系变化分析</div>
                <div style={{ fontSize: '13px', color: '#33312e', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{archiveAnalysis.relationChanges}</div>
              </div>
              <div style={{ border: '1px solid rgba(0,0,0,0.04)', padding: '12px', borderRadius: '6px', background: '#fafafa' }}>
                <div style={{ color: '#d97757', fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>共同事件分析</div>
                <div style={{ fontSize: '13px', color: '#33312e', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{archiveAnalysis.eventChanges}</div>
              </div>
            </div>

            <div style={{ height: '1px', background: 'rgba(0,0,0,0.03)' }} />

            {/* Editable fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#33312e', marginBottom: '6px' }}>本场聊天会话标题</div>
                <Input
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  placeholder="请输入建议标题"
                  style={{ borderRadius: '6px', borderColor: '#eae6df' }}
                />
              </div>

              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#33312e', marginBottom: '6px' }}>更新后的与用户关系类型</div>
                <Input
                  value={editedRelationType}
                  onChange={(e) => setEditedRelationType(e.target.value)}
                  placeholder="与用户关系类型..."
                  style={{ borderRadius: '6px', borderColor: '#eae6df' }}
                />
              </div>

              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#33312e', marginBottom: '6px' }}>更新后的与用户相处模式</div>
                <Input.TextArea
                  value={editedRelationModel}
                  onChange={(e) => setEditedRelationModel(e.target.value)}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  placeholder="与用户相处模式..."
                  style={{ borderRadius: '6px', borderColor: '#eae6df' }}
                />
              </div>

              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#33312e', marginBottom: '6px' }}>更新后的与用户关系底线</div>
                <Input.TextArea
                  value={editedRelationBottomLine}
                  onChange={(e) => setEditedRelationBottomLine(e.target.value)}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  placeholder="与用户关系底线..."
                  style={{ borderRadius: '6px', borderColor: '#eae6df' }}
                />
              </div>

              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#33312e', marginBottom: '6px' }}>更新后的关键事件记录</div>
                <Input.TextArea
                  value={editedEvents}
                  onChange={(e) => setEditedEvents(e.target.value)}
                  autoSize={{ minRows: 4, maxRows: 8 }}
                  placeholder="更新后的关键事件记录..."
                  style={{ borderRadius: '6px', borderColor: '#eae6df' }}
                />
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Header */}
      <div className="agent-chat__header" style={{ borderBottom: '1px solid #eae6df', padding: '16px 24px' }}>
        <div className="agent-chat__title">
          <MessageOutlined style={{ color: '#d97757', fontSize: 18 }} />
          <h3 style={{ margin: 0, fontWeight: 600, color: '#33312e' }}>
            伴侣聊天室
            {selectedCharacterCard && (
              <span style={{ fontSize: 13, color: '#8c8882', fontWeight: 400, marginLeft: 8 }}>
                (已绑定: {selectedCharacterCard.name})
              </span>
            )}
          </h3>
        </div>

        <div className="agent-chat__header-actions">
          {selectedCharacterCard && (
            <>
              <Tooltip title="保存当前对话">
                <Button
                  type="text"
                  loading={isSavingConversation}
                  disabled={isStreaming || isSessionArchived || messages.length === 0 || isSavingConversation}
                  icon={<SaveOutlined />}
                  onClick={() => void handleSaveConversation()}
                  style={{
                    color: (isSessionArchived || messages.length === 0) ? '#8c8882' : '#d97757',
                    fontWeight: 500,
                    fontSize: 13,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  保存对话
                </Button>
              </Tooltip>
              <Tooltip title={isSessionArchived ? "当前会话的记忆已封存到角色卡" : "封存本场对话记忆到角色卡并归档"}>
                <Button
                  type="text"
                  disabled={isStreaming || isSessionArchived || messages.length === 0}
                  icon={<FileProtectOutlined />}
                  onClick={handleArchiveMemory}
                  style={{
                    color: (isSessionArchived || messages.length === 0) ? '#8c8882' : '#d97757',
                    fontWeight: 500,
                    fontSize: 13,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  封存记忆
                </Button>
              </Tooltip>
            </>
          )}

          <Tooltip title="清除当前上下文">
            <Button type="text" icon={<ReloadOutlined />} onClick={createNewSession} />
          </Tooltip>

          <Tooltip title="历史记录">
            <Button
              aria-label="历史记录"
              type="text"
              icon={<HistoryOutlined />}
              onClick={() => {
                void refreshSessions();
                setIsHistoryOpen(true);
              }}
            />
          </Tooltip>
        </div>
      </div>

      <SessionHistoryModal
        open={isHistoryOpen}
        title="历史聊天"
        emptyText="暂无历史聊天"
        sessions={sessions}
        worldBooks={worldBooks}
        characterCards={characterCards}
        onClose={() => setIsHistoryOpen(false)}
        onOpenSession={openSession}
        onDeleteSession={handleDeleteSession}
      />

      {/* Main chat layout */}
      {hasMessages ? (
        <div ref={chatHistoryRef} className="agent-chat__history" style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          <div className="agent-message-row agent-message-row--system">
            <div className="agent-message-bubble agent-message-bubble--system">
              <FoldBlock
                icon={<InfoCircleOutlined />}
                variant="thinking"
                title="系统提示词（已融合设定）"
                preview={effectiveSystemPrompt.slice(0, 80) + (effectiveSystemPrompt.length > 80 ? '...' : '')}
                detail={effectiveSystemPrompt}
                expanded={Boolean(expandedBlocks['system-prompt'])}
                onToggle={() => toggleBlock('system-prompt')}
              />
            </div>
          </div>

          {messages.map((msg, index) => {
            const lastUserIndex = [...messages].reverse().findIndex(m => m.role === 'user');
            const realLastUserIndex = lastUserIndex !== -1 ? messages.length - 1 - lastUserIndex : -1;

            const lastAgentIndex = [...messages].reverse().findIndex(m => m.role === 'agent');
            const realLastAgentIndex = lastAgentIndex !== -1 ? messages.length - 1 - lastAgentIndex : -1;

            const isLastUser = index === realLastUserIndex;
            const isLastAgent = index === realLastAgentIndex;

            return (
              <div className={`agent-message-row agent-message-row--${msg.role}`} key={msg.id}>
                <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '88%', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div className={`agent-message-bubble agent-message-bubble--${msg.role}`} style={{ width: '100%', maxWidth: '100%' }}>
                    {editingMessageId === msg.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '240px' }}>
                        <Input.TextArea
                          value={editingContent}
                          onChange={(e) => setEditingContent(e.target.value)}
                          autoSize={{ minRows: 2, maxRows: 6 }}
                          style={{
                            borderRadius: '6px',
                            borderColor: msg.role === 'user' ? 'rgba(255,255,255,0.2)' : '#eae6df',
                            background: msg.role === 'user' ? 'rgba(0,0,0,0.1)' : '#ffffff',
                            color: msg.role === 'user' ? '#ffffff' : '#33312e'
                          }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                          <Button
                            size="small"
                            onClick={handleCancelEdit}
                            style={{
                              borderRadius: '4px',
                              borderColor: msg.role === 'user' ? 'rgba(255,255,255,0.3)' : undefined,
                              background: msg.role === 'user' ? 'transparent' : undefined,
                              color: msg.role === 'user' ? '#ffffff' : undefined
                            }}
                          >
                            取消
                          </Button>
                          <Button
                            type="primary"
                            size="small"
                            onClick={() => handleSaveEdit(msg)}
                            style={{
                              borderRadius: '4px',
                              backgroundColor: msg.role === 'user' ? '#ffffff' : '#d97757',
                              borderColor: msg.role === 'user' ? '#ffffff' : '#d97757',
                              color: msg.role === 'user' ? '#d97757' : '#ffffff',
                              fontWeight: 500
                            }}
                          >
                            保存
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
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
                          const parts = msg.content ? msg.content.split(/(\[\[(?:THINKING):[^\]]+\]\])/) : [''];
                          const getMarkdownPartKey = createStableContentKey(`${msg.id}-md`);

                          return parts.map((part) => {
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
                        })()}
                      </>
                    )}
                  </div>

                  {!isSessionArchived && editingMessageId !== msg.id && (
                    <>
                      {isLastUser && msg.role === 'user' && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px', paddingRight: '4px' }}>
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            disabled={isStreaming}
                            onClick={() => handleStartEdit(msg)}
                            style={{ color: '#d97757', fontSize: '12px', padding: '0 4px', height: 'auto', display: 'flex', alignItems: 'center' }}
                          >
                            编辑
                          </Button>
                        </div>
                      )}
                      {isLastAgent && msg.role === 'agent' && (
                        <div style={{ display: 'flex', gap: '12px', marginTop: '4px', paddingLeft: '4px' }}>
                          <Button
                            type="text"
                            size="small"
                            icon={<RedoOutlined />}
                            disabled={isStreaming}
                            onClick={handleRegenerateAssistantMessage}
                            style={{ color: '#d97757', fontSize: '12px', padding: '0 4px', height: 'auto', display: 'flex', alignItems: 'center' }}
                          >
                            重新生成
                          </Button>
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            disabled={isStreaming}
                            onClick={() => handleStartEdit(msg)}
                            style={{ color: '#d97757', fontSize: '12px', padding: '0 4px', height: 'auto', display: 'flex', alignItems: 'center' }}
                          >
                            编辑
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Empty/Home State - Center Input Box */
        <div style={CHAT_EMPTY_STATE_STYLE}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <MessageOutlined style={{ fontSize: '56px', color: '#d97757', marginBottom: '16px', opacity: 0.9 }} />
            <h2 style={{ fontSize: '26px', fontWeight: 600, color: '#33312e', margin: '0 0 8px 0', letterSpacing: '-0.5px' }}>
              伴侣聊天室
            </h2>
            <p style={{ color: '#8c8882', fontSize: '15px', margin: 0 }}>
              基于世界书和角色卡设定与您的理想角色开启沉浸式对话
            </p>
          </div>

          {/* Quick Bind Cards */}
          <div style={{ display: 'flex', gap: '16px', marginBottom: '32px', width: '100%', maxWidth: '640px', justifyContent: 'center' }}>
            <Tag icon={<BookOutlined />} color={selectedWorldBook ? "orange" : "default"} style={{ padding: '4px 12px', fontSize: '13px', borderRadius: '4px', border: '1px solid #eae6df' }}>
              世界书: {selectedWorldBook ? selectedWorldBook.name : '未绑定'}
            </Tag>
            <Tag icon={<UserOutlined />} color={selectedCharacterCard ? "orange" : "default"} style={{ padding: '4px 12px', fontSize: '13px', borderRadius: '4px', border: '1px solid #eae6df' }}>
              角色卡: {selectedCharacterCard ? selectedCharacterCard.name : '未绑定'}
            </Tag>
          </div>
        </div>
      )}

      {/* Composer Input Area */}
      <div className="agent-composer" style={{
        padding: hasMessages ? '16px 24px 24px 24px' : '0 24px 100px 24px',
        width: '100%',
        maxWidth: hasMessages ? '100%' : '688px',
        margin: '0 auto',
        boxSizing: 'border-box'
      }}>
        <div id="agent-composer-box" className="agent-composer__box" style={{
          boxShadow: hasMessages ? '0 2px 12px rgba(0, 0, 0, 0.04)' : '0 10px 30px rgba(217, 119, 87, 0.06)',
          border: '1px solid #eae6df',
          borderRadius: '12px',
          background: '#ffffff',
          position: 'relative'
        }}>
          <Input.TextArea
            className="agent-composer__textarea"
            autoSize={{ minRows: hasMessages ? 1 : 2, maxRows: 8 }}
            disabled={isSessionArchived}
            onChange={(e) => setInput(e.target.value)}
            style={{ zIndex: 2, position: 'relative', background: 'transparent', boxShadow: 'none', border: 'none', padding: '16px 16px 40px 16px', fontSize: '15px' }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void handleSend();
              }
            }}
            placeholder={
              isSessionArchived
                ? "当前会话的记忆已封存，无法继续发送消息"
                : selectedCharacterCard
                  ? `与 ${selectedCharacterCard.name} 对话，按 Cmd/Ctrl + Enter 发送...`
                  : "请先点击左下角设置选择角色卡，然后开启对话..."
            }
            value={input}
          />

          <div className="agent-composer__actions" style={CHAT_COMPOSER_ACTIONS_STYLE}>
            <Button
              aria-label="伴侣设置"
              icon={<SettingOutlined />}
              onClick={() => setIsSettingsOpen(true)}
              shape="circle"
              type={selectedCharacterCard ? 'primary' : 'default'}
              style={{
                backgroundColor: selectedCharacterCard ? '#d97757' : undefined,
                borderColor: selectedCharacterCard ? '#d97757' : '#eae6df',
                color: selectedCharacterCard ? '#ffffff' : '#5c5751'
              }}
              title="伴侣设置"
            />

            <div className="agent-send-cluster" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Tooltip color="#fff" placement="topRight" title={contextTooltip} overlayInnerStyle={{ width: 'max-content', maxWidth: 320, padding: '8px 12px', border: '1px solid #eae6df' }}>
                <button
                  aria-label="查看上下文详情"
                  className="agent-context-ring"
                  style={{ '--context-fill': `${contextPercent}%` } as React.CSSProperties}
                  type="button"
                >
                  <span>{contextPercent}%</span>
                </button>
              </Tooltip>

              <Tooltip title={isStreaming ? '停止' : isSessionArchived ? '当前会话已封存' : '发送'}>
                <Button
                  className="de-ai-agent-run-button"
                  disabled={isSessionArchived || (!isStreaming && !input.trim())}
                  icon={isStreaming ? <StopOutlined /> : <PlayCircleOutlined />}
                  onClick={isStreaming ? handleStop : handleSend}
                  shape="circle"
                  type={isStreaming ? "default" : "primary"}
                  danger={isStreaming}
                  style={isStreaming ? undefined : {
                    backgroundColor: '#d97757',
                    borderColor: '#d97757',
                    color: '#ffffff'
                  }}
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

const Chat: React.FC = () => useChatView();

export default Chat;
