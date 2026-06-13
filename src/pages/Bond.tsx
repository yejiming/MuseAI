import React, { useCallback, useEffect, useMemo } from 'react';
import { Card, Empty, Timeline, Spin, Tooltip, Tree } from 'antd';
import {
  HeartOutlined,
  UserOutlined,
  ClockCircleOutlined,
  MessageOutlined,
  CompassOutlined,
  LinkOutlined,
  SafetyOutlined,
  BookOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { usePartnerStore, PartnerItem } from '../stores/usePartnerStore';
import { usePartnerChatStore } from '../stores/usePartnerChatStore';
import { AgentSessionSummary, AgentSessionRecord } from '../stores/useAgentStore';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { groupCharacterCardsByWorldBook } from '../utils/characterCardGroups';
import { useStateGroup } from '../utils/reducerState';

const DIRECTORY_WIDTH = 260;
interface BondUiState {
  selectedId: string | null;
  expandedCharacterGroupKeys: React.Key[];
  sessions: AgentSessionSummary[];
  expandedSessionId: string | null;
  expandedRecord: AgentSessionRecord | null;
  loadingSessions: boolean;
  loadingRecord: boolean;
  adventures: AgentSessionSummary[];
  expandedAdventureId: string | null;
  expandedAdventureRecord: AgentSessionRecord | null;
  loadingAdventures: boolean;
  loadingAdventureRecord: boolean;
}

const HISTORY_TOGGLE_BUTTON_STYLE: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  cursor: 'pointer',
  border: 0,
  background: 'transparent',
  textAlign: 'left',
  fontFamily: 'inherit',
};

const parseKeyEvents = (text?: string): string[] => {
  if (!text || !text.trim()) return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter((line) => line.length > 0);
};

const formatDate = (timestamp: number) => {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const RelationOverview: React.FC<{ item: PartnerItem }> = ({ item }) => {
  const fields = item.fields || {};
  return (
    <Card
      className="custom-form-card"
      title={
        <span className="form-section-title">
          <HeartOutlined style={{ color: '#d97757' }} /> 关系概览
        </span>
      }
      size="small"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div className="input-label">关系类型</div>
          {fields.userRelationType ? (
            <div
              style={{
                fontSize: 13,
                color: '#d97757',
                lineHeight: 1.7,
                wordBreak: 'break-all',
              }}
            >
              {fields.userRelationType}
            </div>
          ) : (
            <span style={{ color: '#bfbfbf', fontSize: 13 }}>尚未设定</span>
          )}
        </div>
        <div>
          <div className="input-label">
            <LinkOutlined style={{ fontSize: 11, marginRight: 4 }} />
            相处模式
          </div>
          <div
            style={{
              fontSize: 13,
              color: fields.userInteractionModel ? '#33312e' : '#bfbfbf',
              lineHeight: 1.7,
              wordBreak: 'break-all',
            }}
          >
            {fields.userInteractionModel || '尚未设定'}
          </div>
        </div>
        <div>
          <div className="input-label">
            <SafetyOutlined style={{ fontSize: 11, marginRight: 4 }} />
            关系底线
          </div>
          <div
            style={{
              fontSize: 13,
              color: fields.userRelationBottomLine ? '#33312e' : '#bfbfbf',
              lineHeight: 1.7,
              wordBreak: 'break-all',
            }}
          >
            {fields.userRelationBottomLine || '尚未设定'}
          </div>
        </div>
      </div>
    </Card>
  );
};

const CharacterTimeline: React.FC<{ item: PartnerItem }> = ({ item }) => {
  const events = parseKeyEvents(item.fields?.keyEvents);
  return (
    <Card
      className="custom-form-card"
      title={
        <span className="form-section-title">
          <ClockCircleOutlined style={{ color: '#d97757' }} /> 羁绊时间线
        </span>
      }
      size="small"
    >
      {events.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无关键事件记录"
          style={{ margin: '24px 0' }}
        />
      ) : (
        <Timeline
          items={events.map((event, idx) => ({
            key: idx,
            color: idx === 0 ? '#d97757' : '#8c8882',
            children: (
              <div
                style={{
                  fontSize: 13,
                  color: '#33312e',
                  lineHeight: 1.7,
                }}
              >
                {event}
              </div>
            ),
          }))}
        />
      )}
    </Card>
  );
};

interface CharacterDirectoryProps {
  characterCards: PartnerItem[];
  expandedCharacterGroupKeys: React.Key[];
  selectedId: string | null;
  characterCardGroupKeys: string[];
  characterTreeData: React.ComponentProps<typeof Tree>['treeData'];
  onExpand: (keys: React.Key[]) => void;
  onToggleGroup: (groupKey: string) => void;
  onSelectCharacter: (id: string) => void;
}

const CharacterDirectory: React.FC<CharacterDirectoryProps> = ({
  characterCards,
  expandedCharacterGroupKeys,
  selectedId,
  characterCardGroupKeys,
  characterTreeData,
  onExpand,
  onToggleGroup,
  onSelectCharacter,
}) => (
  <div
    style={{
      width: DIRECTORY_WIDTH,
      minWidth: DIRECTORY_WIDTH,
      borderRight: '1px solid rgba(0,0,0,0.04)',
      background: '#faf9f5',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}
  >
    <div
      style={{
        padding: '16px 12px 8px',
        fontSize: 12,
        fontWeight: 600,
        color: '#8c8882',
        letterSpacing: 1,
        textTransform: 'uppercase',
      }}
    >
      角色羁绊
    </div>
    <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 16 }}>
      {characterCards.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无角色卡"
          style={{ marginTop: 40 }}
        />
      ) : (
        <Tree
          className="bond-character-tree"
          expandedKeys={expandedCharacterGroupKeys}
          onExpand={(keys) => onExpand(keys)}
          selectedKeys={selectedId ? [selectedId] : []}
          onClick={(_, node) => {
            const nextKey = String(node.key);
            if (characterCardGroupKeys.includes(nextKey)) {
              onToggleGroup(nextKey);
            }
          }}
          onSelect={(_, info) => {
            const nextId = String(info.node.key || '');
            if (characterCards.some((card) => card.id === nextId)) {
              onSelectCharacter(nextId);
            }
          }}
          treeData={characterTreeData}
          style={{ background: 'transparent', padding: '0 8px' }}
        />
      )}
    </div>
  </div>
);

interface SessionHistoryProps {
  sessions: AgentSessionSummary[];
  selectedId: string | null;
  expandedSessionId: string | null;
  expandedRecord: AgentSessionRecord | null;
  loadingSessions: boolean;
  loadingRecord: boolean;
  selectedCharacterName: string | null;
  onExpandSession: (id: string) => void | Promise<void>;
}

const SessionHistory: React.FC<SessionHistoryProps> = ({
  sessions,
  selectedId,
  expandedSessionId,
  expandedRecord,
  loadingSessions,
  loadingRecord,
  selectedCharacterName,
  onExpandSession,
}) => {
  const filteredSessions = sessions.filter((session) => session.characterCardId === selectedId);
  return (
    <Card
      className="custom-form-card"
      title={
        <span className="form-section-title">
          <MessageOutlined style={{ color: '#d97757' }} /> 会话足迹
        </span>
      }
      size="small"
    >
      {loadingSessions ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin size="small" />
        </div>
      ) : filteredSessions.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无与该角色的聊天会话"
          style={{ margin: '24px 0' }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filteredSessions.map((session) => {
            const isExpanded = expandedSessionId === session.id;
            return (
              <div
                key={session.id}
                style={{
                  borderRadius: 8,
                  border: '1px solid rgba(0,0,0,0.04)',
                  background: isExpanded ? '#faf9f5' : '#fff',
                  transition: 'background-color 0.2s, border-color 0.2s',
                }}
              >
                <button
                  type="button"
                  onClick={() => { void onExpandSession(session.id); }}
                  style={HISTORY_TOGGLE_BUTTON_STYLE}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <BookOutlined style={{ color: '#8c8882', fontSize: 13, flexShrink: 0 }} />
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: '#33312e',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {session.title}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <span style={{ fontSize: 12, color: '#bfbfbf' }}>
                      {formatDate(session.savedAt)}
                    </span>
                    <Tooltip title="查看详情">
                      <EyeOutlined
                        style={{
                          fontSize: 13,
                          color: isExpanded ? '#d97757' : '#bfbfbf',
                        }}
                      />
                    </Tooltip>
                  </div>
                </button>
                {isExpanded && (
                  <div style={{ padding: '0 16px 16px' }}>
                    {loadingRecord && !expandedRecord ? (
                      <div style={{ textAlign: 'center', padding: 16 }}>
                        <Spin size="small" />
                      </div>
                    ) : expandedRecord ? (
                      <div
                        style={{
                          background: '#fff',
                          borderRadius: 6,
                          padding: 12,
                          maxHeight: 320,
                          overflowY: 'auto',
                          border: '1px solid rgba(0,0,0,0.03)',
                        }}
                      >
                        {expandedRecord.messages.map((msg, idx) => (
                          <div
                            key={msg.id || idx}
                            style={{
                              marginBottom: 12,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                            }}
                          >
                            <div
                              style={{
                                maxWidth: '85%',
                                padding: '8px 12px',
                                borderRadius: 8,
                                background: msg.role === 'user' ? '#f2e8dc' : '#f5f5f5',
                                color: '#33312e',
                                fontSize: 13,
                                lineHeight: 1.6,
                              }}
                            >
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {msg.content}
                              </ReactMarkdown>
                            </div>
                            <span
                              style={{
                                fontSize: 11,
                                color: '#bfbfbf',
                                marginTop: 4,
                              }}
                            >
                              {msg.role === 'user' ? '我' : selectedCharacterName || '角色'}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};

interface AdventureHistoryProps {
  adventures: AgentSessionSummary[];
  selectedId: string | null;
  expandedAdventureId: string | null;
  expandedAdventureRecord: AgentSessionRecord | null;
  loadingAdventures: boolean;
  loadingAdventureRecord: boolean;
  onExpandAdventure: (id: string) => void | Promise<void>;
}

const AdventureHistory: React.FC<AdventureHistoryProps> = ({
  adventures,
  selectedId,
  expandedAdventureId,
  expandedAdventureRecord,
  loadingAdventures,
  loadingAdventureRecord,
  onExpandAdventure,
}) => {
  const filteredAdventures = adventures.filter((session) =>
    session.characterCardIds?.includes(selectedId || '')
  );
  return (
    <Card
      className="custom-form-card"
      title={
        <span className="form-section-title">
          <CompassOutlined style={{ color: '#d97757' }} /> 冒险足迹
        </span>
      }
      size="small"
    >
      {loadingAdventures ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin size="small" />
        </div>
      ) : filteredAdventures.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无与该角色的冒险记录"
          style={{ margin: '24px 0' }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filteredAdventures.map((adventure) => {
            const isExpanded = expandedAdventureId === adventure.id;
            return (
              <div
                key={adventure.id}
                style={{
                  borderRadius: 8,
                  border: '1px solid rgba(0,0,0,0.04)',
                  background: isExpanded ? '#faf9f5' : '#fff',
                  transition: 'background-color 0.2s, border-color 0.2s',
                }}
              >
                <button
                  type="button"
                  onClick={() => { void onExpandAdventure(adventure.id); }}
                  style={HISTORY_TOGGLE_BUTTON_STYLE}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <BookOutlined style={{ color: '#8c8882', fontSize: 13, flexShrink: 0 }} />
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: '#33312e',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {adventure.title}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <span style={{ fontSize: 12, color: '#bfbfbf' }}>
                      {formatDate(adventure.savedAt)}
                    </span>
                    <Tooltip title="查看详情">
                      <EyeOutlined
                        style={{
                          fontSize: 13,
                          color: isExpanded ? '#d97757' : '#bfbfbf',
                        }}
                      />
                    </Tooltip>
                  </div>
                </button>
                {isExpanded && (
                  <div style={{ padding: '0 16px 16px' }}>
                    {loadingAdventureRecord && !expandedAdventureRecord ? (
                      <div style={{ textAlign: 'center', padding: 16 }}>
                        <Spin size="small" />
                      </div>
                    ) : expandedAdventureRecord ? (
                      <div
                        style={{
                          background: '#fff',
                          borderRadius: 6,
                          padding: 12,
                          maxHeight: 320,
                          overflowY: 'auto',
                          border: '1px solid rgba(0,0,0,0.03)',
                        }}
                      >
                        {expandedAdventureRecord.messages.map((msg, idx) => (
                          <div
                            key={msg.id || idx}
                            style={{
                              marginBottom: 12,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                            }}
                          >
                            <div
                              style={{
                                maxWidth: '85%',
                                padding: '8px 12px',
                                borderRadius: 8,
                                background: msg.role === 'user' ? '#f2e8dc' : '#f5f5f5',
                                color: '#33312e',
                                fontSize: 13,
                                lineHeight: 1.6,
                              }}
                            >
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {msg.content}
                              </ReactMarkdown>
                            </div>
                            <span
                              style={{
                                fontSize: 11,
                                color: '#bfbfbf',
                                marginTop: 4,
                              }}
                            >
                              {msg.role === 'user' ? '我' : '叙事者'}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};

const Bond: React.FC = () => {
  const { worldBooks, characterCards } = usePartnerStore();
  const { selectedCharacterCardId, setSelectedCharacterCardId } = usePartnerChatStore();

  const [uiState, patchUiState, setUiField] = useStateGroup<BondUiState>({
    selectedId: selectedCharacterCardId,
    expandedCharacterGroupKeys: [],
    sessions: [],
    expandedSessionId: null,
    expandedRecord: null,
    loadingSessions: false,
    loadingRecord: false,
    adventures: [],
    expandedAdventureId: null,
    expandedAdventureRecord: null,
    loadingAdventures: false,
    loadingAdventureRecord: false,
  });
  const {
    selectedId,
    expandedCharacterGroupKeys,
    sessions,
    expandedSessionId,
    expandedRecord,
    loadingSessions,
    loadingRecord,
    adventures,
    expandedAdventureId,
    expandedAdventureRecord,
    loadingAdventures,
    loadingAdventureRecord,
  } = uiState;
  const setExpandedCharacterGroupKeys = (expandedCharacterGroupKeys: React.SetStateAction<React.Key[]>) => setUiField('expandedCharacterGroupKeys', expandedCharacterGroupKeys);
  const setExpandedSessionId = (expandedSessionId: string | null) => setUiField('expandedSessionId', expandedSessionId);
  const setExpandedRecord = (expandedRecord: AgentSessionRecord | null) => setUiField('expandedRecord', expandedRecord);
  const setLoadingRecord = (loadingRecord: boolean) => setUiField('loadingRecord', loadingRecord);
  const setExpandedAdventureId = (expandedAdventureId: string | null) => setUiField('expandedAdventureId', expandedAdventureId);
  const setExpandedAdventureRecord = (expandedAdventureRecord: AgentSessionRecord | null) => setUiField('expandedAdventureRecord', expandedAdventureRecord);
  const setLoadingAdventureRecord = (loadingAdventureRecord: boolean) => setUiField('loadingAdventureRecord', loadingAdventureRecord);

  const characterCardGroups = useMemo(
    () => groupCharacterCardsByWorldBook(worldBooks, characterCards),
    [worldBooks, characterCards],
  );
  const characterCardGroupKeys = useMemo(
    () => characterCardGroups.map((group) => group.key),
    [characterCardGroups],
  );
  const getCharacterGroupKey = useCallback((id: string | null) => characterCardGroups.find((group) =>
    group.cards.some((card) => card.id === id)
  )?.key, [characterCardGroups]);
  const expandCharacterGroupForId = useCallback((id: string | null) => {
    const groupKey = getCharacterGroupKey(id);
    if (!groupKey) return;
    setUiField('expandedCharacterGroupKeys', (keys) =>
      keys.includes(groupKey) ? keys : [...keys, groupKey]
    );
  }, [getCharacterGroupKey, setUiField]);

  // Sync with partner chat store selection
  useEffect(() => {
    patchUiState((state) => {
      let nextId: string | null;
      if (selectedCharacterCardId && characterCards.some((card) => card.id === selectedCharacterCardId)) {
        nextId = selectedCharacterCardId;
      } else if (state.selectedId && characterCards.some((card) => card.id === state.selectedId)) {
        nextId = state.selectedId;
      } else {
        nextId = characterCards[0]?.id ?? null;
      }
      const groupKey = getCharacterGroupKey(nextId);
      return {
        ...state,
        selectedId: nextId,
        expandedCharacterGroupKeys: groupKey && !state.expandedCharacterGroupKeys.includes(groupKey)
          ? [...state.expandedCharacterGroupKeys, groupKey]
          : state.expandedCharacterGroupKeys,
      };
    });
  }, [patchUiState, selectedCharacterCardId, characterCards, getCharacterGroupKey]);

  // Load partner chat sessions and story adventures
  useEffect(() => {
    const loadSessions = async () => {
      patchUiState({ loadingSessions: true });
      try {
        const summaries = await invoke<AgentSessionSummary[]>('list_agent_sessions', {
          prefix: 'partner-session-',
        });
        patchUiState({ sessions: summaries });
      } catch (err) {
        console.error('加载会话列表失败:', err);
      } finally {
        patchUiState({ loadingSessions: false });
      }
    };
    const loadAdventures = async () => {
      patchUiState({ loadingAdventures: true });
      try {
        const summaries = await invoke<AgentSessionSummary[]>('list_agent_sessions', {
          prefix: 'story-session-',
        });
        patchUiState({ adventures: summaries });
      } catch (err) {
        console.error('加载冒险列表失败:', err);
      } finally {
        patchUiState({ loadingAdventures: false });
      }
    };
    loadSessions();
    loadAdventures();
  }, [patchUiState]);

  const selectedCharacter = characterCards.find((c) => c.id === selectedId);

  useEffect(() => {
    setUiField('expandedCharacterGroupKeys', (keys) => keys.filter((key) => characterCardGroupKeys.includes(String(key))));
  }, [characterCardGroupKeys, setUiField]);

  const handleSelectCharacter = (id: string) => {
    patchUiState({
      selectedId: id,
      expandedSessionId: null,
      expandedRecord: null,
      expandedAdventureId: null,
      expandedAdventureRecord: null,
    });
    setSelectedCharacterCardId(id);
    expandCharacterGroupForId(id);
  };

  const toggleCharacterGroup = (groupKey: string) => {
    setExpandedCharacterGroupKeys((keys) =>
      keys.includes(groupKey) ? keys.filter((key) => key !== groupKey) : [...keys, groupKey]
    );
  };

  const renderCharacterTreeTitle = (item: PartnerItem) => {
    const isSelected = selectedId === item.id;
    return (
      <div className={`bond-directory-item ${isSelected ? 'is-selected' : ''}`}>
        <UserOutlined
          style={{
            fontSize: 15,
            flexShrink: 0,
            color: isSelected ? '#d97757' : '#8c8882',
          }}
        />
        <span className="bond-directory-item__name">
          {item.name}
        </span>
      </div>
    );
  };

  const characterTreeData = characterCardGroups.map((group) => ({
    key: group.key,
    selectable: false,
    title: (
      <span
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#8c8882', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
      >
        <BookOutlined style={{ fontSize: 13, color: group.worldBookId ? '#d97757' : '#c0bbb4' }} />
        {group.title}
      </span>
    ),
    children: group.cards.map((card) => ({
      key: card.id,
      title: renderCharacterTreeTitle(card),
      isLeaf: true,
    })),
  }));

  const handleExpandSession = async (id: string) => {
    if (expandedSessionId === id) {
      setExpandedSessionId(null);
      setExpandedRecord(null);
      return;
    }
    setExpandedSessionId(id);
    setLoadingRecord(true);
    try {
      const record = await invoke<AgentSessionRecord>('load_agent_session', { id });
      setExpandedRecord(record);
    } catch (err) {
      console.error('加载会话详情失败:', err);
    } finally {
      setLoadingRecord(false);
    }
  };

  const handleExpandAdventure = async (id: string) => {
    if (expandedAdventureId === id) {
      setExpandedAdventureId(null);
      setExpandedAdventureRecord(null);
      return;
    }
    setExpandedAdventureId(id);
    setLoadingAdventureRecord(true);
    try {
      const record = await invoke<AgentSessionRecord>('load_agent_session', { id });
      setExpandedAdventureRecord(record);
    } catch (err) {
      console.error('加载冒险详情失败:', err);
    } finally {
      setLoadingAdventureRecord(false);
    }
  };

  return (
    <div className="bond-page">
      <CharacterDirectory
        characterCards={characterCards}
        expandedCharacterGroupKeys={expandedCharacterGroupKeys}
        selectedId={selectedId}
        characterCardGroupKeys={characterCardGroupKeys}
        characterTreeData={characterTreeData}
        onExpand={setExpandedCharacterGroupKeys}
        onToggleGroup={toggleCharacterGroup}
        onSelectCharacter={handleSelectCharacter}
      />
      <div className="bond-content">
        {!selectedCharacter ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="请在左侧选择一个角色"
            style={{ marginTop: 80 }}
          />
        ) : (
          <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: '#f2e8dc',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <UserOutlined style={{ fontSize: 18, color: '#d97757' }} />
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#33312e' }}>
                  {selectedCharacter.name}
                </div>
                <div style={{ fontSize: 12, color: '#8c8882', marginTop: 2 }}>
                  {selectedCharacter.fields?.identityTags?.join(' · ') || '暂无身份标签'}
                </div>
              </div>
            </div>

            <RelationOverview item={selectedCharacter} />
            <CharacterTimeline item={selectedCharacter} />
            <SessionHistory
              sessions={sessions}
              selectedId={selectedId}
              expandedSessionId={expandedSessionId}
              expandedRecord={expandedRecord}
              loadingSessions={loadingSessions}
              loadingRecord={loadingRecord}
              selectedCharacterName={selectedCharacter.name}
              onExpandSession={handleExpandSession}
            />
            <AdventureHistory
              adventures={adventures}
              selectedId={selectedId}
              expandedAdventureId={expandedAdventureId}
              expandedAdventureRecord={expandedAdventureRecord}
              loadingAdventures={loadingAdventures}
              loadingAdventureRecord={loadingAdventureRecord}
              onExpandAdventure={handleExpandAdventure}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default Bond;
