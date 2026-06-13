import { DeleteOutlined } from '@ant-design/icons';
import { Button, Empty, Modal, Select, Tag } from 'antd';
import type { AgentSessionSummary } from '../stores/useAgentStore';
import type { PartnerItem } from '../stores/usePartnerStore';
import {
  resolveSessionHistoryMeta,
  sessionMatchesHistoryFilters,
} from '../utils/sessionHistory';
import React, { useMemo, useState } from 'react';

interface SessionHistoryModalProps {
  open: boolean;
  title: string;
  emptyText: string;
  sessions: AgentSessionSummary[];
  worldBooks: PartnerItem[];
  characterCards: PartnerItem[];
  onClose: () => void;
  onOpenSession: (id: string) => void | Promise<void>;
  onDeleteSession: (id: string) => void | Promise<void>;
}

const savedAtFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const filterSelectStyle: React.CSSProperties = { minWidth: 180, flex: '1 1 180px' };
const sessionHistoryItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  gap: 8,
  border: '1px solid #eee8df',
  borderRadius: 8,
  background: '#fffdfa',
};
const sessionHistoryOpenButtonStyle: React.CSSProperties = {
  flex: 1,
  border: 0,
  background: 'transparent',
  textAlign: 'left',
  padding: '12px 14px',
  cursor: 'pointer',
  font: 'inherit',
  minWidth: 0,
};

export function SessionHistoryModal({
  open,
  title,
  emptyText,
  sessions,
  worldBooks,
  characterCards,
  onClose,
  onOpenSession,
  onDeleteSession,
}: SessionHistoryModalProps) {
  const [worldBookFilter, setWorldBookFilter] = useState<string | null>(null);
  const [characterCardFilter, setCharacterCardFilter] = useState<string | null>(null);

  const filteredSessions = useMemo(
    () => sessions.filter((session) => sessionMatchesHistoryFilters(
      session,
      worldBooks,
      characterCards,
      { worldBookId: worldBookFilter, characterCardId: characterCardFilter },
    )),
    [characterCardFilter, characterCards, sessions, worldBookFilter, worldBooks],
  );

  const handleOpenSession = (id: string) => {
    void Promise.resolve(onOpenSession(id)).then(onClose);
  };

  return (
    <Modal
      open={open}
      title={title}
      footer={null}
      onCancel={onClose}
      width={720}
      centered
    >
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <Select
          aria-label="按世界书筛选"
          allowClear
          placeholder="按世界书筛选"
          value={worldBookFilter}
          onChange={(value) => setWorldBookFilter(value ?? null)}
          options={worldBooks.map((worldBook) => ({ value: worldBook.id, label: worldBook.name }))}
          style={filterSelectStyle}
        />
        <Select
          aria-label="按角色卡筛选"
          allowClear
          placeholder="按角色卡筛选"
          value={characterCardFilter}
          onChange={(value) => setCharacterCardFilter(value ?? null)}
          options={characterCards.map((card) => ({ value: card.id, label: card.name }))}
          style={filterSelectStyle}
        />
      </div>

      {filteredSessions.length === 0 ? (
        <Empty description={worldBookFilter || characterCardFilter ? '没有符合筛选的历史记录' : emptyText} />
      ) : (
        <div style={{ maxHeight: 460, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filteredSessions.map((session) => {
            const meta = resolveSessionHistoryMeta(session, worldBooks, characterCards);
            const visibleCards = meta.characterCards.slice(0, 3);
            return (
              <div
                key={session.id}
                style={sessionHistoryItemStyle}
              >
                <button
                  type="button"
                  aria-label={`打开${session.title}`}
                  onClick={() => handleOpenSession(session.id)}
                  style={sessionHistoryOpenButtonStyle}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                    <strong style={{ color: '#33312e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {session.title}
                    </strong>
                    <span style={{ color: '#9a948c', fontSize: 12, flexShrink: 0 }}>
                      {session.savedAt ? savedAtFormatter.format(new Date(session.savedAt)) : '未保存'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {meta.worldBookName ? <Tag color="orange">世界书：{meta.worldBookName}</Tag> : <Tag>未绑定世界书</Tag>}
                    {visibleCards.length > 0 ? (
                      visibleCards.map((card) => (
                        <Tag key={card.id} color="default">角色卡：{card.name}</Tag>
                      ))
                    ) : (
                      <Tag>未绑定角色卡</Tag>
                    )}
                  </div>
                </button>
                <div style={{ display: 'flex', alignItems: 'center', paddingRight: 8 }}>
                  <Button
                    type="text"
                    danger
                    aria-label={`删除${session.title}`}
                    icon={<DeleteOutlined />}
                    onClick={() => void onDeleteSession(session.id)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
