import { describe, expect, it } from 'vitest';
import { getEffectiveMessagesForContextStats } from '../utils/contextCompaction';
import { Message, SessionContextCompaction } from '../stores/useAgentStore';

const messages: Message[] = [
  { id: 'u1', role: 'user', content: '你好', tools: [] },
  { id: 'a1', role: 'agent', content: '你好呀', tools: [] },
  { id: 'u2', role: 'user', content: '继续', tools: [] },
  { id: 'a2', role: 'agent', content: '继续说', tools: [] },
  { id: 'u3', role: 'user', content: '最近的请求', tools: [] },
  { id: 'a3', role: 'agent', content: '最近的回复', tools: [] },
];

describe('getEffectiveMessagesForContextStats', () => {
  it('returns visible messages when there is no compaction summary', () => {
    expect(getEffectiveMessagesForContextStats(messages, null)).toBe(messages);
  });

  it('uses compaction summary plus messages after compacted boundary', () => {
    const compaction: SessionContextCompaction = {
      summary: '关系状态：稳定',
      compactedThroughMessageId: 'a2',
      compactedThroughIndex: 3,
      sourceMessageCount: 6,
      updatedAt: 1,
    };

    const effectiveMessages = getEffectiveMessagesForContextStats(messages, compaction);

    expect(effectiveMessages.map(message => message.id)).toEqual([
      'context-compaction-summary',
      'u3',
      'a3',
    ]);
    expect(effectiveMessages[0].content).toContain('关系状态：稳定');
  });

  it('falls back to compacted index when boundary id is missing', () => {
    const compaction: SessionContextCompaction = {
      summary: '旧摘要',
      compactedThroughMessageId: 'missing',
      compactedThroughIndex: 1,
      sourceMessageCount: 6,
      updatedAt: 1,
    };

    const effectiveMessages = getEffectiveMessagesForContextStats(messages, compaction);

    expect(effectiveMessages.map(message => message.id)).toEqual([
      'context-compaction-summary',
      'u2',
      'a2',
      'u3',
      'a3',
    ]);
  });
});
