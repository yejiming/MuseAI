import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Modal } from 'antd';
import Story from '../pages/Story';
import { usePartnerStore } from '../stores/usePartnerStore';
import { useStoryStore } from '../stores/useStoryStore';
import { useBookTravelStore, type BookTravelSnapshot } from '../stores/useBookTravelStore';
import { useStylePresetStore } from '../stores/useStylePresetStore';

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

function mockNarrowBookTravelLayout(matches: boolean) {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: query.includes('1100px') ? matches : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function emitBookTravelEvent(payload: any) {
  const handlers = (globalThis as any).eventHandlers?.['book-travel-stream'] || [];
  handlers.forEach((handler: any) => handler({ payload }));
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

const defaultInvoke = async (command: string, args?: any): Promise<any> => {
  if (command === 'list_agent_sessions') return [];
  if (command === 'classify_book_travel_input') return { classification: 'insert-beat' };
  if (command === 'start_write_book_travel_insert_beat_stream') {
    const runId = 'insert-run';
    setTimeout(() => {
      emitBookTravelEvent({
        runId,
        eventType: 'done',
        message: JSON.stringify({
          id: 'scene-1',
          beat: { id: 'beat-2', content: `她回应了：${args?.userInput}` },
          volatileMemoryPatch: { lastAction: args?.userInput },
        }),
      });
    }, 0);
    return { runId };
  }
  if (command === 'plan_book_travel_scene') {
    return JSON.stringify({
      id: 'scene-1',
      title: '醒在婚宴',
      summary: '喜房苏醒',
      currentSituation: '红烛高照',
      time: '第一夜',
      location: '沈府喜房',
      activeCharacters: ['林晚', '沈霜'],
      stateChanges: {},
      divergence: '无',
      storyProgress: 1,
      endingStatus: 'none',
      sceneGoals: ['调查替嫁真相'],
      entryBeatGuidance: '醒来在喜房',
      writerInstructions: '渲染喜房红烛气氛'
    });
  }
  if (command === 'start_plan_book_travel_scene_stream') {
    const runId = 'planner-run';
    setTimeout(() => {
      emitBookTravelEvent({
        runId,
        eventType: 'done',
        message: JSON.stringify({
          id: 'scene-1',
          title: '醒在婚宴',
          summary: '喜房苏醒',
          currentSituation: '红烛高照',
          time: '第一夜',
          location: '沈府喜房',
          activeCharacters: ['林晚', '沈霜'],
          stateChanges: {},
          divergence: '无',
          storyProgress: 1,
          endingStatus: 'none',
          sceneGoals: ['调查替嫁真相'],
          entryBeatGuidance: '醒来在喜房',
          writerInstructions: '渲染喜房红烛气氛'
        }),
      });
    }, 0);
    return { runId };
  }
  if (command === 'write_book_travel_change_scene') {
    return JSON.stringify({
      beat: {
        id: 'beat-1',
        content: '她在喜房里睁开眼。'
      },
      volatileMemoryPatch: { clue: '红头盖' }
    });
  }
  if (command === 'start_write_book_travel_change_scene_stream') {
    const runId = 'change-writer-run';
    setTimeout(() => {
      emitBookTravelEvent({
        runId,
        eventType: 'done',
        message: JSON.stringify({
          beat: {
            id: 'beat-1',
            content: '她在喜房里睁开眼。'
          },
          volatileMemoryPatch: { clue: '红头盖' }
        }),
      });
    }, 0);
    return { runId };
  }
  if (command === 'save_agent_session') return { id: 'story-session-test', title: '新故事', savedAt: Date.now(), sessionKind: 'bookTravel' };
  if (command === 'summarize_book_travel_memory') return JSON.stringify({ summary: '林晚继续推进替嫁线。' });
  if (command === 'save_app_state' || command === 'load_app_state') return '';
  return undefined;
};

const invokeMock = vi.fn(defaultInvoke);

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
    input: '',
    inputMode: 'speech',
    selectedWorldBookId: null,
    selectedCharacterCardIds: [],
    initialPlot: '',
    isStreaming: false,
    dynamicRoleLoadingEnabled: false,
  });
  useBookTravelStore.getState().resetSession();
  useBookTravelStore.setState({
    assembledMaterials: [],
    selectedMaterialId: null,
    savedProgresses: [],
    activeSavedProgressId: null,
  });
  invokeMock.mockClear();
  invokeMock.mockImplementation(defaultInvoke);
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

function setActiveBookTravelScene() {
  useBookTravelStore.setState({
    selectedOutline: { id: '/outline/第一卷.md', title: '第一卷.md', path: '/outline/第一卷.md', content: '大纲正文' },
    selectedWorldBook: { id: worldBook.id, title: worldBook.name, content: worldBook.content },
    selectedCharacterCards: [{ id: characterCard.id, title: characterCard.name, content: characterCard.content }],
    selectedEntryPointId: 'entry-1',
    userCharacter: { name: '林晚', identity: '替嫁者', goal: '改写死局' },
    currentState: { time: '第一夜', location: '沈府' },
    stableMemory: { worldRules: ['灵契不可违背'] },
    volatileMemory: { clues: ['红头盖'] },
    assembledWorldModel: { originalTimeline: ['原线开局'] },
    summaryMemory: '林晚在沈府喜房醒来，发现自己卷入替嫁局。',
    scenes: [{
      id: 'scene-1',
      title: '沈府婚宴',
      summary: '主角醒来',
      currentSituation: '红烛未灭',
      time: '第一夜',
      location: '沈府',
      activeCharacters: ['林晚', '沈霜'],
      beats: [
        {
          id: 'beat-1',
          content: '她在喜房里睁开眼。',
        },
      ],
    }],
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
}

function getCurrentBookTravelSnapshot(overrides: Partial<BookTravelSnapshot> = {}): BookTravelSnapshot {
  const state = useBookTravelStore.getState();
  return {
    selectedOutline: state.selectedOutline,
    selectedWorldBook: state.selectedWorldBook,
    selectedCharacterCards: state.selectedCharacterCards,
    assembledWorldModel: state.assembledWorldModel,
    stableMemory: state.stableMemory,
    volatileMemory: state.volatileMemory,
    entryPoints: state.entryPoints,
    recommendedUserCharacters: state.recommendedUserCharacters,
    selectedEntryPointId: state.selectedEntryPointId,
    userCharacter: state.userCharacter,
    currentState: state.currentState,
    scenes: state.scenes,
    currentSceneId: state.currentSceneId,
    currentBeatId: state.currentBeatId,
    turns: state.turns,
    summaryMemory: state.summaryMemory,
    isCompleted: state.isCompleted,
    ending: state.ending,
    input: state.input,
    inputMode: state.inputMode,
    selectedStylePresetIds: state.selectedStylePresetIds,
    initialStylePresetIds: state.initialStylePresetIds,
    initialSystemPromptSnapshot: state.initialSystemPromptSnapshot,
    ...overrides,
  };
}

describe('Story book-travel mode', () => {
  beforeEach(() => {
    Modal.destroyAll();
    document.body.innerHTML = '';
    mockNarrowBookTravelLayout(false);
    resetStoryBookTravelStores();
    useStylePresetStore.setState({ presets: [] });
  });

  it('穿书开始后隐藏文风预设修改入口', () => {
    useStylePresetStore.setState({ presets: [
      { id: 'book-1', name: '古典叙事', segments: [{ id: 'segment-1', title: '叙事', content: '正文', enabled: true }], createdAt: 1, updatedAt: 1 },
    ] });
    setActiveBookTravelScene();
    useBookTravelStore.setState({ selectedStylePresetIds: ['book-1'] });

    renderWithRouter(<Story />);

    expect(screen.queryByLabelText('穿书文风预设')).not.toBeInTheDocument();
  });

  it('shows assembled material selection before book-travel can start', () => {
    renderWithRouter(<Story />);

    expect(screen.getByText('选择穿书素材')).toBeInTheDocument();
    expect(screen.getByText(/暂无已装配素材/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /开始穿书/ })).toBeDisabled();
    expect(screen.queryByRole('complementary', { name: '穿书状态' })).not.toBeInTheDocument();
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

    expect(screen.getAllByText('沈府婚宴').length).toBeGreaterThan(0);
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
    expect(within(screen.getByRole('complementary', { name: '穿书状态' })).getByText('旅程已结束')).toBeInTheDocument();
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

  it('switches to the conversation view and shows the planned scene while the first scene writer is running', async () => {
    invokeMock.mockImplementation((command: string, args?: any) => {
      if (command === 'start_plan_book_travel_scene_stream') {
        return Promise.resolve({ runId: 'start-planner-run' });
      }
      if (command === 'start_write_book_travel_change_scene_stream') {
        return Promise.resolve({ runId: 'start-writer-run' });
      }
      return defaultInvoke(command, args);
    });
    saveReadyMaterial();

    renderWithRouter(<Story />);

    const select = screen.getByRole('combobox');
    fireEvent.mouseDown(select);
    fireEvent.click(await screen.findByText('第一卷 · 云州入场'));
    fireEvent.click(screen.getByRole('button', { name: /开始穿书/ }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('start_plan_book_travel_scene_stream', expect.anything());
    });
    emitBookTravelEvent({
      runId: 'start-planner-run',
      eventType: 'done',
      message: JSON.stringify({
        id: 'scene-start',
        title: '猫头鹰来信',
        summary: '林晚在旧宅收到一封不该出现的录取通知。',
        currentSituation: '窗外雨声渐急，猫头鹰停在窗沿上，爪下压着一封烫金信。',
        time: '1991年夏，清晨',
        location: '女贞路4号周边',
        activeCharacters: ['林晚', '哈利·波特', '弗农·德思礼'],
        stateChanges: { letterStatus: '已送达' },
        divergence: '用户以旁观者身份介入开局',
        storyProgress: 3,
        endingStatus: 'active',
        sceneGoals: ['拿到入学信', '避免惊动德思礼家'],
        entryBeatGuidance: '从猫头鹰落窗写起',
        writerInstructions: '写猫头鹰来信的开场氛围',
      }),
    });

    expect((await screen.findAllByText('猫头鹰来信')).length).toBeGreaterThan(0);
    expect(screen.queryByText('选择穿书素材')).not.toBeInTheDocument();
    expect(screen.getByText(/时间：1991年夏，清晨/)).toBeInTheDocument();
    expect(screen.getByText(/地点：女贞路4号周边/)).toBeInTheDocument();
    const situationCards = screen.getAllByTestId('scene-situation-card');
    expect(situationCards[situationCards.length - 1]).toHaveTextContent('场景目标：拿到入学信、避免惊动德思礼家');
    expect(situationCards[situationCards.length - 1]).toHaveTextContent('当前局势：窗外雨声渐急，猫头鹰停在窗沿上，爪下压着一封烫金信。');
    expect(screen.getAllByText('林晚').length).toBeGreaterThan(0);
    expect(await screen.findByText(/场景写手正在书写/)).toBeInTheDocument();
    expect(screen.queryByText('猫头鹰轻轻敲了敲窗。')).not.toBeInTheDocument();

    emitBookTravelEvent({
      runId: 'start-writer-run',
      eventType: 'done',
      message: JSON.stringify({
        beat: { id: 'beat-start', content: '猫头鹰轻轻敲了敲窗。' },
        volatileMemoryPatch: { letterStatus: '已读' },
      }),
    });

    expect(await screen.findByText('猫头鹰轻轻敲了敲窗。')).toBeInTheDocument();
  });

  it('returns to the book-travel material setup when restarting the adventure', async () => {
    setActiveBookTravelScene();
    useBookTravelStore.setState({
      assembledMaterials: [],
      selectedMaterialId: 'material-1',
    });

    renderWithRouter(<Story />);

    expect(screen.getAllByText('沈府婚宴').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '重开新冒险' }));

    expect(await screen.findByText('选择穿书素材')).toBeInTheDocument();
    expect(screen.queryByText('沈府婚宴')).not.toBeInTheDocument();
    expect(useBookTravelStore.getState().scenes).toHaveLength(0);
    expect(useBookTravelStore.getState().selectedMaterialId).toBeNull();
  });

  it('shows a persistent Chinese HUD and removes the composer status modal action', () => {
    setActiveBookTravelScene();

    renderWithRouter(<Story />);

    expect(screen.queryByText(/当前模式/)).not.toBeInTheDocument();
    const hud = screen.getByRole('complementary', { name: '穿书状态' });
    expect(within(hud).getByText('旅程状态')).toBeInTheDocument();
    expect(within(hud).getByText(/林晚（替嫁者）/)).toBeInTheDocument();
    expect(within(hud).getByText('第一夜')).toBeInTheDocument();
    expect(within(hud).getByText('红头盖')).toBeInTheDocument();
    expect(within(hud).getByText('剧情回顾')).toBeInTheDocument();
    expect(within(hud).getByText(/林晚在沈府喜房醒来/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '状态' })).not.toBeInTheDocument();
    expect(screen.queryByText('OK')).not.toBeInTheDocument();
  });

  it('expands no more than the three most recent turns in the HUD recap', () => {
    setActiveBookTravelScene();
    useBookTravelStore.setState({
      turns: Array.from({ length: 5 }, (_, index) => ({
        id: `turn-${index + 1}`,
        userInput: `行动 ${index + 1}`,
        narrativeOutput: `剧情 ${index + 1}`,
        stateSnapshot: {},
        createdBeatIds: [],
      })),
    });

    renderWithRouter(<Story />);

    const hud = screen.getByRole('complementary', { name: '穿书状态' });
    fireEvent.click(within(hud).getByRole('button', { name: '展开近期回合' }));
    expect(within(hud).queryByText('行动 2')).not.toBeInTheDocument();
    expect(within(hud).getByText('行动 3')).toBeInTheDocument();
    expect(within(hud).getByText('行动 4')).toBeInTheDocument();
    expect(within(hud).getByText('行动 5')).toBeInTheDocument();
  });

  it('removes the summary clamp when the HUD recap is expanded', () => {
    setActiveBookTravelScene();
    useBookTravelStore.setState({
      summaryMemory: '林晚逐步查清替嫁局与沈府密道的联系。'.repeat(10),
    });

    renderWithRouter(<Story />);

    const hud = screen.getByRole('complementary', { name: '穿书状态' });
    const expandSummary = within(hud).getByRole('button', { name: '展开剧情摘要' });
    fireEvent.click(expandSummary);

    expect(expandSummary).toHaveAttribute('aria-expanded', 'true');
    expect(hud.querySelector('.book-travel-hud-summary__text')).toHaveClass('is-expanded');
  });

  it('updates the HUD after Book Travel state changes', async () => {
    setActiveBookTravelScene();
    renderWithRouter(<Story />);

    const hud = screen.getByRole('complementary', { name: '穿书状态' });
    act(() => {
      useBookTravelStore.setState({
        currentState: { time: '第二夜', location: '沈府偏院' },
        volatileMemory: { clues: ['红头盖', '婚书碎片'] },
      });
    });

    expect(await within(hud).findByText('第二夜')).toBeInTheDocument();
    expect(within(hud).getByText('沈府偏院')).toBeInTheDocument();
    expect(within(hud).getByText('婚书碎片')).toBeInTheDocument();
    await waitFor(() => expect(hud.querySelector('.book-travel-hud-entry.is-changed')).not.toBeNull());
  });

  it('renders a compact floating summary and supports keyboard opening on narrow layouts', () => {
    mockNarrowBookTravelLayout(true);
    setActiveBookTravelScene();

    renderWithRouter(<Story />);

    const hud = screen.getByRole('complementary', { name: '穿书状态' });
    expect(hud).toHaveClass('is-floating', 'is-narrow', 'is-collapsed');
    expect(within(hud).getByText('旅程状态')).toBeInTheDocument();
    expect(within(hud).getByText('沈府婚宴')).toBeInTheDocument();
    expect(hud.querySelector('.book-travel-status-hud__rail')).not.toBeInTheDocument();

    const openButton = within(hud).getByRole('button', { name: '展开穿书状态' });
    expect(openButton).toHaveClass('book-travel-status-hud__compact-button');
    openButton.focus();
    expect(openButton).toHaveFocus();
    fireEvent.keyDown(openButton, { key: 'Enter' });
    expect(hud).toHaveClass('is-narrow', 'is-open');
    expect(within(hud).getByRole('button', { name: '收起穿书状态' })).toBeInTheDocument();

    fireEvent.keyDown(hud, { key: 'Escape' });
    expect(hud).toHaveClass('is-narrow', 'is-collapsed');
  });

  it('closes the expanded floating HUD with Escape on wide layouts', () => {
    setActiveBookTravelScene();
    renderWithRouter(<Story />);

    const hud = screen.getByRole('complementary', { name: '穿书状态' });
    expect(hud).toHaveClass('is-floating', 'is-wide', 'is-open');

    fireEvent.keyDown(hud, { key: 'Escape' });

    expect(hud).toHaveClass('is-wide', 'is-collapsed');
    expect(within(hud).getByText('旅程状态')).toBeInTheDocument();
    expect(within(hud).getByText('沈府婚宴')).toBeInTheDocument();
  });

  it('shows a submitted book-travel action immediately and locks sending while it is processed', async () => {
    const classification = createDeferred<{ classification: 'insert-beat' }>();
    invokeMock.mockImplementation((command: string, args?: any) => {
      if (command === 'classify_book_travel_input') return classification.promise;
      if (command === 'start_write_book_travel_insert_beat_stream') {
        return Promise.resolve({ runId: 'pending-insert-run' });
      }
      return defaultInvoke(command, args);
    });
    setActiveBookTravelScene();

    renderWithRouter(<Story />);

    const inputBox = screen.getByPlaceholderText(/说些什么/);
    fireEvent.change(inputBox, { target: { value: '查看窗外动静' } });
    const sendButton = document.querySelector('.de-ai-agent-run-button') as HTMLButtonElement;
    fireEvent.click(sendButton);

    expect(await screen.findByText(/查看窗外动静/)).toBeInTheDocument();

    fireEvent.change(inputBox, { target: { value: '继续追问' } });
    expect(sendButton).toBeDisabled();

    classification.resolve({ classification: 'insert-beat' });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('start_write_book_travel_insert_beat_stream', expect.anything());
    });

    fireEvent.change(inputBox, { target: { value: '继续追问' } });
    expect(sendButton).toBeDisabled();

    emitBookTravelEvent({
      runId: 'pending-insert-run',
      eventType: 'done',
      message: JSON.stringify({
        id: 'scene-1',
        beat: { id: 'beat-2', content: '窗外有脚步声掠过。' },
        volatileMemoryPatch: { lastAction: '查看窗外动静' },
      }),
    });

    expect(await screen.findByText('窗外有脚步声掠过。')).toBeInTheDocument();
    await waitFor(() => expect(sendButton).toBeEnabled());
  });

  it('shows new scene information after planning before the scene writer finishes', async () => {
    const classification = createDeferred<{ classification: 'change-scene' }>();
    invokeMock.mockImplementation((command: string, args?: any) => {
      if (command === 'classify_book_travel_input') return classification.promise;
      if (command === 'start_plan_book_travel_scene_stream') {
        return Promise.resolve({ runId: 'planner-run' });
      }
      if (command === 'start_write_book_travel_change_scene_stream') {
        return Promise.resolve({ runId: 'writer-run' });
      }
      return defaultInvoke(command, args);
    });
    setActiveBookTravelScene();

    renderWithRouter(<Story />);

    const inputBox = screen.getByPlaceholderText(/说些什么/);
    fireEvent.change(inputBox, { target: { value: '去正厅见沈家人' } });
    const sendButton = document.querySelector('.de-ai-agent-run-button') as HTMLButtonElement;
    fireEvent.click(sendButton);

    expect(await screen.findByText(/去正厅见沈家人/)).toBeInTheDocument();
    expect(screen.getByText('正在识别行动...')).toBeInTheDocument();

    classification.resolve({ classification: 'change-scene' });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('start_plan_book_travel_scene_stream', expect.anything());
    });
    const plannerCall = invokeMock.mock.calls.find(([command]) => command === 'start_plan_book_travel_scene_stream');
    expect(plannerCall?.[1].userInput).toBe('【说话】去正厅见沈家人');
    emitBookTravelEvent({
      runId: 'planner-run',
      eventType: 'done',
      message: JSON.stringify({
        id: 'scene-2',
        title: '沈府正厅',
        summary: '林晚转入沈家正厅，直面沈家人的试探。',
        currentSituation: '正厅灯火通明，沈家长辈都在等她开口。',
        time: '第一夜',
        location: '沈府正厅',
        activeCharacters: ['林晚', '沈霜', '沈夫人'],
        stateChanges: { shenFamilyMood: '试探' },
        divergence: '用户主动进入正厅',
        storyProgress: 18,
        endingStatus: 'active',
        sceneGoals: ['稳住沈家人', '查清替嫁真相'],
        entryBeatGuidance: '从推门入厅开始',
        writerInstructions: '写正厅压迫感和第一轮试探',
      }),
    });

    expect((await screen.findAllByText('沈府正厅')).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('start_write_book_travel_change_scene_stream', expect.anything());
    });
    const writerCall = invokeMock.mock.calls.find(([command]) => command === 'start_write_book_travel_change_scene_stream');
    expect(writerCall?.[1].userInput).toBe('【说话】去正厅见沈家人');
    expect(screen.getByText(/地点：沈府正厅/)).toBeInTheDocument();
    const situationCards = screen.getAllByTestId('scene-situation-card');
    expect(situationCards[situationCards.length - 1]).toHaveTextContent('当前局势：正厅灯火通明，沈家长辈都在等她开口。');
    expect(screen.queryByText('她推门走入正厅。')).not.toBeInTheDocument();
    expect(await screen.findByText(/场景写手正在书写/)).toBeInTheDocument();

    emitBookTravelEvent({
      runId: 'writer-run',
      eventType: 'done',
      message: JSON.stringify({
        beat: { id: 'beat-2', content: '她推门走入正厅。' },
        volatileMemoryPatch: { shenFamilyMood: '试探' },
      }),
    });

    expect(await screen.findByText('她推门走入正厅。')).toBeInTheDocument();
    fireEvent.change(inputBox, { target: { value: '继续观察正厅' } });
    await waitFor(() => expect(sendButton).toBeEnabled());
  });

  it('allows retrying only the scene writer when the planned scene writer output fails', async () => {
    let writerRuns = 0;
    invokeMock.mockImplementation((command: string, args?: any) => {
      if (command === 'classify_book_travel_input') return Promise.resolve({ classification: 'change-scene' });
      if (command === 'start_plan_book_travel_scene_stream') {
        return Promise.resolve({ runId: 'retry-planner-run' });
      }
      if (command === 'start_write_book_travel_change_scene_stream') {
        writerRuns += 1;
        return Promise.resolve({ runId: `retry-writer-run-${writerRuns}` });
      }
      return defaultInvoke(command, args);
    });
    setActiveBookTravelScene();

    renderWithRouter(<Story />);

    fireEvent.change(screen.getByPlaceholderText(/说些什么/), { target: { value: '转去偏院搜证' } });
    const sendButton = document.querySelector('.de-ai-agent-run-button') as HTMLButtonElement;
    fireEvent.click(sendButton);

    expect(await screen.findByText(/转去偏院搜证/)).toBeInTheDocument();
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('start_plan_book_travel_scene_stream', expect.anything());
    });
    emitBookTravelEvent({
      runId: 'retry-planner-run',
      eventType: 'done',
      message: JSON.stringify({
        id: 'scene-2',
        title: '沈府偏院',
        summary: '林晚避开正厅，从偏院寻找替嫁线索。',
        currentSituation: '偏院无人掌灯，窗纸后有一截被撕碎的婚书。',
        time: '第一夜深处',
        location: '沈府偏院',
        activeCharacters: ['林晚'],
        stateChanges: { foundTrail: '偏院婚书碎片' },
        divergence: '用户转入搜证线',
        storyProgress: 21,
        endingStatus: 'active',
        sceneGoals: ['找到婚书碎片', '避开沈家巡夜人'],
        entryBeatGuidance: '从推开偏院门写起',
        writerInstructions: '写偏院冷清和婚书碎片的悬疑感',
      }),
    });

    expect((await screen.findAllByText('沈府偏院')).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(writerRuns).toBe(1);
    });
    emitBookTravelEvent({
      runId: 'retry-writer-run-1',
      eventType: 'done',
      message: '不是 JSON',
    });

    const retryButton = await screen.findByRole('button', { name: /重试写手/ });
    expect(screen.getByText(/写手生成失败/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/说些什么/), { target: { value: '先稳住呼吸' } });
    await waitFor(() => expect(sendButton).toBeEnabled());

    fireEvent.click(retryButton);
    expect(sendButton).toBeDisabled();
    await waitFor(() => {
      expect(writerRuns).toBe(2);
    });
    emitBookTravelEvent({
      runId: 'retry-writer-run-2',
      eventType: 'done',
      message: JSON.stringify({
        beat: { id: 'beat-2', content: '她蹲下身，拾起那截被撕碎的婚书。' },
        volatileMemoryPatch: { foundTrail: '偏院婚书碎片' },
      }),
    });

    expect(await screen.findByText('她蹲下身，拾起那截被撕碎的婚书。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /重试写手/ })).not.toBeInTheDocument();
    expect(invokeMock.mock.calls.filter(([command]) => command === 'classify_book_travel_input')).toHaveLength(1);
    expect(invokeMock.mock.calls.filter(([command]) => command === 'start_plan_book_travel_scene_stream')).toHaveLength(1);
    await waitFor(() => expect(sendButton).toBeEnabled());
  });

  it('shows role identity and scene goals inside the current situation card when a new scene starts', () => {
    setActiveBookTravelScene();
    useBookTravelStore.setState({
      turns: [{
        id: 'turn-2',
        userInput: '去正厅见沈家人',
        classification: 'change-scene' as const,
        plannerOutput: { sceneGoals: ['稳住沈家人', '查清替嫁真相'] },
        narrativeOutput: '她推门走向正厅。',
        stateSnapshot: { time: '第一夜', location: '沈府正厅' },
        createdSceneId: 'scene-1',
        createdBeatIds: ['beat-1'],
      }],
    });

    renderWithRouter(<Story />);

    const situationCard = screen.getByTestId('scene-situation-card');
    expect(situationCard).toHaveTextContent('扮演身份：林晚（替嫁者）');
    expect(situationCard).toHaveTextContent('场景目标：稳住沈家人、查清替嫁真相');
    expect(situationCard).toHaveTextContent('当前局势：红烛未灭');
    expect(screen.getByText('扮演身份：')).toHaveStyle({ color: '#d97757' });
    expect(screen.getByText('场景目标：')).toHaveStyle({ color: '#d97757' });
  });

  it('opens a save choice modal and saves book-travel progress as a new editable record', async () => {
    const materialId = saveReadyMaterial();
    setActiveBookTravelScene();
    useBookTravelStore.setState({ selectedMaterialId: materialId });

    renderWithRouter(<Story />);

    fireEvent.click(screen.getByRole('button', { name: '保存进度' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('保存进度');
    expect(screen.getByLabelText('覆盖原记录')).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: '进度名称' }), {
      target: { value: '沈府婚宴分支' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }));

    await waitFor(() => {
      expect(useBookTravelStore.getState().savedProgresses[0]?.title).toBe('沈府婚宴分支');
      expect(useBookTravelStore.getState().savedProgresses[0]?.materialId).toBe(materialId);
      expect(useBookTravelStore.getState().activeSavedProgressId).toBe(useBookTravelStore.getState().savedProgresses[0]?.id);
    });
  });

  it('overwrites the active book-travel progress without adding a duplicate', async () => {
    const materialId = saveReadyMaterial();
    setActiveBookTravelScene();
    useBookTravelStore.setState({ selectedMaterialId: materialId });
    const progressId = useBookTravelStore.getState().saveProgress({ mode: 'create', title: '旧进度' });

    renderWithRouter(<Story />);

    fireEvent.click(screen.getByRole('button', { name: '保存进度' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('保存进度');
    fireEvent.click(screen.getByLabelText('覆盖原记录'));
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }));

    await waitFor(() => {
      const progresses = useBookTravelStore.getState().savedProgresses;
      expect(progresses).toHaveLength(1);
      expect(progresses[0].id).toBe(progressId);
      expect(progresses[0].title).toBe('沈府婚宴');
      expect(useBookTravelStore.getState().activeSavedProgressId).toBe(progressId);
    });
  });

  it('restores only the final selected book-travel preset from legacy multi-select progress', () => {
    setActiveBookTravelScene();
    useBookTravelStore.setState({
      selectedStylePresetIds: ['preset-b', 'preset-a'],
      initialStylePresetIds: ['preset-a'],
      initialSystemPromptSnapshot: '初始化穿书提示词',
    });
    const progressId = useBookTravelStore.getState().saveProgress({ mode: 'create', title: '预设进度' });
    useBookTravelStore.setState({ selectedStylePresetIds: [] });
    useBookTravelStore.getState().loadSavedProgress(progressId);
    expect(useBookTravelStore.getState().selectedStylePresetIds).toEqual(['preset-a']);
    expect(useBookTravelStore.getState().initialStylePresetIds).toEqual(['preset-a']);
    expect(useBookTravelStore.getState().initialSystemPromptSnapshot).toBe('初始化穿书提示词');
  });

  it('allows a draft book-travel session to overwrite an existing saved progress', async () => {
    const materialId = saveReadyMaterial();
    setActiveBookTravelScene();
    useBookTravelStore.setState({ selectedMaterialId: materialId });
    const progressId = useBookTravelStore.getState().saveProgress({ mode: 'create', title: '旧进度' });
    useBookTravelStore.setState({ activeSavedProgressId: null });

    renderWithRouter(<Story />);

    fireEvent.click(screen.getByRole('button', { name: '保存进度' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('保存进度');
    expect(screen.getByLabelText('覆盖原记录')).not.toBeDisabled();
    expect(screen.getByText('旧进度')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByLabelText('覆盖进度'));
    expect(await screen.findAllByText(/保存于/)).not.toHaveLength(0);
    expect(screen.getByText('穿书素材：第一卷 · 云州入场')).toBeInTheDocument();
    expect(screen.getByText('世界书：云州世界书')).toBeInTheDocument();
    expect(screen.getByText('角色卡：沈霜')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }));

    await waitFor(() => {
      const progresses = useBookTravelStore.getState().savedProgresses;
      expect(progresses).toHaveLength(1);
      expect(progresses[0].id).toBe(progressId);
      expect(useBookTravelStore.getState().activeSavedProgressId).toBe(progressId);
    });
  });

  it('opens saved book-travel progress in a modal with material filtering and fallback labels', async () => {
    const firstMaterialId = saveReadyMaterial();
    const secondMaterialId = useBookTravelStore.getState().saveAssembledMaterial({
      title: '第二卷 · 北境迷局',
      materials: {
        outline: { id: '/outline/第二卷.md', title: '第二卷.md', path: '/outline/第二卷.md', content: '第二卷大纲' },
        worldBook: { id: 'wb-north', title: '北境世界', content: '北境世界书' },
        characterCards: [{ id: 'cc-north', title: '雪线斥候', content: '雪线斥候正文' }],
      },
      assembledWorldModel: { originalTimeline: ['北境原线'] },
      stableMemory: null,
      volatileMemory: null,
      entryPoints: [],
      recommendedUserCharacters: [],
    });
    setActiveBookTravelScene();
    useBookTravelStore.setState({
      selectedMaterialId: firstMaterialId,
      savedProgresses: [
        {
          id: 'progress-1',
          title: '沈府婚宴',
          savedAt: 1717951140000,
          materialId: firstMaterialId,
          sessionKey: `${firstMaterialId}-entry-1-林晚`,
          snapshot: getCurrentBookTravelSnapshot(),
        } as any,
        {
          id: 'progress-2',
          title: '北境开局',
          savedAt: 1717864800000,
          materialId: secondMaterialId,
          sessionKey: `${secondMaterialId}-entry-1-林晚`,
          snapshot: getCurrentBookTravelSnapshot({
            selectedOutline: { id: '/outline/第二卷.md', title: '第二卷.md', path: '/outline/第二卷.md', content: '第二卷大纲' },
          }),
        } as any,
        {
          id: 'progress-legacy',
          title: '旧进度',
          savedAt: 1717778400000,
          sessionKey: `${firstMaterialId}-entry-1-林晚`,
          snapshot: getCurrentBookTravelSnapshot(),
        } as any,
        {
          id: 'progress-missing',
          title: '孤立进度',
          savedAt: 1717692000000,
          sessionKey: 'none-entry-1-林晚',
          snapshot: getCurrentBookTravelSnapshot({
            selectedOutline: { id: '/outline/未知.md', title: '未知.md', path: '/outline/未知.md', content: '未知' },
            selectedWorldBook: null,
            selectedCharacterCards: [],
          }),
        } as any,
      ],
    });

    renderWithRouter(<Story />);
    fireEvent.click(screen.getByRole('button', { name: '穿书保存进度' }));

    expect(await screen.findByText('穿书进度')).toBeInTheDocument();
    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('沈府婚宴')).toBeInTheDocument();
    expect(within(dialog).getAllByText(/第一卷 · 云州入场/)).not.toHaveLength(0);
    expect(within(dialog).getByText('旧进度')).toBeInTheDocument();
    expect(within(dialog).getByText('孤立进度')).toBeInTheDocument();
    expect(within(dialog).getByText(/未匹配穿书素材/)).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByLabelText('按穿书素材筛选'));
    const materialOptions = await screen.findAllByText('第二卷 · 北境迷局');
    fireEvent.click(materialOptions[materialOptions.length - 1]);
    expect(within(dialog).queryByText('沈府婚宴')).not.toBeInTheDocument();
    expect(within(dialog).getByText('北境开局')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '打开北境开局' }));
    await waitFor(() => {
      expect(useBookTravelStore.getState().selectedOutline?.id).toBe('/outline/第二卷.md');
    });

    fireEvent.click(screen.getByRole('button', { name: '穿书保存进度' }));
    expect(await screen.findByText('穿书进度')).toBeInTheDocument();
    dialog = screen.getByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: '删除北境开局' }));
    expect(useBookTravelStore.getState().savedProgresses.some((progress) => progress.id === 'progress-2')).toBe(false);
  });

  it('classifies book-travel input only as beat insertion or scene change at zero temperature', async () => {
    setActiveBookTravelScene();

    renderWithRouter(<Story />);

    fireEvent.change(screen.getByPlaceholderText(/说些什么/), { target: { value: '查看状态' } });
    const sendButton = document.querySelector('.de-ai-agent-run-button') as HTMLButtonElement;
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('classify_book_travel_input', expect.anything());
    });
    const classifyCall = invokeMock.mock.calls.find(([command]) => command === 'classify_book_travel_input');
    expect(classifyCall?.[1].request.temperature).toBe(0);
    expect(classifyCall?.[1].request.systemPrompt).toContain('insert-beat');
    expect(classifyCall?.[1].request.systemPrompt).toContain('change-scene');
    expect(classifyCall?.[1].request.systemPrompt).toContain('{"classification":"insert-beat"}');
    expect(classifyCall?.[1].request.systemPrompt).not.toContain('reason');
    expect(classifyCall?.[1].request.systemPrompt).not.toContain('meta');
  });

  it('only prepends book-travel presets to scene-writer requests', async () => {
    useStylePresetStore.setState({ presets: [
      { id: 'book-1', name: '古典叙事', segments: [{ id: 'book-segment-1', title: '叙事', content: '穿书预设正文', enabled: true }], createdAt: 1, updatedAt: 1 },
    ] });
    setActiveBookTravelScene();
    useBookTravelStore.getState().setSelectedStylePresetIds(['book-1']);
    renderWithRouter(<Story />);

    fireEvent.change(screen.getByPlaceholderText(/说些什么/), { target: { value: '查看状态' } });
    fireEvent.click(document.querySelector('.de-ai-agent-run-button') as HTMLButtonElement);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('start_write_book_travel_insert_beat_stream', expect.anything()));
    const writerCall = invokeMock.mock.calls.find(([command]) => command === 'start_write_book_travel_insert_beat_stream');
    const classifierCall = invokeMock.mock.calls.find(([command]) => command === 'classify_book_travel_input');
    expect(writerCall?.[1].request.systemPrompt).toMatch(/穿书预设正文[\s\S]*穿书场景写手/);
    expect(classifierCall?.[1].request.systemPrompt).not.toContain('穿书预设正文');
  });

  it('passes the selected book-travel input mode prefix into the runtime calls and turn record', async () => {
    setActiveBookTravelScene();

    renderWithRouter(<Story />);

    fireEvent.click(screen.getByText('角色行为'));
    fireEvent.change(screen.getByPlaceholderText(/做点什么/), { target: { value: '抬手试探门锁' } });
    const sendButton = document.querySelector('.de-ai-agent-run-button') as HTMLButtonElement;
    fireEvent.click(sendButton);

    expect(await screen.findByText('【行为】抬手试探门锁')).toBeInTheDocument();

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'classify_book_travel_input',
        expect.objectContaining({ userInput: '【行为】抬手试探门锁' }),
      );
    });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'start_write_book_travel_insert_beat_stream',
        expect.objectContaining({ userInput: '【行为】抬手试探门锁' }),
      );
    });
  });

  it('keeps scene-writer streaming visible after leaving and returning to the story page', async () => {
    invokeMock.mockImplementation((command: string, args?: any) => {
      if (command === 'classify_book_travel_input') return Promise.resolve({ classification: 'insert-beat' });
      if (command === 'start_write_book_travel_insert_beat_stream') {
        return Promise.resolve({ runId: 'persistent-insert-run' });
      }
      return defaultInvoke(command, args);
    });
    setActiveBookTravelScene();

    const firstRender = renderWithRouter(<Story />);

    fireEvent.change(screen.getByPlaceholderText(/说些什么/), { target: { value: '查看门外' } });
    const sendButton = document.querySelector('.de-ai-agent-run-button') as HTMLButtonElement;
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('start_write_book_travel_insert_beat_stream', expect.anything());
    });
    emitBookTravelEvent({
      runId: 'persistent-insert-run',
      eventType: 'delta',
      delta: '{"beat":{"id":"beat-2","content":"门外有脚步',
    });
    expect(await screen.findByText(/门外有脚步/)).toBeInTheDocument();

    firstRender.unmount();
    emitBookTravelEvent({
      runId: 'persistent-insert-run',
      eventType: 'delta',
      delta: '声越来越近',
    });

    renderWithRouter(<Story />);

    expect(await screen.findByText(/门外有脚步声越来越近/)).toBeInTheDocument();

    emitBookTravelEvent({
      runId: 'persistent-insert-run',
      eventType: 'done',
      message: JSON.stringify({
        beat: { id: 'beat-2', content: '门外有脚步声越来越近。' },
        volatileMemoryPatch: { lastAction: '【说话】查看门外' },
      }),
    });

    expect(await screen.findByText('门外有脚步声越来越近。')).toBeInTheDocument();
  });
});
