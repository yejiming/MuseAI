import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Story from '../pages/Story';
import { usePartnerStore } from '../stores/usePartnerStore';
import { useStoryStore } from '../stores/useStoryStore';
import { useBookTravelStore } from '../stores/useBookTravelStore';

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

const invokeMock = vi.fn(async (command: string, _args?: any) => {
  if (command === 'list_agent_sessions') return [];
  if (command === 'plan_book_travel_scene') {
    return JSON.stringify({
      stateChanges: { time: '第一夜', location: '沈府' },
      divergence: '无',
      storyProgress: 1,
      endingStatus: 'none',
      sceneGoals: ['调查替嫁真相'],
      entryBeatGuidance: '醒来在喜房',
      allowedCast: ['林晚', '沈霜'],
      writerInstructions: '渲染喜房红烛气氛'
    });
  }
  if (command === 'write_book_travel_change_scene') {
    return JSON.stringify({
      id: 'scene-1',
      title: '醒在婚宴',
      summary: '喜房苏醒',
      currentSituation: '红烛高照',
      time: '第一夜',
      location: '沈府喜房',
      activeCharacters: ['林晚'],
      beat: {
        id: 'beat-1',
        content: '她在喜房里睁开眼。'
      },
      volatileMemoryPatch: { clue: '红头盖' }
    });
  }
  if (command === 'save_agent_session') return { id: 'story-session-test', title: '新故事', savedAt: Date.now(), sessionKind: 'bookTravel' };
  if (command === 'save_app_state' || command === 'load_app_state') return '';
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
      if (!handlers[eventName]) {
        handlers[eventName] = [];
      }
      handlers[eventName].push(handler);
      return () => {
        handlers[eventName] = handlers[eventName].filter(h => h !== handler);
      };
    },
  };
});

const worldBook = {
  id: 'wb-test',
  name: '云州世界书',
  type: 'world_book' as const,
  content: '世界书正文',
  fields: {},
};

const characterCard = {
  id: 'cc-test',
  name: '沈霜',
  type: 'character_card' as const,
  content: '角色卡正文',
  fields: {},
};

function resetStoryBookTravelStores() {
  usePartnerStore.setState({
    worldBooks: [worldBook],
    characterCards: [characterCard],
    selectedId: null,
    selectedType: null,
  });
  useStoryStore.setState({
    messages: [],
    selectedWorldBookId: null,
    selectedCharacterCardIds: [],
    initialPlot: '',
    isStreaming: false,
    dynamicRoleLoadingEnabled: false,
  });
  useBookTravelStore.getState().resetSession();
  useBookTravelStore.setState({ assembledMaterials: [], selectedMaterialId: null });
  invokeMock.mockClear();
}

function saveReadyMaterial() {
  return useBookTravelStore.getState().saveAssembledMaterial({
    title: '第一卷 · 云州入场',
    materials: {
      outline: { id: '/outline/第一卷.md', title: '第一卷.md', path: '/outline/第一卷.md', content: '大纲正文' },
      worldBook: { id: worldBook.id, title: worldBook.name, content: worldBook.content },
      characterCards: [{ id: characterCard.id, title: characterCard.name, content: characterCard.content }],
    },
    assembledWorldModel: { originalTimeline: ['原线开局'] },
    stableMemory: { worldRules: ['灵契不可违背'] },
    volatileMemory: { clues: [] },
    entryPoints: [
      {
        id: 'entry-1',
        title: '醒在婚宴',
        summary: '红烛未灭，宾客已散',
        timeAndLocation: '第一夜，沈府',
        situation: '红烛未灭，宾客已散',
        initialGoal: '查清替嫁真相',
        risk: '被沈家识破',
      },
    ],
    recommendedUserCharacters: [
      {
        name: '林晚',
        identity: '替嫁者',
        background: '从现代穿入原书',
        personality: '清醒谨慎',
        goal: '改写死局',
      },
    ],
  });
}

describe('Story book-travel mode', () => {
  beforeEach(() => {
    resetStoryBookTravelStores();
  });

  it('shows assembled material selection before book-travel can start', () => {
    renderWithRouter(<Story />);

    expect(screen.getByText('选择穿书素材')).toBeInTheDocument();
    expect(screen.getByText(/暂无已装配素材/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /开始穿书/ })).toBeDisabled();
  });

  it('loads selected assembled material and shows entry setup with recommended identity', async () => {
    saveReadyMaterial();
    renderWithRouter(<Story />);

    // Open the material Select dropdown
    const select = screen.getByRole('combobox');
    fireEvent.mouseDown(select);
    fireEvent.click(await screen.findByText('第一卷 · 云州入场'));

    expect(await screen.findByText('选择入场点')).toBeInTheDocument();
    expect(screen.getByText('醒在婚宴')).toBeInTheDocument();
    expect(screen.getByText(/林晚/)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/林晚/));

    expect(useBookTravelStore.getState().selectedOutline?.content).toBe('大纲正文');
    expect(useBookTravelStore.getState().entryPoints[0].id).toBe('entry-1');
    expect(useBookTravelStore.getState().userCharacter?.name).toBe('林晚');
  });

  it('renders active scene with current beat', async () => {
    useBookTravelStore.setState({
      selectedEntryPointId: 'entry-1',
      userCharacter: { name: '林晚', identity: '替嫁者', goal: '改写死局' },
      currentState: { time: '第一夜', location: '沈府' },
      scenes: [{
        id: 'scene-1',
        title: '沈府婚宴',
        summary: '主角醒来',
        currentSituation: '红烛未灭',
        beats: [
          {
            id: 'beat-1',
            content: '她在喜房里睁开眼。',
          },
          {
            id: 'beat-2',
            content: '门外长廊空无一人。',
          },
        ],
        currentSceneId: 'scene-1',
        currentBeatId: 'beat-1',
      } as any],
      currentSceneId: 'scene-1',
      currentBeatId: 'beat-1',
      turns: [{
        id: 'turn-1',
        userInput: '醒来',
        classification: 'change-scene' as const,
        narrativeOutput: '她在喜房里睁开眼。',
        stateSnapshot: { time: '第一夜', location: '沈府' },
        createdSceneId: 'scene-1',
        createdBeatIds: ['beat-1'],
      }],
    });

    renderWithRouter(<Story />);

    expect(screen.getByText('沈府婚宴')).toBeInTheDocument();
    expect(screen.getByText('她在喜房里睁开眼。')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/说些什么/)).toBeInTheDocument();
  });

  it('hides composer when book-travel is completed', () => {
    useBookTravelStore.setState({
      scenes: [{
        id: 'scene-1',
        title: '沈府婚宴',
        beats: [{ id: 'beat-1', content: '她在喜房里睁开眼。' }],
      } as any],
      currentSceneId: 'scene-1',
      currentBeatId: 'beat-1',
      isCompleted: true,
      ending: {
        finalEnding: '林晚改写婚宴死局。',
        worldlineName: '红烛未灭线',
        divergenceScore: 42,
      },
    });

    renderWithRouter(<Story />);

    // Composer should be hidden when completed
    expect(screen.queryByPlaceholderText(/说些什么/)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/做点什么/)).not.toBeInTheDocument();
  });

  it('enables start button after selecting material, entry point and character', async () => {
    saveReadyMaterial();
    renderWithRouter(<Story />);

    // Open the material Select dropdown
    const select = screen.getByRole('combobox');
    fireEvent.mouseDown(select);
    fireEvent.click(await screen.findByText('第一卷 · 云州入场'));

    expect(await screen.findByText('选择入场点')).toBeInTheDocument();

    // Select entry point and character
    fireEvent.click(screen.getByText(/林晚/));

    const startBtn = screen.getByRole('button', { name: /开始穿书/ });
    expect(startBtn).toBeEnabled();
  });
});
