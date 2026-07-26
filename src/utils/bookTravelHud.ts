import type {
  BookTravelScene,
  BookTravelTurnSnapshot,
  BookTravelUserCharacter,
} from '../stores/useBookTravelStore';

export type BookTravelHudGroupId = 'clues' | 'people' | 'world' | 'other';

export interface BookTravelHudEntry {
  id: string;
  label: string;
  value?: string;
  values?: string[];
  fullValue?: string;
  details?: BookTravelHudEntry[];
}

export interface BookTravelHudDynamicGroup {
  id: BookTravelHudGroupId;
  label: string;
  entries: BookTravelHudEntry[];
}

export interface BookTravelHudRecentTurn {
  id: string;
  label: string;
  userInput: string;
  narrativeOutput: string;
}

export interface BookTravelHudRecap {
  summary: {
    preview: string;
    fullText: string;
    isTruncated: boolean;
  } | null;
  recentTurns: BookTravelHudRecentTurn[];
}

export interface BookTravelHudModel {
  title: string;
  sceneTitle: string;
  isCompleted: boolean;
  journey: BookTravelHudEntry[];
  scene: BookTravelHudEntry[];
  dynamicGroups: BookTravelHudDynamicGroup[];
  recap: BookTravelHudRecap;
}

export interface BuildBookTravelHudModelInput {
  userCharacter: BookTravelUserCharacter | null;
  currentScene: BookTravelScene | null;
  currentState: unknown | null;
  volatileMemory: Record<string, unknown> | null;
  summaryMemory: string;
  turns: BookTravelTurnSnapshot[];
  isCompleted: boolean;
}

interface FieldDefinition {
  label: string;
  group: BookTravelHudGroupId;
  booleanStyle?: 'event' | 'yes-no';
}

interface NormalizedValue {
  value?: string;
  values?: string[];
  fullValue?: string;
  details?: BookTravelHudEntry[];
}

const GROUP_LABELS: Record<BookTravelHudGroupId, string> = {
  clues: '线索与秘密',
  people: '人物动态',
  world: '世界动态',
  other: '其他状态',
};

const FIELD_DEFINITIONS: Record<string, FieldDefinition> = {
  clues: { label: '线索', group: 'clues' },
  clue: { label: '线索', group: 'clues' },
  items: { label: '随身物品', group: 'clues' },
  item: { label: '随身物品', group: 'clues' },
  inventory: { label: '随身物品', group: 'clues' },
  secrets: { label: '隐秘信息', group: 'clues' },
  secret: { label: '隐秘信息', group: 'clues' },
  foundtrail: { label: '新发现', group: 'clues' },
  letterstatus: { label: '信件状态', group: 'clues' },
  mood: { label: '当前情绪', group: 'people' },
  charactermood: { label: '角色心境', group: 'people' },
  reaction: { label: '人物反应', group: 'people' },
  reactions: { label: '人物反应', group: 'people' },
  characterreaction: { label: '人物反应', group: 'people' },
  characterreactions: { label: '人物反应', group: 'people' },
  relationship: { label: '关系变化', group: 'people' },
  relationships: { label: '关系变化', group: 'people' },
  relationshipstatus: { label: '关系状态', group: 'people' },
  attitude: { label: '人物态度', group: 'people' },
  locationsetup: { label: '场景布置', group: 'world' },
  observedfirstowldelivery: { label: '首次猫头鹰送信', group: 'world', booleanStyle: 'event' },
  worldevent: { label: '世界事件', group: 'world' },
  worldevents: { label: '世界事件', group: 'world' },
  event: { label: '剧情事件', group: 'world' },
  events: { label: '剧情事件', group: 'world' },
  goal: { label: '当前目标', group: 'world' },
  goals: { label: '当前目标', group: 'world' },
  objective: { label: '行动目标', group: 'world' },
  objectives: { label: '行动目标', group: 'world' },
  lastaction: { label: '最近行动', group: 'other' },
  score: { label: '进度数值', group: 'other' },
};

const PRIMARY_SCENE_KEYS = new Set([
  'time',
  'currenttime',
  'timeofday',
  'location',
  'currentlocation',
  'currentsituation',
  'situation',
  'activecharacters',
  'characters',
]);

const normalizeKey = (key: string) => key.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '').toLowerCase();

const createStableId = (source: string) => {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `hud-${(hash >>> 0).toString(36)}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const cleanString = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
};

const truncateValue = (value: string, maxLength = 96) => {
  if (value.length <= maxLength) return { value };
  return {
    value: `${value.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`,
    fullValue: value,
  };
};

const resolveFieldDefinition = (key: string): FieldDefinition => {
  const normalized = normalizeKey(key);
  const exact = FIELD_DEFINITIONS[normalized];
  if (exact) return exact;

  if (/(clue|secret|item|inventory|trail|letter)/.test(normalized)) {
    return { label: '线索记录', group: 'clues' };
  }
  if (/(mood|reaction|relationship|attitude|character|trust|bond)/.test(normalized)) {
    return { label: '人物状态', group: 'people' };
  }
  if (/(location|place|world|event|scene|weather|time|goal|objective|mission)/.test(normalized)) {
    return { label: '世界状态', group: 'world' };
  }
  if (/(observed|opened|found|completed|occurred|triggered|delivered|visited|unlocked|has)/.test(normalized)) {
    return { label: '事件状态', group: 'world', booleanStyle: 'event' };
  }
  return { label: '状态记录', group: 'other' };
};

const normalizeBoolean = (value: boolean, definition: FieldDefinition) => {
  if (definition.booleanStyle === 'event') return value ? '已发生' : '未发生';
  return value ? '是' : '否';
};

const normalizeValue = (
  value: unknown,
  definition: FieldDefinition,
  path: string,
  depth = 0,
): NormalizedValue | null => {
  if (value == null || depth > 4) return null;

  if (typeof value === 'boolean') {
    return { value: normalizeBoolean(value, definition) };
  }

  const primitive = cleanString(value);
  if (primitive !== null) return truncateValue(primitive);

  if (Array.isArray(value)) {
    const primitiveValues = value
      .map((item) => cleanString(item))
      .filter((item): item is string => item !== null);
    const details = value.flatMap((item, index) => {
      if (!isRecord(item) && !Array.isArray(item)) return [];
      const normalized = normalizeValue(item, definition, `${path}.${index}`, depth + 1);
      return normalized?.details ?? [];
    });
    if (primitiveValues.length === 0 && details.length === 0) return null;
    return {
      values: primitiveValues.slice(0, 12),
      details: details.length > 0 ? details : undefined,
    };
  }

  if (isRecord(value)) {
    const details = Object.entries(value).flatMap(([childKey, childValue]) => {
      const childDefinition = resolveFieldDefinition(childKey);
      const normalized = normalizeValue(childValue, childDefinition, `${path}.${childKey}`, depth + 1);
      if (!normalized) return [];
      const detail: BookTravelHudEntry = {
        id: createStableId(`${path}.${childKey}`),
        label: childDefinition.label === '状态记录' ? '详细状态' : childDefinition.label,
        ...normalized,
      };
      return [detail];
    });
    if (details.length === 0) return null;
    return { details };
  }

  return null;
};

const createEntry = (
  idSource: string,
  label: string,
  value: unknown,
  definition: FieldDefinition = { label, group: 'other' },
): BookTravelHudEntry | null => {
  const normalized = normalizeValue(value, definition, idSource);
  if (!normalized) return null;
  return {
    id: createStableId(idSource),
    label,
    ...normalized,
  };
};

const findStateValue = (state: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const match = Object.entries(state).find(([candidate]) => normalizeKey(candidate) === normalizeKey(key));
    if (match && normalizeValue(match[1], { label: key, group: 'other' }, `primary.${key}`)) {
      return match[1];
    }
  }
  return null;
};

export const buildBookTravelHudModel = ({
  userCharacter,
  currentScene,
  currentState,
  volatileMemory,
  summaryMemory,
  turns,
  isCompleted,
}: BuildBookTravelHudModelInput): BookTravelHudModel => {
  const state = isRecord(currentState) ? currentState : {};
  const identity = userCharacter
    ? userCharacter.identity.trim()
      ? `${userCharacter.name.trim()}（${userCharacter.identity.trim()}）`
      : userCharacter.name.trim()
    : '';
  const journey = [
    userCharacter
      ? createEntry('journey.identity', '扮演身份', identity)
      : null,
    userCharacter ? createEntry('journey.goal', '当前目标', userCharacter.goal) : null,
  ].filter((entry): entry is BookTravelHudEntry => entry !== null);

  const time = findStateValue(state, ['time', 'currentTime', 'timeOfDay']) ?? currentScene?.time ?? null;
  const location = findStateValue(state, ['location', 'currentLocation']) ?? currentScene?.location ?? null;
  const situation = findStateValue(state, ['currentSituation', 'situation']) ?? currentScene?.currentSituation ?? currentScene?.summary ?? null;
  const activeCharacters = findStateValue(state, ['activeCharacters', 'characters']) ?? currentScene?.activeCharacters ?? null;
  const scene = [
    createEntry('scene.time', '时间', time),
    createEntry('scene.location', '地点', location),
    createEntry('scene.situation', '当前局势', situation),
    createEntry('scene.characters', '活跃角色', activeCharacters),
  ].filter((entry): entry is BookTravelHudEntry => entry !== null);

  const groupedEntries: Record<BookTravelHudGroupId, BookTravelHudEntry[]> = {
    clues: [],
    people: [],
    world: [],
    other: [],
  };
  const dynamicState = {
    ...(volatileMemory ?? {}),
    ...state,
  };

  Object.entries(dynamicState).forEach(([key, value]) => {
    if (PRIMARY_SCENE_KEYS.has(normalizeKey(key))) return;
    const definition = resolveFieldDefinition(key);
    const normalized = normalizeValue(value, definition, `dynamic.${key}`);
    if (!normalized) return;
    groupedEntries[definition.group].push({
      id: createStableId(`dynamic.${key}`),
      label: definition.label,
      ...normalized,
    });
  });

  const dynamicGroups = (Object.keys(GROUP_LABELS) as BookTravelHudGroupId[]).reduce<BookTravelHudDynamicGroup[]>(
    (groups, id) => {
      if (groupedEntries[id].length > 0) {
        groups.push({ id, label: GROUP_LABELS[id], entries: groupedEntries[id] });
      }
      return groups;
    },
    [],
  );

  const summary = cleanString(summaryMemory);
  const summaryPreview = summary ? truncateValue(summary, 108) : null;
  const recentTurns = turns.slice(-3).map((turn, index) => ({
    id: createStableId(`recap.${turn.id}`),
    label: `回合 ${Math.max(1, turns.length - 3 + index + 1)}`,
    userInput: cleanString(turn.userInput) ?? '未记录行动',
    narrativeOutput: cleanString(turn.narrativeOutput) ?? '未记录剧情',
  }));

  return {
    title: '旅程状态',
    sceneTitle: cleanString(currentScene?.title) ?? '当前旅程',
    isCompleted,
    journey,
    scene,
    dynamicGroups,
    recap: {
      summary: summary && summaryPreview ? {
        preview: summaryPreview.value,
        fullText: summary,
        isTruncated: Boolean(summaryPreview.fullValue),
      } : null,
      recentTurns,
    },
  };
};
