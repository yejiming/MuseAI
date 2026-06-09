import { beforeEach, describe, expect, it } from 'vitest';
import { useBookTravelStore } from '../stores/useBookTravelStore';

describe('useBookTravelStore', () => {
  beforeEach(() => {
    useBookTravelStore.getState().resetSession();
    useBookTravelStore.setState({ assembledMaterials: [], selectedMaterialId: null });
  });

  it('starts with empty book-travel state', () => {
    const state = useBookTravelStore.getState();

    expect(state.selectedOutline).toBeNull();
    expect(state.selectedWorldBook).toBeNull();
    expect(state.selectedCharacterCards).toEqual([]);
    expect(state.assembledWorldModel).toBeNull();
    expect(state.stableMemory).toBeNull();
    expect(state.volatileMemory).toBeNull();
    expect(state.entryPoints).toEqual([]);
    expect(state.userCharacter).toBeNull();
    expect(state.currentState).toBeNull();
    expect(state.scenes).toEqual([]);
    expect(state.currentSceneId).toBeNull();
    expect(state.currentBeatId).toBeNull();
    expect(state.turns).toEqual([]);
    expect(state.summaryMemory).toBe('');
    expect(state.ending).toBeNull();
    expect(state.isCompleted).toBe(false);
  });

  it('stores material selections and resolved content', () => {
    const store = useBookTravelStore.getState();

    store.selectOutline({ id: '/outline/第一卷.md', title: '第一卷', path: '/outline/第一卷.md' });
    store.selectWorldBook({ id: 'wb-1', title: '云州世界书', content: '世界书正文' });
    store.setSelectedCharacterCards([
      { id: 'cc-1', title: '沈霜', content: '角色卡正文' },
    ]);
    store.setResolvedMaterials({
      outline: { id: '/outline/第一卷.md', title: '第一卷', path: '/outline/第一卷.md', content: '大纲正文' },
      worldBook: { id: 'wb-1', title: '云州世界书', content: '世界书正文' },
      characterCards: [{ id: 'cc-1', title: '沈霜', content: '角色卡正文' }],
    });

    const state = useBookTravelStore.getState();
    expect(state.selectedOutline?.content).toBe('大纲正文');
    expect(state.selectedWorldBook?.content).toBe('世界书正文');
    expect(state.selectedCharacterCards[0].content).toBe('角色卡正文');
  });

  it('saves assembled material presets separately from the active session', () => {
    const store = useBookTravelStore.getState();

    store.saveAssembledMaterial({
      title: '第一卷 · 云州入场',
      materials: {
        outline: { id: '/outline/第一卷.md', title: '第一卷.md', path: '/outline/第一卷.md', content: '大纲正文' },
        worldBook: { id: 'wb-1', title: '云州世界书', content: '世界书正文' },
        characterCards: [{ id: 'cc-1', title: '沈霜', content: '角色卡正文' }],
      },
      assembledWorldModel: { originalTimeline: ['原线开局'] },
      stableMemory: { worldRules: ['灵契不可违背'] },
      volatileMemory: { clues: [] },
      entryPoints: [{ id: 'entry-1', title: '小说开篇', summary: '从第一章开场进入' }],
      recommendedUserCharacters: [{ name: '林晚', identity: '穿书者', goal: '改写死局' }],
    });

    const state = useBookTravelStore.getState();
    expect(state.assembledMaterials).toHaveLength(1);
    expect(state.assembledMaterials[0].title).toBe('第一卷 · 云州入场');
    expect(state.assembledMaterials[0].materials.outline.content).toBe('大纲正文');
    expect(state.selectedOutline).toBeNull();
    expect(state.entryPoints).toEqual([]);
  });

  it('loads an assembled material preset into the active book-travel session', () => {
    const store = useBookTravelStore.getState();
    const id = store.saveAssembledMaterial({
      title: '第一卷 · 云州入场',
      materials: {
        outline: { id: '/outline/第一卷.md', title: '第一卷.md', path: '/outline/第一卷.md', content: '大纲正文' },
        worldBook: { id: 'wb-1', title: '云州世界书', content: '世界书正文' },
        characterCards: [{ id: 'cc-1', title: '沈霜', content: '角色卡正文' }],
      },
      assembledWorldModel: { originalTimeline: ['原线开局'] },
      stableMemory: { worldRules: ['灵契不可违背'] },
      volatileMemory: { clues: [] },
      entryPoints: [{ id: 'entry-1', title: '小说开篇', summary: '从第一章开场进入' }],
      recommendedUserCharacters: [{ name: '林晚', identity: '穿书者', goal: '改写死局' }],
    });

    store.loadAssembledMaterial(id);

    const state = useBookTravelStore.getState();
    expect(state.selectedMaterialId).toBe(id);
    expect(state.selectedOutline?.title).toBe('第一卷.md');
    expect(state.selectedWorldBook?.title).toBe('云州世界书');
    expect(state.entryPoints[0].title).toBe('小说开篇');
    expect(state.userCharacter?.name).toBe('林晚');
    expect(state.scenes).toEqual([]);
  });

  it('tracks scene, beat, turns, memory, and completion state', () => {
    const store = useBookTravelStore.getState();

    store.setAssembledWorldModel({ originalTimeline: ['开局'] });
    store.setStableMemory({ worldRules: ['灵契不可违背'] });
    store.updateVolatileMemory({ clues: ['玉佩发热'] });
    store.setEntryPoints([{ id: 'entry-1', title: '醒在婚宴', summary: '红烛未灭' }]);
    store.setSelectedEntryPointId('entry-1');
    store.setUserCharacter({ name: '林晚', identity: '替嫁者', goal: '查清真相' });
    store.setCurrentState({ time: '夜半', location: '沈府' });
    store.addScene({
      id: 'scene-1',
      title: '沈府婚宴',
      summary: '主角醒来',
      currentSituation: '宾客散去',
      beats: [
        { id: 'beat-1', content: '她睁开眼。' },
        { id: 'beat-2', content: '门外无人。' },
      ],
    });
    store.advanceBeat('scene-1', 'beat-2');
    store.appendTurn({
      id: 'turn-1',
      userInput: '推门出去',
      classification: 'insert-beat',
      narrativeOutput: '门轴轻响。',
      stateSnapshot: { time: '夜半', location: '沈府' },
      createdBeatIds: ['beat-2'],
    });
    store.updateSummaryMemory('已进入沈府主线。');
    store.finishSession({
      finalEnding: '林晚改写婚宴死局。',
      worldlineName: '红烛未灭线',
      divergenceScore: 42,
    });

    const state = useBookTravelStore.getState();
    expect(state.currentSceneId).toBe('scene-1');
    expect(state.currentBeatId).toBe('beat-2');
    expect(state.turns[0].stateSnapshot).toEqual({ time: '夜半', location: '沈府' });
    expect(state.volatileMemory).toEqual({ clues: ['玉佩发热'] });
    expect(state.summaryMemory).toBe('已进入沈府主线。');
    expect(state.isCompleted).toBe(true);
    expect(state.ending?.worldlineName).toBe('红烛未灭线');
  });

  it('resets book-travel state without touching normal Story store data', () => {
    const store = useBookTravelStore.getState();

    store.selectOutline({ id: 'outline-1', title: '第一卷' });
    store.addScene({ id: 'scene-1', title: '旧场景', beats: [] });
    store.finishSession({ finalEnding: '结束', worldlineName: '旧线', divergenceScore: 1 });
    store.resetSession();

    const state = useBookTravelStore.getState();
    expect(state.selectedOutline).toBeNull();
    expect(state.scenes).toEqual([]);
    expect(state.ending).toBeNull();
    expect(state.isCompleted).toBe(false);
  });
});
