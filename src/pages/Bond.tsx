import React, { useState, useEffect, useMemo } from 'react';
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

const DIRECTORY_WIDTH = 260;
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

const renderRelationOverview = (item: PartnerItem) => {
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

const renderTimeline = (item: PartnerItem) => {
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

const Bond: React.FC = () => {
  const { worldBooks, characterCards } = usePartnerStore();
  const { selectedCharacterCardId, setSelectedCharacterCardId } = usePartnerChatStore();

  const [selectedId, setSelectedId] = useState<string | null>(selectedCharacterCardId);
  const [expandedCharacterGroupKeys, setExpandedCharacterGroupKeys] = useState<React.Key[]>([]);
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [expandedRecord, setExpandedRecord] = useState<AgentSessionRecord | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingRecord, setLoadingRecord] = useState(false);

  const [adventures, setAdventures] = useState<AgentSessionSummary[]>([]);
  const [expandedAdventureId, setExpandedAdventureId] = useState<string | null>(null);
  const [expandedAdventureRecord, setExpandedAdventureRecord] = useState<AgentSessionRecord | null>(null);
  const [loadingAdventures, setLoadingAdventures] = useState(false);
  const [loadingAdventureRecord, setLoadingAdventureRecord] = useState(false);

  // Sync with partner chat store selection
  useEffect(() => {
    setSelectedId((currentId) => {
      if (selectedCharacterCardId && characterCards.some((card) => card.id === selectedCharacterCardId)) {
        return selectedCharacterCardId;
      }
      if (currentId && characterCards.some((card) => card.id === currentId)) {
        return currentId;
      }
      return characterCards[0]?.id ?? null;
    });
  }, [selectedCharacterCardId, characterCards]);

  // Load partner chat sessions and story adventures
  useEffect(() => {
    const loadSessions = async () => {
      setLoadingSessions(true);
      try {
        const summaries = await invoke<AgentSessionSummary[]>('list_agent_sessions', {
          prefix: 'partner-session-',
        });
        setSessions(summaries);
      } catch (err) {
        console.error('加载会话列表失败:', err);
      } finally {
        setLoadingSessions(false);
      }
    };
    const loadAdventures = async () => {
      setLoadingAdventures(true);
      try {
        const summaries = await invoke<AgentSessionSummary[]>('list_agent_sessions', {
          prefix: 'story-session-',
        });
        setAdventures(summaries);
      } catch (err) {
        console.error('加载冒险列表失败:', err);
      } finally {
        setLoadingAdventures(false);
      }
    };
    loadSessions();
    loadAdventures();
  }, []);

  const selectedCharacter = characterCards.find((c) => c.id === selectedId);
  const characterCardGroups = useMemo(
    () => groupCharacterCardsByWorldBook(worldBooks, characterCards),
    [worldBooks, characterCards],
  );
  const characterCardGroupKeys = useMemo(
    () => characterCardGroups.map((group) => group.key),
    [characterCardGroups],
  );
  const selectedCharacterGroupKey = characterCardGroups.find((group) =>
    group.cards.some((card) => card.id === selectedId)
  )?.key;

  useEffect(() => {
    setExpandedCharacterGroupKeys((keys) => keys.filter((key) => characterCardGroupKeys.includes(String(key))));
  }, [characterCardGroupKeys]);

  useEffect(() => {
    if (!selectedCharacterGroupKey) return;
    setExpandedCharacterGroupKeys((keys) =>
      keys.includes(selectedCharacterGroupKey) ? keys : [...keys, selectedCharacterGroupKey]
    );
  }, [selectedCharacterGroupKey]);

  const handleSelectCharacter = (id: string) => {
    setSelectedId(id);
    setSelectedCharacterCardId(id);
    setExpandedSessionId(null);
    setExpandedRecord(null);
    setExpandedAdventureId(null);
    setExpandedAdventureRecord(null);
  };

  const toggleCharacterGroup = (groupKey: string) => {
    setExpandedCharacterGroupKeys((keys) =>
      keys.includes(groupKey) ? keys.filter((key) => key !== groupKey) : [...keys, groupKey]
    );
  };

  const renderCharacterTreeTitle = (item: PartnerItem) => {
    const isSelected = selectedId === item.id;
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 10px',
          borderRadius: 8,
          cursor: 'pointer',
          background: isSelected ? '#f2e8dc' : 'transparent',
          color: isSelected ? '#d97757' : '#33312e',
          transition: 'background-color 0.2s cubic-bezier(0.25, 0.8, 0.25, 1), color 0.2s cubic-bezier(0.25, 0.8, 0.25, 1)',
        }}
        className="bond-directory-item"
      >
        <UserOutlined
          style={{
            fontSize: 15,
            flexShrink: 0,
            color: isSelected ? '#d97757' : '#8c8882',
          }}
        />
        <span
          style={{
            fontSize: 13,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontWeight: isSelected ? 500 : 400,
          }}
        >
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

  const renderCharacterDirectory = () => (
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
            onExpand={(keys) => setExpandedCharacterGroupKeys(keys)}
            selectedKeys={selectedId ? [selectedId] : []}
            onClick={(_, node) => {
              const nextKey = String(node.key);
              if (characterCardGroupKeys.includes(nextKey)) {
                toggleCharacterGroup(nextKey);
              }
            }}
            onSelect={(_, info) => {
              const nextId = String(info.node.key || '');
              if (characterCards.some((card) => card.id === nextId)) {
                handleSelectCharacter(nextId);
              }
            }}
            treeData={characterTreeData}
            style={{ background: 'transparent', padding: '0 8px' }}
          />
        )}
      </div>
    </div>
  );

  const renderSessionHistory = () => {
    const filteredSessions = sessions.filter((s) => s.characterCardId === selectedId);
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
                    onClick={() => handleExpandSession(session.id)}
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
                                {msg.role === 'user' ? '我' : selectedCharacter?.name || '角色'}
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

  const renderAdventureHistory = () => {
    const filteredAdventures = adventures.filter((s) =>
      s.characterCardIds?.includes(selectedId || '')
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
                    onClick={() => handleExpandAdventure(adventure.id)}
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

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        background: '#faf9f5',
      }}
    >
      <style>{`
        .bond-directory-item:hover {
          background-color: #faf6f0;
        }
        .bond-character-tree .ant-tree-node-content-wrapper {
          padding: 0;
        }
        .bond-character-tree .ant-tree-node-content-wrapper.ant-tree-node-selected {
          background: transparent;
        }
        .bond-character-tree .ant-tree-treenode {
          padding: 1px 0;
        }
      `}</style>
      {renderCharacterDirectory()}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 32px',
        }}
      >
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

            {renderRelationOverview(selectedCharacter)}
            {renderTimeline(selectedCharacter)}
            {renderSessionHistory()}
            {renderAdventureHistory()}
          </div>
        )}
      </div>
    </div>
  );
};

export default Bond;
