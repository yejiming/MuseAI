import { Message, SessionContextCompaction } from '../stores/useAgentStore';

export const getEffectiveMessagesForContextStats = (
  messages: Message[],
  contextCompaction: SessionContextCompaction | null
): Message[] => {
  if (!contextCompaction?.summary?.trim()) {
    return messages;
  }

  let suffixStart = contextCompaction.compactedThroughIndex + 1;
  const compactedThroughMessageId = contextCompaction.compactedThroughMessageId;
  if (compactedThroughMessageId) {
    const boundaryIndex = messages.findIndex(message => message.id === compactedThroughMessageId);
    if (boundaryIndex >= 0) {
      suffixStart = boundaryIndex + 1;
    }
  }

  return [
    {
      id: 'context-compaction-summary',
      role: 'user',
      content: `【本会话早期内容已压缩】\n${contextCompaction.summary.trim()}`,
      tools: []
    },
    ...messages.slice(Math.min(Math.max(suffixStart, 0), messages.length))
  ];
};
