import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Adventure from '../pages/Adventure';
import { usePartnerChatStore } from '../stores/usePartnerChatStore';
import { usePartnerStore } from '../stores/usePartnerStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useStoryStore } from '../stores/useStoryStore';

const invokeMock = vi.fn(async (command: string, _args?: unknown) => {
  if (command === 'start_chat_completion_stream') return 'run-1';
  if (command === 'summarize_text') return '森林开局';
  if (command === 'save_agent_session') return { id: 'story-session-test', title: '森林开局', savedAt: Date.now() };
  if (command === 'list_agent_sessions') return [];
  return undefined;
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: unknown) => invokeMock(command, args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: async () => () => {},
}));

const worldBook = {
  id: 'wb-test',
  name: '测试世界',
  type: 'world_book' as const,
  content: '# 测试世界\n世界正文',
  fields: {},
};

const characterCard = {
  id: 'cc-test',
  name: '陆雪莹',
  type: 'character_card' as const,
  content: '# 角色卡：陆雪莹\n角色卡秘密正文',
  fields: {},
  worldBookId: worldBook.id,
};

function resetStores(dynamicRoleLoadingEnabled = false) {
  usePartnerStore.setState({
    worldBooks: [worldBook],
    characterCards: [characterCard],
    selectedId: null,
    selectedType: null,
  });
  useStoryStore.setState({
    messages: [],
    input: '',
    inputMode: 'speech',
    isStreaming: false,
    expandedBlocks: {},
    selectedWorldBookId: worldBook.id,
    selectedCharacterCardIds: [characterCard.id],
    sessions: [],
    sessionId: 'story-session-test',
    sessionTitle: '新故事',
    activeRun: { runId: null, messageId: null },
    isSessionArchived: false,
    initialPlot: '我在森林醒来。',
    contextCompaction: null,
    dynamicRoleLoadingEnabled,
  });
  usePartnerChatStore.setState({
    userInfo: {
      name: '阿明',
      skills: '风系魔法',
    },
  });
  useSettingsStore.setState({
    storyAgentPrompt: '静态冒险提示词',
    storyDynamicAgentPrompt: '动态冒险提示词：必须调用 role_play',
    agentConfigs: {
      ...useSettingsStore.getState().agentConfigs,
      storyAgent: {
        temperature: 0.3,
        maxOutputTokens: 1111,
        maxContextTokens: 2222,
        thinkingDepth: 'low',
      },
      storyDynamicAgent: {
        temperature: 1.2,
        maxOutputTokens: 3333,
        maxContextTokens: 4444,
        thinkingDepth: 'high',
      },
    },
  });
}

describe('Story dynamic role loading page', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    resetStores(false);
  });

  it('renders the dynamic loading switch and starts static adventures without tools', async () => {
    render(<Adventure />);

    expect(screen.getByText('冒险页')).toBeInTheDocument();
    expect(screen.queryByText('普通冒险')).not.toBeInTheDocument();
    expect(screen.queryByText('选择穿书素材')).not.toBeInTheDocument();
    expect(screen.getByText('角色卡动态加载')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /开启冒险旅程/ }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'start_chat_completion_stream',
        expect.objectContaining({
          request: expect.objectContaining({
            allowedTools: [],
            systemPrompt: expect.stringContaining('静态冒险提示词'),
            temperature: 0.3,
            maxOutputTokens: 1111,
            maxContextTokens: 2222,
            thinkingDepth: 'low',
          }),
        }),
      );
    });
  });

  it('starts dynamic adventures with role_play and keeps character/user info in Story prompt', async () => {
    resetStores(true);
    render(<Adventure />);

    fireEvent.click(screen.getByRole('button', { name: /开启冒险旅程/ }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'start_chat_completion_stream',
        expect.objectContaining({
          request: expect.objectContaining({
            allowedTools: ['role_play'],
            systemPrompt: expect.stringMatching(/动态冒险提示词[\s\S]*角色卡秘密正文[\s\S]*阿明/),
            temperature: 1.2,
            maxOutputTokens: 3333,
            maxContextTokens: 4444,
            thinkingDepth: 'high',
            rolePlayContext: expect.objectContaining({
              userInfo: expect.objectContaining({ name: '阿明', skills: '风系魔法' }),
              characterCards: [expect.objectContaining({ name: '陆雪莹', content: expect.stringContaining('角色卡秘密正文') })],
            }),
          }),
        }),
      );
    });
  });

  it('auto-selects owned Character Cards after choosing a World Book and allows manual adjustment', async () => {
    const secondWorldBook = {
      id: 'wb-other',
      name: '北境世界',
      type: 'world_book' as const,
      content: '# 北境世界',
      fields: {},
    };
    usePartnerStore.setState({
      worldBooks: [worldBook, secondWorldBook],
      characterCards: [
        characterCard,
        {
          id: 'cc-free',
          name: '游侠',
          type: 'character_card' as const,
          content: '# 角色卡：游侠',
          fields: {},
          worldBookId: null,
        },
        {
          id: 'cc-other',
          name: '北境守卫',
          type: 'character_card' as const,
          content: '# 角色卡：北境守卫',
          fields: {},
          worldBookId: secondWorldBook.id,
        },
      ],
      selectedId: null,
      selectedType: null,
    });
    useStoryStore.setState({
      messages: [],
      selectedWorldBookId: null,
      selectedCharacterCardIds: [],
    });

    render(<Adventure />);

    const characterTree = document.querySelector('.ant-tree') as HTMLElement;
    expect(within(characterTree).queryByText('陆雪莹')).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByLabelText('选择冒险世界书'));
    const worldBookOptions = await screen.findAllByText('测试世界');
    fireEvent.click(worldBookOptions[worldBookOptions.length - 1]);

    await waitFor(() => {
      expect(useStoryStore.getState().selectedCharacterCardIds).toEqual(['cc-test']);
    });

    expect(within(characterTree).queryByText('陆雪莹')).not.toBeInTheDocument();

    fireEvent.click(within(characterTree).getByText('测试世界'));
    expect(within(characterTree).getByText('陆雪莹')).toBeInTheDocument();
    expect(useStoryStore.getState().selectedCharacterCardIds).toEqual(['cc-test']);

    fireEvent.click(within(characterTree).getByText('测试世界'));
    expect(within(characterTree).queryByText('陆雪莹')).not.toBeInTheDocument();
    expect(useStoryStore.getState().selectedCharacterCardIds).toEqual(['cc-test']);

    fireEvent.click(within(characterTree).getByText('未归属'));
    const freeCardNode = within(characterTree).getByText('游侠').closest('.ant-tree-treenode') as HTMLElement;
    fireEvent.click(freeCardNode.querySelector('.ant-tree-checkbox') as HTMLElement);

    expect(useStoryStore.getState().selectedCharacterCardIds).toEqual(['cc-test', 'cc-free']);
  });

  it('toggles all Character Cards in a directory from the Adventure selector', () => {
    usePartnerStore.setState({
      worldBooks: [worldBook],
      characterCards: [
        characterCard,
        {
          id: 'cc-companion',
          name: '同行者',
          type: 'character_card' as const,
          content: '# 角色卡：同行者',
          fields: {},
          worldBookId: worldBook.id,
        },
        {
          id: 'cc-free',
          name: '游侠',
          type: 'character_card' as const,
          content: '# 角色卡：游侠',
          fields: {},
          worldBookId: null,
        },
      ],
      selectedId: null,
      selectedType: null,
    });
    useStoryStore.setState({
      messages: [],
      selectedWorldBookId: null,
      selectedCharacterCardIds: [],
    });

    render(<Adventure />);

    const characterTree = document.querySelector('.ant-tree') as HTMLElement;
    const groupNode = within(characterTree).getByText('测试世界').closest('.ant-tree-treenode') as HTMLElement;
    const groupCheckbox = groupNode.querySelector('.ant-tree-checkbox') as HTMLElement;

    fireEvent.click(groupCheckbox);
    expect(useStoryStore.getState().selectedCharacterCardIds).toEqual(['cc-test', 'cc-companion']);

    fireEvent.click(groupCheckbox);
    expect(useStoryStore.getState().selectedCharacterCardIds).toEqual([]);
  });

  it('renders role_play results as full role chat boxes and keeps generic tools folded', () => {
    useStoryStore.setState({
      messages: [
        {
          id: 'a1',
          role: 'agent',
          content: '树影晃动。\n\n[[TOOL:rp-1]]\n\n[[TOOL:grep-1]]',
          tools: [
            {
              id: 'rp-1',
              name: 'role_play',
              arguments: '{"characterName":"陆雪莹"}',
              result: '别乱走，跟紧我。',
              status: 'success',
            },
            {
              id: 'grep-1',
              name: 'grep',
              arguments: '{"pattern":"x"}',
              result: 'grep output',
              status: 'success',
            },
          ],
        },
      ],
      selectedWorldBookId: worldBook.id,
      selectedCharacterCardIds: [characterCard.id],
      dynamicRoleLoadingEnabled: true,
    });

    render(<Adventure />);

    expect(screen.getByText('陆雪莹')).toBeInTheDocument();
    expect(screen.getByText('别乱走，跟紧我。')).toBeInTheDocument();
    expect(screen.getByText('工具：grep')).toBeInTheDocument();
  });

  it('does not show cold running tool text for pending role_play calls', () => {
    useStoryStore.setState({
      messages: [
        {
          id: 'a1',
          role: 'agent',
          content: '树影晃动。\n\n[[TOOL:rp-1]]',
          tools: [
            {
              id: 'rp-1',
              name: 'role_play',
              arguments: '{"characterName":"陆雪莹"}',
              result: '',
              status: 'running',
            },
          ],
        },
      ],
      selectedWorldBookId: worldBook.id,
      selectedCharacterCardIds: [characterCard.id],
      dynamicRoleLoadingEnabled: true,
    });

    render(<Adventure />);

    expect(screen.queryByText('正在执行工具')).not.toBeInTheDocument();
    expect(screen.queryByText('角色暂未回应。')).not.toBeInTheDocument();
  });
});
