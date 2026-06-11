import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BookTravelMaterials from '../pages/BookTravelMaterials';
import { useBookTravelStore } from '../stores/useBookTravelStore';
import { usePartnerStore } from '../stores/usePartnerStore';

const invokeMock = vi.fn(async (command: string, args?: any) => {
  if (command === 'get_workspace_dir' && args?.dirType === 'outline') return '/outline';
  if (command === 'list_dir' && args?.path === '/outline') {
    return [
      { name: '长篇', path: '/outline/长篇', is_dir: true },
      { name: '短篇.md', path: '/outline/短篇.md', is_dir: false },
    ];
  }
  if (command === 'list_dir' && args?.path === '/outline/长篇') {
    return [{ name: '第一卷.md', path: '/outline/长篇/第一卷.md', is_dir: false }];
  }
  if (command === 'read_file' && args?.path === '/outline/长篇/第一卷.md') return '第一卷大纲正文';
  if (command === 'start_assemble_book_travel_materials_stream') {
    setTimeout(() => {
      const handlers = (globalThis as any).eventHandlers?.['book-travel-stream'] || [];
      handlers.forEach((handler: any) => handler({
        payload: {
          runId: 'assemble-run',
          eventType: 'done',
          message: JSON.stringify({
            assembledWorldModel: { originalTimeline: ['小说开篇'] },
            stableMemory: { worldRules: ['原书因果有效'] },
            volatileMemory: { clues: [] },
          }),
        },
      }));
    }, 5);
    return { runId: 'assemble-run' };
  }
  if (command === 'start_generate_book_travel_entry_setup_stream') {
    setTimeout(() => {
      const handlers = (globalThis as any).eventHandlers?.['book-travel-stream'] || [];
      handlers.forEach((handler: any) => handler({
        payload: {
          runId: 'entry-run',
          eventType: 'done',
          message: JSON.stringify({
            entryPoints: [{ id: 'entry-start', title: '小说开篇', summary: '从第一章开始进入' }],
            recommendedUserCharacters: [{ name: '林晚', identity: '穿书者', goal: '改写死局' }],
          }),
        },
      }));
    }, 5);
    return { runId: 'entry-run' };
  }
  return undefined;
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: any) => invokeMock(command, args),
}));

vi.mock('@tauri-apps/api/event', () => {
  const handlers: Record<string, any[]> = {};
  (globalThis as any).eventHandlers = handlers;
  return {
    listen: async (eventName: string, handler: (event: any) => void) => {
      handlers[eventName] = [...(handlers[eventName] || []), handler];
      return () => {
        handlers[eventName] = (handlers[eventName] || []).filter((item) => item !== handler);
      };
    },
  };
});

describe('BookTravelMaterials page', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    useBookTravelStore.getState().resetSession();
    useBookTravelStore.setState({ assembledMaterials: [], selectedMaterialId: null });
    usePartnerStore.setState({
      worldBooks: [{ id: 'wb-1', name: '云州世界书', type: 'world_book', content: '世界书正文', fields: {} }],
      characterCards: [
        { id: 'cc-1', name: '沈霜', type: 'character_card', content: '角色卡正文', fields: {}, worldBookId: 'wb-1' },
        { id: 'cc-2', name: '游侠', type: 'character_card', content: '游侠正文', fields: {}, worldBookId: null },
      ],
      selectedId: null,
      selectedType: null,
    });
  });

  it('assembles a material from outline tree, world book, and character cards', async () => {
    render(<BookTravelMaterials />);

    fireEvent.click(screen.getByRole('button', { name: /新增素材/ }));

    expect(await screen.findByText('素材装配')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByLabelText('选择穿书大纲'));
    fireEvent.click(await screen.findByText('第一卷.md'));
    fireEvent.mouseDown(screen.getByLabelText('选择穿书世界书'));
    const worldBookOptions = await screen.findAllByText('云州世界书');
    fireEvent.click(worldBookOptions[worldBookOptions.length - 1]);
    const freeCardNode = screen.getByText('游侠').closest('.ant-tree-treenode') as HTMLElement;
    fireEvent.click(freeCardNode.querySelector('.ant-tree-checkbox') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: /开始装配/ }));

    expect((await screen.findAllByText('第一卷.md · 云州世界书')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: /入场点/ }));
    expect(await screen.findAllByDisplayValue('小说开篇')).not.toHaveLength(0);
    expect(useBookTravelStore.getState().assembledMaterials[0].materials.outline.content).toBe('第一卷大纲正文');
    expect(useBookTravelStore.getState().assembledMaterials[0].materials.characterCards.map((card) => card.title)).toEqual(['沈霜', '游侠']);
  });

  it('toggles all Character Cards in a directory from the material selector', async () => {
    usePartnerStore.setState({
      characterCards: [
        { id: 'cc-1', name: '沈霜', type: 'character_card', content: '角色卡正文', fields: {}, worldBookId: 'wb-1' },
        { id: 'cc-3', name: '顾临', type: 'character_card', content: '顾临正文', fields: {}, worldBookId: 'wb-1' },
        { id: 'cc-2', name: '游侠', type: 'character_card', content: '游侠正文', fields: {}, worldBookId: null },
      ],
    });

    render(<BookTravelMaterials />);

    fireEvent.click(screen.getByRole('button', { name: /新增素材/ }));
    expect(await screen.findByText('素材装配')).toBeInTheDocument();

    const characterTree = document.querySelector('.ant-tree') as HTMLElement;
    const groupNode = within(characterTree).getByText('云州世界书').closest('.ant-tree-treenode') as HTMLElement;
    const firstCardNode = within(characterTree).getByText('沈霜').closest('.ant-tree-treenode') as HTMLElement;
    const secondCardNode = within(characterTree).getByText('顾临').closest('.ant-tree-treenode') as HTMLElement;
    const freeCardNode = within(characterTree).getByText('游侠').closest('.ant-tree-treenode') as HTMLElement;

    fireEvent.click(groupNode.querySelector('.ant-tree-checkbox') as HTMLElement);
    expect(firstCardNode.querySelector('.ant-tree-checkbox')).toHaveClass('ant-tree-checkbox-checked');
    expect(secondCardNode.querySelector('.ant-tree-checkbox')).toHaveClass('ant-tree-checkbox-checked');
    expect(freeCardNode.querySelector('.ant-tree-checkbox')).not.toHaveClass('ant-tree-checkbox-checked');

    fireEvent.click(groupNode.querySelector('.ant-tree-checkbox') as HTMLElement);
    expect(firstCardNode.querySelector('.ant-tree-checkbox')).not.toHaveClass('ant-tree-checkbox-checked');
    expect(secondCardNode.querySelector('.ant-tree-checkbox')).not.toHaveClass('ant-tree-checkbox-checked');
  });

  it('allows editing the selected assembled material detail', async () => {
    useBookTravelStore.getState().saveAssembledMaterial({
      title: '旧素材标题',
      materials: {
        outline: { id: '/outline/旧.md', title: '旧.md', content: '旧大纲' },
        worldBook: { id: 'wb-1', title: '云州世界书', content: '世界书正文' },
        characterCards: [{ id: 'cc-1', title: '沈霜', content: '角色卡正文' }],
      },
      assembledWorldModel: { originalTimeline: ['旧线'] },
      stableMemory: { worldRules: ['旧规则'] },
      volatileMemory: { clues: [] },
      entryPoints: [{ id: 'entry-1', title: '旧入场', summary: '旧摘要' }],
      recommendedUserCharacters: [{ name: '林晚', identity: '穿书者', goal: '改写死局' }],
    });

    render(<BookTravelMaterials />);

    const detail = screen.getByLabelText('素材详情');
    const titleInput = within(detail).getByLabelText('素材名称');
    fireEvent.change(titleInput, { target: { value: '新素材标题' } });
    fireEvent.click(screen.getByRole('button', { name: /保存素材详情/ }));

    await waitFor(() => {
      expect(useBookTravelStore.getState().assembledMaterials[0].title).toBe('新素材标题');
    });
  });
});
