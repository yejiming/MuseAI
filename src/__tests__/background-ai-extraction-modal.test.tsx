import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Background from '../pages/Background';
import { usePartnerStore } from '../stores/usePartnerStore';
import { useSettingsStore } from '../stores/useSettingsStore';

const invokeMock = vi.mocked(invoke);

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

const filePath = '/Users/test/Documents/MuseAI/articles/chapter.md';

function resetStores() {
  usePartnerStore.setState({
    worldBooks: [],
    characterCards: [],
    selectedId: null,
    selectedType: null,
  });
  useSettingsStore.setState({
    llmApiKey: 'key',
    llmBaseUrl: 'https://llm.test',
    llmModel: 'model',
    modelInterface: 'OpenAI-compatible',
    backgroundWorldBookPrompt: '世界书自定义系统提示词',
    backgroundCharacterCardPrompt: '角色卡自定义系统提示词',
    agentConfigs: {
      ...useSettingsStore.getState().agentConfigs,
      backgroundExtraction: { concurrency: 5 },
      backgroundWorldBook: {
        temperature: 0.2,
        maxOutputTokens: 6000,
        maxContextTokens: 90000,
        thinkingDepth: 'low',
      },
      backgroundCharacterCard: {
        temperature: 0.4,
        maxOutputTokens: 7000,
        maxContextTokens: 80000,
        thinkingDepth: 'medium',
      },
    },
  });
}

function mockWorkspaceInvoke() {
  invokeMock.mockImplementation(async (command: string, args?: any) => {
    if (command === 'get_workspace_dir') return `/Users/test/Documents/MuseAI/${args.dirType}`;
    if (command === 'list_dir') {
      if (args.path.endsWith('/articles')) {
        return [{ name: 'chapter.md', path: filePath, is_dir: false }];
      }
      return [];
    }
    if (command === 'read_file') return '林逸和陆雪莹在魔法学院调查以太风暴。';
    if (command === 'generate_background_stage_one') {
      return {
        worldBooks: [
          {
            name: '奥兰魔法大陆',
            fields: {
              theme: '魔法冒险',
              era: '魔法工业时代',
            },
          },
        ],
        characterNames: ['林逸', '陆雪莹'],
      };
    }
    if (command === 'generate_background_character_card') {
      if (args.request.characterName === '失败角色') {
        throw new Error('角色信息不足');
      }
      if (args.request.characterName === '原始输出失败') {
        throw new Error('模型没有返回合法 JSON，请重新分析：expected `,` or `}`\n\n---RAW_MODEL_OUTPUT_START---\n{"name":"原始输出失败","fields":{"age":"18岁"\n---RAW_MODEL_OUTPUT_END---');
      }
      if (args.request.characterName === '截断角色') {
        throw new Error('模型没有返回合法 JSON，请重新分析：模型返回的 JSON 被截断了（输出超长）。\n建议：1）减少选中文件数量或先用“AI反向分析大纲”精简原文；\n2）改用“仅提取世界书”或减少角色名数量；\n3）更换支持更长输出的模型后重试。\n\n---RAW_MODEL_OUTPUT_START---\n{"name":"截断角色","fields":{"backgroundStory":"很长很长"\n---RAW_MODEL_OUTPUT_END---');
      }
      return {
        name: args.request.characterName,
        fields: {
          age: '18岁',
          gender: '未知',
          backgroundStory: `${args.request.characterName}的背景`,
        },
      };
    }
    return undefined;
  });
}

async function openModal() {
  render(<Background />);
  fireEvent.click(screen.getByRole('button', { name: /AI 智能提取/ }));
  expect(await screen.findByText('AI 智能提取背景设定')).toBeInTheDocument();
}

async function checkArticleFile() {
  const articlePanel = await screen.findByText('我的作品 (Articles)');
  const section = articlePanel.closest('div')?.parentElement as HTMLElement;
  const checkbox = within(section).getByRole('checkbox');
  fireEvent.click(checkbox);
}

describe('Background AI extraction modal', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetStores();
    mockWorkspaceInvoke();
  });

  it('shows mode selector and removes the extraction requirements field', async () => {
    await openModal();

    expect(screen.getByText('仅提取世界书')).toBeInTheDocument();
    expect(screen.getByText('仅提取角色卡')).toBeInTheDocument();
    expect(screen.getByText('提取世界书和角色卡')).toBeInTheDocument();
    expect(screen.queryByText('提取要求（可选）')).not.toBeInTheDocument();
  });

  it('reviews stage-one output before saving the world book and starting stage two', async () => {
    await openModal();
    await checkArticleFile();

    fireEvent.click(screen.getByRole('button', { name: '开始智能提取' }));

    expect(await screen.findByDisplayValue('奥兰魔法大陆')).toBeInTheDocument();
    expect(screen.getByDisplayValue(/林逸[\s\S]*陆雪莹/)).toBeInTheDocument();
    expect(usePartnerStore.getState().worldBooks).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '确认并生成角色卡' }));

    await waitFor(() => {
      expect(usePartnerStore.getState().worldBooks).toHaveLength(1);
      expect(usePartnerStore.getState().characterCards).toHaveLength(2);
    });
    const generatedWorldBookId = usePartnerStore.getState().worldBooks[0].id;
    expect(usePartnerStore.getState().characterCards.map((card) => card.worldBookId)).toEqual([
      generatedWorldBookId,
      generatedWorldBookId,
    ]);
    expect(invokeMock).toHaveBeenCalledWith(
      'generate_background_stage_one',
      expect.objectContaining({
        request: expect.objectContaining({
          temperature: 0.2,
          maxOutputTokens: 6000,
          maxContextTokens: 90000,
          thinkingDepth: 'low',
          systemPrompt: '世界书自定义系统提示词',
        }),
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      'generate_background_character_card',
      expect.objectContaining({
        request: expect.objectContaining({
          temperature: 0.4,
          maxOutputTokens: 7000,
          maxContextTokens: 80000,
          thinkingDepth: 'medium',
          systemPrompt: '角色卡自定义系统提示词',
        }),
      }),
    );
  });

  it('uses configured background character concurrency', async () => {
    useSettingsStore.setState({
      agentConfigs: {
        ...useSettingsStore.getState().agentConfigs,
        backgroundExtraction: { concurrency: 1 },
      },
    });
    let active = 0;
    let maxActive = 0;
    const resolvers: Array<() => void> = [];
    invokeMock.mockImplementation(async (command: string, args?: any) => {
      if (command === 'get_workspace_dir') return `/Users/test/Documents/MuseAI/${args.dirType}`;
      if (command === 'list_dir') {
        if (args.path.endsWith('/articles')) return [{ name: 'chapter.md', path: filePath, is_dir: false }];
        return [];
      }
      if (command === 'read_file') return '参考正文';
      if (command === 'generate_background_character_card') {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => resolvers.push(resolve));
        active -= 1;
        return { name: args.request.characterName, fields: { age: '18岁' } };
      }
      return undefined;
    });

    const promise = (async () => {
      await openModal();
      fireEvent.click(screen.getByText('仅提取角色卡'));
      fireEvent.change(screen.getByPlaceholderText('每行输入一个角色名'), {
        target: { value: '林逸\n陆雪莹' },
      });
      await checkArticleFile();
      fireEvent.click(screen.getByRole('button', { name: '开始智能提取' }));
    })();

    await waitFor(() => expect(resolvers).toHaveLength(1));
    expect(maxActive).toBe(1);
    resolvers.splice(0).forEach((resolve) => resolve());
    await waitFor(() => expect(resolvers).toHaveLength(1));
    expect(maxActive).toBe(1);
    resolvers.splice(0).forEach((resolve) => resolve());
    await promise;
  });

  it('allows aborting and locks mode switching while stage-one extraction is running', async () => {
    let resolveStageOne: (value: unknown) => void = () => {};
    (globalThis as { __MUSEAI_BACKGROUND_CANCELLATION_SETTLE_MS__?: number })
      .__MUSEAI_BACKGROUND_CANCELLATION_SETTLE_MS__ = 100;
    try {
      invokeMock.mockImplementation(async (command: string, args?: any) => {
        if (command === 'get_workspace_dir') return `/Users/test/Documents/MuseAI/${args.dirType}`;
        if (command === 'list_dir') {
          if (args.path.endsWith('/articles')) return [{ name: 'chapter.md', path: filePath, is_dir: false }];
          return [];
        }
        if (command === 'read_file') return '参考正文';
        if (command === 'generate_background_stage_one') {
          return await new Promise((resolve) => {
            resolveStageOne = resolve;
          });
        }
        return undefined;
      });

      await openModal();
      await checkArticleFile();
      fireEvent.click(screen.getByRole('button', { name: '开始智能提取' }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '中断提取' })).toBeEnabled();
        expect(screen.getByRole('radio', { name: '仅提取角色卡' })).toBeDisabled();
      });

      fireEvent.click(screen.getByRole('radio', { name: '仅提取角色卡' }));
      expect(screen.queryByPlaceholderText('每行输入一个角色名')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: '中断提取' }));

      resolveStageOne({
        worldBooks: [{ name: '奥兰魔法大陆', fields: { theme: '魔法冒险' } }],
        characterNames: [],
      });

      expect(await screen.findByRole('button', { name: '正在释放连接' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: '开始智能提取' })).not.toBeInTheDocument();

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: '正在释放连接' })).not.toBeInTheDocument();
      });
    } finally {
      delete (globalThis as { __MUSEAI_BACKGROUND_CANCELLATION_SETTLE_MS__?: number })
        .__MUSEAI_BACKGROUND_CANCELLATION_SETTLE_MS__;
    }
  });

  it('keeps continue extraction locked during cancellation settling', async () => {
    const resolvers: Array<() => void> = [];
    (globalThis as { __MUSEAI_BACKGROUND_CANCELLATION_SETTLE_MS__?: number })
      .__MUSEAI_BACKGROUND_CANCELLATION_SETTLE_MS__ = 100;
    try {
      invokeMock.mockImplementation(async (command: string, args?: any) => {
        if (command === 'get_workspace_dir') return `/Users/test/Documents/MuseAI/${args.dirType}`;
        if (command === 'list_dir') {
          if (args.path.endsWith('/articles')) return [{ name: 'chapter.md', path: filePath, is_dir: false }];
          return [];
        }
        if (command === 'read_file') return '参考正文';
        if (command === 'generate_background_character_card') {
          await new Promise<void>((resolve) => resolvers.push(resolve));
          return { name: args.request.characterName, fields: { age: '18岁' } };
        }
        return undefined;
      });

      await openModal();
      fireEvent.click(screen.getByText('仅提取角色卡'));
      fireEvent.change(screen.getByPlaceholderText('每行输入一个角色名'), {
        target: { value: '林逸' },
      });
      await checkArticleFile();

      fireEvent.click(screen.getByRole('button', { name: '开始智能提取' }));
      await waitFor(() => expect(resolvers).toHaveLength(1));

      fireEvent.click(screen.getByRole('button', { name: '中断提取' }));
      resolvers[0]();

      expect(await screen.findByRole('button', { name: '正在释放连接' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: '继续提取' })).not.toBeInTheDocument();

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: '正在释放连接' })).not.toBeInTheDocument();
      });
    } finally {
      delete (globalThis as { __MUSEAI_BACKGROUND_CANCELLATION_SETTLE_MS__?: number })
        .__MUSEAI_BACKGROUND_CANCELLATION_SETTLE_MS__;
    }
  });

  it('runs character-card-only mode from manually entered names and saves only successful cards', async () => {
    await openModal();

    fireEvent.click(screen.getByText('仅提取角色卡'));
    fireEvent.change(screen.getByPlaceholderText('每行输入一个角色名'), {
      target: { value: '林逸\n失败角色\n陆雪莹' },
    });
    await checkArticleFile();

    fireEvent.click(screen.getByRole('button', { name: '开始智能提取' }));

    expect(await screen.findByText('失败角色')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('失败')).toBeInTheDocument();
      expect(screen.getAllByText('成功')).toHaveLength(2);
    });

    const cards = usePartnerStore.getState().characterCards;
    expect(cards.map((card) => card.name)).toEqual(['林逸', '陆雪莹']);
    expect(cards.map((card) => card.worldBookId)).toEqual([null, null]);
    expect(invokeMock).not.toHaveBeenCalledWith('generate_background_stage_one', expect.anything());
  });

  it('keeps the generated World Book binding when retrying failed full-extraction cards', async () => {
    let attempt = 0;
    invokeMock.mockImplementation(async (command: string, args?: any) => {
      if (command === 'get_workspace_dir') return `/Users/test/Documents/MuseAI/${args.dirType}`;
      if (command === 'list_dir') {
        if (args.path.endsWith('/articles')) return [{ name: 'chapter.md', path: filePath, is_dir: false }];
        return [];
      }
      if (command === 'read_file') return '参考正文';
      if (command === 'generate_background_stage_one') {
        return {
          worldBooks: [{ name: '奥兰魔法大陆', fields: { theme: '魔法冒险' } }],
          characterNames: ['失败角色'],
        };
      }
      if (command === 'generate_background_character_card') {
        attempt += 1;
        if (attempt === 1) {
          throw new Error('角色信息不足');
        }
        return {
          name: args.request.characterName,
          fields: { age: '18岁' },
        };
      }
      return undefined;
    });

    await openModal();
    await checkArticleFile();

    fireEvent.click(screen.getByRole('button', { name: '开始智能提取' }));
    expect(await screen.findByDisplayValue('奥兰魔法大陆')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认并生成角色卡' }));

    expect(await screen.findByRole('button', { name: '重试失败角色' })).toBeInTheDocument();
    expect(usePartnerStore.getState().characterCards).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '重试失败角色' }));

    await waitFor(() => {
      expect(usePartnerStore.getState().characterCards).toHaveLength(1);
    });
    expect(usePartnerStore.getState().characterCards[0]).toEqual(expect.objectContaining({
      name: '失败角色',
      worldBookId: usePartnerStore.getState().worldBooks[0].id,
    }));
  });

  it('lets users expand failed character cards to inspect failure details', async () => {
    await openModal();

    fireEvent.click(screen.getByText('仅提取角色卡'));
    fireEvent.change(screen.getByPlaceholderText('每行输入一个角色名'), {
      target: { value: '失败角色' },
    });
    await checkArticleFile();

    fireEvent.click(screen.getByRole('button', { name: '开始智能提取' }));

    const failedHeader = await screen.findByText('失败角色');
    fireEvent.click(failedHeader);

    expect(await screen.findByText(/角色信息不足/)).toBeInTheDocument();
  });

  it('shows raw model output when a failed character includes it', async () => {
    await openModal();

    fireEvent.click(screen.getByText('仅提取角色卡'));
    fireEvent.change(screen.getByPlaceholderText('每行输入一个角色名'), {
      target: { value: '原始输出失败' },
    });
    await checkArticleFile();

    fireEvent.click(screen.getByRole('button', { name: '开始智能提取' }));

    const failedHeader = await screen.findByText('原始输出失败');
    fireEvent.click(failedHeader);

    expect(await screen.findByText('后端原始信息')).toBeInTheDocument();
    expect(screen.getByText(/"name":"原始输出失败"/)).toBeInTheDocument();
  });

  it('shortens truncated JSON errors and keeps raw output in failed character details', async () => {
    await openModal();

    fireEvent.click(screen.getByText('仅提取角色卡'));
    fireEvent.change(screen.getByPlaceholderText('每行输入一个角色名'), {
      target: { value: '截断角色' },
    });
    await checkArticleFile();

    fireEvent.click(screen.getByRole('button', { name: '开始智能提取' }));

    const failedHeader = await screen.findByText('截断角色');
    fireEvent.click(failedHeader);

    expect(await screen.findByText('后端原始信息')).toBeInTheDocument();
    expect(screen.getByText(/建议：1/)).toBeInTheDocument();
    expect(screen.getByText(/---RAW_MODEL_OUTPUT_START---/)).toBeInTheDocument();
    expect(screen.getByText(/"name":"截断角色"/)).toBeInTheDocument();
  });
});
