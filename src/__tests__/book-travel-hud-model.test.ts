import { describe, expect, it } from 'vitest';
import { buildBookTravelHudModel } from '../utils/bookTravelHud';

describe('buildBookTravelHudModel', () => {
  it('builds journey and scene sections with current-state values and scene fallbacks', () => {
    const model = buildBookTravelHudModel({
      userCharacter: { name: '林晚', identity: '替嫁者', goal: '查清替嫁真相' },
      currentScene: {
        id: 'scene-1',
        title: '沈府婚宴',
        time: '第一夜',
        location: '沈府喜房',
        currentSituation: '红烛将尽，门外传来脚步声',
        activeCharacters: ['林晚', '沈霜'],
        beats: [],
      },
      currentState: { time: '', location: null },
      volatileMemory: null,
      summaryMemory: '',
      turns: [],
      isCompleted: false,
    });

    expect(model.journey).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '扮演身份', value: '林晚（替嫁者）' }),
      expect.objectContaining({ label: '当前目标', value: '查清替嫁真相' }),
    ]));
    expect(model.scene).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '时间', value: '第一夜' }),
      expect.objectContaining({ label: '地点', value: '沈府喜房' }),
      expect.objectContaining({ label: '当前局势', value: '红烛将尽，门外传来脚步声' }),
      expect.objectContaining({ label: '活跃角色', values: ['林晚', '沈霜'] }),
    ]));
  });

  it('localizes known and screenshot-derived keys without exposing raw internal names', () => {
    const model = buildBookTravelHudModel({
      userCharacter: null,
      currentScene: null,
      currentState: {
        mood: '警觉',
        relationshipStatus: { 沈霜: '仍在试探' },
      },
      volatileMemory: {
        locationSetup: '塔楼寝室，窗边落着一封信',
        observedFirstOwlDelivery: true,
        clues: ['红头盖', '残缺婚书'],
        items: [{ name: '铜钥匙', count: 1 }],
        hiddenDoorOpened: false,
      },
      summaryMemory: '',
      turns: [],
      isCompleted: false,
    });

    const entries = model.dynamicGroups.flatMap((group) => group.entries);
    const renderedText = entries
      .flatMap((entry) => [entry.label, entry.value, ...(entry.values ?? []), ...(entry.details ?? []).map((detail) => `${detail.label}${detail.value}`)])
      .filter(Boolean)
      .join(' ');

    expect(renderedText).toContain('场景布置');
    expect(renderedText).toContain('首次猫头鹰送信');
    expect(renderedText).toContain('已发生');
    expect(renderedText).toContain('未发生');
    expect(renderedText).toContain('红头盖');
    expect(renderedText).toContain('铜钥匙');
    expect(renderedText).toContain('仍在试探');
    expect(renderedText).not.toMatch(/locationSetup|observedFirstOwlDelivery|relationshipStatus|true|false|\[object Object\]/);
  });

  it('keeps readable unknown values under a Chinese fallback and omits empty values', () => {
    const model = buildBookTravelHudModel({
      userCharacter: null,
      currentScene: null,
      currentState: {
        generatedStateKey: { level: 2, note: '风声从密道传来' },
        emptyString: '  ',
        emptyArray: [],
        emptyObject: {},
        nothing: null,
      },
      volatileMemory: { score: 7 },
      summaryMemory: '',
      turns: [],
      isCompleted: false,
    });

    const otherGroup = model.dynamicGroups.find((group) => group.id === 'other');
    expect(otherGroup?.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '状态记录' }),
      expect.objectContaining({ label: '进度数值', value: '7' }),
    ]));
    expect(otherGroup?.entries.flatMap((entry) => entry.details ?? [])).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: '2' }),
      expect.objectContaining({ value: '风声从密道传来' }),
    ]));
    expect(JSON.stringify(model)).not.toMatch(/emptyString|emptyArray|emptyObject|nothing|generatedStateKey|\[object Object\]/);
  });

  it('limits recap data to the three most recent turns and marks completed journeys', () => {
    const turns = Array.from({ length: 5 }, (_, index) => ({
      id: `turn-${index + 1}`,
      userInput: `行动 ${index + 1}`,
      narrativeOutput: `剧情 ${index + 1}`,
      stateSnapshot: {},
      createdBeatIds: [],
    }));

    const model = buildBookTravelHudModel({
      userCharacter: null,
      currentScene: null,
      currentState: null,
      volatileMemory: null,
      summaryMemory: '这是一段很长的剧情摘要，用于验证回顾预览和按需展开。',
      turns,
      isCompleted: true,
    });

    expect(model.isCompleted).toBe(true);
    expect(model.recap.recentTurns.map((turn) => turn.userInput)).toEqual(['行动 3', '行动 4', '行动 5']);
    expect(new Set(model.recap.recentTurns.map((turn) => turn.id)).size).toBe(3);
  });
});
