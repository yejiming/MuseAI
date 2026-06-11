import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button, Input, Tooltip, Empty, Card, Tabs, Tag, Row, Col, Space, Radio, Modal, Spin, message, Tree, Progress, Select } from 'antd';
import { 
  GlobalOutlined, 
  UserOutlined, 
  PlusOutlined, 
  DeleteOutlined, 
  EditOutlined,
  CompassOutlined,
  EyeOutlined,
  EditFilled,
  RobotOutlined,
  ThunderboltOutlined,
  BookOutlined,
  FileProtectOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined
} from '@ant-design/icons';
import { usePartnerStore, PartnerItem, PartnerItemFields, CustomField, normalizePartnerFields } from '../stores/usePartnerStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BackgroundExtractionMode,
  CharacterExtractionItem,
  runCharacterExtractionBatch,
  splitCharacterNames,
} from '../utils/backgroundExtraction';
import { UNASSIGNED_CHARACTER_CARD_GROUP_ID, groupCharacterCardsByWorldBook } from '../utils/characterCardGroups';

const DIRECTORY_WIDTH = 280;
const DEFAULT_BACKGROUND_CANCELLATION_SETTLE_MS = 15_000;

const getBackgroundCancellationSettleMs = () => {
  const testValue = (globalThis as { __MUSEAI_BACKGROUND_CANCELLATION_SETTLE_MS__?: number })
    .__MUSEAI_BACKGROUND_CANCELLATION_SETTLE_MS__;
  return typeof testValue === 'number' ? testValue : DEFAULT_BACKGROUND_CANCELLATION_SETTLE_MS;
};

const Background: React.FC = () => {
  const { 
    worldBooks, 
    characterCards, 
    selectedId, 
    selectedType,
    addWorldBook,
    addCharacterCard,
    selectItem,
    deleteItem,
    updateItemName,
    updateItemFields,
    updateCharacterCardWorldBook,
    addCustomField,
    updateCustomField,
    removeCustomField
  } = usePartnerStore();

  const settings = useSettingsStore();
  const { importGeneratedItems } = usePartnerStore();
  const backgroundExtractionConfig = settings.agentConfigs?.backgroundExtraction || {};
  const backgroundWorldBookConfig = settings.agentConfigs?.backgroundWorldBook || {};
  const backgroundCharacterCardConfig = settings.agentConfigs?.backgroundCharacterCard || {};
  const backgroundCharacterConcurrency = Math.max(1, Math.min(20, backgroundExtractionConfig.concurrency ?? 5));

  // AI settings generation states
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCancellingBackground, setIsCancellingBackground] = useState(false);
  const [extractionMode, setExtractionMode] = useState<BackgroundExtractionMode>('world_book_and_character_cards');
  const [extractionStep, setExtractionStep] = useState<'setup' | 'review' | 'characters'>('setup');
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentTaskIdRef = useRef<string | null>(null);
  const generatedWorldBookIdRef = useRef<string | null>(null);
  const [manualCharacterNames, setManualCharacterNames] = useState('');
  const [reviewWorldBookName, setReviewWorldBookName] = useState('');
  const [reviewWorldBookFieldsJson, setReviewWorldBookFieldsJson] = useState('');
  const [reviewCharacterNames, setReviewCharacterNames] = useState('');
  const [characterStatuses, setCharacterStatuses] = useState<CharacterExtractionItem<{ name: string; fields: PartnerItemFields }>[]>([]);

  // Folder Tree States for AI Settings Modal
  interface FileTreeNode {
    title: string;
    key: string;
    isLeaf: boolean;
    children?: FileTreeNode[];
  }
  const [articlesTree, setArticlesTree] = useState<FileTreeNode[]>([]);
  const [outlineTree, setOutlineTree] = useState<FileTreeNode[]>([]);
  const [referencesTree, setReferencesTree] = useState<FileTreeNode[]>([]);
  const flatFilesRef = useRef<string[]>([]);

  // AI memory optimization states
  const [isMemModalOpen, setIsMemModalOpen] = useState(false);
  const [optimizedEvents, setOptimizedEvents] = useState('');
  const [isOptimizing, setIsOptimizing] = useState(false);

  const generateTaskId = useCallback(() => {
    return 'task_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }, []);

  const loadWorkspaceFiles = async () => {
    try {
      const [artRoot, outRoot, refRoot] = await Promise.all([
        invoke<string>('get_workspace_dir', { dirType: 'articles' }),
        invoke<string>('get_workspace_dir', { dirType: 'outline' }),
        invoke<string>('get_workspace_dir', { dirType: 'references' }),
      ]);

      let filesList: string[] = [];

      const fetchDirTree = async (path: string): Promise<FileTreeNode[]> => {
        const list: any[] = await invoke('list_dir', { path });
        const nodes = (await Promise.all(list.map(async (item): Promise<FileTreeNode | null> => {
          if (
            item.name === '.versions' || 
            item.name === '.work-summary-results' || 
            item.name === '.work-summary-results.json'
          ) {
            return null;
          }
          if (item.is_dir) {
            const children = await fetchDirTree(item.path);
            return {
              title: item.name,
              key: item.path,
              isLeaf: false,
              children
            };
          } else {
            const lower = item.name.toLowerCase();
            if (lower.endsWith('.md') || lower.endsWith('.txt')) {
              filesList.push(item.path);
              return {
                title: item.name,
                key: item.path,
                isLeaf: true
              };
            }
          }
          return null;
        }))).reduce<FileTreeNode[]>((acc, node) => {
          if (node) acc.push(node);
          return acc;
        }, []);

        nodes.sort((a, b) => {
          if (a.isLeaf !== b.isLeaf) return a.isLeaf ? 1 : -1;
          return a.title.localeCompare(b.title);
        });

        return nodes;
      };

      const [artNodes, outNodes, refNodes] = await Promise.all([
        fetchDirTree(artRoot),
        fetchDirTree(outRoot),
        fetchDirTree(refRoot),
      ]);

      flatFilesRef.current = filesList;
      setArticlesTree(artNodes);
      setOutlineTree(outNodes);
      setReferencesTree(refNodes);
    } catch (e) {
      console.error('加载工作区文件目录树失败:', e);
      message.error('加载工作区文件目录树失败');
    }
  };

  useEffect(() => {
    if (isAiModalOpen) {
      loadWorkspaceFiles();
      setSelectedFilePaths([]);
      setExtractionMode('world_book_and_character_cards');
      setExtractionStep('setup');
      setManualCharacterNames('');
      setReviewWorldBookName('');
      setReviewWorldBookFieldsJson('');
      setReviewCharacterNames('');
      setCharacterStatuses([]);
      generatedWorldBookIdRef.current = null;
    }
  }, [isAiModalOpen]);

  const readSelectedReferenceText = async () => {
    const selectedFileOnlyPaths = selectedFilePaths.filter(path => flatFilesRef.current.includes(path));
    if (selectedFileOnlyPaths.length === 0) {
      message.warning('请至少选择一个参考文件');
      return null;
    }

    if (!settings.llmApiKey) {
      message.warning('大模型 API Key 尚未配置，请先在设置页中配置');
      return null;
    }

    const fileSections = await Promise.all(selectedFileOnlyPaths.map(async (path) => {
      const fileContent: string = await invoke('read_file', { path });
      const fileName = path.split(/[\\/]/).pop() || '';
      return `\n\n### 文件: ${fileName}\n${fileContent}`;
    }));
    const combinedText = fileSections.join('');

    if (combinedText.length > 100_000) {
      message.warning('选中文件总字数超过10万字，内容过长可能导致提取失败。建议先在大纲页使用"AI反向分析大纲"功能，再基于精简后的大纲提取设定。');
      return null;
    }

    return combinedText;
  };

  const currentWorldBookDraft = () => {
    const name = reviewWorldBookName.trim() || '未命名世界书';
    let fields: PartnerItemFields = {};
    try {
      fields = JSON.parse(reviewWorldBookFieldsJson || '{}');
    } catch {
      throw new Error('世界书字段 JSON 格式不正确，请检查后再确认');
    }
    return { name, fields };
  };

  const waitForBackgroundCancellation = async (taskId: string) => {
    setIsCancellingBackground(true);
    try {
      try {
        await invoke('cancel_background_task', { taskId });
      } catch {
        // ignore
      }
      await new Promise((resolve) => setTimeout(resolve, getBackgroundCancellationSettleMs()));
    } finally {
      setIsCancellingBackground(false);
    }
  };

  const runCharacterExtraction = async (
    combinedText: string,
    worldBookContext?: string,
    mode: 'new' | 'continue' | 'retry' = 'new',
  ) => {
    let names: string[] = [];
    let initialItems: CharacterExtractionItem<{ name: string; fields: PartnerItemFields }>[] | undefined;

    if (mode === 'new') {
      const sourceNames = extractionMode === 'character_cards_only'
        ? splitCharacterNames(manualCharacterNames)
        : splitCharacterNames(reviewCharacterNames);
      if (sourceNames.length === 0) {
        message.warning('请至少输入一个角色名');
        return;
      }
      names = sourceNames;
    } else if (mode === 'continue') {
      const pendingItems = characterStatuses.filter((item) => item.status === 'pending');
      if (pendingItems.length === 0) {
        message.info('没有待提取的角色');
        return;
      }
      names = pendingItems.map((item) => item.name);
      initialItems = characterStatuses.map((item) => ({ ...item }));
    } else if (mode === 'retry') {
      const failedItems = characterStatuses.filter(
        (item) => item.status === 'failed'
      );
      if (failedItems.length === 0) {
        message.info('没有失败的角色需要重试');
        return;
      }
      names = failedItems.map((item) => item.name);
      initialItems = characterStatuses.map((item) =>
        item.status === 'failed'
          ? { ...item, status: 'pending' as const, error: undefined, rawOutput: undefined }
          : { ...item }
      );
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const taskId = generateTaskId();
    currentTaskIdRef.current = taskId;

    setExtractionStep('characters');
    setIsCancellingBackground(false);
    setIsGenerating(true);
    try {
      const results = await runCharacterExtractionBatch<{ name: string; fields: PartnerItemFields }>({
        names,
        initialItems,
        worker: async (characterName) => {
          if (controller.signal.aborted) {
            throw new Error('已中断');
          }
          return await invoke('generate_background_character_card', {
            request: {
              modelInterface: settings.modelInterface,
              baseUrl: settings.llmBaseUrl,
              apiKey: settings.llmApiKey,
              model: settings.llmModel,
              text: combinedText,
              characterName,
              worldBookContext,
              temperature: backgroundCharacterCardConfig.temperature ?? 0.3,
              maxOutputTokens: backgroundCharacterCardConfig.maxOutputTokens ?? 32000,
              maxContextTokens: backgroundCharacterCardConfig.maxContextTokens ?? 200000,
              thinkingDepth: backgroundCharacterCardConfig.thinkingDepth ?? 'off',
              systemPrompt: settings.backgroundCharacterCardPrompt,
              taskId,
            },
          });
        },
        concurrency: backgroundCharacterConcurrency,
        onUpdate: setCharacterStatuses,
        signal: controller.signal,
      });

      setCharacterStatuses(results);
      const successfulCards: Array<{ name: string; fields: PartnerItemFields }> = [];
      for (const item of results) {
        if (item.status === 'success' && item.result) {
          successfulCards.push(item.result);
        }
      }

      // 合并新的成功结果，避免重复导入
      const existingNames = new Set<string>();
      for (const item of characterStatuses) {
        if (item.status === 'success' && item.result) {
          existingNames.add(item.result.name);
        }
      }
      const newCards = successfulCards.filter((card) => !existingNames.has(card.name));
      if (newCards.length > 0) {
        const bindingWorldBookId = extractionMode === 'world_book_and_character_cards'
          ? generatedWorldBookIdRef.current
          : null;
        importGeneratedItems({
          worldBooks: [],
          characterCards: newCards.map((card) => ({
            ...card,
            worldBookId: bindingWorldBookId,
          })),
        });
      }

      const pendingCount = results.filter((item) => item.status === 'pending').length;
      const failedCount = results.filter((item) => item.status === 'failed').length;
      const totalSuccess = results.filter((item) => item.status === 'success').length;

      if (pendingCount > 0) {
        // 被中断，有未完成的，不弹全局消息，由 UI 展示状态
      } else if (failedCount > 0) {
        message.warning(`角色卡提取完成：成功 ${totalSuccess} 个，失败 ${failedCount} 个。`);
      } else {
        message.success(`角色卡提取完成：成功 ${totalSuccess} 个。`);
      }
    } finally {
      if (controller.signal.aborted && currentTaskIdRef.current) {
        await waitForBackgroundCancellation(currentTaskIdRef.current);
      }
      setIsGenerating(false);
      abortControllerRef.current = null;
      currentTaskIdRef.current = null;
    }
  };

  const handleStartExtraction = async () => {
    const combinedText = await readSelectedReferenceText();
    if (!combinedText) return;

    if (extractionMode === 'character_cards_only') {
      generatedWorldBookIdRef.current = null;
      await runCharacterExtraction(combinedText, undefined, 'new');
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const taskId = generateTaskId();
    currentTaskIdRef.current = taskId;

    setIsCancellingBackground(false);
    setIsGenerating(true);
    try {
      const invokePromise = invoke('generate_background_stage_one', {
        request: {
          modelInterface: settings.modelInterface,
          baseUrl: settings.llmBaseUrl,
          apiKey: settings.llmApiKey,
          model: settings.llmModel,
          text: combinedText,
          includeCharacterNames: extractionMode === 'world_book_and_character_cards',
          temperature: backgroundWorldBookConfig.temperature ?? 0.3,
          maxOutputTokens: backgroundWorldBookConfig.maxOutputTokens ?? 32000,
          maxContextTokens: backgroundWorldBookConfig.maxContextTokens ?? 200000,
          thinkingDepth: backgroundWorldBookConfig.thinkingDepth ?? 'off',
          systemPrompt: settings.backgroundWorldBookPrompt,
          taskId,
        }
      }) as Promise<{
        worldBooks: Array<{ name: string; fields: PartnerItemFields }>;
        characterNames: string[];
      }>;

      const abortPromise = new Promise<never>((_, reject) => {
        const onAbort = () => reject(new Error('ABORTED'));
        if (controller.signal.aborted) {
          onAbort();
        } else {
          controller.signal.addEventListener('abort', onAbort, { once: true });
        }
      });

      const stageOneResult = await Promise.race([invokePromise, abortPromise]);

      const worldBook = stageOneResult.worldBooks?.[0];
      if (!worldBook) {
        throw new Error('阶段一没有返回可编辑的世界书');
      }
      setReviewWorldBookName(worldBook.name || '未命名世界书');
      setReviewWorldBookFieldsJson(JSON.stringify(worldBook.fields || {}, null, 2));
      setReviewCharacterNames((stageOneResult.characterNames || []).join('\n'));
      setExtractionStep('review');
    } catch (err) {
      if (err instanceof Error && err.message === 'ABORTED') {
        message.info('世界书提取已中断');
        return;
      }
      console.error('AI 生成设定失败:', err);
      message.error(`AI 提取设定失败：${String(err)}`);
    } finally {
      if (controller.signal.aborted && currentTaskIdRef.current) {
        await waitForBackgroundCancellation(currentTaskIdRef.current);
      }
      setIsGenerating(false);
      abortControllerRef.current = null;
      currentTaskIdRef.current = null;
    }
  };

  const handleConfirmReview = async () => {
    try {
      const worldBook = currentWorldBookDraft();
      const importResult = importGeneratedItems({ worldBooks: [worldBook], characterCards: [] });
      generatedWorldBookIdRef.current = extractionMode === 'world_book_and_character_cards'
        ? importResult.worldBookIds[0] || null
        : null;

      if (extractionMode === 'world_book_only') {
        message.success('世界书保存成功！');
        setIsAiModalOpen(false);
        return;
      }

      const combinedText = await readSelectedReferenceText();
      if (!combinedText) return;
      await runCharacterExtraction(
        combinedText,
        JSON.stringify(worldBook),
        'new',
      );
    } catch (err) {
      message.error(String(err));
    }
  };

  const handleAiModalOk = () => {
    if (extractionStep === 'review') {
      handleConfirmReview();
    } else if (extractionStep === 'characters') {
      const hasPending = characterStatuses.some((item) => item.status === 'pending');
      const hasFailed = characterStatuses.some((item) => item.status === 'failed');
      if (hasPending) {
        handleContinueExtraction();
      } else if (hasFailed) {
        handleRetryFailed();
      } else {
        setIsAiModalOpen(false);
      }
    } else {
      handleStartExtraction();
    }
  };

  const handleContinueExtraction = async () => {
    const combinedText = await readSelectedReferenceText();
    if (!combinedText) return;
    await runCharacterExtraction(combinedText, undefined, 'continue');
  };

  const handleRetryFailed = async () => {
    const combinedText = await readSelectedReferenceText();
    if (!combinedText) return;
    await runCharacterExtraction(combinedText, undefined, 'retry');
  };

  const aiModalOkText = extractionStep === 'review'
    ? (extractionMode === 'world_book_only' ? '确认保存世界书' : '确认并生成角色卡')
    : extractionStep === 'characters'
      ? (characterStatuses.some((item) => item.status === 'pending')
          ? '继续提取'
          : characterStatuses.some((item) => item.status === 'failed')
            ? '重试失败角色'
            : '完成')
      : '开始智能提取';

  const completedCharacters = characterStatuses.filter((item) => item.status === 'success' || item.status === 'failed').length;
  const totalCharacters = characterStatuses.length;
  const characterProgressPercent = totalCharacters === 0
    ? 0
    : Math.round((completedCharacters / totalCharacters) * 100);

  const handleOptimizeMemories = async (currentEvents: string) => {
    if (!currentEvents.trim()) {
      message.warning('当前关键事件记忆内容为空，无法进行浓缩与消解矛盾');
      return;
    }

    if (!settings.llmApiKey) {
      message.warning('大模型 API Key 尚未配置，请先在设置页中配置');
      return;
    }

    setIsOptimizing(true);
    try {
      const optimized: string = await invoke('optimize_character_memories', {
        request: {
          modelInterface: settings.modelInterface,
          baseUrl: settings.llmBaseUrl,
          apiKey: settings.llmApiKey,
          model: settings.llmModel,
          text: currentEvents,
        }
      });

      setOptimizedEvents(optimized);
      setIsMemModalOpen(true);
    } catch (err) {
      console.error('记忆优化失败:', err);
      message.error(`记忆浓缩优化失败：${String(err)}`);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleConfirmOptimize = () => {
    if (selectedItem) {
      updateItemFields(selectedItem.id, selectedItem.type, { keyEvents: optimizedEvents });
      message.success('关键事件记忆更新成功！');
      setIsMemModalOpen(false);
    }
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [activeMode, setActiveMode] = useState<'edit' | 'preview'>('edit');
  
  // Tag input states for character card
  const [tagInputVisible, setTagInputVisible] = useState(false);
  const [tagInputValue, setTagInputValue] = useState('');
  const [expandedCharacterGroupKeys, setExpandedCharacterGroupKeys] = useState<React.Key[]>([]);
  const tagInputRef = useRef<any>(null);
  const renameInputRef = useRef<any>(null);
  const knownCharacterGroupKeysRef = useRef<string[]>([]);
  const hasInitializedCharacterGroupsRef = useRef(false);

  // Focus rename input when editing starts
  useEffect(() => {
    if (editingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [editingId]);

  // Focus tag input when visible
  useEffect(() => {
    if (tagInputVisible && tagInputRef.current) {
      tagInputRef.current.focus();
    }
  }, [tagInputVisible]);

  const handleStartRename = (item: PartnerItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(item.id);
    setEditName(item.name);
  };

  const handleSaveRename = (item: PartnerItem) => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== item.name) {
      updateItemName(item.id, item.type, trimmed);
    }
    setEditingId(null);
  };

  const handleDeleteItem = (id: string, type: 'world_book' | 'character_card', e: React.MouseEvent) => {
    e.stopPropagation();
    deleteItem(id, type);
  };

  // Find currently selected item
  const selectedItem = selectedType === 'world_book' 
    ? worldBooks.find(b => b.id === selectedId) 
    : characterCards.find(c => c.id === selectedId);
  const characterCardGroups = useMemo(
    () => groupCharacterCardsByWorldBook(worldBooks, characterCards),
    [worldBooks, characterCards],
  );
  const characterCardGroupKeys = useMemo(
    () => characterCardGroups.map((group) => group.key),
    [characterCardGroups],
  );

  useEffect(() => {
    const previousGroupKeys = knownCharacterGroupKeysRef.current;
    knownCharacterGroupKeysRef.current = characterCardGroupKeys;

    setExpandedCharacterGroupKeys((previousKeys) => {
      if (!hasInitializedCharacterGroupsRef.current) {
        hasInitializedCharacterGroupsRef.current = true;
        return characterCardGroupKeys;
      }

      const validKeys = previousKeys.filter((key) => characterCardGroupKeys.includes(String(key)));
      const newKeys = characterCardGroupKeys.filter((key) => !previousGroupKeys.includes(key));
      return [...validKeys, ...newKeys];
    });
  }, [characterCardGroupKeys]);

  // Sync editName when item name changes or new item is selected
  const handleFieldChange = (key: keyof PartnerItemFields, value: any) => {
    if (selectedItem) {
      updateItemFields(selectedItem.id, selectedItem.type, { [key]: value });
    }
  };

  // Render custom fields for a given module
  const renderCustomFieldsBlock = (item: PartnerItem, moduleId: string) => {
    const fields = item.fields?.customFields?.filter((f: CustomField) => f.moduleId === moduleId) || [];

    return (
      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px dashed rgba(0,0,0,0.06)' }}>
        <Row gutter={[16, 16]}>
          {fields.map((field: CustomField) => (
            <Col span={8} key={field.id}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Input
                    value={field.label}
                    placeholder="字段名"
                    onChange={(e) => updateCustomField(item.id, item.type, field.id, { label: e.target.value })}
                    style={{ flex: 1, fontSize: 12, fontWeight: 500 }}
                    className="custom-form-input"
                  />
                  <Tooltip title="删除">
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                      onClick={() => removeCustomField(item.id, item.type, field.id)}
                      style={{ width: 22, height: 22, padding: 0 }}
                    />
                  </Tooltip>
                </div>
                <Input
                  value={field.value}
                  placeholder={`请输入${field.label || '内容'}`}
                  onChange={(e) => updateCustomField(item.id, item.type, field.id, { value: e.target.value })}
                  className="custom-form-input"
                />
              </div>
            </Col>
          ))}
        </Row>
        <Button
          type="dashed"
          size="small"
          icon={<PlusOutlined />}
          onClick={() => addCustomField(item.id, item.type, moduleId)}
          style={{ marginTop: 16, height: 28, fontSize: 12, color: '#8c8882', borderColor: 'rgba(0,0,0,0.1)' }}
        >
          添加自定义字段
        </Button>
      </div>
    );
  };

  // Tag manipulation for Character Card
  const handleRemoveTag = (removedTag: string) => {
    if (selectedItem) {
      const currentTags = selectedItem.fields?.identityTags || [];
      const nextTags = currentTags.filter(tag => tag !== removedTag);
      handleFieldChange('identityTags', nextTags);
    }
  };

  const handleAddTagConfirm = () => {
    if (selectedItem && tagInputValue.trim()) {
      const currentTags = selectedItem.fields?.identityTags || [];
      if (!currentTags.includes(tagInputValue.trim())) {
        const nextTags = [...currentTags, tagInputValue.trim()];
        handleFieldChange('identityTags', nextTags);
      }
    }
    setTagInputVisible(false);
    setTagInputValue('');
  };

  const showTagInput = () => {
    setTagInputVisible(true);
  };

  const renderDirectoryItem = (item: PartnerItem) => {
    const isSelected = selectedId === item.id;
    const isEditing = editingId === item.id;

    return (
      <div
        key={item.id}
        role="treeitem"
        aria-selected={isSelected}
        tabIndex={0}
        onClick={() => selectItem(item.id, item.type)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectItem(item.id, item.type);
          }
        }}
        onDoubleClick={(e) => handleStartRename(item, e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          margin: '4px 8px',
          borderRadius: '6px',
          cursor: 'pointer',
          background: isSelected ? '#f2e8dc' : 'transparent',
          color: isSelected ? '#d97757' : '#33312e',
          transition: 'background-color 0.2s cubic-bezier(0.25, 0.8, 0.25, 1), color 0.2s cubic-bezier(0.25, 0.8, 0.25, 1)',
          position: 'relative',
        }}
        className="directory-item-hover"
      >
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, gap: 8 }}>
          {item.type === 'world_book' ? (
            <GlobalOutlined style={{ fontSize: 15, flexShrink: 0, color: isSelected ? '#d97757' : '#8c8882' }} />
          ) : (
            <UserOutlined style={{ fontSize: 15, flexShrink: 0, color: isSelected ? '#d97757' : '#8c8882' }} />
          )}

          {isEditing ? (
            <Input
              ref={renameInputRef}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => handleSaveRename(item)}
              onPressEnter={() => handleSaveRename(item)}
              size="small"
              style={{
                height: 22,
                padding: '0 4px',
                fontSize: 13,
                borderColor: '#d97757',
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span style={{ 
              fontSize: 13, 
              overflow: 'hidden', 
              textOverflow: 'ellipsis', 
              whiteSpace: 'nowrap',
              fontWeight: isSelected ? 500 : 400
            }}>
              {item.name}
            </span>
          )}
        </div>

        {!isEditing && (
          <div className="directory-item-actions" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Tooltip title="重命名" mouseEnterDelay={0.8}>
              <Button 
                type="text" 
                size="small" 
                icon={<EditOutlined style={{ fontSize: 12 }} />} 
                onClick={(e) => handleStartRename(item, e)}
                style={{ width: 20, height: 20, padding: 0, display: 'none' }}
                className="action-btn"
              />
            </Tooltip>
            <Tooltip title="删除" mouseEnterDelay={0.8}>
              <Button 
                type="text" 
                danger
                size="small" 
                icon={<DeleteOutlined style={{ fontSize: 12 }} />} 
                onClick={(e) => handleDeleteItem(item.id, item.type, e)}
                style={{ width: 20, height: 20, padding: 0, display: 'none' }}
                className="action-btn"
              />
            </Tooltip>
          </div>
        )}
      </div>
    );
  };

  const renderCharacterCardTreeTitle = (item: PartnerItem) => {
    const isSelected = selectedType === 'character_card' && selectedId === item.id;
    const isEditing = editingId === item.id;

    return (
      <div
        className={`character-tree-item ${isSelected ? 'is-selected' : ''}`}
        onDoubleClick={(e) => handleStartRename(item, e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 30,
          padding: '4px 8px',
          borderRadius: 6,
          background: isSelected ? '#f2e8dc' : 'transparent',
          color: isSelected ? '#d97757' : '#33312e',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, gap: 8 }}>
          <UserOutlined style={{ fontSize: 14, flexShrink: 0, color: isSelected ? '#d97757' : '#8c8882' }} />
          {isEditing ? (
            <Input
              ref={renameInputRef}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => handleSaveRename(item)}
              onPressEnter={() => handleSaveRename(item)}
              size="small"
              style={{ height: 22, padding: '0 4px', fontSize: 13, borderColor: '#d97757' }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span style={{
              fontSize: 13,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontWeight: isSelected ? 500 : 400,
            }}>
              {item.name}
            </span>
          )}
        </div>

        {!isEditing && (
          <div className="directory-item-actions" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Tooltip title="重命名" mouseEnterDelay={0.8}>
              <Button
                type="text"
                size="small"
                icon={<EditOutlined style={{ fontSize: 12 }} />}
                onClick={(e) => handleStartRename(item, e)}
                style={{ width: 20, height: 20, padding: 0, display: 'none' }}
                className="action-btn"
              />
            </Tooltip>
            <Tooltip title="删除" mouseEnterDelay={0.8}>
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                onClick={(e) => handleDeleteItem(item.id, item.type, e)}
                style={{ width: 20, height: 20, padding: 0, display: 'none' }}
                className="action-btn"
              />
            </Tooltip>
          </div>
        )}
      </div>
    );
  };

  const toggleCharacterGroup = (groupKey: string) => {
    setExpandedCharacterGroupKeys((keys) =>
      keys.includes(groupKey) ? keys.filter((key) => key !== groupKey) : [...keys, groupKey]
    );
  };

  const characterCardTreeData = characterCardGroups.map((group) => ({
    key: group.key,
    selectable: false,
    title: (
      <span
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#8c8882', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
      >
        <BookOutlined style={{ fontSize: 13, color: group.worldBookId ? '#d97757' : '#c0bbb4' }} />
        {group.title}
      </span>
    ),
    children: group.cards.map((card) => ({
      key: card.id,
      title: renderCharacterCardTreeTitle(card),
      isLeaf: true,
    })),
  }));

  // Rendering World Book Config UI
  const renderWorldBookForm = (item: PartnerItem) => {
    const fields = normalizePartnerFields(item.fields);

    return (
      <Space direction="vertical" size={20} style={{ width: '100%' }}>
        <Card className="custom-form-card" title={<span className="form-section-title"><CompassOutlined style={{ color: '#d97757' }} /> 基本世界设定</span>} size="small">
          <Row gutter={[16, 16]}>
            <Col span={12}>
              <div className="input-label">世界名称</div>
              <Input 
                value={item.name} 
                className="custom-form-input"
                placeholder="请输入世界观名称"
                onChange={(e) => updateItemName(item.id, item.type, e.target.value)}
              />
            </Col>
            <Col span={12}>
              <div className="input-label">核心主题</div>
              <Input 
                value={fields.theme || ''} 
                className="custom-form-input"
                placeholder="例如：魔法冒险 / 奇幻史诗 / 蒸汽朋克"
                onChange={(e) => handleFieldChange('theme', e.target.value)}
              />
            </Col>
            <Col span={8}>
              <div className="input-label">时代背景</div>
              <Input 
                value={fields.era || ''} 
                className="custom-form-input"
                placeholder="例如：魔法工业时代 / 中世纪末期"
                onChange={(e) => handleFieldChange('era', e.target.value)}
              />
            </Col>
            <Col span={8}>
              <div className="input-label">科技水平</div>
              <Input 
                value={fields.techLevel || ''} 
                className="custom-form-input"
                placeholder="例如：蒸汽机与简单电气"
                onChange={(e) => handleFieldChange('techLevel', e.target.value)}
              />
            </Col>
            <Col span={8}>
              <div className="input-label">魔法水平</div>
              <Input 
                value={fields.magicLevel || ''} 
                className="custom-form-input"
                placeholder="例如：高魔世界 / 以太广泛应用"
                onChange={(e) => handleFieldChange('magicLevel', e.target.value)}
              />
            </Col>
          </Row>
          {renderCustomFieldsBlock(item, 'world_basic')}
        </Card>

        <Card className="custom-form-card" title={<span className="form-section-title"><GlobalOutlined style={{ color: '#d97757' }} /> 核心世界观架构</span>} size="small">
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div>
              <div className="input-label">地理格局</div>
              <Input.TextArea 
                value={fields.geography || ''} 
                autoSize={{ minRows: 2, maxRows: 6 }}
                className="custom-form-input"
                placeholder="描述大陆分布、主要地理特征及气候格局..."
                onChange={(e) => handleFieldChange('geography', e.target.value)}
              />
            </div>
            <div>
              <div className="input-label">关键场景</div>
              <Input.TextArea 
                value={fields.keyScenes || ''} 
                autoSize={{ minRows: 2, maxRows: 6 }}
                className="custom-form-input"
                placeholder="列出故事展开的核心场景地标，如“奥兰魔法学院大图书馆”..."
                onChange={(e) => handleFieldChange('keyScenes', e.target.value)}
              />
            </div>
            <div>
              <div className="input-label">文化特色</div>
              <Input.TextArea 
                value={fields.culturalFeatures || ''} 
                autoSize={{ minRows: 2, maxRows: 6 }}
                className="custom-form-input"
                placeholder="描述各族群的风俗习惯、宗教信仰、以及对魔法/科技的社会观念..."
                onChange={(e) => handleFieldChange('culturalFeatures', e.target.value)}
              />
            </div>
            <div>
              <div className="input-label">历史事件</div>
              <Input.TextArea 
                value={fields.history || ''} 
                autoSize={{ minRows: 2, maxRows: 6 }}
                className="custom-form-input"
                placeholder="列出世界观下具有深远影响的历史大战、协议签署或重大转折点..."
                onChange={(e) => handleFieldChange('history', e.target.value)}
              />
            </div>
            <div>
              <div className="input-label">核心矛盾</div>
              <Input.TextArea 
                value={fields.conflict || ''} 
                autoSize={{ minRows: 2, maxRows: 6 }}
                className="custom-form-input"
                placeholder="描述当前世界最激烈的矛盾冲突，如“魔法保守势力与科技工业党派的对立”..."
                onChange={(e) => handleFieldChange('conflict', e.target.value)}
              />
            </div>
            {renderCustomFieldsBlock(item, 'world_core')}
          </Space>
        </Card>
      </Space>
    );
  };

  // Rendering Character Card Config UI
  const renderCharacterCardForm = (item: PartnerItem) => {
    const fields = normalizePartnerFields(item.fields);
    const ownerSelectValue = item.worldBookId && worldBooks.some((worldBook) => worldBook.id === item.worldBookId)
      ? item.worldBookId
      : UNASSIGNED_CHARACTER_CARD_GROUP_ID;

    const tabItems = [
      {
        key: '1',
        label: '基础与标签',
        children: (
          <Space direction="vertical" size={16} style={{ width: '100%', marginTop: 8 }}>
            <Card className="custom-sub-card" title="基本身份信息" size="small">
              <Row gutter={[16, 12]}>
                <Col span={12}>
                  <div className="input-label">姓名</div>
                  <Input 
                    value={item.name} 
                    className="custom-form-input"
                    placeholder="请输入角色姓名"
                    onChange={(e) => updateItemName(item.id, item.type, e.target.value)}
                  />
                </Col>
                <Col span={12}>
                  <div className="input-label">归属世界书</div>
                  <Select
                    aria-label="归属世界书"
                    value={ownerSelectValue}
                    onChange={(value) => updateCharacterCardWorldBook(
                      item.id,
                      value === UNASSIGNED_CHARACTER_CARD_GROUP_ID ? null : value,
                    )}
                    options={[
                      { value: UNASSIGNED_CHARACTER_CARD_GROUP_ID, label: '未归属' },
                      ...worldBooks.map((worldBook) => ({ value: worldBook.id, label: worldBook.name })),
                    ]}
                    style={{ width: '100%' }}
                  />
                </Col>
                <Col span={6}>
                  <div className="input-label">年龄</div>
                  <Input 
                    value={fields.age || ''} 
                    className="custom-form-input"
                    placeholder="例如：18岁"
                    onChange={(e) => handleFieldChange('age', e.target.value)}
                  />
                </Col>
                <Col span={6}>
                  <div className="input-label">性别</div>
                  <Input 
                    value={fields.gender || ''} 
                    className="custom-form-input"
                    placeholder="例如：男"
                    onChange={(e) => handleFieldChange('gender', e.target.value)}
                  />
                </Col>
                <Col span={8}>
                  <div className="input-label">种族</div>
                  <Input 
                    value={fields.race || ''} 
                    className="custom-form-input"
                    placeholder="例如：人类 / 精灵"
                    onChange={(e) => handleFieldChange('race', e.target.value)}
                  />
                </Col>
                <Col span={8}>
                  <div className="input-label">出生地</div>
                  <Input 
                    value={fields.birthplace || ''} 
                    className="custom-form-input"
                    placeholder="例如：边境小镇"
                    onChange={(e) => handleFieldChange('birthplace', e.target.value)}
                  />
                </Col>
                <Col span={8}>
                  <div className="input-label">职业</div>
                  <Input 
                    value={fields.occupation || ''} 
                    className="custom-form-input"
                    placeholder="例如：学院高级学员"
                    onChange={(e) => handleFieldChange('occupation', e.target.value)}
                  />
                </Col>
                <Col span={24}>
                  <div className="input-label">社会阶层</div>
                  <Input 
                    value={fields.socialClass || ''} 
                    className="custom-form-input"
                    placeholder="描述角色的社会地位，例如：“平民出身，凭天赋获得奖学金入学”"
                    onChange={(e) => handleFieldChange('socialClass', e.target.value)}
                  />
                </Col>
              </Row>
            </Card>

            <Card className="custom-sub-card" title="身份标签 (按回车或失去焦点保存)" size="small">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 4px', alignItems: 'center' }}>
                {(fields.identityTags || []).map((tag) => (
                  <Tag
                    key={tag}
                    closable
                    onClose={() => handleRemoveTag(tag)}
                    style={{
                      backgroundColor: '#faf6f0',
                      border: '1px solid #f2e8dc',
                      color: '#d97757',
                      fontSize: 13,
                      padding: '4px 10px',
                      borderRadius: 4,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    {tag}
                  </Tag>
                ))}
                {tagInputVisible ? (
                  <Input
                    ref={tagInputRef}
                    type="text"
                    size="small"
                    style={{ width: 100, height: 26 }}
                    value={tagInputValue}
                    onChange={(e) => setTagInputValue(e.target.value)}
                    onBlur={handleAddTagConfirm}
                    onPressEnter={handleAddTagConfirm}
                  />
                ) : (
                  <Button 
                    type="dashed" 
                    size="small" 
                    icon={<PlusOutlined />} 
                    onClick={showTagInput}
                    style={{ 
                      height: 26, 
                      fontSize: 12, 
                      borderRadius: 4,
                      color: '#8c8882',
                      borderColor: 'rgba(0,0,0,0.1)'
                    }}
                  >
                    新增标签
                  </Button>
                )}
              </div>
            </Card>
            {renderCustomFieldsBlock(item, 'char_basic')}
          </Space>
        )
      },
      {
        key: '2',
        label: '外貌与性格',
        children: (
          <Space direction="vertical" size={16} style={{ width: '100%', marginTop: 8 }}>
            <Card className="custom-sub-card" title="外貌气质设定" size="small">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Row gutter={16}>
                  <Col span={12}>
                    <div className="input-label">身高体型</div>
                    <Input 
                      value={fields.heightBuild || ''} 
                      className="custom-form-input"
                      placeholder="如：“178cm，体型匀称偏瘦”"
                      onChange={(e) => handleFieldChange('heightBuild', e.target.value)}
                    />
                  </Col>
                  <Col span={12}>
                    <div className="input-label">标志性特征</div>
                    <Input 
                      value={fields.iconicFeatures || ''} 
                      className="custom-form-input"
                      placeholder="如：“手背上有淡蓝色以太烙印”"
                      onChange={(e) => handleFieldChange('iconicFeatures', e.target.value)}
                    />
                  </Col>
                </Row>
                <div>
                  <div className="input-label">衣着风格</div>
                  <Input.TextArea 
                    value={fields.clothingStyle || ''} 
                    autoSize={{ minRows: 1, maxRows: 3 }}
                    className="custom-form-input"
                    placeholder="描述角色常穿服饰及随身携带的物品..."
                    onChange={(e) => handleFieldChange('clothingStyle', e.target.value)}
                  />
                </div>
                <div>
                  <div className="input-label">整体气质</div>
                  <Input.TextArea 
                    value={fields.overallVibe || ''} 
                    autoSize={{ minRows: 1, maxRows: 3 }}
                    className="custom-form-input"
                    placeholder="给旁人留下的直观感觉，如“温和沉静，偶尔闪过警惕”..."
                    onChange={(e) => handleFieldChange('overallVibe', e.target.value)}
                  />
                </div>
              </Space>
            </Card>

            <Card className="custom-sub-card" title="性格内里特征" size="small">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Row gutter={16}>
                  <Col span={12}>
                    <div className="input-label">外在性格 (表现给外界看的一面)</div>
                    <Input.TextArea 
                      value={fields.externalPersonality || ''} 
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      className="custom-form-input"
                      placeholder="如：“温和谦逊，乐于助人，靠谱同伴”"
                      onChange={(e) => handleFieldChange('externalPersonality', e.target.value)}
                    />
                  </Col>
                  <Col span={12}>
                    <div className="input-label">内在性格 (真实的自我本质)</div>
                    <Input.TextArea 
                      value={fields.internalPersonality || ''} 
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      className="custom-form-input"
                      placeholder="如：“冷静克制，心防极重，权衡明确”"
                      onChange={(e) => handleFieldChange('internalPersonality', e.target.value)}
                    />
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <div className="input-label">核心欲望 (内在的最强驱动力)</div>
                    <Input.TextArea 
                      value={fields.coreDesire || ''} 
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      className="custom-form-input"
                      placeholder="如：“探寻魔法底层原理，安全回家”"
                      onChange={(e) => handleFieldChange('coreDesire', e.target.value)}
                    />
                  </Col>
                  <Col span={12}>
                    <div className="input-label">恐惧与弱点 (最大的软肋)</div>
                    <Input.TextArea 
                      value={fields.fearWeakness || ''} 
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      className="custom-form-input"
                      placeholder="如：“穿越的秘密泄露被当成异端净化”"
                      onChange={(e) => handleFieldChange('fearWeakness', e.target.value)}
                    />
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <div className="input-label">道德观念 (是非对错底线)</div>
                    <Input.TextArea 
                      value={fields.moralValues || ''} 
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      className="custom-form-input"
                      placeholder="如：“不主动害人，安全受威胁时果断反击”"
                      onChange={(e) => handleFieldChange('moralValues', e.target.value)}
                    />
                  </Col>
                  <Col span={12}>
                    <div className="input-label">怪癖 (独特有趣的习惯动作)</div>
                    <Input.TextArea 
                      value={fields.quirk || ''} 
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      className="custom-form-input"
                      placeholder="如：“思考难题时下意识用食指轻敲太阳穴”"
                      onChange={(e) => handleFieldChange('quirk', e.target.value)}
                    />
                  </Col>
                </Row>
              </Space>
            </Card>
            {renderCustomFieldsBlock(item, 'char_appearance')}
          </Space>
        )
      },
      {
        key: '3',
        label: '能力与经历',
        children: (
          <Space direction="vertical" size={16} style={{ width: '100%', marginTop: 8 }}>
            <Card className="custom-sub-card" title="硬核能力与经历" size="small">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <div>
                  <div className="input-label">技能专长</div>
                  <Input.TextArea 
                    value={fields.skills || ''} 
                    autoSize={{ minRows: 2, maxRows: 5 }}
                    className="custom-form-input"
                    placeholder="描述角色掌握的魔法、体术、科学知识或其他特长..."
                    onChange={(e) => handleFieldChange('skills', e.target.value)}
                  />
                </div>
                <div>
                  <div className="input-label">背景故事</div>
                  <Input.TextArea 
                    value={fields.backgroundStory || ''} 
                    autoSize={{ minRows: 3, maxRows: 6 }}
                    className="custom-form-input"
                    placeholder="记叙角色过去的重要成长事件，如何成为现在的自己..."
                    onChange={(e) => handleFieldChange('backgroundStory', e.target.value)}
                  />
                </div>
                <div>
                  <div className="input-label">人际关系</div>
                  <Input.TextArea 
                    value={fields.relationships || ''} 
                    autoSize={{ minRows: 2, maxRows: 5 }}
                    className="custom-form-input"
                    placeholder="描述与配角、敌对势力、导师或死党的关系关联..."
                    onChange={(e) => handleFieldChange('relationships', e.target.value)}
                  />
                </div>
              </Space>
            </Card>

            <Card className="custom-sub-card" title="语言表达风格" size="small">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <div>
                  <div className="input-label">说话方式</div>
                  <Input.TextArea 
                    value={fields.speakingStyle || ''} 
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    className="custom-form-input"
                    placeholder="口癖、语气节奏，如：“语气不温不火，喜欢用'根据我的观察...'”..."
                    onChange={(e) => handleFieldChange('speakingStyle', e.target.value)}
                  />
                </div>
                <div>
                  <div className="input-label">典型反应</div>
                  <Input.TextArea 
                    value={fields.typicalReactions || ''} 
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    className="custom-form-input"
                    placeholder="遇到不同突发事件的本能反应，如“遭遇危机时瞳孔微缩但绝不惊慌”..."
                    onChange={(e) => handleFieldChange('typicalReactions', e.target.value)}
                  />
                </div>
              </Space>
            </Card>
            {renderCustomFieldsBlock(item, 'char_ability')}
          </Space>
        )
      },
      {
        key: '4',
        label: '角色记忆',
        children: (
          <Space direction="vertical" size={16} style={{ width: '100%', marginTop: 8 }}>
            <Card className="custom-sub-card" title="与用户关系设定（大模型提取或手动输入）" size="small">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <div>
                  <div className="input-label">与用户关系类型</div>
                  <Input 
                    value={fields.userRelationType || ''} 
                    className="custom-form-input"
                    placeholder="例如：欢喜冤家、生死之交、师徒、针锋相对的竞争对手..."
                    onChange={(e) => handleFieldChange('userRelationType', e.target.value)}
                  />
                </div>
                <div>
                  <div className="input-label">与用户相处模式</div>
                  <Input.TextArea 
                    value={fields.userInteractionModel || ''} 
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    className="custom-form-input"
                    placeholder="描述该角色如何与用户互动交往。例如：表面上冷嘲热讽但关键时刻极其护短、以礼相待保持分寸、主动热情爱开玩笑..."
                    onChange={(e) => handleFieldChange('userInteractionModel', e.target.value)}
                  />
                </div>
                <div>
                  <div className="input-label">与用户关系底线</div>
                  <Input.TextArea 
                    value={fields.userRelationBottomLine || ''} 
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    className="custom-form-input"
                    placeholder="描述该角色在与用户相处时的底线。例如：绝对不能容忍欺骗、一旦涉及家族利益会优先站在家族立场、禁止打听其右手烙印的秘密..."
                    onChange={(e) => handleFieldChange('userRelationBottomLine', e.target.value)}
                  />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <div className="input-label" style={{ margin: 0 }}>关键事件</div>
                    <Button
                      type="text"
                      size="small"
                      disabled={isOptimizing}
                      icon={isOptimizing ? <LoadingOutlined spin /> : <ThunderboltOutlined style={{ color: '#d97757' }} />}
                      onClick={() => handleOptimizeMemories(fields.keyEvents || '')}
                      style={{
                        fontSize: '11px',
                        color: '#d97757',
                        background: '#faf6f0',
                        border: '1px solid #f2e8dc',
                        borderRadius: '4px',
                        height: '22px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      {isOptimizing ? 'AI 优化中...' : 'AI 浓缩与优化'}
                    </Button>
                  </div>
                  <Input.TextArea 
                    value={fields.keyEvents || ''} 
                    autoSize={{ minRows: 4, maxRows: 8 }}
                    className="custom-form-input"
                    placeholder="记录该角色与用户共同经历的重要里程碑事件（推荐以点列或时间线形式记录）..."
                    onChange={(e) => handleFieldChange('keyEvents', e.target.value)}
                  />
                </div>
              </Space>
            </Card>
            {renderCustomFieldsBlock(item, 'char_memory')}
          </Space>
        )
      }
    ];

    return (
      <div className="custom-tab" style={{ width: '100%' }}>
        <Tabs items={tabItems} defaultActiveKey="1" size="middle" />
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden', background: '#faf9f5' }}>
      {/* CSS injection for aesthetic styling and theme preservation */}
      <style>{`
        .directory-item-hover:hover {
          background-color: #faf6f0;
        }
        .directory-item-hover:hover .action-btn {
          display: inline-flex !important;
        }
        .character-tree-item:hover {
          background-color: #faf6f0 !important;
        }
        .character-tree-item:hover .action-btn,
        .character-tree-item.is-selected .action-btn {
          display: inline-flex !important;
        }
        .character-card-tree .ant-tree-treenode {
          padding: 0 8px 2px 8px !important;
        }
        .character-card-tree .ant-tree-node-content-wrapper {
          flex: 1;
          min-width: 0;
          padding: 0 !important;
          border-radius: 6px !important;
        }
        .character-card-tree .ant-tree-node-content-wrapper.ant-tree-node-selected {
          background: transparent !important;
        }
        .character-card-tree .ant-tree-switcher {
          color: #c0bbb4;
        }
        .directory-item-hover .action-btn:hover {
          background-color: rgba(0, 0, 0, 0.04) !important;
        }
        .add-category-btn {
          color: #8c8882;
          transition: all 0.2s;
        }
        .add-category-btn:hover {
          color: #d97757 !important;
          background-color: #f2e8dc !important;
        }
        
        /* Premium custom styles for inputs and forms */
        .input-label {
          font-size: 12px;
          color: #8c8882;
          font-weight: 500;
          margin-bottom: 6px;
        }
        .custom-form-input {
          border-radius: 6px !important;
          border: 1px solid rgba(0, 0, 0, 0.08) !important;
          transition: all 0.2s !important;
          font-family: inherit !important;
        }
        .custom-form-input:focus, .custom-form-input-focused {
          border-color: #d97757 !important;
          box-shadow: 0 0 0 2px rgba(217, 119, 87, 0.1) !important;
        }
        .custom-form-input:hover {
          border-color: #d97757 !important;
        }
        .form-section-title {
          font-size: 14px;
          font-weight: 600;
          color: #33312e;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .custom-form-card {
          background: #ffffff !important;
          border: 1px solid rgba(0, 0, 0, 0.03) !important;
          border-radius: 8px !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.01) !important;
        }
        .custom-form-card .ant-card-head {
          border-bottom: 1px solid rgba(0,0,0,0.02) !important;
          background: #fafafa !important;
          border-top-left-radius: 8px !important;
          border-top-right-radius: 8px !important;
        }
        .custom-sub-card {
          background: #ffffff !important;
          border: 1px solid rgba(0, 0, 0, 0.03) !important;
          border-radius: 8px !important;
          box-shadow: 0 1px 4px rgba(0,0,0,0.01) !important;
        }
        .custom-sub-card .ant-card-head {
          border-bottom: 1px solid rgba(0,0,0,0.02) !important;
          background: #fbfbfa !important;
          font-size: 13px !important;
          font-weight: 500 !important;
        }
        
        /* Custom tabs styling in warm palette */
        .custom-tab .ant-tabs-nav::before {
          border-bottom: 1px solid rgba(0,0,0,0.03) !important;
        }
        .custom-tab .ant-tabs-tab {
          padding: 8px 12px !important;
        }
        .custom-tab .ant-tabs-tab-btn {
          color: #8c8882 !important;
          font-weight: 400 !important;
        }
        .custom-tab .ant-tabs-tab-btn:hover {
          color: #d97757 !important;
        }
        .custom-tab .ant-tabs-tab-active .ant-tabs-tab-btn {
          color: #d97757 !important;
          font-weight: 600 !important;
        }
        .custom-tab .ant-tabs-ink-bar {
          background: #d97757 !important;
          height: 2px !important;
        }
        
        /* Premium Magazine-like preview styling */
        .markdown-preview-container {
          background-color: #ffffff;
          padding: 32px 40px;
          border-radius: 8px;
          border: 1px solid rgba(0, 0, 0, 0.03);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.01);
          color: #33312e;
          font-family: Georgia, -apple-system-font, "STSong", "Songti SC", serif;
          line-height: 1.8;
          font-size: 15px;
          max-width: 760px;
          margin: 0 auto;
          width: 100%;
        }
        .markdown-preview-container h1 {
          font-size: 26px;
          font-weight: 700;
          border-bottom: 2px solid #f2e8dc;
          padding-bottom: 10px;
          margin-bottom: 24px;
          color: #33312e;
          text-align: center;
        }
        .markdown-preview-container h2 {
          font-size: 18px;
          font-weight: 600;
          margin-top: 28px;
          margin-bottom: 16px;
          color: #d97757;
          border-left: 3px solid #d97757;
          padding-left: 10px;
        }
        .markdown-preview-container p {
          margin-bottom: 16px;
          text-align: justify;
        }
        .markdown-preview-container ul {
          padding-left: 20px;
          margin-bottom: 18px;
        }
        .markdown-preview-container li {
          margin-bottom: 8px;
        }
        .markdown-preview-container code {
          background-color: #faf6f0;
          color: #d97757;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 13px;
          font-family: Consolas, Monaco, monospace;
        }
      `}</style>

      {/* Left Directory Sidebar */}
      <div style={{ 
        width: DIRECTORY_WIDTH, 
        minWidth: DIRECTORY_WIDTH, 
        borderRight: '1px solid rgba(0, 0, 0, 0.04)', 
        display: 'flex', 
        flexDirection: 'column',
        background: '#ffffff'
      }}>
        {/* Title Header */}
        <div style={{ 
          padding: '16px 20px', 
          borderBottom: '1px solid rgba(0, 0, 0, 0.02)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <span style={{ 
            fontSize: 16, 
            fontWeight: 600, 
            color: '#33312e',
            fontFamily: '"Inter", sans-serif'
          }}>
            背景设定
          </span>
          <Button
            type="text"
            size="small"
            icon={<RobotOutlined style={{ color: '#d97757' }} />}
            onClick={() => setIsAiModalOpen(true)}
            style={{
              fontSize: '12px',
              color: '#d97757',
              background: '#faf6f0',
              border: '1px solid #f2e8dc',
              borderRadius: '4px',
              padding: '2px 8px',
              height: '24px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            AI 智能提取
          </Button>
        </div>

        {/* Directory Scrollable Area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
          
          {/* World Book Category */}
          <div>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              padding: '4px 16px 4px 20px',
              color: '#8c8882',
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '0.05em'
            }}>
              <span>世界书</span>
              <Tooltip title="新增世界书">
                <Button 
                  type="text" 
                  size="small" 
                  icon={<PlusOutlined style={{ fontSize: 12 }} />} 
                  onClick={addWorldBook}
                  style={{ width: 22, height: 22, padding: 0 }}
                  className="add-category-btn"
                />
              </Tooltip>
            </div>
            
            <div style={{ marginBottom: 16 }}>
              {worldBooks.length === 0 ? (
                <div style={{ padding: '8px 20px', color: '#c0bbb4', fontSize: 12, fontStyle: 'italic' }}>
                  暂无世界书
                </div>
              ) : (
                worldBooks.map(renderDirectoryItem)
              )}
            </div>
          </div>

          {/* Character Card Category */}
          <div>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              padding: '4px 16px 4px 20px',
              color: '#8c8882',
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '0.05em'
            }}>
              <span>角色卡</span>
              <Tooltip title="新增角色卡">
                <Button 
                  type="text" 
                  size="small" 
                  icon={<PlusOutlined style={{ fontSize: 12 }} />} 
                  onClick={addCharacterCard}
                  style={{ width: 22, height: 22, padding: 0 }}
                  className="add-category-btn"
                />
              </Tooltip>
            </div>
            
            <div>
              {characterCards.length === 0 ? (
                <div style={{ padding: '8px 20px', color: '#c0bbb4', fontSize: 12, fontStyle: 'italic' }}>
                  暂无角色卡
                </div>
              ) : (
                <Tree
                  className="character-card-tree"
                  expandedKeys={expandedCharacterGroupKeys}
                  onExpand={(keys) => setExpandedCharacterGroupKeys(keys)}
                  selectedKeys={selectedType === 'character_card' && selectedId ? [selectedId] : []}
                  onClick={(_, node) => {
                    const nextKey = String(node.key);
                    if (characterCardGroupKeys.includes(nextKey)) {
                      toggleCharacterGroup(nextKey);
                    }
                  }}
                  onSelect={(keys) => {
                    const nextId = String(keys[0] || '');
                    if (nextId) {
                      selectItem(nextId, 'character_card');
                    }
                  }}
                  treeData={characterCardTreeData}
                />
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Right Config Panel */}
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        overflow: 'hidden' 
      }}>
        {selectedItem ? (
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            height: '100%', 
            width: '100%' 
          }}>
            {/* Header */}
            <div style={{ 
              padding: '12px 24px', 
              background: '#ffffff', 
              borderBottom: '1px solid rgba(0, 0, 0, 0.04)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              height: 52
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {selectedItem.type === 'world_book' ? (
                  <GlobalOutlined style={{ fontSize: 16, color: '#d97757' }} />
                ) : (
                  <UserOutlined style={{ fontSize: 16, color: '#d97757' }} />
                )}
                <span style={{ fontSize: 15, fontWeight: 600, color: '#33312e' }}>
                  {selectedItem.name}
                </span>
                <span style={{ 
                  fontSize: 10, 
                  background: '#f2e8dc', 
                  color: '#d97757', 
                  padding: '2px 8px', 
                  borderRadius: 12, 
                  fontWeight: 500
                }}>
                  {selectedItem.type === 'world_book' ? '世界书' : '角色卡'}
                </span>
              </div>

              {/* Mode Toggle Selector */}
              <Radio.Group 
                value={activeMode} 
                onChange={(e) => setActiveMode(e.target.value)}
                size="small"
                style={{
                  padding: 2,
                  background: '#faf9f5',
                  borderRadius: 6,
                  border: '1px solid rgba(0,0,0,0.03)'
                }}
              >
                <Radio.Button 
                  value="edit"
                  style={{
                    borderRadius: 4,
                    border: 'none',
                    background: activeMode === 'edit' ? '#ffffff' : 'transparent',
                    color: activeMode === 'edit' ? '#d97757' : '#8c8882',
                    boxShadow: activeMode === 'edit' ? '0 1px 4px rgba(0,0,0,0.05)' : 'none',
                    fontWeight: activeMode === 'edit' ? 500 : 400
                  }}
                >
                  <Space size={4}>
                    <EditFilled style={{ fontSize: 11 }} />
                    <span>编辑配置</span>
                  </Space>
                </Radio.Button>
                <Radio.Button 
                  value="preview"
                  style={{
                    borderRadius: 4,
                    border: 'none',
                    background: activeMode === 'preview' ? '#ffffff' : 'transparent',
                    color: activeMode === 'preview' ? '#d97757' : '#8c8882',
                    boxShadow: activeMode === 'preview' ? '0 1px 4px rgba(0,0,0,0.05)' : 'none',
                    fontWeight: activeMode === 'preview' ? 500 : 400
                  }}
                >
                  <Space size={4}>
                    <EyeOutlined style={{ fontSize: 11 }} />
                    <span>效果预览</span>
                  </Space>
                </Radio.Button>
              </Radio.Group>
            </div>

            {/* Scrollable Work Area */}
            <div style={{ 
              flex: 1, 
              padding: '24px 32px 40px 32px', 
              overflowY: 'auto',
              background: '#faf9f5'
            }}>
              {activeMode === 'edit' ? (
                // Form Editor View
                <div style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
                  {selectedItem.type === 'world_book' 
                    ? renderWorldBookForm(selectedItem) 
                    : renderCharacterCardForm(selectedItem)
                  }
                </div>
              ) : (
                // Elegant Markdown Preview View
                <div className="markdown-preview-container">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {selectedItem.content}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ 
            flex: 1, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            background: '#faf9f5' 
          }}>
            <Empty
              image={<CompassOutlined style={{ fontSize: 64, color: '#c0bbb4' }} />}
              description={
                <span style={{ color: '#8c8882', fontSize: 14 }}>
                  请在左侧目录中选择或新建一个世界书或角色卡来查看配置。
                </span>
              }
            />
          </div>
        )}
      </div>

      {/* Background AI Extraction Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#33312e', fontSize: '16px', fontWeight: 600 }}>
            <RobotOutlined style={{ color: '#d97757' }} />
            <span>AI 智能提取背景设定</span>
          </div>
        }
        open={isAiModalOpen}
        onCancel={() => {
          if (isGenerating) {
            setIsCancellingBackground(true);
            abortControllerRef.current?.abort();
            const taskId = currentTaskIdRef.current;
            if (taskId) {
              invoke('cancel_background_task', { taskId }).catch(() => {});
            }
          } else {
            setIsAiModalOpen(false);
          }
        }}
        afterOpenChange={(open) => {
          if (!open) {
            if (abortControllerRef.current) {
              abortControllerRef.current.abort();
            }
            const taskId = currentTaskIdRef.current;
            if (taskId) {
              invoke('cancel_background_task', { taskId }).catch(() => {});
            }
          }
        }}
        closable={true}
        mask={{ closable: !isGenerating }}
        keyboard={!isGenerating}
        onOk={handleAiModalOk}
        okText={aiModalOkText}
        cancelText={isCancellingBackground ? '正在释放连接' : isGenerating ? '中断提取' : '取消'}
        width={720}
        okButtonProps={{ loading: isGenerating, disabled: isGenerating }}
        cancelButtonProps={{ danger: isGenerating, disabled: isCancellingBackground }}
        styles={{
          body: { padding: '16px 24px' }
        }}
      >
        {extractionStep === 'review' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ padding: '12px 16px', background: '#faf6f0', borderRadius: '8px', border: '1px solid #f2e8dc', color: '#8c8882', fontSize: '12px', lineHeight: 1.5 }}>
              <InfoCircleOutlined style={{ color: '#d97757', marginRight: 6 }} />
              请先检查并微调阶段一结果。确认后会保存世界书{extractionMode === 'world_book_and_character_cards' ? '，并按下方角色名继续生成角色卡。' : '。'}
            </div>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 500, color: '#8c8882', marginBottom: '6px' }}>世界书名称</div>
              <Input
                value={reviewWorldBookName}
                onChange={(e) => setReviewWorldBookName(e.target.value)}
                className="custom-form-input"
                placeholder="请输入世界书名称"
              />
            </div>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 500, color: '#8c8882', marginBottom: '6px' }}>世界书字段</div>
              <Input.TextArea
                value={reviewWorldBookFieldsJson}
                onChange={(e) => setReviewWorldBookFieldsJson(e.target.value)}
                autoSize={{ minRows: 8, maxRows: 14 }}
                className="custom-form-input"
                style={{ fontFamily: 'Consolas, Monaco, "Courier New", monospace', fontSize: '13px' }}
              />
            </div>
            {extractionMode === 'world_book_and_character_cards' && (
              <div>
                <div style={{ fontSize: '12px', fontWeight: 500, color: '#8c8882', marginBottom: '6px' }}>角色名列表</div>
                <Input.TextArea
                  value={reviewCharacterNames}
                  onChange={(e) => setReviewCharacterNames(e.target.value)}
                  autoSize={{ minRows: 4, maxRows: 8 }}
                  className="custom-form-input"
                  placeholder="每行输入一个角色名"
                />
              </div>
            )}
          </div>
        ) : extractionStep === 'characters' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#8c8882', fontSize: '13px' }}>
              {isGenerating && <Spin indicator={<LoadingOutlined style={{ fontSize: 16, color: '#d97757' }} spin />} size="small" />}
              <span>
                {isCancellingBackground
                  ? '正在中断提取并等待模型服务释放连接...'
                  : isGenerating
                  ? 'AI 正在分布式生成角色卡...'
                  : characterStatuses.some((item) => item.status === 'pending')
                    ? `已暂停，还有 ${characterStatuses.filter((item) => item.status === 'pending').length} 个角色待提取`
                    : characterStatuses.some((item) => item.status === 'failed')
                      ? `角色卡生成已完成，${characterStatuses.filter((item) => item.status === 'failed').length} 个失败`
                      : '角色卡生成已完成'}
              </span>
            </div>
            <Progress percent={characterProgressPercent} strokeColor="#d97757" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: 320, overflowY: 'auto' }}>
              {characterStatuses.map((item) => {
                const statusMeta = item.status === 'success'
                  ? { icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />, text: '成功', color: '#52c41a' }
                  : item.status === 'failed'
                    ? { icon: <CloseCircleOutlined style={{ color: '#ff4d4f' }} />, text: '失败', color: '#ff4d4f' }
                    : item.status === 'running'
                      ? { icon: <LoadingOutlined spin style={{ color: '#d97757' }} />, text: '分析中', color: '#d97757' }
                      : { icon: <ClockCircleOutlined style={{ color: '#c0bbb4' }} />, text: '等待中', color: '#8c8882' };
                return (
                  item.status === 'failed' ? (
                    <details
                      key={item.name}
                      style={{ background: '#fafafa', border: '1px solid rgba(0,0,0,0.03)', borderRadius: 6, padding: '8px 10px' }}
                    >
                      <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: '#33312e', fontSize: 13 }}>{item.name}</span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: statusMeta.color, fontSize: 12 }}>
                            {statusMeta.icon}
                            {statusMeta.text}
                          </span>
                        </div>
                      </summary>
                      <div style={{ color: '#8c8882', fontSize: 12, lineHeight: 1.6, marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                        <div style={{ color: '#33312e', fontWeight: 500, marginBottom: 4 }}>后端原始信息</div>
                        <pre style={{ margin: 0, padding: 10, maxHeight: 220, overflow: 'auto', background: '#fff', border: '1px solid rgba(0,0,0,0.04)', borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'Consolas, Monaco, "Courier New", monospace', fontSize: 12 }}>
                          {item.rawOutput || item.error || '未返回失败详情'}
                        </pre>
                      </div>
                    </details>
                  ) : (
                    <div key={item.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: '#fafafa', borderRadius: 6, border: '1px solid rgba(0,0,0,0.03)' }}>
                      <span style={{ color: '#33312e', fontSize: 13 }}>{item.name}</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: statusMeta.color, fontSize: 12 }}>
                        {statusMeta.icon}
                        {statusMeta.text}
                      </span>
                    </div>
                  )
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ padding: '12px 16px', background: '#faf6f0', borderRadius: '8px', border: '1px solid #f2e8dc', color: '#8c8882', fontSize: '12px', lineHeight: 1.5 }}>
              <InfoCircleOutlined style={{ color: '#d97757', marginRight: 6 }} />
              <strong>提示：</strong>选择您已有的作品、大纲或参考范文（可多选），大模型将按所选模式提取世界书或角色卡。完整模式会先让您确认世界书和角色名，再继续生成角色卡。
            </div>

            <div>
              <div style={{ fontSize: '12px', fontWeight: 500, color: '#8c8882', marginBottom: '6px' }}>
                提取模式
              </div>
                <Radio.Group
                  value={extractionMode}
                  onChange={(e) => setExtractionMode(e.target.value)}
                  disabled={isGenerating}
                  optionType="button"
                  buttonStyle="solid"
                  options={[
                  { label: '提取世界书和角色卡', value: 'world_book_and_character_cards' },
                  { label: '仅提取世界书', value: 'world_book_only' },
                  { label: '仅提取角色卡', value: 'character_cards_only' },
                ]}
              />
            </div>

            {extractionMode === 'character_cards_only' && (
              <div>
                <div style={{ fontSize: '12px', fontWeight: 500, color: '#8c8882', marginBottom: '6px' }}>
                  角色名列表
                </div>
                <Input.TextArea
                  value={manualCharacterNames}
                  onChange={(e) => setManualCharacterNames(e.target.value)}
                  autoSize={{ minRows: 3, maxRows: 6 }}
                  className="custom-form-input"
                  placeholder="每行输入一个角色名"
                />
              </div>
            )}

            <div style={{ maxHeight: '380px', overflowY: 'auto', paddingRight: '4px' }}>
              {/* Category: Works */}
              <div style={{ marginBottom: '16px', background: '#fafafa', padding: '12px', borderRadius: '6px', border: '1px solid rgba(0,0,0,0.03)' }}>
                <div style={{ fontWeight: 600, fontSize: '13px', color: '#33312e', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <BookOutlined style={{ color: '#d97757' }} />
                  <span>我的作品 (Articles)</span>
                </div>
                {articlesTree.length === 0 ? (
                  <div style={{ color: '#c0bbb4', fontSize: '12px', paddingLeft: '24px', fontStyle: 'italic' }}>暂无作品文件夹及文件</div>
                ) : (
                  <Tree
                    checkable
                    selectable={false}
                    checkedKeys={selectedFilePaths}
                    onCheck={(keys) => {
                      const checkedList = Array.isArray(keys) ? keys : keys.checked;
                      setSelectedFilePaths(checkedList.map(String));
                    }}
                    treeData={articlesTree}
                    style={{ background: 'transparent', fontSize: '13px' }}
                  />
                )}
              </div>

              {/* Category: Outline */}
              <div style={{ marginBottom: '16px', background: '#fafafa', padding: '12px', borderRadius: '6px', border: '1px solid rgba(0,0,0,0.03)' }}>
                <div style={{ fontWeight: 600, fontSize: '13px', color: '#33312e', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CompassOutlined style={{ color: '#d97757' }} />
                  <span>故事大纲 (Outline)</span>
                </div>
                {outlineTree.length === 0 ? (
                  <div style={{ color: '#c0bbb4', fontSize: '12px', paddingLeft: '24px', fontStyle: 'italic' }}>暂无大纲文件夹及文件</div>
                ) : (
                  <Tree
                    checkable
                    selectable={false}
                    checkedKeys={selectedFilePaths}
                    onCheck={(keys) => {
                      const checkedList = Array.isArray(keys) ? keys : keys.checked;
                      setSelectedFilePaths(checkedList.map(String));
                    }}
                    treeData={outlineTree}
                    style={{ background: 'transparent', fontSize: '13px' }}
                  />
                )}
              </div>

              {/* Category: References */}
              <div style={{ marginBottom: '8px', background: '#fafafa', padding: '12px', borderRadius: '6px', border: '1px solid rgba(0,0,0,0.03)' }}>
                <div style={{ fontWeight: 600, fontSize: '13px', color: '#33312e', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <GlobalOutlined style={{ color: '#d97757' }} />
                  <span>范文库/参考 (References)</span>
                </div>
                {referencesTree.length === 0 ? (
                  <div style={{ color: '#c0bbb4', fontSize: '12px', paddingLeft: '24px', fontStyle: 'italic' }}>暂无参考文件夹及文件</div>
                ) : (
                  <Tree
                    checkable
                    selectable={false}
                    checkedKeys={selectedFilePaths}
                    onCheck={(keys) => {
                      const checkedList = Array.isArray(keys) ? keys : keys.checked;
                      setSelectedFilePaths(checkedList.map(String));
                    }}
                    treeData={referencesTree}
                    style={{ background: 'transparent', fontSize: '13px' }}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Memory Optimization Review Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#33312e', fontSize: '16px', fontWeight: 600 }}>
            <FileProtectOutlined style={{ color: '#d97757' }} />
            <span>AI 优化与消解逻辑矛盾记忆预览</span>
          </div>
        }
        open={isMemModalOpen}
        onCancel={() => setIsMemModalOpen(false)}
        onOk={handleConfirmOptimize}
        okText="确认更新写入角色卡"
        cancelText="取消"
        width={680}
        styles={{
          body: { padding: '16px 24px' }
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ padding: '10px 14px', background: '#faf6f0', borderRadius: '8px', border: '1px solid #f2e8dc', color: '#8c8882', fontSize: '12px', lineHeight: 1.5 }}>
            <strong>记忆优化已完成：</strong>大模型已消解逻辑矛盾并浓缩整理完毕。您可以在下方编辑框中直接微调修改，点击“确认更新”即可同步回该角色的“关键事件”中。
          </div>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 500, color: '#8c8882', marginBottom: '6px' }}>优化后的关键事件</div>
            <Input.TextArea
              value={optimizedEvents}
              onChange={(e) => setOptimizedEvents(e.target.value)}
              autoSize={{ minRows: 10, maxRows: 16 }}
              className="custom-form-input custom-form-input-focused"
              placeholder="请输入优化后的关键事件记忆内容..."
              style={{ borderRadius: '6px', fontSize: '13px', lineHeight: 1.6 }}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default Background;
