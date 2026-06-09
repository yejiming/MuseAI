import React, { useEffect, useRef, useState } from 'react';
import { Button, Tooltip, Dropdown, Tag, Input, message, Modal, Spin, Select, Radio, Checkbox } from 'antd';
import {
  HistoryOutlined,
  ReloadOutlined,
  CompassOutlined,
  StopOutlined,
  PlayCircleOutlined,
  DeleteOutlined,
  UserOutlined,
  FileProtectOutlined,
  CommentOutlined,
  ExperimentOutlined,
  BranchesOutlined
} from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { listen } from '@tauri-apps/api/event';


import { useSettingsStore } from '../stores/useSettingsStore';
import { usePartnerStore } from '../stores/usePartnerStore';
import { useStoryStore } from '../stores/useStoryStore';
import { usePartnerChatStore } from '../stores/usePartnerChatStore';
import { useBookTravelStore } from '../stores/useBookTravelStore';
import { Message, AgentSessionSummary, AgentSessionRecord, SessionContextCompaction, AgentToolEntry } from '../stores/useAgentStore';
import {
  buildStoryModelMessages,
  compileStorySystemPrompt,
  getStoryAllowedTools,
} from './storyAgent';
import { parseArchiveAnalysisResponse } from '../utils/archiveAnalysis';

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

const estimateContextUsage = (systemPrompt: string, messages: Message[], draft: string) => {
  const stats = {
    system: Math.max(0, Math.ceil(systemPrompt.length * 1.5)),
    user: Math.max(0, Math.ceil(([draft, ...messages.filter(m => m.role === 'user').map(m => m.content)].join('')).length * 1.5)),
    assistant: Math.max(0, Math.ceil((messages.filter(m => m.role === 'agent').map(m => m.content).join('')).length * 1.5))
  };
  return {
    ...stats,
    total: stats.system + stats.user + stats.assistant,
  };
};


const cleanAndParseJSON = (rawStr: string): any => {
  let cleaned = rawStr.trim();
  if (cleaned.startsWith('`')) {
    const lines = cleaned.split('\n');
    if (lines[0].startsWith('`')) lines.shift();
    if (lines[lines.length - 1]?.trim() === '`') lines.pop();
    cleaned = lines.join('\n').trim();
  }
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  let startIdx = -1;
  let isObject = true;
  if (firstBrace !== -1 && firstBracket !== -1) {
    if (firstBrace < firstBracket) {
      startIdx = firstBrace;
      isObject = true;
    } else {
      startIdx = firstBracket;
      isObject = false;
    }
  } else if (firstBrace !== -1) {
    startIdx = firstBrace;
    isObject = true;
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
    isObject = false;
  }
  if (startIdx === -1) {
    throw new Error('No JSON object or array found in response');
  }
  let endIdx = cleaned.length;
  if (isObject) {
    let braceCount = 0;
    for (let i = startIdx; i < cleaned.length; i++) {
      if (cleaned[i] === '{') braceCount++;
      if (cleaned[i] === '}') braceCount--;
      if (braceCount === 0) {
        endIdx = i + 1;
        break;
      }
    }
  } else {
    let bracketCount = 0;
    for (let i = startIdx; i < cleaned.length; i++) {
      if (cleaned[i] === '[') bracketCount++;
      if (cleaned[i] === ']') bracketCount--;
      if (bracketCount === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }
  const jsonStr = cleaned.slice(startIdx, endIdx);
  return JSON.parse(jsonStr);
};

const Story: React.FC = () => {
  const {
    messages, setMessages,
    input, setInput,
    inputMode, setInputMode,
    isStreaming, setIsStreaming,
    selectedWorldBookId, setSelectedWorldBookId,
    selectedCharacterCardIds, setSelectedCharacterCardIds,
    sessions, setSessions,
    sessionId, setSessionId,
    sessionTitle, setSessionTitle,
    activeRun, setActiveRun,
    isSessionArchived, setIsSessionArchived,
    contextCompaction, setContextCompaction,
    dynamicRoleLoadingEnabled, setDynamicRoleLoadingEnabled,
    createNewSession
  } = useStoryStore();

  const bookTravelStore = useBookTravelStore();
  const navigate = useNavigate();

  // Book-travel stream states
  const [, setIsTransitioningScene] = useState(false);
  const [startProgressPhase, setStartProgressPhase] = useState<'planner' | 'writer' | 'done' | 'error' | 'cancelled'>('done');
  const [plannerOutput, setPlannerOutput] = useState('');
  const [writerOutput, setWriterOutput] = useState('');
  const [startProgressError, setStartProgressError] = useState('');
  const [startElapsedMs, setStartElapsedMs] = useState(0);
  const startRunIdRef = useRef<string | null>(null);
  const startResolverRef = useRef<{ resolve: (content: string) => void; reject: (error: string) => void } | null>(null);
  const startCancelledRef = useRef(false);

  const formatElapsed = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const buildBookTravelRequest = (
    role: string,
    systemPrompt: string,
    config: {
      temperature?: number;
      maxOutputTokens?: number;
      maxContextTokens?: number;
      thinkingDepth?: string;
    },
    materials: {
      outline: { id: string; title: string; content?: string };
      worldBook: { id: string; title: string; content?: string };
      characterCards: Array<{ id: string; title: string; content?: string }>;
    },
    state: unknown,
    previousValidState: unknown = {},
  ) => ({
    modelInterface: settings.modelInterface,
    baseUrl: settings.llmBaseUrl,
    apiKey: settings.llmApiKey,
    model: settings.llmModel,
    role,
    materials,
    state,
    previousValidState,
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
    maxContextTokens: config.maxContextTokens,
    thinkingDepth: 'off',
    systemPrompt,
  });

  const runBookTravelStreamTask = async (commandName: string, request: any, extraArgs?: Record<string, unknown>) => {
    return new Promise<string>((resolve, reject) => {
      if (startCancelledRef.current) {
        reject('用户中断');
        return;
      }
      startResolverRef.current = { resolve, reject };
      invoke<{ runId: string }>(commandName, { request, ...extraArgs })
        .then((result) => {
          startRunIdRef.current = result.runId;
        })
        .catch((err) => {
          reject(String(err));
        });
    });
  };

  const handleCancelStart = async () => {
    startCancelledRef.current = true;
    startResolverRef.current?.reject('用户中断');
    if (startRunIdRef.current) {
      try {
        await invoke('stop_book_travel_stream', { runId: startRunIdRef.current });
      } catch (e) {
        console.error('停止穿书流失败:', e);
      }
    }
    setStartProgressPhase('cancelled');
  };


  const { worldBooks, characterCards, updateItemFields } = usePartnerStore();
  const { userInfo: partnerChatUserInfo } = usePartnerChatStore();
  const settings = useSettingsStore();

  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const currentThinkingIdRef = useRef<string | null>(null);

  const activeRunRef = useRef(activeRun);
  const messagesRef = useRef(messages);
  const sessionIdRef = useRef(sessionId);
  const sessionTitleRef = useRef(sessionTitle);
  const isSessionArchivedRef = useRef(isSessionArchived);
  const selectedCharacterCardIdsRef = useRef(selectedCharacterCardIds);
  const contextCompactionRef = useRef<SessionContextCompaction | null>(contextCompaction);

  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [archiveAnalyses, setArchiveAnalyses] = useState<Record<string, any>>({});
  const [selectedTargetCardId, setSelectedTargetCardId] = useState<string>('');

  const [editedTitle, setEditedTitle] = useState('');
  const [editedRelationTypes, setEditedRelationTypes] = useState<Record<string, string>>({});
  const [editedRelationModels, setEditedRelationModels] = useState<Record<string, string>>({});
  const [editedRelationBottomLines, setEditedRelationBottomLines] = useState<Record<string, string>>({});
  const [editedEventsMap, setEditedEventsMap] = useState<Record<string, string>>({});


  const [tempSelectedCardIds, setTempSelectedCardIds] = useState<string[]>([]);
  const [hasStartedAnalysis, setHasStartedAnalysis] = useState(false);

  useEffect(() => { activeRunRef.current = activeRun; }, [activeRun]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { sessionTitleRef.current = sessionTitle; }, [sessionTitle]);
  useEffect(() => { isSessionArchivedRef.current = isSessionArchived; }, [isSessionArchived]);
  useEffect(() => { selectedCharacterCardIdsRef.current = selectedCharacterCardIds; }, [selectedCharacterCardIds]);
  useEffect(() => { contextCompactionRef.current = contextCompaction; }, [contextCompaction]);

  useEffect(() => {
    void refreshSessions();
  }, []);

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

      if (payload.eventType === 'tool_start') {
        currentThinkingIdRef.current = null;
        const toolId = payload.toolCallId || `tool-${Date.now()}`;
        setMessages((prev) => {
          const next = updateMessageTool(prev, activeRun.messageId!, {
            id: toolId,
            name: payload.toolName || '未知工具',
            result: payload.toolName === 'role_play' ? '' : payload.message || '正在执行工具',
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

      if (payload.eventType === 'context_compacted' && payload.contextCompaction) {
        contextCompactionRef.current = payload.contextCompaction;
        setContextCompaction(payload.contextCompaction);
        return;
      }

      if (payload.eventType === 'error') {
        currentThinkingIdRef.current = null;
        setMessages((prev) => prev.map((msg) => (
          msg.id === activeRun.messageId
            ? { ...msg, content: payload.message ? `冒险推演失败：${payload.message}` : '冒险推演失败' }
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
      if (!isMounted) fn();
    });

    return () => {
      isMounted = false;
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // Listen to book-travel stream events
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    listen<any>('book-travel-stream', (event) => {
      if (!active) return;
      const { runId, eventType, delta, message: eventMessage } = event.payload;
      if (startRunIdRef.current && runId !== startRunIdRef.current) return;
      if (eventType === 'delta' && delta) {
        if (startProgressPhase === 'planner') {
          setPlannerOutput((prev) => prev + delta);
        } else if (startProgressPhase === 'writer') {
          setWriterOutput((prev) => prev + delta);
        }
      }
      if (eventType === 'done') {
        startResolverRef.current?.resolve(eventMessage || '');
      }
      if (eventType === 'error') {
        startResolverRef.current?.reject(eventMessage || '未知错误');
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, [startProgressPhase]);

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
  const selectedCards = characterCards.filter(cc => selectedCharacterCardIds.includes(cc.id));
  const storyAllowedTools = getStoryAllowedTools(dynamicRoleLoadingEnabled);
  const rolePlayContext = dynamicRoleLoadingEnabled ? {
    chatSystemPrompt: settings.partnerChatPrompt || '',
    worldBookContent: selectedWorldBook?.content || '',
    userInfo: partnerChatUserInfo,
    characterCards: selectedCards.map((card) => ({
      id: card.id,
      name: card.name,
      content: card.content,
    })),
  } : null;

  // Compile final Prompt
  const baseSystemPrompt = dynamicRoleLoadingEnabled
    ? settings.storyDynamicAgentPrompt || ''
    : settings.storyAgentPrompt || '';
  const effectiveSystemPrompt = compileStorySystemPrompt({
    basePrompt: baseSystemPrompt,
    worldBookContent: selectedWorldBook ? selectedWorldBook.content : null,
    characterCards: selectedCards.map((card) => ({ name: card.name, content: card.content })),
    userInfo: partnerChatUserInfo,
    dynamicRoleLoadingEnabled,
  });
  const storyAgentConfigId = dynamicRoleLoadingEnabled ? 'storyDynamicAgent' : 'storyAgent';
  const storyAgentConfig = settings.agentConfigs?.[storyAgentConfigId] || {
    temperature: 0.3,
    maxOutputTokens: 32000,
    maxContextTokens: 200000,
    thinkingDepth: 'off',
  };


  const mergeNewBeatIntoCurrentScene = (updatedScene: any) => {
    const currentScene = bookTravelStore.scenes.find((s) => s.id === bookTravelStore.currentSceneId);
    if (!currentScene) return;
    const newBeat = updatedScene.beat;
    if (newBeat && newBeat.content) {
      const existingIds = new Set(currentScene.beats.map((b) => b.id));
      const beatId = existingIds.has(newBeat.id) ? `beat-${Date.now()}` : (newBeat.id || `beat-${Date.now()}`);
      bookTravelStore.addBeatToCurrentScene({
        id: beatId,
        content: newBeat.content || '',
      });
      bookTravelStore.setCurrentBeatId(beatId);
    }
    const patch = updatedScene.volatileMemoryPatch || updatedScene.volatile_memory_patch;
    if (patch && typeof patch === 'object') {
      bookTravelStore.updateVolatileMemory(patch);
    }
  };

  const handleMetaCommand = async (userInput: string) => {
    const lower = userInput.toLowerCase();
    if (['存档', '保存', 'save'].some((t) => lower.includes(t))) {
      try {
        await saveCurrentSession();
        message.success('已存档');
      } catch (e) {
        message.error(`存档失败：${String(e)}`);
      }
      return;
    }
    if (['查看状态', '我的状态', '状态', '背包', '当前情况'].some((t) => lower.includes(t))) {
      Modal.info({
        title: '当前状态',
        width: 520,
        content: (
          <div style={{ lineHeight: 1.8, color: '#33312e' }}>
            {bookTravelStore.userCharacter && (
              <div>
                <strong>扮演身份：</strong>
                {bookTravelStore.userCharacter.name}（{bookTravelStore.userCharacter.identity}）
                <br /><strong>目标：</strong>{bookTravelStore.userCharacter.goal}
              </div>
            )}
            <div style={{ marginTop: 8 }}>
              <strong>时间：</strong>{String((bookTravelStore.currentState as any)?.time || bookTravelStore.scenes.find((s) => s.id === bookTravelStore.currentSceneId)?.time || '未知')}
              <br /><strong>地点：</strong>{String((bookTravelStore.currentState as any)?.location || bookTravelStore.scenes.find((s) => s.id === bookTravelStore.currentSceneId)?.location || '未知')}
            </div>
            {bookTravelStore.volatileMemory && (
              <div style={{ marginTop: 8 }}>
                {Object.entries(bookTravelStore.volatileMemory).map(([k, v]) => (
                  <div key={k}><strong>{k}：</strong>{String(v)}</div>
                ))}
              </div>
            )}
          </div>
        ),
      });
      return;
    }
    if (['回顾剧情', '剧情回顾', '之前发生了什么'].some((t) => lower.includes(t))) {
      const summary = bookTravelStore.summaryMemory;
      const turns = bookTravelStore.turns;
      Modal.info({
        title: '剧情回顾',
        width: 600,
        content: (
          <div style={{ lineHeight: 1.8, color: '#33312e', maxHeight: 480, overflowY: 'auto' }}>
            {summary ? (
              <div style={{ marginBottom: 16, padding: 12, background: '#faf9f5', borderRadius: 8 }}>
                <strong>剧情摘要：</strong>
                <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{String(summary)}</div>
              </div>
            ) : null}
            {turns.length > 0 ? (
              <div>
                <strong>近期回合：</strong>
                {turns.slice(-5).map((turn, idx) => (
                  <div key={turn.id} style={{ marginTop: 8, padding: 8, background: '#faf9f5', borderRadius: 6 }}>
                    <div style={{ fontSize: 12, color: '#8c8882', marginBottom: 4 }}>回合 {turns.length - 5 + idx + 1}</div>
                    <div><strong>你：</strong>{turn.userInput}</div>
                    <div style={{ marginTop: 4 }}><strong>剧情：</strong>{turn.narrativeOutput}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: '#8c8882' }}>暂无剧情记录</div>
            )}
          </div>
        ),
      });
      return;
    }
    if (['结束游戏', '结束穿书', '退出穿书', 'game over'].some((t) => lower.includes(t))) {
      Modal.confirm({
        title: '结束穿书',
        content: '确定要结束当前穿书冒险并触发结局判定吗？',
        onOk: async () => {
          try {
            const { selectedOutline, selectedWorldBook, selectedCharacterCards, stableMemory, volatileMemory, assembledWorldModel, scenes, turns } = bookTravelStore;
            if (!selectedOutline || !selectedWorldBook) {
              message.error('素材缺失');
              return;
            }
            const materials = {
              outline: { id: selectedOutline.id, title: selectedOutline.title, content: selectedOutline.content },
              worldBook: { id: selectedWorldBook.id, title: selectedWorldBook.title, content: selectedWorldBook.content },
              characterCards: selectedCharacterCards.map((cc: any) => ({ id: cc.id, title: cc.title, content: cc.content })),
            };
            const judgeConfig = settings.agentConfigs?.bookTravelEndingJudge || {};
            const judgeState = { stableMemory, volatileMemory, assembledWorldModel, currentState: bookTravelStore.currentState, summaryMemory: bookTravelStore.summaryMemory || '', recentScenes: scenes.slice(-3), recentTurns: turns.slice(-5) };
            const judgeRequest = buildBookTravelRequest('ending-judge', settings.bookTravelEndingJudgePrompt, judgeConfig, materials, judgeState);
            const endingJsonStr = await invoke<string>('judge_book_travel_ending', { request: judgeRequest });
            let ending = cleanAndParseJSON(endingJsonStr);
            bookTravelStore.finishSession(ending);
            message.success('已达成穿书结局！');
          } catch (err: any) {
            message.error(`结局判定失败：${String(err)}`);
          }
        },
      });
      return;
    }
    if (['重试', '重来', '撤销', '回退', 'undo'].some((t) => lower.includes(t))) {
      const turns = bookTravelStore.turns;
      if (turns.length === 0) {
        message.info('没有可回退的回合');
        return;
      }
      bookTravelStore.removeLastTurn();
      bookTravelStore.removeLastBeatFromCurrentScene();
      message.success('已回退到上一回合');
      return;
    }
    message.info('元指令已接收');
  };

  const handleInsertBeatStream = async (userInput: string) => {
    setIsTransitioningScene(true);
    setStartProgressPhase('writer');
    setPlannerOutput('');
    setWriterOutput('');
    setStartProgressError('');
    setStartElapsedMs(0);
    startCancelledRef.current = false;
    let elapsedInterval: ReturnType<typeof setInterval> | null = null;
    try {
      elapsedInterval = setInterval(() => setStartElapsedMs((p) => p + 100), 100);
      const { selectedOutline, selectedWorldBook, selectedCharacterCards, stableMemory, volatileMemory, assembledWorldModel, scenes, turns } = bookTravelStore;
      if (!selectedOutline || !selectedWorldBook) throw new Error('素材缺失');
      const materials = {
        outline: { id: selectedOutline.id, title: selectedOutline.title, content: selectedOutline.content },
        worldBook: { id: selectedWorldBook.id, title: selectedWorldBook.title, content: selectedWorldBook.content },
        characterCards: selectedCharacterCards.map((cc: any) => ({ id: cc.id, title: cc.title, content: cc.content })),
      };
      const writerConfig = settings.agentConfigs?.bookTravelSceneWriter || {};
      const writerState = { stableMemory, volatileMemory, assembledWorldModel, currentState: bookTravelStore.currentState, summaryMemory: bookTravelStore.summaryMemory || '', recentScenes: scenes.slice(-3), recentTurns: turns.slice(-5), writerInstructions: userInput };
      const writerRequest = buildBookTravelRequest('scene-writer', settings.bookTravelSceneWriterPrompt, writerConfig, materials, writerState);
      const currentScene = scenes.find((s) => s.id === bookTravelStore.currentSceneId);
      const allowedSpeakers = currentScene?.activeCharacters || [];
      const sceneJsonStr = await runBookTravelStreamTask('start_write_book_travel_insert_beat_stream', writerRequest, { userInput, allowedSpeakers });
      let scene = cleanAndParseJSON(sceneJsonStr);
      mergeNewBeatIntoCurrentScene(scene);
      const newBeat = scene.beat;
      bookTravelStore.appendTurn({ id: `turn-${Date.now()}`, userInput, classification: 'insert-beat' as const, narrativeOutput: newBeat?.content || '', stateSnapshot: bookTravelStore.currentState, createdBeatIds: [newBeat?.id || ''] });
      setStartProgressPhase('done');
    } catch (err: any) {
      if (startCancelledRef.current) { message.info('已中断'); setStartProgressPhase('cancelled'); }
      else { const errorMsg = String(err); message.error(`生成失败：${errorMsg}`); setStartProgressError(errorMsg); setStartProgressPhase('error'); }
    } finally {
      if (elapsedInterval) clearInterval(elapsedInterval);
      setIsTransitioningScene(false);
      startRunIdRef.current = null;
      startResolverRef.current = null;
    }
  };

  const handleChangeSceneStream = async (userInput: string) => {
    setIsTransitioningScene(true);
    setStartProgressPhase('planner');
    setPlannerOutput('');
    setWriterOutput('');
    setStartProgressError('');
    setStartElapsedMs(0);
    startCancelledRef.current = false;
    let elapsedInterval: ReturnType<typeof setInterval> | null = null;
    try {
      elapsedInterval = setInterval(() => setStartElapsedMs((p) => p + 100), 100);
      const { selectedOutline, selectedWorldBook, selectedCharacterCards, stableMemory, volatileMemory, assembledWorldModel, scenes, turns, userCharacter } = bookTravelStore;
      if (!selectedOutline || !selectedWorldBook) throw new Error('素材缺失');
      const materials = {
        outline: { id: selectedOutline.id, title: selectedOutline.title, content: selectedOutline.content },
        worldBook: { id: selectedWorldBook.id, title: selectedWorldBook.title, content: selectedWorldBook.content },
        characterCards: selectedCharacterCards.map((cc: any) => ({ id: cc.id, title: cc.title, content: cc.content })),
      };
      const plannerConfig = settings.agentConfigs?.bookTravelScenePlanner || {};
      const plannerState = { stableMemory, volatileMemory, assembledWorldModel, currentState: bookTravelStore.currentState, summaryMemory: bookTravelStore.summaryMemory || '', recentScenes: scenes.slice(-3), recentTurns: turns.slice(-5), userCharacter };
      const plannerRequest = buildBookTravelRequest('scene-planner', settings.bookTravelPlotPlannerPrompt, plannerConfig, materials, plannerState);
      const plannerPlanStr = await runBookTravelStreamTask('start_plan_book_travel_scene_stream', plannerRequest, { userInput });
      let plan = cleanAndParseJSON(plannerPlanStr);
      const newCurrentState = { ...(bookTravelStore.currentState || {}), ...(plan.stateChanges || plan.state_changes || {}) };
      bookTravelStore.setCurrentState(newCurrentState);
      setStartProgressPhase('writer');
      const writerConfig = settings.agentConfigs?.bookTravelSceneWriter || {};
      const writerState = { stableMemory, volatileMemory, assembledWorldModel, currentState: newCurrentState, summaryMemory: bookTravelStore.summaryMemory || '', recentScenes: scenes.slice(-3), recentTurns: turns.slice(-5), writerInstructions: plan.writerInstructions || plan.writer_instructions || '' };
      const writerRequest = buildBookTravelRequest('scene-writer', settings.bookTravelSceneWriterPrompt, writerConfig, materials, writerState);
      const allowedCast = plan.allowedCast || plan.allowed_cast || [];
      const sceneJsonStr = await runBookTravelStreamTask('start_write_book_travel_change_scene_stream', writerRequest, { userInput: plan.writerInstructions || plan.writer_instructions || '', allowedSpeakers: allowedCast });
      let scene = cleanAndParseJSON(sceneJsonStr);
      const patch = scene.volatileMemoryPatch || scene.volatile_memory_patch;
      if (patch && typeof patch === 'object') bookTravelStore.updateVolatileMemory(patch);
      const rawBeat = scene.beat;
      const singleBeat = rawBeat
        ? { id: rawBeat.id || `beat-${Date.now()}`, content: rawBeat.content || '' }
        : { id: `beat-${Date.now()}`, content: '' };
      const repairedScene = {
        id: scene.id || `scene-${Date.now()}`,
        title: scene.title || `新场景-${scenes.length + 1}`,
        summary: scene.summary || '',
        currentSituation: scene.currentSituation || '',
        time: scene.time || newCurrentState.time || '',
        location: scene.location || newCurrentState.location || '',
        activeCharacters: scene.activeCharacters || allowedCast,
        beats: [singleBeat],
      };
      bookTravelStore.addScene(repairedScene);
      const newTurn = { id: `turn-${Date.now()}`, userInput, classification: 'change-scene' as const, plannerOutput: plan, narrativeOutput: singleBeat.content, stateSnapshot: newCurrentState, createdSceneId: repairedScene.id, createdBeatIds: [singleBeat.id] };
      bookTravelStore.appendTurn(newTurn);
      if (plan.endingStatus && plan.endingStatus !== 'none' && plan.endingStatus !== 'active') {
        const judgeConfig = settings.agentConfigs?.bookTravelEndingJudge || {};
        const judgeState = { stableMemory, volatileMemory, assembledWorldModel, currentState: newCurrentState, summaryMemory: bookTravelStore.summaryMemory || '', recentScenes: [...scenes.slice(-3), repairedScene], recentTurns: [...turns.slice(-5), newTurn] };
        const judgeRequest = buildBookTravelRequest('ending-judge', settings.bookTravelEndingJudgePrompt, judgeConfig, materials, judgeState);
        const endingJsonStr = await invoke<string>('judge_book_travel_ending', { request: judgeRequest });
        let ending = cleanAndParseJSON(endingJsonStr);
        bookTravelStore.finishSession(ending);
        message.success('已达成穿书结局！');
      } else {
        const keeperConfig = settings.agentConfigs?.bookTravelMemoryKeeper || {};
        const keeperState = { stableMemory, volatileMemory, assembledWorldModel, currentState: newCurrentState, summaryMemory: bookTravelStore.summaryMemory || '', recentScenes: [...scenes.slice(-3), repairedScene], recentTurns: [...turns.slice(-5), newTurn] };
        const keeperRequest = buildBookTravelRequest('memory-keeper', settings.bookTravelMemoryKeeperPrompt, keeperConfig, materials, keeperState);
        invoke<string>('summarize_book_travel_memory', { request: keeperRequest }).then((resStr) => {
          try { const res = cleanAndParseJSON(resStr); if (res.summary) bookTravelStore.updateSummaryMemory(res.summary); }
          catch (e) { console.error('Failed to parse memory keeper summary:', e); }
        }).catch((err) => { console.error('Failed to update memory keeper:', err); });
      }
      setStartProgressPhase('done');
      message.success('已切换至新场景！');
    } catch (err: any) {
      if (startCancelledRef.current) { message.info('已中断'); setStartProgressPhase('cancelled'); }
      else { const errorMsg = String(err); message.error(`切换场景失败：${errorMsg}`); setStartProgressError(errorMsg); setStartProgressPhase('error'); }
    } finally {
      if (elapsedInterval) clearInterval(elapsedInterval);
      setIsTransitioningScene(false);
      startRunIdRef.current = null;
      startResolverRef.current = null;
    }
  };

  const startBookTravelAdventure = async () => {
    const { selectedEntryPointId, userCharacter, assembledWorldModel, stableMemory, volatileMemory, selectedOutline, selectedWorldBook, selectedCharacterCards } = bookTravelStore;
    if (!selectedEntryPointId) {
      message.warning('请选择一个入场点');
      return;
    }
    if (!userCharacter || !userCharacter.name.trim()) {
      message.warning('请选择或填写一个扮演身份');
      return;
    }
    if (!selectedOutline || !selectedWorldBook) {
      message.warning('素材缺失，请重新装配素材');
      return;
    }

    setIsTransitioningScene(true);
    setStartProgressPhase('planner');
    setPlannerOutput('');
    setWriterOutput('');
    setStartProgressError('');
    setStartElapsedMs(0);
    startCancelledRef.current = false;

    let elapsedInterval: ReturnType<typeof setInterval> | null = null;
    try {
      elapsedInterval = setInterval(() => setStartElapsedMs((prev) => prev + 100), 100);

      const entryPoint = bookTravelStore.entryPoints.find(ep => ep.id === selectedEntryPointId);
      if (!entryPoint) throw new Error('选中的入场点不存在');

      const materials = {
        outline: { id: selectedOutline.id, title: selectedOutline.title, content: selectedOutline.content },
        worldBook: { id: selectedWorldBook.id, title: selectedWorldBook.title, content: selectedWorldBook.content },
        characterCards: selectedCharacterCards.map(cc => ({ id: cc.id, title: cc.title, content: cc.content })),
      };

      const plannerConfig = settings.agentConfigs?.bookTravelScenePlanner || {};
      const plannerState = { stableMemory, volatileMemory, assembledWorldModel, currentState: null, summaryMemory: '', recentScenes: [], recentTurns: [], userCharacter, selectedEntryPointId };
      const plannerRequest = buildBookTravelRequest('scene-planner', settings.bookTravelPlotPlannerPrompt, plannerConfig, materials, plannerState);
      const plannerInput = `确认以入场点 [${entryPoint.title}] 入场，扮演新身份 [${userCharacter.name}]（${userCharacter.identity}）。\n详细局势：${entryPoint.situation || entryPoint.summary || ''}\n初始目标：${entryPoint.initialGoal || ''}\n面临风险：${entryPoint.risk || ''}`;
      const plannerPlanStr = await runBookTravelStreamTask('start_plan_book_travel_scene_stream', plannerRequest, { userInput: plannerInput });

      let plan = cleanAndParseJSON(plannerPlanStr);
      const newCurrentState = { ...(plannerState.currentState || {}), ...(plan.stateChanges || plan.state_changes || {}), time: entryPoint.timeAndLocation || plan.stateChanges?.time || plan.state_changes?.time || '', location: entryPoint.timeAndLocation || plan.stateChanges?.location || plan.state_changes?.location || '' };
      bookTravelStore.setCurrentState(newCurrentState);

      setStartProgressPhase('writer');
      const writerConfig = settings.agentConfigs?.bookTravelSceneWriter || {};
      const writerState = { stableMemory, volatileMemory, assembledWorldModel, currentState: newCurrentState, summaryMemory: '', recentScenes: [], recentTurns: [], writerInstructions: plan.writerInstructions || plan.writer_instructions || '' };
      const writerRequest = buildBookTravelRequest('scene-writer', settings.bookTravelSceneWriterPrompt, writerConfig, materials, writerState);
      const allowedCast = plan.allowedCast || plan.allowed_cast || [];
      const sceneJsonStr = await runBookTravelStreamTask('start_write_book_travel_change_scene_stream', writerRequest, { userInput: plan.writerInstructions || plan.writer_instructions || '', allowedSpeakers: allowedCast });

      let scene = cleanAndParseJSON(sceneJsonStr);
      const patch = scene.volatileMemoryPatch || scene.volatile_memory_patch;
      if (patch && typeof patch === 'object') bookTravelStore.updateVolatileMemory(patch);

      const repairedScene = {
        id: scene.id || `scene-${Date.now()}`,
        title: scene.title || entryPoint.title,
        summary: scene.summary || entryPoint.situation || entryPoint.summary,
        currentSituation: scene.currentSituation || entryPoint.situation,
        time: scene.time || entryPoint.timeAndLocation,
        location: scene.location || entryPoint.timeAndLocation,
        activeCharacters: scene.activeCharacters || allowedCast,
        beats: scene.beat
          ? [{ id: scene.beat.id || `beat-${Date.now()}`, content: scene.beat.content || '' }]
          : [{ id: `beat-${Date.now()}`, content: '' }],
      };

      bookTravelStore.addScene(repairedScene);
      const autoTitle = `${selectedOutline.title}-${entryPoint.title}`;
      setSessionTitle(autoTitle);
      sessionTitleRef.current = autoTitle;
      setStartProgressPhase('done');
      message.success('穿书冒险已开始！');
    } catch (err: any) {
      if (startCancelledRef.current) {
        message.info('已中断穿书开始');
        setStartProgressPhase('cancelled');
      } else {
        const errorMsg = String(err);
        message.error(`开始穿书冒险失败：${errorMsg}`);
        setStartProgressError(errorMsg);
        setStartProgressPhase('error');
        console.error(err);
      }
    } finally {
      if (elapsedInterval) clearInterval(elapsedInterval);
      setIsTransitioningScene(false);
      startRunIdRef.current = null;
      startResolverRef.current = null;
    }
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    if (bookTravelStore.scenes.length > 0) {
      setInput('');
      try {
        const { selectedOutline, selectedWorldBook, selectedCharacterCards } = bookTravelStore;
        if (!selectedOutline || !selectedWorldBook) {
          message.error('素材缺失，请重新装配素材');
          return;
        }
        const materials = {
          outline: { id: selectedOutline.id, title: selectedOutline.title, content: selectedOutline.content },
          worldBook: { id: selectedWorldBook.id, title: selectedWorldBook.title, content: selectedWorldBook.content },
          characterCards: selectedCharacterCards.map((cc: any) => ({ id: cc.id, title: cc.title, content: cc.content })),
        };
        const classifierConfig = settings.agentConfigs?.bookTravelInputClassifier || {};
        const classifierState = {
          stableMemory: bookTravelStore.stableMemory,
          volatileMemory: bookTravelStore.volatileMemory,
          assembledWorldModel: bookTravelStore.assembledWorldModel,
          currentState: bookTravelStore.currentState,
          summaryMemory: bookTravelStore.summaryMemory || '',
          recentScenes: bookTravelStore.scenes.slice(-3),
          recentTurns: bookTravelStore.turns.slice(-5),
          userCharacter: bookTravelStore.userCharacter,
        };
        const classifierRequest = buildBookTravelRequest(
          'input-classifier',
          '你是一个穿书输入分类器。根据用户的输入，判断其意图是以下哪一种：\n- meta: 元指令（如查看状态、存档、回顾剧情等）\n- insert-beat: 在当前场景中继续互动（对话、观察、小动作）\n- change-scene: 切换场景（离开地点、跳过时间、重大决定）\n只输出分类结果，不要解释。',
          classifierConfig,
          materials,
          classifierState,
        );
        const classificationResult = await invoke<{ classification: 'meta' | 'insert-beat' | 'change-scene' }>('classify_book_travel_input', {
          request: classifierRequest,
          userInput: trimmed,
        });
        switch (classificationResult.classification) {
          case 'meta': await handleMetaCommand(trimmed); break;
          case 'insert-beat': await handleInsertBeatStream(trimmed); break;
          case 'change-scene': await handleChangeSceneStream(trimmed); break;
          default: message.warning('无法识别输入意图，请重新输入');
        }
      } catch (err) {
        message.error(`处理失败：${String(err)}`);
      }
      return;
    }

    let formattedText = trimmed;
    if (inputMode === 'speech') {
      formattedText = `我："${trimmed}"`;
    } else if (inputMode === 'behavior') {
      formattedText = `（我 ${trimmed}）`;
    } else if (inputMode === 'plot') {
      formattedText = `[剧情推进] ${trimmed}`;
    }
    const userMessage: Message = { id: `msg-${Date.now()}`, role: 'user', content: formattedText, tools: [] };
    const agentMessageId = `msg-${Date.now() + 1}`;
    const pendingAgentMessage: Message = { id: agentMessageId, role: 'agent', content: '', tools: [] };
    const nextMessages = [...messages, userMessage, pendingAgentMessage];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setInput('');
    setIsStreaming(true);
    scrollToBottomOnce();
    try {
      const modelMessages = buildStoryModelMessages(nextMessages.slice(0, -1));
      const runId = await invoke<string>('start_chat_completion_stream', {
        request: {
          modelInterface: settings.modelInterface, baseUrl: settings.llmBaseUrl, apiKey: settings.llmApiKey,
          model: settings.llmModel, temperature: storyAgentConfig.temperature ?? 0.3,
          maxOutputTokens: storyAgentConfig.maxOutputTokens ?? 32000,
          maxContextTokens: storyAgentConfig.maxContextTokens ?? 200000,
          thinkingDepth: storyAgentConfig.thinkingDepth ?? 'off',
          systemPrompt: effectiveSystemPrompt, workspacePath: null, messages: modelMessages,
          contextCompaction: contextCompactionRef.current, selectedReferenceFiles: [],
          allowedTools: storyAllowedTools, rolePlayContext,
        }
      });
      activeRunRef.current = { runId, messageId: agentMessageId };
      setActiveRun({ runId, messageId: agentMessageId });
    } catch (err) {
      activeRunRef.current = { runId: null, messageId: null };
      setActiveRun({ runId: null, messageId: null });
      setIsStreaming(false);
      setMessages((prev) => prev.map((msg) => msg.id === agentMessageId ? { ...msg, content: `请求冒险发生故障：${String(err)}` } : msg));
    }
  };

  const handleStop = async () => {
    if (activeRunRef.current.runId) {
      try {
        await invoke('stop_chat_stream', { runId: activeRunRef.current.runId });
      } catch (err) {
        console.error('停止冒险失败:', err);
      }
    }
    setIsStreaming(false);
  };

  const refreshSessions = async () => {
    try {
      const summaries = await invoke<AgentSessionSummary[]>('list_agent_sessions', { prefix: 'story-session-' });
      setSessions(summaries);
    } catch (err) {
      console.error('读取故事会话失败:', err);
    }
  };

  const saveCurrentSession = async () => {
    const userMessages = messagesRef.current.filter(m => m.role === 'user');
    if (userMessages.length === 0) return;

    try {
      await invoke<AgentSessionSummary>('save_agent_session', {
        session: {
          id: sessionIdRef.current,
          title: sessionTitleRef.current,
          savedAt: Date.now(),
          messages: messagesRef.current,
          selectedReferenceFiles: [],
          selectedOutlineFile: null,
          todos: [],
          contextCompaction: contextCompactionRef.current,
          isArchived: isSessionArchivedRef.current,
          selectedWorldBookId,
          dynamicRoleLoadingEnabled,
          characterCardIds: selectedCharacterCardIdsRef.current
        }
      });
      await refreshSessions();
    } catch (err) {
      console.error('保存故事会话失败:', err);
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
      setSelectedCharacterCardIds(session.characterCardIds ?? []);
      setDynamicRoleLoadingEnabled(session.dynamicRoleLoadingEnabled ?? false);
      contextCompactionRef.current = session.contextCompaction ?? null;
      setContextCompaction(session.contextCompaction ?? null);
      setIsStreaming(false);
      setInput('');
      setIsSessionArchived(session.isArchived ?? false);
      scrollToBottomOnce();
    } catch (err) {
      console.error('打开故事会话失败:', err);
    }
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await invoke('delete_agent_session', { id });
      message.success('已删除该冒险记录');
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
    if (messages.length === 0 || isStreaming || isSessionArchived) return;

    if (selectedCards.length === 0) {
      message.warning('当前冒险尚未绑定任何角色卡，无法封存记忆！');
      return;
    }

    setTempSelectedCardIds(selectedCards.map(c => c.id));
    setHasStartedAnalysis(false);
    setArchiveAnalyses({});
    setIsArchiveModalOpen(true);
  };

  const startAnalyzingSelectedCards = async () => {
    if (tempSelectedCardIds.length === 0) return;

    setIsAnalyzing(true);
    setHasStartedAnalysis(true);
    setSelectedTargetCardId(tempSelectedCardIds[0]);

    const chatHistoryText = messages
      .filter(m => m.role === 'user' || m.role === 'agent')
      .map(m => {
        const sender = m.role === 'user' ? '我' : '故事旁白与NPC';
        const cleanContent = m.content.replace(/\[\[THINKING:[^\]]+\]\]/g, '').trim();
        return `${sender}: ${cleanContent}`;
      })
      .filter(line => line.split(': ')[1] !== '')
      .join('\n\n');

    try {
      const archiveConfig = settings.agentConfigs?.storyArchive || {};
      const filteredCards = selectedCards.filter(cc => tempSelectedCardIds.includes(cc.id));
      const promises = filteredCards.map(async (card) => {
        const resultStr = await invoke<string | Record<string, any>>('analyze_character_memory', {
          request: {
            modelInterface: settings.modelInterface,
            baseUrl: settings.llmBaseUrl,
            apiKey: settings.llmApiKey,
            model: settings.llmModel,
            temperature: archiveConfig.temperature ?? 0.3,
            maxOutputTokens: archiveConfig.maxOutputTokens ?? 32000,
            thinkingDepth: archiveConfig.thinkingDepth ?? 'off',
            systemPrompt: settings.storyArchivePrompt || undefined,
            chatHistory: chatHistoryText,
            targetCharacterName: card.name,
            targetCharacterContent: card.content,
            currentUserRelationType: card.fields?.userRelationType || '',
            currentUserInteractionModel: card.fields?.userInteractionModel || '',
            currentUserRelationBottomLine: card.fields?.userRelationBottomLine || '',
            currentEvents: card.fields?.keyEvents || '暂无共同经历的关键事件。'
          }
        });
        const analysis = parseArchiveAnalysisResponse(resultStr);
        return { cardId: card.id, analysis };
      });

      const results = await Promise.all(promises);
      const analyses: Record<string, any> = {};
      const relationTypes: Record<string, string> = {};
      const relationModels: Record<string, string> = {};
      const relationBottomLines: Record<string, string> = {};
      const events: Record<string, string> = {};
      let firstSessionTitle = '';

      for (const res of results) {
        analyses[res.cardId] = res.analysis;
        relationTypes[res.cardId] = res.analysis.userRelationType || '';
        relationModels[res.cardId] = res.analysis.userInteractionModel || '';
        relationBottomLines[res.cardId] = res.analysis.userRelationBottomLine || '';
        events[res.cardId] = res.analysis.keyEvents || '';
        if (!firstSessionTitle) {
          firstSessionTitle = res.analysis.sessionTitle || '';
        }
      }

      setArchiveAnalyses(analyses);
      setEditedRelationTypes(relationTypes);
      setEditedRelationModels(relationModels);
      setEditedRelationBottomLines(relationBottomLines);
      setEditedEventsMap(events);
      setEditedTitle(firstSessionTitle || sessionTitle || '未命名故事');
    } catch (err) {
      console.error('故事记忆分析失败:', err);
      message.error(`故事记忆分析失败：${String(err)}`);
      setIsArchiveModalOpen(false);
      setHasStartedAnalysis(false);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleTargetCardChange = (cardId: string) => {
    setSelectedTargetCardId(cardId);
  };

  const handleConfirmArchive = async () => {
    try {
      // 1. Update all character card fields
      const filteredCards = selectedCards.filter(c => tempSelectedCardIds.includes(c.id));
      for (const card of filteredCards) {
        const relationType = editedRelationTypes[card.id] || '';
        const relationModel = editedRelationModels[card.id] || '';
        const relationBottomLine = editedRelationBottomLines[card.id] || '';
        const events = editedEventsMap[card.id] || '';
        updateItemFields(card.id, 'character_card', {
          userRelationType: relationType,
          userInteractionModel: relationModel,
          userRelationBottomLine: relationBottomLine,
          keyEvents: events
        });
      }

      // 2. Archive session state
      setIsSessionArchived(true);
      const finalTitle = editedTitle.trim() || '未命名故事';
      setSessionTitle(finalTitle);
      sessionTitleRef.current = finalTitle;
      isSessionArchivedRef.current = true;

      // 3. Update backend session title and persist
      await invoke('update_agent_session_title', { id: sessionIdRef.current, title: finalTitle });
      await saveCurrentSession();

      message.success('冒险记忆成功封存到选中的角色卡！本局会话已锁定归档。');
      setIsArchiveModalOpen(false);
    } catch (err) {
      console.error('封存故事记忆失败:', err);
      message.error(`封存故事记忆失败：${String(err)}`);
    }
  };

  // Context Stats
  const contextStats = estimateContextUsage(effectiveSystemPrompt, messages, input);
  const maxContext = storyAgentConfig.maxContextTokens ?? 200000;
  const contextPercent = maxContext > 0
    ? Math.min(100, Math.round((contextStats.total / maxContext) * 100))
    : 0;

  const contextTooltip = (
    <div className="agent-context-popover">
      <div className="agent-context-popover__header">
        <strong>冒险上下文详情</strong>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">世界书：</span>
        <span className="agent-context-popover__value">{selectedWorldBook?.name || '未绑定'}</span>
      </div>
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">活跃角色：</span>
        <span className="agent-context-popover__value">{selectedCards.map(c => c.name).join(', ') || '未绑定'}</span>
      </div>
      <div className="agent-context-popover__divider" />
      <div className="agent-context-popover__row">
        <span className="agent-context-popover__label">总估 Token：</span>
        <span className="agent-context-popover__value agent-context-popover__value--highlight">{contextStats.total} / {maxContext}</span>
      </div>
    </div>
  );

  const hasMessages = messages.length > 0;

  return (
    <div className="agent-chat" style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#faf9f5' }}>

      {/* Archive Memory Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#33312e', fontSize: '18px', fontWeight: 600 }}>
            <FileProtectOutlined style={{ color: '#d97757' }} />
            <span>封存冒险记忆与设定同步</span>
          </div>
        }
        open={isArchiveModalOpen}
        onCancel={() => !isAnalyzing && setIsArchiveModalOpen(false)}
        width={720}
        styles={{ body: { padding: '16px 24px' } }}
        footer={
          !hasStartedAnalysis ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button onClick={() => setIsArchiveModalOpen(false)}>取消</Button>
              <Button
                type="primary"
                disabled={tempSelectedCardIds.length === 0}
                onClick={startAnalyzingSelectedCards}
                style={{
                  backgroundColor: tempSelectedCardIds.length > 0 ? '#d97757' : undefined,
                  borderColor: tempSelectedCardIds.length > 0 ? '#d97757' : undefined,
                  borderRadius: '6px',
                  color: tempSelectedCardIds.length > 0 ? '#ffffff' : undefined
                }}
              >
                开始分析封存
              </Button>
            </div>
          ) : isAnalyzing ? null : (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button onClick={() => setIsArchiveModalOpen(false)}>取消</Button>
              <Button
                type="primary"
                onClick={handleConfirmArchive}
                style={{
                  backgroundColor: '#d97757',
                  borderColor: '#d97757',
                  borderRadius: '6px',
                  color: '#ffffff'
                }}
              >
                确认同步并归档
              </Button>
            </div>
          )
        }
      >
        {!hasStartedAnalysis ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '12px 0' }}>
            <div style={{ fontSize: '14px', color: '#5c5751', fontWeight: 500 }}>
              请勾选本次封存记忆需要更新的角色卡：
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', padding: '8px 0' }}>
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
                      padding: '8px 16px',
                      border: isChecked ? '1px solid #d97757' : '1px solid #eae6df',
                      borderRadius: '8px',
                      backgroundColor: isChecked ? '#fff7f2' : '#faf9f5',
                      color: isChecked ? '#d97757' : '#5c5751',
                      transition: 'all 0.2s ease',
                      cursor: 'pointer'
                    }}
                  >
                    <span style={{ fontSize: '13px', fontWeight: 500 }}>{card.name}</span>
                  </Checkbox>
                );
              })}
            </div>
          </div>
        ) : isAnalyzing ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: '16px' }}>
            <Spin size="large" />
            <div style={{ color: '#8c8882', fontSize: '14px' }}>
              正在深度提炼并收拢本次冒险中的关系与里程碑经历...
            </div>
          </div>
        ) : archiveAnalyses[selectedTargetCardId] ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* Target Character Card Sync Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#faf6f0', padding: '12px 16px', borderRadius: '8px', border: '1px solid #f2e8dc' }}>
              <strong style={{ color: '#33312e', fontSize: '14px' }}>选择要同步的角色卡：</strong>
              <Select
                value={selectedTargetCardId}
                onChange={handleTargetCardChange}
                style={{ width: 220 }}
                options={selectedCards.filter(c => tempSelectedCardIds.includes(c.id)).map(c => ({ value: c.id, label: c.name }))}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div style={{ border: '1px solid rgba(0,0,0,0.04)', padding: '12px', borderRadius: '6px', background: '#fafafa' }}>
                <div style={{ color: '#d97757', fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>关系变化提炼</div>
                <div style={{ fontSize: '13px', color: '#33312e', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{archiveAnalyses[selectedTargetCardId]?.relationChanges}</div>
              </div>
              <div style={{ border: '1px solid rgba(0,0,0,0.04)', padding: '12px', borderRadius: '6px', background: '#fafafa' }}>
                <div style={{ color: '#d97757', fontWeight: 600, fontSize: '13px', marginBottom: '8px' }}>里程碑事件提炼</div>
                <div style={{ fontSize: '13px', color: '#33312e', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{archiveAnalyses[selectedTargetCardId]?.eventChanges}</div>
              </div>
            </div>

            <div style={{ height: '1px', background: 'rgba(0,0,0,0.03)' }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#33312e', marginBottom: '6px' }}>本局冒险标题</div>
                <Input
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  placeholder="冒险标题"
                  style={{ borderRadius: '6px', borderColor: '#eae6df' }}
                />
              </div>

              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#33312e', marginBottom: '6px' }}>更新后的与用户关系类型（{selectedCards.find(c => c.id === selectedTargetCardId)?.name}）</div>
                <Input
                  value={editedRelationTypes[selectedTargetCardId] || ''}
                  onChange={(e) => setEditedRelationTypes(prev => ({ ...prev, [selectedTargetCardId]: e.target.value }))}
                  placeholder="与用户关系类型..."
                  style={{ borderRadius: '6px', borderColor: '#eae6df' }}
                />
              </div>

              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#33312e', marginBottom: '6px' }}>更新后的与用户相处模式（{selectedCards.find(c => c.id === selectedTargetCardId)?.name}）</div>
                <Input.TextArea
                  value={editedRelationModels[selectedTargetCardId] || ''}
                  onChange={(e) => setEditedRelationModels(prev => ({ ...prev, [selectedTargetCardId]: e.target.value }))}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  placeholder="与用户相处模式..."
                  style={{ borderRadius: '6px', borderColor: '#eae6df' }}
                />
              </div>

              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#33312e', marginBottom: '6px' }}>更新后的与用户关系底线（{selectedCards.find(c => c.id === selectedTargetCardId)?.name}）</div>
                <Input.TextArea
                  value={editedRelationBottomLines[selectedTargetCardId] || ''}
                  onChange={(e) => setEditedRelationBottomLines(prev => ({ ...prev, [selectedTargetCardId]: e.target.value }))}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  placeholder="与用户关系底线..."
                  style={{ borderRadius: '6px', borderColor: '#eae6df' }}
                />
              </div>

              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#33312e', marginBottom: '6px' }}>更新后的关键经历记录（{selectedCards.find(c => c.id === selectedTargetCardId)?.name}）</div>
                <Input.TextArea
                  value={editedEventsMap[selectedTargetCardId] || ''}
                  onChange={(e) => setEditedEventsMap(prev => ({ ...prev, [selectedTargetCardId]: e.target.value }))}
                  autoSize={{ minRows: 4, maxRows: 8 }}
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
          <CompassOutlined style={{ color: '#d97757', fontSize: 18 }} />
          <h3 style={{ margin: 0, fontWeight: 600, color: '#33312e', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sessionTitle}</span>
            {bookTravelStore.selectedMaterialId || bookTravelStore.scenes.length > 0 ? (
              <Tag color="#d97757" style={{ marginLeft: 8, borderRadius: 4, flexShrink: 0, whiteSpace: 'nowrap' }}>
                {bookTravelStore.scenes.length > 0
                  ? `穿书中 · ${bookTravelStore.scenes.find((s) => s.id === bookTravelStore.currentSceneId)?.title || '场景'}`
                  : '穿书准备中'}
              </Tag>
            ) : (
              <span style={{ fontSize: 12, color: '#8c8882', fontWeight: 400, flexShrink: 0, whiteSpace: 'nowrap' }}>
                ({selectedWorldBook?.name || '无世界书'} · {selectedCards.length}个活跃角色{dynamicRoleLoadingEnabled ? ' · 动态加载' : ''})
              </span>
            )}
          </h3>
        </div>

        <div className="agent-chat__header-actions">
          {selectedCards.length > 0 && (
            <Tooltip title={isSessionArchived ? "当前冒险记录已归档封存" : "封存本局冒险记忆并锁定会话"}>
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
          )}

          <Tooltip title="重开新冒险">
            <Button type="text" icon={<ReloadOutlined />} onClick={createNewSession} />
          </Tooltip>

          <Dropdown
            menu={{
              items: sessions.length > 0
                ? sessions.map((session) => ({
                  key: session.id,
                  label: (
                    <div className="agent-session-menu-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', minWidth: 200, padding: '4px 0' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', marginRight: 16 }}>
                        <strong style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{session.title}</strong>
                        <span style={{ fontSize: '11px', color: '#999', marginTop: 2 }}>
                          {session.savedAt ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(session.savedAt)) : '未保存'}
                        </span>
                      </div>
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteSession(session.id);
                        }}
                      />
                    </div>
                  ),
                }))
                : [{ key: 'empty', disabled: true, label: '暂无历史冒险' }],
              onClick: ({ key }) => {
                if (key !== 'empty') void openSession(String(key));
              },
            }}
            placement="bottomRight"
            trigger={['click']}
          >
            <Tooltip title="历史记录">
              <Button type="text" icon={<HistoryOutlined />} onClick={() => void refreshSessions()} />
            </Tooltip>
          </Dropdown>
        </div>
      </div>

      {/* Unified scrollable content area */}
      <div ref={chatHistoryRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {bookTravelStore.scenes.length > 0 ? (
          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Turns history */}
            {bookTravelStore.turns.map((turn) => (
              <div key={turn.id} style={{ marginBottom: 24 }}>
                <div style={{ textAlign: 'right', marginBottom: 8 }}>
                  <div style={{ display: 'inline-block', background: '#d97757', color: '#fff', padding: '10px 14px', borderRadius: '12px 12px 2px 12px', maxWidth: '80%', fontSize: 14, lineHeight: 1.6 }}>
                    {turn.userInput}
                  </div>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ display: 'inline-block', background: '#fff', border: '1px solid #eae6df', padding: '12px 14px', borderRadius: '12px 12px 12px 2px', maxWidth: '80%', color: '#33312e', fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                    {turn.narrativeOutput}
                  </div>
                </div>
              </div>
            ))}

            {/* Current scene info */}
            {!bookTravelStore.isCompleted && (() => {
              const currentScene = bookTravelStore.scenes.find((s) => s.id === bookTravelStore.currentSceneId);
              const currentBeat = currentScene?.beats.find((b) => b.id === bookTravelStore.currentBeatId) || currentScene?.beats[0];
              const currentState = (bookTravelStore.currentState || {}) as Record<string, unknown>;
              return currentScene && currentBeat ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {bookTravelStore.userCharacter && (
                    <Tag color="#d97757" style={{ borderRadius: 4, margin: 0, width: 'fit-content' }}>
                      扮演身份：{bookTravelStore.userCharacter.name}（{bookTravelStore.userCharacter.identity}）
                    </Tag>
                  )}
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: '#33312e' }}>{currentScene.title}</div>
                    <div style={{ color: '#8c8882', fontSize: 12, marginTop: 4 }}>
                      {[currentScene.time || String(currentState.time || ''), currentScene.location || String(currentState.location || ''), currentScene.currentSituation].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div style={{ border: '1px solid #eae6df', borderRadius: 8, background: '#ffffff', padding: '12px 14px', color: '#33312e', fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                    {currentBeat.content}
                  </div>
                </div>
              ) : null;
            })()}

            {/* Streaming output placeholder */}
            {(startProgressPhase === 'planner' || startProgressPhase === 'writer') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '16px', background: '#f5f3ef', borderRadius: 12, border: '1px dashed #ddd8d0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#8c8882', fontSize: 13 }}>
                  <Spin size="small" />
                  {startProgressPhase === 'planner' ? '🧠 剧情规划师正在分析你的行动...' : '✍️ 场景写手正在书写...'}
                  <span style={{ fontSize: 12, color: '#b8b3ab', fontFamily: 'monospace', marginLeft: 'auto' }}>
                    {formatElapsed(startElapsedMs)}
                  </span>
                </div>
                <div style={{ color: '#5c5751', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {startProgressPhase === 'planner' ? plannerOutput : writerOutput}
                  <span style={{ display: 'inline-block', width: 2, height: 14, background: '#d97757', marginLeft: 2, verticalAlign: 'middle', animation: 'blink 1s step-end infinite' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button size="small" onClick={handleCancelStart}>中断</Button>
                </div>
              </div>
            )}

            {startProgressPhase === 'error' && (
              <div style={{ padding: '12px 16px', background: '#fff2f0', borderRadius: 8, color: '#ff4d4f', fontSize: 14 }}>
                生成失败：{startProgressError}
              </div>
            )}

            {startProgressPhase === 'cancelled' && (
              <div style={{ padding: '12px 16px', background: '#f5f5f5', borderRadius: 8, color: '#8c8882', fontSize: 14 }}>
                已中断生成
              </div>
            )}
          </div>
        ) : (
          /* Book Travel Setup Wizard */
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '40px 24px',
            maxWidth: '720px',
            margin: '0 auto',
            width: '100%'
          }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <CompassOutlined style={{ fontSize: '56px', color: '#d97757', marginBottom: '16px', opacity: 0.9 }} />
            <h2 style={{ fontSize: '26px', fontWeight: 600, color: '#33312e', margin: '0 0 8px 0', letterSpacing: '-0.5px' }}>
              穿书页
            </h2>
            <p style={{ color: '#8c8882', fontSize: '15px', margin: 0 }}>
              选择穿书素材与入场点，进入小说世界展开独一无二的剧情体验
            </p>
          </div>

          <div style={{
            width: '100%',
            background: '#ffffff',
            border: '1px solid #eae6df',
            borderRadius: '12px',
            padding: '32px',
            boxShadow: '0 4px 24px rgba(217, 119, 87, 0.02)',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px'
          }}>
            {/* Select Assembled Material */}
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#33312e', marginBottom: '8px' }}>
                选择穿书素材
              </div>
              {bookTravelStore.assembledMaterials.length === 0 ? (
                <div style={{ color: '#8c8882', fontSize: '13px', textAlign: 'center', padding: '12px', border: '1px dashed #eae6df', borderRadius: '6px', background: '#faf9f5' }}>
                  暂无已装配素材，请先前往<Button type="link" style={{ padding: 0, height: 'auto' }} onClick={() => navigate('/book-travel-materials')}>穿书素材页</Button>装配素材
                </div>
              ) : (
                <Select
                  placeholder="选择一个已装配素材"
                  value={bookTravelStore.selectedMaterialId}
                  onChange={(id) => bookTravelStore.loadAssembledMaterial(id)}
                  style={{ width: '100%' }}
                  options={bookTravelStore.assembledMaterials.map((m) => ({ value: m.id, label: m.title }))}
                />
              )}
            </div>

            {/* Select Entry Point */}
            {bookTravelStore.selectedMaterialId && bookTravelStore.entryPoints.length > 0 && (
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#33312e', marginBottom: '8px' }}>
                  选择入场点
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {bookTravelStore.entryPoints.map((ep) => {
                    const selected = bookTravelStore.selectedEntryPointId === ep.id;
                    return (
                      <div
                        key={ep.id}
                        onClick={() => bookTravelStore.setSelectedEntryPointId(ep.id)}
                        style={{
                          padding: '12px 14px',
                          borderRadius: 8,
                          border: selected ? '1px solid #d97757' : '1px solid #eae6df',
                          background: selected ? '#fff7f2' : '#ffffff',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontWeight: 600, color: selected ? '#d97757' : '#33312e', fontSize: 14 }}>{ep.title}</div>
                        <div style={{ fontSize: 12, color: '#8c8882', marginTop: 4 }}>{ep.summary}</div>
                        {ep.risk && <div style={{ fontSize: 12, color: '#ff4d4f', marginTop: 4 }}>风险：{ep.risk}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Select User Character */}
            {bookTravelStore.selectedEntryPointId && (
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#33312e', marginBottom: '8px' }}>
                  选择扮演身份
                </div>
                {bookTravelStore.recommendedUserCharacters.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                    {bookTravelStore.recommendedUserCharacters.map((uc) => {
                      const selected = bookTravelStore.userCharacter?.name === uc.name;
                      return (
                        <Tag.CheckableTag
                          key={uc.name}
                          checked={selected}
                          onChange={(checked) => {
                            if (checked) bookTravelStore.setUserCharacter(uc);
                          }}
                          style={{
                            padding: '6px 14px',
                            fontSize: '13px',
                            border: selected ? '1px solid #d97757' : '1px solid #eae6df',
                            borderRadius: '6px',
                            backgroundColor: selected ? '#fff7f2' : '#faf9f5',
                            color: selected ? '#d97757' : '#5c5751',
                            margin: 0,
                            cursor: 'pointer'
                          }}
                        >
                          <UserOutlined style={{ marginRight: 6 }} />
                          {uc.name}（{uc.identity}）
                        </Tag.CheckableTag>
                      );
                    })}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Input
                    placeholder="姓名"
                    value={bookTravelStore.userCharacter?.name || ''}
                    onChange={(e) => bookTravelStore.setUserCharacter({ name: e.target.value, identity: bookTravelStore.userCharacter?.identity || '', goal: bookTravelStore.userCharacter?.goal || '' })}
                    style={{ flex: 1 }}
                  />
                  <Input
                    placeholder="身份"
                    value={bookTravelStore.userCharacter?.identity || ''}
                    onChange={(e) => bookTravelStore.setUserCharacter({ name: bookTravelStore.userCharacter?.name || '', identity: e.target.value, goal: bookTravelStore.userCharacter?.goal || '' })}
                    style={{ flex: 1 }}
                  />
                </div>
                <Input.TextArea
                  placeholder="目标（可选）"
                  value={bookTravelStore.userCharacter?.goal || ''}
                  onChange={(e) => bookTravelStore.setUserCharacter({ name: bookTravelStore.userCharacter?.name || '', identity: bookTravelStore.userCharacter?.identity || '', goal: e.target.value })}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  style={{ marginTop: 8 }}
                />
              </div>
            )}

            {/* Start Button */}
            <Button
              type="primary"
              size="large"
              icon={<PlayCircleOutlined />}
              onClick={startBookTravelAdventure}
              disabled={!bookTravelStore.selectedMaterialId || !bookTravelStore.selectedEntryPointId || !bookTravelStore.userCharacter?.name?.trim()}
              style={{
                backgroundColor: (bookTravelStore.selectedMaterialId && bookTravelStore.selectedEntryPointId && bookTravelStore.userCharacter?.name?.trim()) ? '#d97757' : undefined,
                borderColor: (bookTravelStore.selectedMaterialId && bookTravelStore.selectedEntryPointId && bookTravelStore.userCharacter?.name?.trim()) ? '#d97757' : undefined,
                borderRadius: '8px',
                fontWeight: 600,
                marginTop: '12px'
              }}
            >
              开始穿书
            </Button>
          </div>
        </div>
      )}
      </div>

      {/* Composer Input Area */}
      {(hasMessages || bookTravelStore.scenes.length > 0) && !bookTravelStore.isCompleted && (
        <div className="agent-composer" style={{
          padding: '16px 24px 24px 24px',
          width: '100%',
          boxSizing: 'border-box'
        }}>
          {/* Formatted Text input helper overlay inside composer box */}
          <div id="agent-composer-box" className="agent-composer__box" style={{
            boxShadow: '0 2px 12px rgba(0, 0, 0, 0.04)',
            border: '1px solid #eae6df',
            borderRadius: '12px',
            background: '#ffffff',
            position: 'relative',
            paddingTop: '40px' // Leave space for Segment Tabs
          }}>

            {/* Input Action Segment Controller */}
            <div style={{
              position: 'absolute',
              top: '8px',
              left: '12px',
              zIndex: 10,
              display: 'flex',
              gap: '6px'
            }}>
              <Radio.Group
                value={inputMode}
                onChange={(e) => setInputMode(e.target.value)}
                size="small"
                buttonStyle="solid"
              >
                <Radio.Button value="speech" style={{ borderRadius: '4px 0 0 4px' }}>
                  <CommentOutlined style={{ marginRight: 4 }} />
                  角色说话
                </Radio.Button>
                <Radio.Button value="behavior">
                  <ExperimentOutlined style={{ marginRight: 4 }} />
                  角色行为
                </Radio.Button>
                <Radio.Button value="plot" style={{ borderRadius: '0 4px 4px 0' }}>
                  <BranchesOutlined style={{ marginRight: 4 }} />
                  剧情客观推进
                </Radio.Button>
              </Radio.Group>
            </div>

            <Input.TextArea
              className="agent-composer__textarea"
              autoSize={{ minRows: 1, maxRows: 8 }}
              disabled={isSessionArchived}
              onChange={(e) => setInput(e.target.value)}
              style={{ zIndex: 2, position: 'relative', background: 'transparent', boxShadow: 'none', border: 'none', padding: '12px 16px 40px 16px', fontSize: '15px' }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={
                isSessionArchived
                  ? "本局冒险记忆已被封存，无法继续发送指令"
                  : bookTravelStore.scenes.length > 0
                    ? inputMode === 'speech'
                      ? "说些什么..."
                      : inputMode === 'behavior'
                        ? "做点什么..."
                        : "推进剧情..."
                    : inputMode === 'speech'
                      ? "以你角色的口吻输入对话内容，按 Cmd/Ctrl + Enter 提交..."
                      : inputMode === 'behavior'
                        ? "描述你角色采取的具体动作（例如：撬门、施法、隐蔽等）..."
                        : "以旁白口吻描述剧情推进（例如：天空突然放晴、怪物发动袭击等）..."
              }
              value={input}
            />

            <div className="agent-composer__actions" style={{ position: 'absolute', bottom: '12px', left: '16px', right: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 3 }}>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: '#8c8882' }}>
                  当前模式：
                  <Tag color="orange" style={{ margin: 0 }}>
                    {inputMode === 'speech' ? '说话 (我：“内容”)' : inputMode === 'behavior' ? '动作 (（我 内容）)' : '第三方剧情推进'}
                  </Tag>
                </span>
              </div>

              <div className="agent-send-cluster" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Tooltip color="#fff" placement="topRight" title={contextTooltip} overlayInnerStyle={{ width: 'max-content', maxWidth: 320, padding: '8px 12px', border: '1px solid #eae6df' }}>
                  <button
                    aria-label="查看上下文"
                    className="agent-context-ring"
                    style={{ '--context-fill': `${contextPercent}%` } as React.CSSProperties}
                    type="button"
                  >
                    <span>{contextPercent}%</span>
                  </button>
                </Tooltip>

                <Tooltip title={isStreaming ? '停止' : isSessionArchived ? '当前故事已归档' : '提交行动'}>
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
      )}
    </div>
  );
};

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
export default Story;
