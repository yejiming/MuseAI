import React, { useEffect, useMemo, useRef } from 'react';
import { Alert, Button, Card, Empty, Form, Input, Modal, Select, Spin, Tag, Tabs, Tree, TreeSelect, message } from 'antd';
import { BookOutlined, BranchesOutlined, DeleteOutlined, PlusOutlined, SaveOutlined, StopOutlined, UserOutlined } from '@ant-design/icons';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useBookTravelStore, BookTravelAssembledMaterial, BookTravelEntryPoint, BookTravelUserCharacter } from '../stores/useBookTravelStore';
import { usePartnerStore } from '../stores/usePartnerStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { resolveOutlineMaterial, resolvePartnerMaterials } from '../utils/bookTravelMaterials';
import { getCharacterCardIdsForWorldBook, groupCharacterCardsByWorldBook } from '../utils/characterCardGroups';
import { useStateGroup } from '../utils/reducerState';

interface FileTreeNode {
  title: string;
  value: string;
  key: string;
  selectable: boolean;
  children?: FileTreeNode[];
}

interface MaterialDetailDraft {
  title: string;
  worldModel: Record<string, unknown>;
  entryPoints: BookTravelEntryPoint[];
  characters: BookTravelUserCharacter[];
  stableMemory: Record<string, unknown> | null;
  volatileMemory: Record<string, unknown> | null;
}

interface BookTravelMaterialsUiState {
  modalOpen: boolean;
  outlineTree: FileTreeNode[];
  selectedOutlinePath?: string;
  selectedWorldBookId?: string;
  selectedCharacterCardIds: string[];
  progressOpen: boolean;
  progressPhase: 'assembling' | 'entry' | 'done' | 'error' | 'cancelled';
  assembleOutput: string;
  entryOutput: string;
  progressError: string;
  elapsedMs: number;
  detailDraft: MaterialDetailDraft;
}

const BOOK_TRAVEL_PROGRESS_DOT_BASE_STYLE: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: '50%',
  color: '#fff',
  fontSize: 12,
  fontWeight: 600,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/**
 * Robust JSON parser that extracts the first well-formed JSON object/array
 * from raw text, handling trailing Chinese characters and markdown fences.
 */
const parseJSON = (raw: string) => {
  let cleaned = raw.trim();

  if (cleaned.startsWith('```')) {
    const lines = cleaned.split('\n');
    if (lines[0].startsWith('```')) lines.shift();
    if (lines[lines.length - 1]?.trim() === '```') lines.pop();
    cleaned = lines.join('\n').trim();
  }

  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  let startIdx = -1;
  let isObject = true;

  if (firstBrace !== -1 && firstBracket !== -1) {
    if (firstBrace < firstBracket) {
      startIdx = firstBrace;
      isObject = true;
    } else {
      startIdx = firstBracket;
      isObject = false;
    }
  } else if (firstBrace !== -1) {
    startIdx = firstBrace;
    isObject = true;
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
    isObject = false;
  }

  if (startIdx === -1) {
    throw new Error('未找到 JSON 数据结构开始标记');
  }

  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  let escape = false;
  let endIdx = -1;

  for (let i = startIdx; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
    } else {
      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0 && isObject) {
          endIdx = i;
          break;
        }
      } else if (char === '[') {
        bracketCount++;
      } else if (char === ']') {
        bracketCount--;
        if (bracketCount === 0 && !isObject) {
          endIdx = i;
          break;
        }
      }
    }
  }

  if (endIdx === -1) {
    return JSON.parse(cleaned.substring(startIdx));
  }

  const jsonCandidate = cleaned.substring(startIdx, endIdx + 1);
  return JSON.parse(jsonCandidate);
};

const TASK_TIMEOUT_MS = 600_000; // 600 seconds

let editableRowKeySeed = 0;
const createEditableRowKey = () => `editable-row-${editableRowKeySeed++}`;

const formatElapsed = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

/* ------------------------------------------------------------------ */
/*  Editable JSON helpers                                               */
/* ------------------------------------------------------------------ */

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^\s/, '')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every((v) => typeof v === 'string');
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function createMaterialDetailDraft(material: BookTravelAssembledMaterial | null): MaterialDetailDraft {
  if (!material) {
    return {
      title: '',
      worldModel: {},
      entryPoints: [],
      characters: [],
      stableMemory: null,
      volatileMemory: null,
    };
  }

  return {
    title: material.title,
    worldModel: isPlainObject(material.assembledWorldModel) ? material.assembledWorldModel : {},
    entryPoints: [...material.entryPoints],
    characters: [...material.recommendedUserCharacters],
    stableMemory: isPlainObject(material.stableMemory) ? material.stableMemory : null,
    volatileMemory: isPlainObject(material.volatileMemory) ? material.volatileMemory : null,
  };
}

/** Generic editor for a JSON object value (string, string[], nested object). */
function EditableJsonValue({
  value,
  onChange,
  depth = 0,
}: {
  value: unknown;
  onChange: (next: unknown) => void;
  depth?: number;
}) {
  const rowKeysRef = useRef<string[]>([]);
  const getRowKeys = (length: number) => {
    while (rowKeysRef.current.length < length) {
      rowKeysRef.current.push(createEditableRowKey());
    }
    if (rowKeysRef.current.length > length) {
      rowKeysRef.current.length = length;
    }
    return rowKeysRef.current;
  };

  if (value === null || value === undefined) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#bfbfbf' }}>暂无</span>
        <Button size="small" onClick={() => onChange('')} style={{ fontSize: 12 }}>
          添加内容
        </Button>
      </div>
    );
  }

  if (typeof value === 'string') {
    if (value.includes('\n') || value.length > 60) {
      return (
        <Input.TextArea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoSize={{ minRows: 2, maxRows: 6 }}
          style={{ borderRadius: 6, borderColor: '#eae6df', background: '#faf9f5', fontSize: 14 }}
        />
      );
    }
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ borderRadius: 6, borderColor: '#eae6df', background: '#faf9f5', fontSize: 14 }}
      />
    );
  }

  if (typeof value === 'number') {
    return (
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ borderRadius: 6, borderColor: '#eae6df', background: '#faf9f5', fontSize: 14 }}
      />
    );
  }

  if (typeof value === 'boolean') {
    return (
      <Tag.CheckableTag
        checked={value}
        onChange={(checked) => onChange(checked)}
        style={{
          borderRadius: 6,
          padding: '4px 12px',
          border: value ? '1px solid #d97757' : '1px solid #eae6df',
          backgroundColor: value ? '#fff7f2' : '#faf9f5',
          color: value ? '#d97757' : '#5c5751',
          margin: 0,
        }}
      >
        {value ? '是' : '否'}
      </Tag.CheckableTag>
    );
  }

  if (isStringArray(value)) {
    const rowKeys = getRowKeys(value.length);
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        {value.map((item, idx) => (
          <div key={rowKeys[idx]} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Input
              value={item}
              onChange={(e) => {
                const next = [...value];
                next[idx] = e.target.value;
                onChange(next);
              }}
              style={{ flex: 1, borderRadius: 6, borderColor: '#eae6df', background: '#faf9f5', fontSize: 14 }}
            />
            <Button
              size="small"
              danger
              onClick={() => {
                rowKeysRef.current = rowKeysRef.current.filter((_, i) => i !== idx);
                const next = value.filter((_, i) => i !== idx);
                onChange(next);
              }}
            >
              删除
            </Button>
          </div>
        ))}
        <Button
          size="small"
          icon={<PlusOutlined />}
          onClick={() => {
            rowKeysRef.current = [...rowKeysRef.current, createEditableRowKey()];
            onChange([...value, '']);
          }}
          style={{ width: 'fit-content', fontSize: 12 }}
        >
          添加条目
        </Button>
      </div>
    );
  }

  if (Array.isArray(value)) {
    const rowKeys = getRowKeys(value.length);
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        {value.map((item, idx) => (
          <div key={rowKeys[idx]} style={{ paddingLeft: 12, borderLeft: '2px solid #f2e8dc' }}>
            <EditableJsonValue
              value={item}
              onChange={(nextItem) => {
                const next = [...value];
                next[idx] = nextItem;
                onChange(next);
              }}
              depth={depth + 1}
            />
            <Button
              size="small"
              danger
              style={{ marginTop: 4, fontSize: 12 }}
              onClick={() => {
                rowKeysRef.current = rowKeysRef.current.filter((_, i) => i !== idx);
                const next = value.filter((_, i) => i !== idx);
                onChange(next);
              }}
            >
              删除
            </Button>
          </div>
        ))}
        <Button
          size="small"
          icon={<PlusOutlined />}
          onClick={() => {
            rowKeysRef.current = [...rowKeysRef.current, createEditableRowKey()];
            onChange([...value, '']);
          }}
          style={{ width: 'fit-content', fontSize: 12 }}
        >
          添加条目
        </Button>
      </div>
    );
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    return (
      <div style={{ display: 'grid', gap: 14 }}>
        {entries.map(([key, val]) => (
          <div key={key}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#8c8882', marginBottom: 6 }}>
              {humanizeKey(key)}
            </div>
            <div style={{ paddingLeft: 12, borderLeft: '2px solid #f2e8dc' }}>
              <EditableJsonValue
                value={val}
                onChange={(nextVal) => {
                  onChange({ ...value, [key]: nextVal });
                }}
                depth={depth + 1}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <Input
      value={String(value)}
      onChange={(e) => onChange(e.target.value)}
      style={{ borderRadius: 6, borderColor: '#eae6df', background: '#faf9f5', fontSize: 14 }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

const useBookTravelMaterialsView = () => {
  const store = useBookTravelStore();
  const settings = useSettingsStore();
  const { worldBooks, characterCards } = usePartnerStore();
  const [uiState, patchUiState, setUiField] = useStateGroup<BookTravelMaterialsUiState>({
    modalOpen: false,
    outlineTree: [],
    selectedOutlinePath: undefined,
    selectedWorldBookId: undefined,
    selectedCharacterCardIds: [],
    progressOpen: false,
    progressPhase: 'assembling',
    assembleOutput: '',
    entryOutput: '',
    progressError: '',
    elapsedMs: 0,
    detailDraft: createMaterialDetailDraft(null),
  });
  const {
    modalOpen,
    outlineTree,
    selectedOutlinePath,
    selectedWorldBookId,
    selectedCharacterCardIds,
    progressOpen,
    progressPhase,
    assembleOutput,
    entryOutput,
    progressError,
    elapsedMs,
    detailDraft,
  } = uiState;
  const setModalOpen = (modalOpen: boolean) => setUiField('modalOpen', modalOpen);
  const setOutlineTree = (outlineTree: FileTreeNode[]) => setUiField('outlineTree', outlineTree);
  const setSelectedOutlinePath = (selectedOutlinePath: string | undefined) => setUiField('selectedOutlinePath', selectedOutlinePath);
  const setSelectedWorldBookId = (selectedWorldBookId: string | undefined) => setUiField('selectedWorldBookId', selectedWorldBookId);
  const setSelectedCharacterCardIds = (selectedCharacterCardIds: string[]) => setUiField('selectedCharacterCardIds', selectedCharacterCardIds);
  const setProgressOpen = (progressOpen: boolean) => setUiField('progressOpen', progressOpen);
  const setProgressPhase = (progressPhase: BookTravelMaterialsUiState['progressPhase']) => setUiField('progressPhase', progressPhase);
  const setProgressError = (progressError: string) => setUiField('progressError', progressError);
  const setElapsedMs = (elapsedMs: React.SetStateAction<number>) => setUiField('elapsedMs', elapsedMs);
  const characterCardGroups = groupCharacterCardsByWorldBook(worldBooks, characterCards);
  const characterCardIdSet = new Set(characterCards.map((card) => card.id));
  const characterCardTreeData = characterCardGroups.map((group) => ({
    key: group.key,
    title: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#8c8882', fontSize: 13 }}>
        <BookOutlined style={{ color: group.worldBookId ? '#d97757' : '#c0bbb4' }} />
        {group.title}
      </span>
    ),
    selectable: false,
    children: group.cards.map((card) => ({
      key: card.id,
      title: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#33312e', fontSize: 13 }}>
          <UserOutlined style={{ color: '#8c8882' }} />
          {card.name}
        </span>
      ),
      isLeaf: true,
    })),
  }));
  const handleWorldBookChange = (worldBookId: string) => {
    setSelectedWorldBookId(worldBookId);
    setSelectedCharacterCardIds(getCharacterCardIdsForWorldBook(worldBookId, characterCards));
  };
  const handleCharacterCardCheck = (checkedKeys: React.Key[] | { checked: React.Key[] }) => {
    const keys = Array.isArray(checkedKeys) ? checkedKeys : checkedKeys.checked;
    setSelectedCharacterCardIds(keys.reduce<string[]>((ids, key) => {
      const id = String(key);
      if (characterCardIdSet.has(id)) ids.push(id);
      return ids;
    }, []));
  };

  // Progress modal state
  const activeRunIdRef = useRef<string | null>(null);
  const resolverRef = useRef<{ resolve: (content: string) => void; reject: (error: string) => void } | null>(null);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const characterKeysRef = useRef<string[]>([]);

  const detailTitle = detailDraft.title;
  const editWorldModel = detailDraft.worldModel;
  const editEntryPoints = detailDraft.entryPoints;
  const editCharacters = detailDraft.characters;
  const editStableMemory = detailDraft.stableMemory;
  const editVolatileMemory = detailDraft.volatileMemory;
  const setDetailDraft = (updater: MaterialDetailDraft | ((draft: MaterialDetailDraft) => MaterialDetailDraft)) => setUiField('detailDraft', updater);
  const setDetailTitle = (title: string) => setDetailDraft((draft) => ({ ...draft, title }));
  const setEditWorldModel = (worldModel: Record<string, unknown>) => setDetailDraft((draft) => ({ ...draft, worldModel }));
  const setEditEntryPoints = (updater: BookTravelEntryPoint[] | ((prev: BookTravelEntryPoint[]) => BookTravelEntryPoint[])) => {
    setDetailDraft((draft) => ({
      ...draft,
      entryPoints: typeof updater === 'function' ? updater(draft.entryPoints) : updater,
    }));
  };
  const setEditCharacters = (updater: BookTravelUserCharacter[] | ((prev: BookTravelUserCharacter[]) => BookTravelUserCharacter[])) => {
    setDetailDraft((draft) => ({
      ...draft,
      characters: typeof updater === 'function' ? updater(draft.characters) : updater,
    }));
  };
  const setEditStableMemory = (stableMemory: Record<string, unknown> | null) => setDetailDraft((draft) => ({ ...draft, stableMemory }));
  const setEditVolatileMemory = (volatileMemory: Record<string, unknown> | null) => setDetailDraft((draft) => ({ ...draft, volatileMemory }));

  const selectedMaterial = useMemo(() => {
    if (store.selectedMaterialId) {
      return store.assembledMaterials.find((item) => item.id === store.selectedMaterialId) || store.assembledMaterials[0] || null;
    }
    return store.assembledMaterials[0] || null;
  }, [store.assembledMaterials, store.selectedMaterialId]);

  // Sync editable states when selected material changes
  useEffect(() => {
    characterKeysRef.current = selectedMaterial
      ? selectedMaterial.recommendedUserCharacters.map(() => createEditableRowKey())
      : [];
    setUiField('detailDraft', createMaterialDetailDraft(selectedMaterial));
  }, [selectedMaterial, setUiField]);

  // Global listener for book-travel-stream events
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    listen<any>('book-travel-stream', (event) => {
      if (!active) return;
      const { runId, eventType, delta, message: eventMessage } = event.payload;
      if (activeRunIdRef.current && runId !== activeRunIdRef.current) return;

      if (eventType === 'delta' && delta) {
        if (progressPhase === 'assembling') {
          setUiField('assembleOutput', (prev) => prev + delta);
        } else if (progressPhase === 'entry') {
          setUiField('entryOutput', (prev) => prev + delta);
        }
      }
      if (eventType === 'done') {
        resolverRef.current?.resolve(eventMessage || '');
      }
      if (eventType === 'error') {
        resolverRef.current?.reject(eventMessage || '未知错误');
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [progressPhase, setUiField]);

  const loadOutlineTree = async () => {
    try {
      const root = await invoke<string>('get_workspace_dir', { dirType: 'outline' });
      const readDir = async (path: string): Promise<FileTreeNode[]> => {
        const list = await invoke<any[]>('list_dir', { path });
        const nodes = (await Promise.all(list.map(async (item): Promise<FileTreeNode | null> => {
          if (item.is_dir) {
            return {
              title: item.name,
              value: item.path,
              key: item.path,
              selectable: false,
              children: await readDir(item.path),
            };
          } else if (item.name.toLowerCase().endsWith('.md') || item.name.toLowerCase().endsWith('.txt')) {
            return {
              title: item.name,
              value: item.path,
              key: item.path,
              selectable: true,
            };
          }
          return null;
        }))).reduce<FileTreeNode[]>((acc, node) => {
          if (node) acc.push(node);
          return acc;
        }, []);
        return nodes.sort((a, b) => {
          if (a.selectable !== b.selectable) return a.selectable ? 1 : -1;
          return a.title.localeCompare(b.title, 'zh-CN');
        });
      };
      setOutlineTree(await readDir(root));
    } catch (err) {
      message.error(`加载大纲目录失败：${String(err)}`);
    }
  };

  const openModal = () => {
    setSelectedOutlinePath(undefined);
    setSelectedWorldBookId(undefined);
    setSelectedCharacterCardIds([]);
    setModalOpen(true);
    void loadOutlineTree();
  };

  const buildRequest = (role: string, systemPrompt: string, config: any, materials: any, state: unknown) => ({
    modelInterface: settings.modelInterface,
    baseUrl: settings.llmBaseUrl,
    apiKey: settings.llmApiKey,
    model: settings.llmModel,
    role,
    materials,
    state,
    previousValidState: {},
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
    maxContextTokens: config.maxContextTokens,
    thinkingDepth: 'off',
    systemPrompt,
  });

  const runStreamTask = async (commandName: string, request: any) => {
    return new Promise<string>((resolve, reject) => {
      if (cancelledRef.current) {
        reject('用户中断');
        return;
      }
      resolverRef.current = { resolve, reject };
      invoke<{ runId: string }>(commandName, { request })
        .then((result) => {
          activeRunIdRef.current = result.runId;
        })
        .catch((err) => {
          reject(String(err));
        });
    });
  };

  const clearTimers = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const handleCancel = async () => {
    cancelledRef.current = true;
    resolverRef.current?.reject('用户中断');
    if (activeRunIdRef.current) {
      try {
        await invoke('stop_book_travel_stream', { runId: activeRunIdRef.current });
      } catch (e) {
        console.error('停止穿书流失败:', e);
      }
    }
    clearTimers();
    setProgressPhase('cancelled');
  };

  const handleAssemble = async () => {
    if (!selectedOutlinePath || !selectedWorldBookId || selectedCharacterCardIds.length === 0) {
      message.warning('请先选择大纲、世界书和角色卡');
      return;
    }

    patchUiState({
      modalOpen: false,
      progressOpen: true,
      progressPhase: 'assembling',
      assembleOutput: '',
      entryOutput: '',
      progressError: '',
      elapsedMs: 0,
    });
    cancelledRef.current = false;

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 1000);

    timeoutRef.current = setTimeout(() => {
      if (!cancelledRef.current) {
        handleCancel();
        setProgressPhase('error');
        setProgressError('任务执行超时（600秒），已自动中断');
      }
    }, TASK_TIMEOUT_MS);

    try {
      const outline = await resolveOutlineMaterial(selectedOutlinePath);
      const partnerMaterials = resolvePartnerMaterials(selectedWorldBookId, selectedCharacterCardIds);
      if (!partnerMaterials.worldBook || partnerMaterials.characterCards.length === 0) {
        throw new Error('世界书或角色卡不存在');
      }
      const materials = {
        outline,
        worldBook: partnerMaterials.worldBook,
        characterCards: partnerMaterials.characterCards,
      };

      setProgressPhase('assembling');
      const assemblerConfig = settings.agentConfigs?.bookTravelMaterialAssembler || {};
      if (cancelledRef.current) {
        clearTimers();
        return;
      }
      const assembledRaw = await runStreamTask(
        'start_assemble_book_travel_materials_stream',
        buildRequest('material-assembler', settings.bookTravelMaterialAssemblerPrompt, assemblerConfig, materials, {}),
      );
      const assembled = parseJSON(assembledRaw);
      const assembledWorldModel = assembled?.assembledWorldModel ?? assembled;

      setProgressPhase('entry');
      const entryConfig = settings.agentConfigs?.bookTravelEntryDirector || {};
      if (cancelledRef.current) {
        clearTimers();
        return;
      }
      const entryRaw = await runStreamTask(
        'start_generate_book_travel_entry_setup_stream',
        buildRequest('entry-director', settings.bookTravelEntryDirectorPrompt, entryConfig, materials, {
          assembledWorldModel,
          stableMemory: assembled?.stableMemory ?? null,
          volatileMemory: assembled?.volatileMemory ?? null,
        }),
      );
      const entrySetup = parseJSON(entryRaw);
      const entryPoints = (entrySetup.entryPoints || []).map((entry: any, index: number) => ({
        id: entry.id || `entry-${index + 1}`,
        title: entry.title || `入场点-${index + 1}`,
        summary: entry.summary || entry.situation || '',
        timeAndLocation: entry.timeAndLocation,
        situation: entry.situation,
        initialGoal: entry.initialGoal,
        risk: entry.risk,
      }));
      const recommendedUserCharacters = (entrySetup.recommendedUserCharacters || []).map((character: any, index: number) => {
        const identity = character.identity || character.name || `身份-${index + 1}`;
        return {
          name: character.name || identity,
          identity,
          background: character.background || '',
          personality: character.personality || '',
          goal: character.goal || '',
        };
      });

      const title = `${outline.title} · ${partnerMaterials.worldBook.title}`;
      const id = store.saveAssembledMaterial({
        title,
        materials,
        assembledWorldModel,
        stableMemory: assembled?.stableMemory ?? null,
        volatileMemory: assembled?.volatileMemory ?? null,
        entryPoints,
        recommendedUserCharacters,
      });
      store.loadAssembledMaterial(id);

      setProgressPhase('done');
      message.success('素材装配成功');

      setTimeout(() => {
        setProgressOpen(false);
      }, 1200);
    } catch (err) {
      if (cancelledRef.current) {
        setProgressPhase('cancelled');
      } else {
        setProgressPhase('error');
        setProgressError(String(err));
      }
    } finally {
      clearTimers();
      activeRunIdRef.current = null;
      resolverRef.current = null;
    }
  };

  const handleSaveDetail = () => {
    if (!selectedMaterial) return;
    store.updateAssembledMaterial(selectedMaterial.id, {
      title: detailTitle.trim() || selectedMaterial.title,
      assembledWorldModel: editWorldModel,
      stableMemory: editStableMemory,
      volatileMemory: editVolatileMemory,
      entryPoints: editEntryPoints,
      recommendedUserCharacters: editCharacters,
    });
    message.success('已保存素材详情');
  };

  /* ---------------------------------------------------------------- */
  /*  Detail editing helpers                                            */
  /* ---------------------------------------------------------------- */

  const updateEntryPoint = (index: number, patch: Partial<BookTravelEntryPoint>) => {
    setEditEntryPoints((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item))
    );
  };

  const removeEntryPoint = (index: number) => {
    setEditEntryPoints((prev) => prev.filter((_, i) => i !== index));
  };

  const addEntryPoint = () => {
    setEditEntryPoints((prev) => [
      ...prev,
      {
        id: `entry-${Date.now()}`,
        title: '新入场点',
        summary: '',
        timeAndLocation: '',
        situation: '',
        initialGoal: '',
        risk: '',
      },
    ]);
  };

  const updateCharacter = (index: number, patch: Partial<BookTravelUserCharacter>) => {
    setEditCharacters((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item))
    );
  };

  const removeCharacter = (index: number) => {
    characterKeysRef.current = characterKeysRef.current.filter((_, i) => i !== index);
    setEditCharacters((prev) => prev.filter((_, i) => i !== index));
  };

  const addCharacter = () => {
    characterKeysRef.current = [...characterKeysRef.current, createEditableRowKey()];
    setEditCharacters((prev) => [
      ...prev,
      { name: '新角色', identity: '', background: '', personality: '', goal: '' },
    ]);
  };

  while (characterKeysRef.current.length < editCharacters.length) {
    characterKeysRef.current.push(createEditableRowKey());
  }
  if (characterKeysRef.current.length > editCharacters.length) {
    characterKeysRef.current.length = editCharacters.length;
  }

  return (
    <div style={{ height: '100%', display: 'flex', background: '#faf9f5', overflow: 'hidden' }}>
      <aside style={{ width: 300, borderRight: '1px solid #eae6df', padding: 24, overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#33312e' }}>穿书素材</div>
          <Button type="primary" icon={<PlusOutlined />} onClick={openModal} style={{ background: '#d97757', borderColor: '#d97757' }}>
            新增素材
          </Button>
        </div>
        {store.assembledMaterials.length === 0 ? (
          <Empty description="暂无已装配素材" />
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {store.assembledMaterials.map((item) => {
              const selected = selectedMaterial?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => store.loadAssembledMaterial(item.id)}
                  style={{
                    textAlign: 'left',
                    border: selected ? '1px solid #d97757' : '1px solid #eae6df',
                    background: selected ? '#fff7f2' : '#ffffff',
                    borderRadius: 8,
                    padding: '12px 14px',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 600, color: selected ? '#d97757' : '#33312e' }}>{item.title}</div>
                  <div style={{ fontSize: 12, color: '#8c8882', marginTop: 5 }}>
                    {item.entryPoints.length} 个入场点 · {item.recommendedUserCharacters.length} 个身份 · {item.materials.characterCards.length} 张角色卡
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </aside>

      <main aria-label="素材详情" style={{ flex: 1, padding: 32, overflowY: 'auto' }}>
        {!selectedMaterial ? (
          <Empty description="选择或新增一个穿书素材" />
        ) : (
          <div style={{ maxWidth: 900, display: 'grid', gap: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <h2 style={{ margin: 0, color: '#33312e', fontSize: 22 }}>素材详情</h2>
                <div style={{ color: '#8c8882', fontSize: 13, marginTop: 6 }}>
                  {selectedMaterial.materials.outline.title} · {selectedMaterial.materials.worldBook.title}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button icon={<SaveOutlined />} type="primary" onClick={handleSaveDetail} style={{ background: '#d97757', borderColor: '#d97757' }}>
                  保存素材详情
                </Button>
                <Button icon={<DeleteOutlined />} danger onClick={() => store.deleteAssembledMaterial(selectedMaterial.id)}>
                  删除
                </Button>
              </div>
            </div>

            <label htmlFor="book-travel-material-title" style={{ display: 'grid', gap: 6, color: '#33312e', fontWeight: 600 }}>
              素材名称
              <Input id="book-travel-material-title" aria-label="素材名称" value={detailTitle} onChange={(event) => setDetailTitle(event.target.value)} />
            </label>

            <Tabs
              defaultActiveKey="world-model"
              items={[
                {
                  key: 'world-model',
                  label: '世界模型',
                  children: (
                    <div style={{ padding: '8px 0' }}>
                      <EditableJsonValue value={editWorldModel} onChange={(v) => setEditWorldModel(v as Record<string, unknown>)} />
                    </div>
                  ),
                },
                {
                  key: 'entry-points',
                  label: `入场点 (${editEntryPoints.length})`,
                  children: (
                    <div style={{ display: 'grid', gap: 12, padding: '8px 0' }}>
                      {editEntryPoints.map((entry, idx) => (
                        <Card
                          key={entry.id}
                          size="small"
                          style={{ borderRadius: 10, borderColor: '#f2e8dc', background: '#ffffff' }}
                          title={
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontWeight: 600, color: '#33312e' }}>入场点 {idx + 1}</span>
                              <Button size="small" danger onClick={() => removeEntryPoint(idx)}>
                                删除
                              </Button>
                            </div>
                          }
                        >
                          <div style={{ display: 'grid', gap: 12 }}>
                            <div>
                              <div style={{ fontSize: 12, color: '#8c8882', fontWeight: 500, marginBottom: 4 }}>标题</div>
                              <Input
                                value={entry.title}
                                onChange={(e) => updateEntryPoint(idx, { title: e.target.value })}
                                style={{ borderRadius: 6, borderColor: '#eae6df', background: '#faf9f5' }}
                              />
                            </div>
                            <div>
                              <div style={{ fontSize: 12, color: '#8c8882', fontWeight: 500, marginBottom: 4 }}>时间与地点</div>
                              <Input
                                value={entry.timeAndLocation || ''}
                                onChange={(e) => updateEntryPoint(idx, { timeAndLocation: e.target.value })}
                                style={{ borderRadius: 6, borderColor: '#eae6df', background: '#faf9f5' }}
                              />
                            </div>
                            <div>
                              <div style={{ fontSize: 12, color: '#8c8882', fontWeight: 500, marginBottom: 4 }}>局势</div>
                              <Input.TextArea
                                value={entry.situation || ''}
                                onChange={(e) => updateEntryPoint(idx, { situation: e.target.value })}
                                autoSize={{ minRows: 2, maxRows: 4 }}
                                style={{ borderRadius: 6, borderColor: '#eae6df', background: '#faf9f5' }}
                              />
                            </div>
                            <div>
                              <div style={{ fontSize: 12, color: '#8c8882', fontWeight: 500, marginBottom: 4 }}>概述</div>
                              <Input.TextArea
                                value={entry.summary || ''}
                                onChange={(e) => updateEntryPoint(idx, { summary: e.target.value })}
                                autoSize={{ minRows: 2, maxRows: 4 }}
                                style={{ borderRadius: 6, borderColor: '#eae6df', background: '#faf9f5' }}
                              />
                            </div>
                            <div>
                              <div style={{ fontSize: 12, color: '#8c8882', fontWeight: 500, marginBottom: 4 }}>初始目标</div>
                              <Input.TextArea
                                value={entry.initialGoal || ''}
                                onChange={(e) => updateEntryPoint(idx, { initialGoal: e.target.value })}
                                autoSize={{ minRows: 2, maxRows: 4 }}
                                style={{ borderRadius: 6, borderColor: '#eae6df', background: '#faf9f5' }}
                              />
                            </div>
                            <div>
                              <div style={{ fontSize: 12, color: '#8c8882', fontWeight: 500, marginBottom: 4 }}>风险</div>
                              <Input.TextArea
                                value={entry.risk || ''}
                                onChange={(e) => updateEntryPoint(idx, { risk: e.target.value })}
                                autoSize={{ minRows: 2, maxRows: 4 }}
                                style={{ borderRadius: 6, borderColor: '#eae6df', background: '#faf9f5' }}
                              />
                            </div>
                          </div>
                        </Card>
                      ))}
                      <Button icon={<PlusOutlined />} onClick={addEntryPoint} style={{ width: 'fit-content' }}>
                        添加入场点
                      </Button>
                      {editEntryPoints.length === 0 && (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无入场点" />
                      )}
                    </div>
                  ),
                },
                {
                  key: 'characters',
                  label: `推荐身份 (${editCharacters.length})`,
                  children: (
                    <div style={{ display: 'grid', gap: 12, padding: '8px 0' }}>
                      {editCharacters.map((character, idx) => (
                        <Card
                          key={characterKeysRef.current[idx]}
                          size="small"
                          style={{ borderRadius: 10, borderColor: '#f2e8dc', background: '#ffffff' }}
                          title={
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontWeight: 600, color: '#33312e' }}>身份 {idx + 1}</span>
                              <Button size="small" danger onClick={() => removeCharacter(idx)}>
                                删除
                              </Button>
                            </div>
                          }
                        >
                          <div style={{ display: 'grid', gap: 12 }}>
                            <div>
                              <div style={{ fontSize: 12, color: '#8c8882', fontWeight: 500, marginBottom: 4 }}>姓名</div>
                              <Input
                                value={character.name}
                                onChange={(e) => updateCharacter(idx, { name: e.target.value })}
                                style={{ borderRadius: 6, borderColor: '#eae6df', background: '#faf9f5' }}
                              />
                            </div>
                            <div>
                              <div style={{ fontSize: 12, color: '#8c8882', fontWeight: 500, marginBottom: 4 }}>身份</div>
                              <Input
                                value={character.identity}
                                onChange={(e) => updateCharacter(idx, { identity: e.target.value })}
                                style={{ borderRadius: 6, borderColor: '#eae6df', background: '#faf9f5' }}
                              />
                            </div>
                            <div>
                              <div style={{ fontSize: 12, color: '#8c8882', fontWeight: 500, marginBottom: 4 }}>背景</div>
                              <Input.TextArea
                                value={character.background || ''}
                                onChange={(e) => updateCharacter(idx, { background: e.target.value })}
                                autoSize={{ minRows: 2, maxRows: 4 }}
                                style={{ borderRadius: 6, borderColor: '#eae6df', background: '#faf9f5' }}
                              />
                            </div>
                            <div>
                              <div style={{ fontSize: 12, color: '#8c8882', fontWeight: 500, marginBottom: 4 }}>性格</div>
                              <Input.TextArea
                                value={character.personality || ''}
                                onChange={(e) => updateCharacter(idx, { personality: e.target.value })}
                                autoSize={{ minRows: 2, maxRows: 4 }}
                                style={{ borderRadius: 6, borderColor: '#eae6df', background: '#faf9f5' }}
                              />
                            </div>
                            <div>
                              <div style={{ fontSize: 12, color: '#8c8882', fontWeight: 500, marginBottom: 4 }}>目标</div>
                              <Input.TextArea
                                value={character.goal || ''}
                                onChange={(e) => updateCharacter(idx, { goal: e.target.value })}
                                autoSize={{ minRows: 2, maxRows: 4 }}
                                style={{ borderRadius: 6, borderColor: '#eae6df', background: '#faf9f5' }}
                              />
                            </div>
                          </div>
                        </Card>
                      ))}
                      <Button icon={<PlusOutlined />} onClick={addCharacter} style={{ width: 'fit-content' }}>
                        添加身份
                      </Button>
                      {editCharacters.length === 0 && (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无推荐身份" />
                      )}
                    </div>
                  ),
                },
                {
                  key: 'stable-memory',
                  label: '稳定记忆',
                  children: (
                    <div style={{ padding: '8px 0' }}>
                      <EditableJsonValue value={editStableMemory} onChange={(v) => setEditStableMemory(v as Record<string, unknown> | null)} />
                    </div>
                  ),
                },
                {
                  key: 'volatile-memory',
                  label: '临时记忆',
                  children: (
                    <div style={{ padding: '8px 0' }}>
                      <EditableJsonValue value={editVolatileMemory} onChange={(v) => setEditVolatileMemory(v as Record<string, unknown> | null)} />
                    </div>
                  ),
                },
              ]}
            />
          </div>
        )}
      </main>

      {/* Config Modal */}
      <Modal
        title="素材装配"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        width={720}
        footer={[
          <Button key="cancel" onClick={() => setModalOpen(false)}>取消</Button>,
          <Button
            key="submit"
            type="primary"
            icon={<BranchesOutlined />}
            onClick={handleAssemble}
            style={{ background: '#d97757', borderColor: '#d97757' }}
          >
            开始装配
          </Button>,
        ]}
      >
        <Form layout="vertical">
          <Form.Item label="选择穿书大纲">
            <TreeSelect
              aria-label="选择穿书大纲"
              value={selectedOutlinePath}
              treeData={outlineTree}
              placeholder="请选择一个大纲"
              treeDefaultExpandAll
              onChange={setSelectedOutlinePath}
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item label="选择穿书世界书">
            <Select
              aria-label="选择穿书世界书"
              value={selectedWorldBookId}
              placeholder="请选择一个世界书"
              onChange={handleWorldBookChange}
              options={worldBooks.map((item) => ({ value: item.id, label: item.name }))}
            />
          </Form.Item>
          <Form.Item label="选择登场角色卡">
            {characterCards.length > 0 ? (
              <div style={{ border: '1px solid #eae6df', borderRadius: 6, background: '#faf9f5', padding: '8px 4px' }}>
                <Tree
                  checkable
                  defaultExpandAll
                  selectable={false}
                  checkedKeys={selectedCharacterCardIds}
                  onCheck={handleCharacterCardCheck}
                  treeData={characterCardTreeData}
                  style={{ background: 'transparent' }}
                />
              </div>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无角色卡" />
            )}
          </Form.Item>
        </Form>
      </Modal>

      {/* Progress Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>素材装配进度</span>
            <span style={{ fontSize: 13, color: '#8c8882', fontWeight: 400 }}>
              已用时 {formatElapsed(elapsedMs)} / 10:00
            </span>
          </div>
        }
        open={progressOpen}
        onCancel={() => {
          if (progressPhase === 'assembling' || progressPhase === 'entry') {
            handleCancel();
          } else {
            setProgressOpen(false);
          }
        }}
        width={800}
        footer={
          progressPhase === 'assembling' || progressPhase === 'entry' ? (
            <Button danger icon={<StopOutlined />} onClick={handleCancel}>
              中断任务
            </Button>
          ) : (
            <Button type="primary" onClick={() => setProgressOpen(false)}>
              关闭
            </Button>
          )
        }
      >
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Phase 1 */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div
                style={{
                  ...BOOK_TRAVEL_PROGRESS_DOT_BASE_STYLE,
                  background: progressPhase === 'assembling' ? '#d97757' : progressPhase === 'entry' || progressPhase === 'done' ? '#52c41a' : '#d9d9d9',
                }}
              >
                {progressPhase === 'assembling' ? <Spin size="small" style={{ color: '#fff' }} /> : progressPhase === 'entry' || progressPhase === 'done' ? '✓' : '1'}
              </div>
              <span style={{ fontWeight: 600, color: '#33312e' }}>素材装配</span>
              {progressPhase === 'assembling' && <Tag color="orange">进行中</Tag>}
              {(progressPhase === 'entry' || progressPhase === 'done') && <Tag color="success">已完成</Tag>}
            </div>
            <Input.TextArea
              readOnly
              rows={5}
              value={assembleOutput || (progressPhase === 'assembling' ? '正在装配素材，请稍候...' : progressPhase === 'entry' || progressPhase === 'done' ? '素材装配完成' : '')}
              style={{ background: '#faf9f5', fontSize: 13 }}
            />
          </div>

          {/* Phase 2 */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div
                style={{
                  ...BOOK_TRAVEL_PROGRESS_DOT_BASE_STYLE,
                  background: progressPhase === 'entry' ? '#d97757' : progressPhase === 'done' ? '#52c41a' : '#d9d9d9',
                }}
              >
                {progressPhase === 'entry' ? <Spin size="small" style={{ color: '#fff' }} /> : progressPhase === 'done' ? '✓' : '2'}
              </div>
              <span style={{ fontWeight: 600, color: '#33312e' }}>生成入场设计</span>
              {progressPhase === 'entry' && <Tag color="orange">进行中</Tag>}
              {progressPhase === 'done' && <Tag color="success">已完成</Tag>}
            </div>
            <Input.TextArea
              readOnly
              rows={5}
              value={entryOutput || (progressPhase === 'entry' ? '正在生成入场设计，请稍候...' : progressPhase === 'done' ? '入场设计生成完成' : '')}
              style={{ background: '#faf9f5', fontSize: 13 }}
            />
          </div>

          {progressPhase === 'error' && (
            <Alert type="error" showIcon message="装配失败" description={progressError} />
          )}
          {progressPhase === 'cancelled' && (
            <Alert type="warning" showIcon message="任务已中断" description="用户主动中断了素材装配任务" />
          )}
        </div>
      </Modal>
    </div>
  );
};

const BookTravelMaterials: React.FC = () => useBookTravelMaterialsView();

export default BookTravelMaterials;
