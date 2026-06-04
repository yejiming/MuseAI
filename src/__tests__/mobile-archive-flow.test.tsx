import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MobileChat from '../pages/MobileChat';
import MobileStory from '../pages/MobileStory';
import { usePartnerChatStore } from '../stores/usePartnerChatStore';
import { usePartnerStore } from '../stores/usePartnerStore';
import { useStoryStore } from '../stores/useStoryStore';

const appInvokeMock = vi.fn(async (command: string, _args?: unknown) => {
  if (command === 'list_agent_sessions') return [];
  if (command === 'save_agent_session') return { id: 'saved-session', title: '已保存' };
  if (command === 'analyze_character_memory') {
    return {
      recommendedSessionTitle: '归档标题',
      userRelationType: '伙伴',
      userInteractionModel: '互相信任',
      userRelationBottomLine: '保持坦诚',
      keyEvents: '共同完成一次对话',
    };
  }
  return undefined;
});

vi.mock('../utils/runtime', () => ({
  appInvoke: (command: string, args?: unknown) => appInvokeMock(command, args),
  listenStream: vi.fn(),
}));

const characterCard = {
  id: 'card-1',
  name: '禾禾',
  type: 'character_card' as const,
  content: '# 禾禾',
  fields: {},
};
const secondCharacterCard = {
  id: 'card-2',
  name: '林逸',
  type: 'character_card' as const,
  content: '# 林逸',
  fields: {},
};

function resetPartnerStore() {
  usePartnerStore.setState({
    characterCards: [characterCard, secondCharacterCard],
    worldBooks: [],
    selectedId: null,
    selectedType: null,
  });
}

describe('mobile archive flow', () => {
  beforeEach(() => {
    appInvokeMock.mockClear();
    Element.prototype.scrollTo = vi.fn();
    resetPartnerStore();
  });

  it('saves the mobile chat session before memory analysis', async () => {
    usePartnerChatStore.setState({
      messages: [{ id: 'm1', role: 'user', content: '你好', tools: [] }],
      input: '',
      isStreaming: false,
      expandedBlocks: {},
      selectedWorldBookId: null,
      selectedCharacterCardId: characterCard.id,
      sessions: [],
      sessionId: 'partner-session-unsaved',
      sessionTitle: '新聊天',
      activeRun: { runId: null, messageId: null },
      isSessionArchived: false,
      contextCompaction: null,
    });

    render(<MobileChat />);
    fireEvent.click(screen.getByText('封存记忆并归档会话'));

    await waitFor(() => {
      expect(appInvokeMock).toHaveBeenCalledWith(
        'save_agent_session',
        expect.objectContaining({
          session: expect.objectContaining({
            id: 'partner-session-unsaved',
            selectedReferenceFiles: [],
            todos: [],
            isArchived: false,
            characterCardId: characterCard.id,
          }),
        })
      );
      expect(appInvokeMock).toHaveBeenCalledWith('analyze_character_memory', {
        sessionId: 'partner-session-unsaved',
      });
    });

    const saveIndex = appInvokeMock.mock.calls.findIndex(([command]) => command === 'save_agent_session');
    const analyzeIndex = appInvokeMock.mock.calls.findIndex(([command]) => command === 'analyze_character_memory');
    expect(saveIndex).toBeLessThan(analyzeIndex);
    expect(await screen.findByDisplayValue('归档标题')).toBeInTheDocument();
  });

  it('saves the mobile story session before memory analysis', async () => {
    useStoryStore.setState({
      messages: [{ id: 'm1', role: 'user', content: '进入森林', tools: [] }],
      input: '',
      inputMode: 'speech',
      isStreaming: false,
      expandedBlocks: {},
      selectedWorldBookId: null,
      selectedCharacterCardIds: [characterCard.id, secondCharacterCard.id],
      sessions: [],
      sessionId: 'story-session-unsaved',
      sessionTitle: '新故事',
      activeRun: { runId: null, messageId: null },
      isSessionArchived: false,
      initialPlot: '',
      contextCompaction: null,
      dynamicRoleLoadingEnabled: false,
    });

    render(<MobileStory />);
    fireEvent.click(screen.getByText('提炼记忆并锁定存档'));

    expect(await screen.findByText('请选择本次要同步记忆的角色卡：')).toBeInTheDocument();
    expect(screen.getByText('禾禾')).toBeInTheDocument();
    expect(screen.getByText('林逸')).toBeInTheDocument();
    expect(appInvokeMock).not.toHaveBeenCalledWith('analyze_character_memory', expect.anything());

    fireEvent.click(screen.getByText('开始分析封存'));

    await waitFor(() => {
      expect(appInvokeMock).toHaveBeenCalledWith(
        'save_agent_session',
        expect.objectContaining({
          session: expect.objectContaining({
            id: 'story-session-unsaved',
            selectedReferenceFiles: [],
            todos: [],
            isArchived: false,
            characterCardIds: [characterCard.id, secondCharacterCard.id],
          }),
        })
      );
      expect(appInvokeMock).toHaveBeenCalledWith('analyze_character_memory', {
        sessionId: 'story-session-unsaved',
        characterCardId: characterCard.id,
      });
      expect(appInvokeMock).toHaveBeenCalledWith('analyze_character_memory', {
        sessionId: 'story-session-unsaved',
        characterCardId: secondCharacterCard.id,
      });
    });

    const saveIndex = appInvokeMock.mock.calls.findIndex(([command]) => command === 'save_agent_session');
    const analyzeIndex = appInvokeMock.mock.calls.findIndex(([command]) => command === 'analyze_character_memory');
    expect(saveIndex).toBeLessThan(analyzeIndex);
    expect(await screen.findByDisplayValue('归档标题')).toBeInTheDocument();
  });
});
