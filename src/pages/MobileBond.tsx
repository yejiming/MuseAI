import React, { useEffect } from 'react';
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
import { usePartnerStore, type PartnerItem } from '../stores/usePartnerStore';
import { usePartnerChatStore } from '../stores/usePartnerChatStore';
import { appInvoke } from '../utils/runtime';
import { useStateGroup } from '../utils/reducerState';
import type { AgentSessionSummary, AgentSessionRecord } from '../stores/useAgentStore';

interface MobileBondUiState {
  selectedId: string | null;
  sessions: AgentSessionSummary[];
  adventures: AgentSessionSummary[];
  loadingSessions: boolean;
  loadingAdventures: boolean;
  expandedSessionId: string | null;
  expandedRecord: AgentSessionRecord | null;
  loadingRecord: boolean;
  expandedAdventureId: string | null;
  expandedAdventureRecord: AgentSessionRecord | null;
  loadingAdventureRecord: boolean;
}

const MOBILE_BOND_PAGE_STYLE: React.CSSProperties = {
  padding: '16px',
  backgroundColor: '#faf9f5',
  height: '100%',
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

const MOBILE_BOND_SELECTOR_STYLE: React.CSSProperties = {
  padding: '12px 16px',
  backgroundColor: '#fff',
  borderRadius: '12px',
  border: '1px solid rgba(217, 119, 87, 0.05)',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  flexShrink: 0,
};

const MOBILE_BOND_HISTORY_BUTTON_STYLE: React.CSSProperties = {
  padding: '12px 14px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  cursor: 'pointer',
  width: '100%',
  border: 'none',
  background: 'transparent',
  font: 'inherit',
  textAlign: 'left',
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

const MobileBond: React.FC = () => {
  const { characterCards } = usePartnerStore();
  const { selectedCharacterCardId, setSelectedCharacterCardId } = usePartnerChatStore();

  const [uiState, patchUiState, setUiField] = useStateGroup<MobileBondUiState>({
    selectedId: selectedCharacterCardId,
    sessions: [],
    adventures: [],
    loadingSessions: false,
    loadingAdventures: false,
    expandedSessionId: null,
    expandedRecord: null,
    loadingRecord: false,
    expandedAdventureId: null,
    expandedAdventureRecord: null,
    loadingAdventureRecord: false,
  });
  const {
    selectedId,
    sessions,
    adventures,
    loadingSessions,
    loadingAdventures,
    expandedSessionId,
    expandedRecord,
    loadingRecord,
    expandedAdventureId,
    expandedAdventureRecord,
    loadingAdventureRecord,
  } = uiState;
  const setExpandedSessionId = (expandedSessionId: string | null) => setUiField('expandedSessionId', expandedSessionId);
  const setExpandedRecord = (expandedRecord: AgentSessionRecord | null) => setUiField('expandedRecord', expandedRecord);
  const setLoadingRecord = (loadingRecord: boolean) => setUiField('loadingRecord', loadingRecord);
  const setExpandedAdventureId = (expandedAdventureId: string | null) => setUiField('expandedAdventureId', expandedAdventureId);
  const setExpandedAdventureRecord = (expandedAdventureRecord: AgentSessionRecord | null) => setUiField('expandedAdventureRecord', expandedAdventureRecord);
  const setLoadingAdventureRecord = (loadingAdventureRecord: boolean) => setUiField('loadingAdventureRecord', loadingAdventureRecord);

  useEffect(() => {
    setUiField('selectedId', (currentId) => {
      if (selectedCharacterCardId && characterCards.some(c => c.id === selectedCharacterCardId)) {
        return selectedCharacterCardId;
      }
      if (characterCards.length > 0 && !currentId) {
        return characterCards[0].id;
      }
      return currentId;
    });
  }, [selectedCharacterCardId, characterCards, setUiField]);

  useEffect(() => {
    const loadData = async () => {
      patchUiState({ loadingSessions: true, loadingAdventures: true });

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
        patchUiState({ sessions: summaries });
      } catch (err) {
        console.error('加载会话足迹失败:', err);
      } finally {
        patchUiState({ loadingSessions: false });
      }

      try {
        const summaries = await appInvoke<AgentSessionSummary[]>('list_agent_sessions', { prefix: 'story-session-' });
        patchUiState({ adventures: summaries });
      } catch (err) {
        console.error('加载冒险足迹失败:', err);
      } finally {
        patchUiState({ loadingAdventures: false });
      }
    };
    loadData();
  }, [patchUiState]);

  const handleSelectCharacter = (id: string) => {
    patchUiState({
      selectedId: id,
      expandedSessionId: null,
      expandedRecord: null,
      expandedAdventureId: null,
      expandedAdventureRecord: null,
    });
    setSelectedCharacterCardId(id);
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

  const selectedCharacter = characterCards.find((c) => c.id === selectedId);
  const selectedSessions: AgentSessionSummary[] = [];
  const selectedAdventures: AgentSessionSummary[] = [];
  for (const session of sessions) {
    if (session.characterCardId === selectedId) {
      selectedSessions.push(session);
    }
  }
  for (const session of adventures) {
    for (const characterCardId of session.characterCardIds ?? []) {
      if (characterCardId === (selectedId || '')) {
        selectedAdventures.push(session);
        break;
      }
    }
  }

  return (
    <MobileBondView
      characterCards={characterCards}
      expandedState={{
        expandedAdventureId,
        expandedAdventureRecord,
        expandedRecord,
        expandedSessionId,
      }}
      loadingState={{
        loadingAdventureRecord,
        loadingAdventures,
        loadingRecord,
        loadingSessions,
      }}
      selectedAdventures={selectedAdventures}
      selectedCharacter={selectedCharacter}
      selectedId={selectedId}
      selectedSessions={selectedSessions}
      onExpandAdventure={handleExpandAdventure}
      onExpandSession={handleExpandSession}
      onSelectCharacter={handleSelectCharacter}
    />
  );
};

interface MobileBondViewProps {
  characterCards: PartnerItem[];
  expandedState: {
    expandedAdventureId: string | null;
    expandedAdventureRecord: AgentSessionRecord | null;
    expandedRecord: AgentSessionRecord | null;
    expandedSessionId: string | null;
  };
  loadingState: {
    loadingAdventureRecord: boolean;
    loadingAdventures: boolean;
    loadingRecord: boolean;
    loadingSessions: boolean;
  };
  selectedAdventures: AgentSessionSummary[];
  selectedCharacter?: PartnerItem;
  selectedId: string | null;
  selectedSessions: AgentSessionSummary[];
  onExpandAdventure: (id: string) => void;
  onExpandSession: (id: string) => void;
  onSelectCharacter: (id: string) => void;
}

const MobileBondView: React.FC<MobileBondViewProps> = ({
  characterCards,
  expandedState,
  loadingState,
  selectedAdventures,
  selectedCharacter,
  selectedId,
  selectedSessions,
  onExpandAdventure,
  onExpandSession,
  onSelectCharacter,
}) => (
  <div style={MOBILE_BOND_PAGE_STYLE}>
    <div style={MOBILE_BOND_SELECTOR_STYLE}>
      <div style={{ fontSize: '13px', color: '#8c8880', fontWeight: 600 }}>选择羁绊角色</div>
      <Select
        value={selectedId}
        onChange={onSelectCharacter}
        style={{ width: '100%', fontSize: '16px' }}
        placeholder="切换角色..."
        options={characterCards.map((card) => ({ value: card.id, label: card.name }))}
      />
    </div>

    {!selectedCharacter ? (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无选中的角色卡" style={{ marginTop: '40px' }} />
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <MobileBondCharacterHeader character={selectedCharacter} />
        <MobileBondRelationCard character={selectedCharacter} />
        <MobileBondTimelineCard character={selectedCharacter} />
        <MobileBondHistoryCard
          emptyText="暂无聊天足迹"
          icon={<MessageOutlined />}
          loading={loadingState.loadingSessions}
          loadingRecord={loadingState.loadingRecord}
          record={expandedState.expandedRecord}
          sessions={selectedSessions}
          title="会话足迹"
          expandedId={expandedState.expandedSessionId}
          onExpand={onExpandSession}
        />
        <MobileBondHistoryCard
          emptyText="暂无冒险足迹"
          icon={<CompassOutlined />}
          loading={loadingState.loadingAdventures}
          loadingRecord={loadingState.loadingAdventureRecord}
          record={expandedState.expandedAdventureRecord}
          sessions={selectedAdventures}
          title="冒险足迹"
          expandedId={expandedState.expandedAdventureId}
          onExpand={onExpandAdventure}
        />
      </div>
    )}
  </div>
);

const MobileBondCharacterHeader: React.FC<{ character: PartnerItem }> = ({ character }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '4px' }}>
    <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'rgba(217, 119, 87, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <UserOutlined style={{ fontSize: '18px', color: '#d97757' }} />
    </div>
    <div>
      <div style={{ fontSize: '16px', fontWeight: 600, color: '#33312e' }}>{character.name}</div>
      <div style={{ fontSize: '12px', color: '#8c8880', marginTop: '2px' }}>
        {character.fields?.identityTags?.join(' · ') || '暂无身份标签'}
      </div>
    </div>
  </div>
);

const MobileBondRelationCard: React.FC<{ character: PartnerItem }> = ({ character }) => (
  <Card title={<span style={{ color: '#d97757', fontWeight: 600 }}><HeartOutlined /> 关系概览</span>} size="small" style={{ borderRadius: '12px', border: '1px solid rgba(217, 119, 87, 0.05)' }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div>
        <div style={{ fontSize: '11px', color: '#8c8880', marginBottom: '2px' }}>关系类型</div>
        <div style={{ fontSize: '13px', color: '#d97757', fontWeight: 600 }}>{character.fields?.userRelationType || '尚未设定'}</div>
      </div>
      <div>
        <div style={{ fontSize: '11px', color: '#8c8880', marginBottom: '2px' }}><LinkOutlined style={{ marginRight: '4px' }} />相处模式</div>
        <div style={{ fontSize: '13px', color: '#33312e', lineHeight: 1.5 }}>{character.fields?.userInteractionModel || '尚未设定'}</div>
      </div>
      <div>
        <div style={{ fontSize: '11px', color: '#8c8880', marginBottom: '2px' }}><SafetyOutlined style={{ marginRight: '4px' }} />关系底线</div>
        <div style={{ fontSize: '13px', color: '#33312e', lineHeight: 1.5 }}>{character.fields?.userRelationBottomLine || '尚未设定'}</div>
      </div>
    </div>
  </Card>
);

const MobileBondTimelineCard: React.FC<{ character: PartnerItem }> = ({ character }) => {
  const events = parseKeyEvents(character.fields?.keyEvents);
  return (
    <Card title={<span style={{ color: '#d97757', fontWeight: 600 }}><ClockCircleOutlined /> 羁绊时间线</span>} size="small" style={{ borderRadius: '12px', border: '1px solid rgba(217, 119, 87, 0.05)' }}>
      {events.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关键事件记录" />
      ) : (
        <Timeline
          style={{ marginTop: '8px' }}
          items={events.map((event, index) => ({
            key: index,
            color: index === 0 ? '#d97757' : '#8c8882',
            children: <div style={{ fontSize: '13px', color: '#33312e', lineHeight: 1.6 }}>{event}</div>,
          }))}
        />
      )}
    </Card>
  );
};

interface MobileBondHistoryCardProps {
  emptyText: string;
  expandedId: string | null;
  icon: React.ReactNode;
  loading: boolean;
  loadingRecord: boolean;
  record: AgentSessionRecord | null;
  sessions: AgentSessionSummary[];
  title: string;
  onExpand: (id: string) => void;
}

const MobileBondHistoryCard: React.FC<MobileBondHistoryCardProps> = ({
  emptyText,
  expandedId,
  icon,
  loading,
  loadingRecord,
  record,
  sessions,
  title,
  onExpand,
}) => (
  <Card title={<span style={{ color: '#d97757', fontWeight: 600 }}>{icon} {title}</span>} size="small" style={{ borderRadius: '12px', border: '1px solid rgba(217, 119, 87, 0.05)' }}>
    {loading ? (
      <div style={{ textAlign: 'center', padding: '16px' }}><Spin size="small" /></div>
    ) : sessions.length === 0 ? (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {sessions.map((session) => (
          <MobileBondHistoryItem
            key={session.id}
            expanded={expandedId === session.id}
            loadingRecord={loadingRecord}
            record={record}
            session={session}
            onExpand={onExpand}
          />
        ))}
      </div>
    )}
  </Card>
);

const MobileBondHistoryItem: React.FC<{
  expanded: boolean;
  loadingRecord: boolean;
  record: AgentSessionRecord | null;
  session: AgentSessionSummary;
  onExpand: (id: string) => void;
}> = ({ expanded, loadingRecord, record, session, onExpand }) => (
  <div style={{ border: '1px solid rgba(0,0,0,0.03)', borderRadius: '8px', backgroundColor: expanded ? '#fafaf7' : '#fff' }}>
    <button type="button" onClick={() => onExpand(session.id)} style={MOBILE_BOND_HISTORY_BUTTON_STYLE}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <BookOutlined style={{ color: '#8c8880', fontSize: '13px' }} />
        <span style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.title}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '11px', color: '#bfbfbf' }}>{formatDate(session.savedAt)}</span>
        <EyeOutlined style={{ fontSize: '12px', color: expanded ? '#d97757' : '#bfbfbf' }} />
      </div>
    </button>
    {expanded && (
      <div style={{ padding: '0 12px 12px' }}>
        {loadingRecord && !record ? (
          <div style={{ textAlign: 'center' }}><Spin size="small" /></div>
        ) : record ? (
          <div style={{ maxHeight: '200px', overflowY: 'auto', backgroundColor: '#fff', border: '1px solid rgba(0,0,0,0.02)', borderRadius: '6px', padding: '10px' }}>
            {record.messages.map((message) => (
              <div key={message.id || `${message.role}-${message.content.slice(0, 48)}`} style={{ marginBottom: '8px', display: 'flex', flexDirection: 'column', alignItems: message.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{ maxWidth: '85%', padding: '6px 10px', borderRadius: '8px', backgroundColor: message.role === 'user' ? '#f2e8dc' : '#f5f5f5', fontSize: '12.5px', lineHeight: 1.5 }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    )}
  </div>
);

export default MobileBond;
