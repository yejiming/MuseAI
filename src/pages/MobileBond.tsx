import React, { useState, useEffect } from 'react';
import { Select, Card, Empty, Timeline, Spin } from 'antd';
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
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { usePartnerStore } from '../stores/usePartnerStore';
import { usePartnerChatStore } from '../stores/usePartnerChatStore';
import { appInvoke } from '../utils/runtime';
import type { AgentSessionSummary, AgentSessionRecord } from '../stores/useAgentStore';

const MobileBond: React.FC = () => {
  const { characterCards } = usePartnerStore();
  const { selectedCharacterCardId, setSelectedCharacterCardId } = usePartnerChatStore();

  const [selectedId, setSelectedId] = useState<string | null>(selectedCharacterCardId);
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [adventures, setAdventures] = useState<AgentSessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingAdventures, setLoadingAdventures] = useState(false);

  // Expanded details state
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [expandedRecord, setExpandedRecord] = useState<AgentSessionRecord | null>(null);
  const [loadingRecord, setLoadingRecord] = useState(false);

  const [expandedAdventureId, setExpandedAdventureId] = useState<string | null>(null);
  const [expandedAdventureRecord, setExpandedAdventureRecord] = useState<AgentSessionRecord | null>(null);
  const [loadingAdventureRecord, setLoadingAdventureRecord] = useState(false);

  useEffect(() => {
    if (selectedCharacterCardId && characterCards.some(c => c.id === selectedCharacterCardId)) {
      setSelectedId(selectedCharacterCardId);
    } else if (characterCards.length > 0 && !selectedId) {
      setSelectedId(characterCards[0].id);
    }
  }, [selectedCharacterCardId, characterCards]);

  useEffect(() => {
    const loadData = async () => {
      setLoadingSessions(true);
      setLoadingAdventures(true);

      // Reload partner store from backend to ensure latest character cards
      try {
        const partnerStoreContent = await appInvoke<string>('load_app_state', { name: 'partner-store' });
        if (partnerStoreContent) {
          const parsed = JSON.parse(partnerStoreContent);
          if (parsed.state) {
            usePartnerStore.setState(parsed.state);
          }
        }
      } catch (err) {
        console.error('加载角色卡数据失败:', err);
      }

      try {
        const summaries = await appInvoke<AgentSessionSummary[]>('list_agent_sessions', { prefix: 'partner-session-' });
        setSessions(summaries);
      } catch (err) {
        console.error('加载会话足迹失败:', err);
      } finally {
        setLoadingSessions(false);
      }

      try {
        const summaries = await appInvoke<AgentSessionSummary[]>('list_agent_sessions', { prefix: 'story-session-' });
        setAdventures(summaries);
      } catch (err) {
        console.error('加载冒险足迹失败:', err);
      } finally {
        setLoadingAdventures(false);
      }
    };
    loadData();
  }, []);

  const handleSelectCharacter = (id: string) => {
    setSelectedId(id);
    setSelectedCharacterCardId(id);
    setExpandedSessionId(null);
    setExpandedRecord(null);
    setExpandedAdventureId(null);
    setExpandedAdventureRecord(null);
  };

  const handleExpandSession = async (id: string) => {
    if (expandedSessionId === id) {
      setExpandedSessionId(null);
      setExpandedRecord(null);
      return;
    }
    setExpandedSessionId(id);
    setLoadingRecord(true);
    try {
      const record = await appInvoke<AgentSessionRecord>('load_agent_session', { id });
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
      const record = await appInvoke<AgentSessionRecord>('load_agent_session', { id });
      setExpandedAdventureRecord(record);
    } catch (err) {
      console.error('加载冒险详情失败:', err);
    } finally {
      setLoadingAdventureRecord(false);
    }
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

  const selectedCharacter = characterCards.find((c) => c.id === selectedId);

  return (
    <div style={{
      padding: '16px',
      backgroundColor: '#faf9f5',
      height: '100%',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
    }}>
      {/* Character Selector */}
      <div style={{
        padding: '12px 16px',
        backgroundColor: '#fff',
        borderRadius: '12px',
        border: '1px solid rgba(217, 119, 87, 0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: '13px', color: '#8c8880', fontWeight: 600 }}>选择羁绊角色</div>
        <Select
          value={selectedId}
          onChange={handleSelectCharacter}
          style={{ width: '100%', fontSize: '16px' }}
          placeholder="切换角色..."
          options={characterCards.map(c => ({ value: c.id, label: c.name }))}
        />
      </div>

      {!selectedCharacter ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无选中的角色卡"
          style={{ marginTop: '40px' }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '4px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              backgroundColor: 'rgba(217, 119, 87, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <UserOutlined style={{ fontSize: '18px', color: '#d97757' }} />
            </div>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 600, color: '#33312e' }}>
                {selectedCharacter.name}
              </div>
              <div style={{ fontSize: '12px', color: '#8c8880', marginTop: '2px' }}>
                {selectedCharacter.fields?.identityTags?.join(' · ') || '暂无身份标签'}
              </div>
            </div>
          </div>

          {/* Relation overview */}
          <Card
            title={<span style={{ color: '#d97757', fontWeight: 600 }}><HeartOutlined /> 关系概览</span>}
            size="small"
            style={{ borderRadius: '12px', border: '1px solid rgba(217, 119, 87, 0.05)' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '11px', color: '#8c8880', marginBottom: '2px' }}>关系类型</div>
                <div style={{ fontSize: '13px', color: '#d97757', fontWeight: 600 }}>
                  {selectedCharacter.fields?.userRelationType || '尚未设定'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: '#8c8880', marginBottom: '2px' }}>
                  <LinkOutlined style={{ marginRight: '4px' }} />相处模式
                </div>
                <div style={{ fontSize: '13px', color: '#33312e', lineHeight: 1.5 }}>
                  {selectedCharacter.fields?.userInteractionModel || '尚未设定'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '11px', color: '#8c8880', marginBottom: '2px' }}>
                  <SafetyOutlined style={{ marginRight: '4px' }} />关系底线
                </div>
                <div style={{ fontSize: '13px', color: '#33312e', lineHeight: 1.5 }}>
                  {selectedCharacter.fields?.userRelationBottomLine || '尚未设定'}
                </div>
              </div>
            </div>
          </Card>

          {/* Timeline */}
          <Card
            title={<span style={{ color: '#d97757', fontWeight: 600 }}><ClockCircleOutlined /> 羁绊时间线</span>}
            size="small"
            style={{ borderRadius: '12px', border: '1px solid rgba(217, 119, 87, 0.05)' }}
          >
            {parseKeyEvents(selectedCharacter.fields?.keyEvents).length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关键事件记录" />
            ) : (
              <Timeline
                style={{ marginTop: '8px' }}
                items={parseKeyEvents(selectedCharacter.fields?.keyEvents).map((event, idx) => ({
                  key: idx,
                  color: idx === 0 ? '#d97757' : '#8c8882',
                  children: (
                    <div style={{ fontSize: '13px', color: '#33312e', lineHeight: 1.6 }}>
                      {event}
                    </div>
                  )
                }))}
              />
            )}
          </Card>

          {/* Session footprints */}
          <Card
            title={<span style={{ color: '#d97757', fontWeight: 600 }}><MessageOutlined /> 会话足迹</span>}
            size="small"
            style={{ borderRadius: '12px', border: '1px solid rgba(217, 119, 87, 0.05)' }}
          >
            {loadingSessions ? (
              <div style={{ textAlign: 'center', padding: '16px' }}><Spin size="small" /></div>
            ) : sessions.filter(s => s.characterCardId === selectedId).length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无聊天足迹" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {sessions.filter(s => s.characterCardId === selectedId).map(session => {
                  const isExpanded = expandedSessionId === session.id;
                  return (
                    <div key={session.id} style={{
                      border: '1px solid rgba(0,0,0,0.03)',
                      borderRadius: '8px',
                      backgroundColor: isExpanded ? '#fafaf7' : '#fff',
                    }}>
                      <div
                        onClick={() => handleExpandSession(session.id)}
                        style={{
                          padding: '12px 14px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                          <BookOutlined style={{ color: '#8c8880', fontSize: '13px' }} />
                          <span style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {session.title}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '11px', color: '#bfbfbf' }}>{formatDate(session.savedAt)}</span>
                          <EyeOutlined style={{ fontSize: '12px', color: isExpanded ? '#d97757' : '#bfbfbf' }} />
                        </div>
                      </div>
                      {isExpanded && (
                        <div style={{ padding: '0 12px 12px' }}>
                          {loadingRecord && !expandedRecord ? (
                            <div style={{ textAlign: 'center' }}><Spin size="small" /></div>
                          ) : expandedRecord ? (
                            <div style={{
                              maxHeight: '200px',
                              overflowY: 'auto',
                              backgroundColor: '#fff',
                              border: '1px solid rgba(0,0,0,0.02)',
                              borderRadius: '6px',
                              padding: '10px',
                            }}>
                              {expandedRecord.messages.map((m, mIdx) => (
                                <div key={mIdx} style={{
                                  marginBottom: '8px',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                                }}>
                                  <div style={{
                                    maxWidth: '85%',
                                    padding: '6px 10px',
                                    borderRadius: '8px',
                                    backgroundColor: m.role === 'user' ? '#f2e8dc' : '#f5f5f5',
                                    fontSize: '12.5px',
                                    lineHeight: 1.5,
                                  }}>
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                                  </div>
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

          {/* Adventure footprints */}
          <Card
            title={<span style={{ color: '#d97757', fontWeight: 600 }}><CompassOutlined /> 冒险足迹</span>}
            size="small"
            style={{ borderRadius: '12px', border: '1px solid rgba(217, 119, 87, 0.05)' }}
          >
            {loadingAdventures ? (
              <div style={{ textAlign: 'center', padding: '16px' }}><Spin size="small" /></div>
            ) : adventures.filter(s => s.characterCardIds?.includes(selectedId || '')).length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无冒险足迹" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {adventures.filter(s => s.characterCardIds?.includes(selectedId || '')).map(session => {
                  const isExpanded = expandedAdventureId === session.id;
                  return (
                    <div key={session.id} style={{
                      border: '1px solid rgba(0,0,0,0.03)',
                      borderRadius: '8px',
                      backgroundColor: isExpanded ? '#fafaf7' : '#fff',
                    }}>
                      <div
                        onClick={() => handleExpandAdventure(session.id)}
                        style={{
                          padding: '12px 14px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                          <BookOutlined style={{ color: '#8c8880', fontSize: '13px' }} />
                          <span style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {session.title}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '11px', color: '#bfbfbf' }}>{formatDate(session.savedAt)}</span>
                          <EyeOutlined style={{ fontSize: '12px', color: isExpanded ? '#d97757' : '#bfbfbf' }} />
                        </div>
                      </div>
                      {isExpanded && (
                        <div style={{ padding: '0 12px 12px' }}>
                          {loadingAdventureRecord && !expandedAdventureRecord ? (
                            <div style={{ textAlign: 'center' }}><Spin size="small" /></div>
                          ) : expandedAdventureRecord ? (
                            <div style={{
                              maxHeight: '200px',
                              overflowY: 'auto',
                              backgroundColor: '#fff',
                              border: '1px solid rgba(0,0,0,0.02)',
                              borderRadius: '6px',
                              padding: '10px',
                            }}>
                              {expandedAdventureRecord.messages.map((m, mIdx) => (
                                <div key={mIdx} style={{
                                  marginBottom: '8px',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                                }}>
                                  <div style={{
                                    maxWidth: '85%',
                                    padding: '6px 10px',
                                    borderRadius: '8px',
                                    backgroundColor: m.role === 'user' ? '#f2e8dc' : '#f5f5f5',
                                    fontSize: '12.5px',
                                    lineHeight: 1.5,
                                  }}>
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                                  </div>
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
        </div>
      )}
    </div>
  );
};

export default MobileBond;
