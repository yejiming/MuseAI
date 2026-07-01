import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Background from '../pages/Background';
import { PartnerItem, usePartnerStore } from '../stores/usePartnerStore';

const invokeMock = vi.mocked(invoke);

const validSillyTavernV2Json = JSON.stringify({
  spec: 'chara_card_v2',
  spec_version: '2.0',
  name: '沈霜',
  description: '冷静沉着的战士',
  personality: '冷静',
  scenario: '并肩作战',
  first_mes: '你来了。',
  mes_example: '<START>\n测试',
  creator_notes: '由 MuseAI 转换',
  system_prompt: '',
  post_history_instructions: '保持中文',
  alternate_greetings: [],
  tags: ['中文'],
  creator: 'MuseAI',
  character_version: '2.0',
  extensions: {},
  character_book: { name: '沈霜世界书', entries: [] },
  data: {
    name: '沈霜',
    description: '冷静沉着的战士',
    personality: '冷静',
    scenario: '并肩作战',
    first_mes: '你来了。',
    mes_example: '<START>\n测试',
    creator_notes: '由 MuseAI 转换',
    system_prompt: '',
    post_history_instructions: '保持中文',
    alternate_greetings: [],
    tags: ['中文'],
    creator: 'MuseAI',
    character_version: '2.0',
    extensions: {},
    character_book: { name: '沈霜世界书', entries: [] },
  },
});

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

const worldBook = (id: string, name: string): PartnerItem => ({
  id,
  name,
  type: 'world_book',
  content: `# ${name}`,
  fields: {},
});

const characterCard = (id: string, name: string, worldBookId?: string | null): PartnerItem => ({
  id,
  name,
  type: 'character_card',
  content: `# 角色卡：${name}`,
  fields: { age: '18岁' },
  worldBookId,
});

describe('Background Character Card ownership', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'export_json_files_to_downloads') return ['/Users/test/Downloads/export.json'];
      if (command === 'convert_character_card_to_silly_tavern') return validSillyTavernV2Json;
      return undefined;
    });
    usePartnerStore.setState({
      worldBooks: [worldBook('wb-1', '云州世界书'), worldBook('wb-2', '北境世界书')],
      characterCards: [
        characterCard('cc-1', '沈霜', 'wb-1'),
        characterCard('cc-2', '顾临'),
      ],
      selectedId: null,
      selectedType: null,
    });
  });

  it('renders Character Cards grouped by World Book and unassigned folder', () => {
    render(<Background />);

    expect(screen.getAllByText('云州世界书').length).toBeGreaterThan(0);
    expect(screen.getByText('沈霜')).toBeInTheDocument();
    expect(screen.getByText('未归属')).toBeInTheDocument();
    expect(screen.getByText('顾临')).toBeInTheDocument();
  });

  it('toggles Character Card folders by clicking the folder title without changing selection', async () => {
    render(<Background />);

    fireEvent.click(screen.getByText('沈霜'));
    expect(usePartnerStore.getState().selectedId).toBe('cc-1');

    const tree = document.querySelector('.character-card-tree') as HTMLElement;
    const groupTitle = within(tree).getByText('云州世界书');

    fireEvent.click(groupTitle);

    await waitFor(() => {
      expect(within(tree).getByText('沈霜')).not.toBeVisible();
    });
    expect(usePartnerStore.getState().selectedId).toBe('cc-1');

    fireEvent.click(groupTitle);

    await waitFor(() => {
      expect(within(tree).getByText('沈霜')).toBeVisible();
    });
    expect(usePartnerStore.getState().selectedId).toBe('cc-1');
  });

  it('edits Character Card World Book ownership from the detail panel', async () => {
    render(<Background />);

    fireEvent.click(screen.getByText('沈霜'));
    expect(await screen.findByDisplayValue('沈霜')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByLabelText('归属世界书'));
    const northOptions = await screen.findAllByText('北境世界书');
    fireEvent.click(northOptions[northOptions.length - 1]);

    await waitFor(() => {
      expect(usePartnerStore.getState().characterCards.find((card) => card.id === 'cc-1')?.worldBookId).toBe('wb-2');
    });

    fireEvent.mouseDown(screen.getByLabelText('归属世界书'));
    const unassignedOptions = await screen.findAllByText('未归属');
    fireEvent.click(unassignedOptions[unassignedOptions.length - 1]);

    await waitFor(() => {
      expect(usePartnerStore.getState().characterCards.find((card) => card.id === 'cc-1')?.worldBookId).toBeNull();
    });
  });

  it('shows import controls in section headers and keeps export off the section headers', () => {
    render(<Background />);

    expect(screen.getByRole('button', { name: '导入世界书' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导入角色卡' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '导出世界书' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '导出角色卡' })).not.toBeInTheDocument();
  });

  it('asks how to delete a World Book and can keep owned Character Cards', async () => {
    render(<Background />);

    fireEvent.click(screen.getByLabelText('删除世界书 云州世界书'));

    expect(await screen.findByText('删除世界书')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除世界书本身' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除世界书及归属的角色卡' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '删除世界书本身' }));

    await waitFor(() => {
      expect(usePartnerStore.getState().worldBooks).toEqual([
        expect.objectContaining({ id: 'wb-2' }),
      ]);
      expect(usePartnerStore.getState().characterCards).toEqual([
        expect.objectContaining({ id: 'cc-1', worldBookId: null }),
        expect.objectContaining({ id: 'cc-2' }),
      ]);
    });
  });

  it('can delete a World Book with owned Character Cards from the confirm modal', async () => {
    render(<Background />);

    fireEvent.click(screen.getByLabelText('删除世界书 云州世界书'));
    fireEvent.click(await screen.findByRole('button', { name: '删除世界书及归属的角色卡' }));

    await waitFor(() => {
      expect(usePartnerStore.getState().worldBooks).toEqual([
        expect.objectContaining({ id: 'wb-2' }),
      ]);
      expect(usePartnerStore.getState().characterCards).toEqual([
        expect.objectContaining({ id: 'cc-2' }),
      ]);
    });
  });

  it('exports the selected World Book bundle from the right detail header into Downloads', async () => {
    render(<Background />);

    fireEvent.click(screen.getAllByText('云州世界书')[0]);
    fireEvent.click(await screen.findByRole('button', { name: '导出当前世界书' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('export_json_files_to_downloads', {
        directoryName: '云州世界书',
        files: expect.arrayContaining([
          expect.objectContaining({
            relativePath: '世界书.json',
            content: expect.stringContaining('"worldBooks"'),
          }),
          expect.objectContaining({
            relativePath: '角色卡/沈霜.json',
            content: expect.stringContaining('"characterCards"'),
          }),
        ]),
      });
    });
  });

  it('exports the selected Character Card in MuseAI format from the format selection modal', async () => {
    render(<Background />);

    fireEvent.click(screen.getByText('沈霜'));
    fireEvent.click(await screen.findByRole('button', { name: '导出当前角色卡' }));

    expect(await screen.findByText('选择导出格式')).toBeInTheDocument();
    fireEvent.click(screen.getByText('MuseAI 格式'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('export_json_files_to_downloads', {
        directoryName: null,
        files: [
          expect.objectContaining({
            relativePath: 'museai-character-card-沈霜.json',
            content: expect.stringContaining('"characterCards"'),
          }),
        ],
      });
    });
  });

  it('exports the selected Character Card in SillyTavern format after preview confirmation', async () => {
    render(<Background />);

    fireEvent.click(screen.getByText('沈霜'));
    fireEvent.click(await screen.findByRole('button', { name: '导出当前角色卡' }));

    expect(await screen.findByText('选择导出格式')).toBeInTheDocument();
    fireEvent.click(screen.getByText('SillyTavern 格式'));

    expect(await screen.findByText('SillyTavern 角色卡预览')).toBeInTheDocument();
    await screen.findByText('冷静沉着的战士');
    const confirmBtn = await screen.findByRole('button', { name: /确认导出/ });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('export_json_files_to_downloads', {
        directoryName: null,
        files: [
          expect.objectContaining({
            relativePath: 'sillytavern-character-card-沈霜.json',
            content: expect.stringContaining('"chara_card_v2"'),
          }),
        ],
      });
    });
  });

  it('shows an error and does not export when SillyTavern conversion fails', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'export_json_files_to_downloads') return ['/Users/test/Downloads/export.json'];
      if (command === 'convert_character_card_to_silly_tavern') throw new Error('转换失败：模型超时');
      return undefined;
    });

    render(<Background />);

    fireEvent.click(screen.getByText('沈霜'));
    fireEvent.click(await screen.findByRole('button', { name: '导出当前角色卡' }));

    expect(await screen.findByText('选择导出格式')).toBeInTheDocument();
    fireEvent.click(screen.getByText('SillyTavern 格式'));

    expect(await screen.findByText('转换失败')).toBeInTheDocument();
    const exportCalls = invokeMock.mock.calls.filter(
      (call) => call[0] === 'export_json_files_to_downloads',
    );
    expect(exportCalls).toHaveLength(0);
  });

  it('exports World Book directly without opening the format selection modal', async () => {
    render(<Background />);

    fireEvent.click(screen.getAllByText('云州世界书')[0]);
    fireEvent.click(await screen.findByRole('button', { name: '导出当前世界书' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('export_json_files_to_downloads', {
        directoryName: '云州世界书',
        files: expect.arrayContaining([
          expect.objectContaining({
            relativePath: '世界书.json',
            content: expect.stringContaining('"worldBooks"'),
          }),
        ]),
      });
    });
    expect(screen.queryByText('选择导出格式')).not.toBeInTheDocument();
  });

  it('imports multiple Character Card files through the hidden file input', async () => {
    render(<Background />);

    fireEvent.click(screen.getByRole('button', { name: '导入角色卡' }));
    const input = screen.getByLabelText('导入世界书或角色卡文件') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    const firstFile = new File([
      JSON.stringify({
        schema: 'museai.partner-items',
        version: 1,
        exportedAt: '2026-06-11T00:00:00.000Z',
        worldBooks: [],
        characterCards: [
          {
            name: '新导入角色',
            worldBookId: 'wb-1',
            fields: { age: 20 },
          },
        ],
      }),
    ], 'cards.json', { type: 'application/json' });
    const secondFile = new File([
      JSON.stringify({
        schema: 'museai.partner-items',
        version: 1,
        exportedAt: '2026-06-11T00:00:00.000Z',
        worldBooks: [],
        characterCards: [
          {
            name: '第二个角色',
            worldBookId: 'wb-1',
            fields: { age: 21 },
          },
        ],
      }),
    ], 'cards-2.json', { type: 'application/json' });

    fireEvent.change(input, { target: { files: [firstFile, secondFile] } });

    await waitFor(() => {
      expect(usePartnerStore.getState().characterCards).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: '新导入角色',
            worldBookId: 'wb-1',
            fields: expect.objectContaining({ age: '20' }),
          }),
          expect.objectContaining({
            name: '第二个角色',
            worldBookId: 'wb-1',
            fields: expect.objectContaining({ age: '21' }),
          }),
        ]),
      );
    });
  });
});
