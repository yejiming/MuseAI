import { describe, it, expect } from 'vitest';
import {
  defaultSystemPrompt,
  defaultDeAiDetectorPrompt,
  defaultDeAiRemoverPrompt,
  defaultWorkSummaryPrompt,
  defaultOutlineCreationPrompt,
  defaultOutlineAssessmentPrompt,
  defaultReverseOutlineShortPrompt,
  defaultReverseOutlineLongSummaryPrompt,
  defaultReverseOutlineLongFinalPrompt,
  defaultPartnerChatPrompt,
  defaultBackgroundWorldBookPrompt,
  defaultBackgroundCharacterCardPrompt,
  defaultStoryAgentPrompt,
  defaultStoryDynamicAgentPrompt,
  defaultBookTravelMaterialAssemblerPrompt,
  defaultBookTravelEntryDirectorPrompt,
  defaultBookTravelPlotPlannerPrompt,
  defaultBookTravelSceneWriterPrompt,
  defaultBookTravelMemoryKeeperPrompt,
  defaultBookTravelEndingJudgePrompt,
  defaultSillyTavernExporterPrompt,
  defaultAgentConfigs,
  applyCompactionTurnThresholdDefaults,
  useSettingsStore,
} from '../stores/useSettingsStore';

describe('Settings store default exports', () => {
  it('defaultSystemPrompt should contain Chinese writing instructions', () => {
    expect(defaultSystemPrompt).toContain('你是一名有着20年网文写作经验的资深网文作者');
    expect(defaultSystemPrompt).toContain('请始终使用中文回复');
  });

  it('defaultDeAiDetectorPrompt should contain scoring criteria', () => {
    expect(defaultDeAiDetectorPrompt).toContain('可预测的节奏');
    expect(defaultDeAiDetectorPrompt).toContain('功能性用词');
    expect(defaultDeAiDetectorPrompt).toContain('机械式写作');
  });

  it('defaultDeAiRemoverPrompt should contain editing instructions', () => {
    expect(defaultDeAiRemoverPrompt).toContain('AI味');
    expect(defaultDeAiRemoverPrompt).toContain('禁用词和句型');
  });

  it('defaultWorkSummaryPrompt should contain summary requirements', () => {
    expect(defaultWorkSummaryPrompt).toContain('总结关键人物');
    expect(defaultWorkSummaryPrompt).toContain('分章节剧情总结');
  });

  it('defaultOutlineCreationPrompt should contain outline structure', () => {
    expect(defaultOutlineCreationPrompt).toContain('短篇小说大纲的一般结构');
    expect(defaultOutlineCreationPrompt).toContain('长篇小说大纲的一般结构');
  });

  it('defaultOutlineAssessmentPrompt should contain scoring dimensions', () => {
    expect(defaultOutlineAssessmentPrompt).toContain('引流能力');
    expect(defaultOutlineAssessmentPrompt).toContain('开局钩子');
    expect(defaultOutlineAssessmentPrompt).toContain('设定新鲜感');
  });

  it('should keep reverse outline defaults separate by stage', () => {
    const { agentConfigs } = useSettingsStore.getState();

    expect(agentConfigs.reverseOutline.concurrency).toBe(5);
    expect(agentConfigs.reverseOutlineShort).toEqual({
      temperature: 0,
      maxOutputTokens: 32000,
      maxContextTokens: 200000,
      thinkingDepth: 'off',
    });
    expect(agentConfigs.reverseOutlineLongSummary).toEqual({
      temperature: 0,
      maxOutputTokens: 8192,
      maxContextTokens: 200000,
      thinkingDepth: 'off',
    });
    expect(agentConfigs.reverseOutlineLongFinal).toEqual({
      temperature: 0,
      maxOutputTokens: 32000,
      maxContextTokens: 200000,
      thinkingDepth: 'off',
    });
    expect(defaultReverseOutlineShortPrompt).toContain('不超过10000字');
    expect(defaultReverseOutlineShortPrompt).toContain('文章类型');
    expect(defaultReverseOutlineShortPrompt).toContain('标签');
    expect(defaultReverseOutlineShortPrompt).toContain('导语');
    expect(defaultReverseOutlineLongSummaryPrompt).toContain('不超过300字');
    expect(defaultReverseOutlineLongSummaryPrompt).toContain('仅输出主要剧情事件');
    expect(defaultReverseOutlineLongFinalPrompt).toContain('不超过10000字');
    expect(defaultReverseOutlineLongFinalPrompt).toContain('基础信息设定');
    expect(defaultReverseOutlineLongFinalPrompt).toContain('核心人物设定');
  });

  it('defaultPartnerChatPrompt should contain roleplay constraints', () => {
    expect(defaultPartnerChatPrompt).toContain('严格扮演角色');
    expect(defaultPartnerChatPrompt).toContain('口语化与对话感');
    expect(defaultPartnerChatPrompt).toContain('避免重复空转');
    expect(defaultPartnerChatPrompt).toContain('每轮推进关系或情境');
    expect(defaultAgentConfigs.partnerChat.maxOutputTokens).toBe(1024);
    expect(defaultAgentConfigs.partnerChat.compactionTurnThreshold).toBe(20);
    expect(defaultAgentConfigs.partnerChat.frequencyPenalty).toBe(0.3);
    expect(defaultAgentConfigs.partnerChat.presencePenalty).toBe(0.2);
    expect(defaultAgentConfigs.partnerChat.topP).toBe(0.9);
  });

  it('resetPartnerChatPrompt should restore repeat-resistant default prompt', () => {
    const store = useSettingsStore.getState();

    store.setPartnerChatPrompt('自定义伴侣提示词');
    store.resetPartnerChatPrompt();

    expect(useSettingsStore.getState().partnerChatPrompt).toBe(defaultPartnerChatPrompt);
    expect(useSettingsStore.getState().partnerChatPrompt).toContain('避免重复空转');
  });

  it('defaultStoryAgentPrompt should contain DM narrative constraints', () => {
    expect(defaultStoryAgentPrompt).toContain('沉浸式叙事');
    expect(defaultStoryAgentPrompt).toContain('绝不代替用户角色做决定');
  });

  it('defaultStoryDynamicAgentPrompt should require role_play for character speech', () => {
    expect(defaultStoryDynamicAgentPrompt).toContain('角色卡动态加载');
    expect(defaultStoryDynamicAgentPrompt).toContain('role_play');
    expect(defaultStoryDynamicAgentPrompt).toContain('禁止代写角色台词');
  });

  it('should keep a separate model config for dynamic story agent', () => {
    const { agentConfigs } = useSettingsStore.getState();

    expect(agentConfigs.storyAgent).toEqual({
      temperature: 0.7,
      maxOutputTokens: 4096,
      maxContextTokens: 128000,
      compactionTurnThreshold: 20,
      frequencyPenalty: 0.3,
      presencePenalty: 0.2,
      topP: 0.9,
      thinkingDepth: 'off',
    });
    expect(agentConfigs.storyDynamicAgent).toEqual({
      temperature: 0.7,
      maxOutputTokens: 4096,
      maxContextTokens: 128000,
      compactionTurnThreshold: 20,
      frequencyPenalty: 0.3,
      presencePenalty: 0.2,
      topP: 0.9,
      thinkingDepth: 'off',
    });
  });

  it('fills compaction and sampling controls only for chat and story agents', () => {
    const normalized = applyCompactionTurnThresholdDefaults({
      partnerChat: { temperature: 0.4 },
      storyAgent: { compactionTurnThreshold: 32 },
      storyDynamicAgent: {},
      writer: { temperature: 0.2 },
    });

    expect(defaultAgentConfigs.partnerChat.compactionTurnThreshold).toBe(20);
    expect(defaultAgentConfigs.storyAgent.compactionTurnThreshold).toBe(20);
    expect(defaultAgentConfigs.storyDynamicAgent.compactionTurnThreshold).toBe(20);
    expect(defaultAgentConfigs.writer.compactionTurnThreshold).toBeUndefined();
    expect(defaultAgentConfigs.writer.frequencyPenalty).toBeUndefined();
    expect(normalized.partnerChat).toEqual({
      temperature: 0.4,
      compactionTurnThreshold: 20,
      frequencyPenalty: 0.3,
      presencePenalty: 0.2,
      topP: 0.9,
    });
    expect(normalized.storyAgent.compactionTurnThreshold).toBe(32);
    expect(normalized.storyAgent.frequencyPenalty).toBe(0.3);
    expect(normalized.storyDynamicAgent.compactionTurnThreshold).toBe(20);
    expect(normalized.storyDynamicAgent.topP).toBe(0.9);
    expect(normalized.writer.compactionTurnThreshold).toBeUndefined();
    expect(normalized.writer.frequencyPenalty).toBeUndefined();
  });

  it('should keep background extraction defaults separate for world book and character card', () => {
    const state = useSettingsStore.getState();

    expect(state.agentConfigs.backgroundExtraction.concurrency).toBe(5);
    expect(state.agentConfigs.backgroundWorldBook).toEqual({
      temperature: 0,
      maxOutputTokens: 8192,
      maxContextTokens: 128000,
      thinkingDepth: 'off',
    });
    expect(state.agentConfigs.backgroundCharacterCard).toEqual({
      temperature: 0,
      maxOutputTokens: 8192,
      maxContextTokens: 128000,
      thinkingDepth: 'off',
    });
    expect(defaultBackgroundWorldBookPrompt).toContain('世界观与人物设定专家');
    expect(defaultBackgroundCharacterCardPrompt).toContain('人物设定专家');
  });

  it('should define book-travel role configs and default prompts', () => {
    const { agentConfigs } = useSettingsStore.getState();

    expect(agentConfigs.bookTravelMaterialAssembler).toEqual({
      temperature: 0,
      maxOutputTokens: 8192,
      maxContextTokens: 128000,
      thinkingDepth: 'off',
    });
    expect(agentConfigs.bookTravelEntryDirector).toEqual({
      temperature: 0,
      maxOutputTokens: 8192,
      maxContextTokens: 128000,
      thinkingDepth: 'off',
    });
    expect(agentConfigs.bookTravelPlotPlanner).toEqual({
      temperature: 0,
      maxOutputTokens: 8192,
      maxContextTokens: 128000,
      thinkingDepth: 'off',
    });
    expect(agentConfigs.bookTravelSceneWriter).toEqual({
      temperature: 0,
      maxOutputTokens: 8192,
      maxContextTokens: 128000,
      thinkingDepth: 'off',
    });
    expect(agentConfigs.bookTravelMemoryKeeper).toEqual({
      temperature: 0,
      maxOutputTokens: 8192,
      maxContextTokens: 128000,
      thinkingDepth: 'off',
    });
    expect(agentConfigs.bookTravelEndingJudge).toEqual({
      temperature: 0,
      maxOutputTokens: 8192,
      maxContextTokens: 128000,
      thinkingDepth: 'off',
    });

    expect(defaultBookTravelMaterialAssemblerPrompt).toContain('穿书素材装配师');
    expect(defaultBookTravelEntryDirectorPrompt).toContain('穿书入场导演');
    expect(defaultBookTravelPlotPlannerPrompt).toContain('穿书剧情规划师');
    expect(defaultBookTravelSceneWriterPrompt).toContain('穿书场景写手');
    expect(defaultBookTravelSceneWriterPrompt).toContain('【说话】');
    expect(defaultBookTravelSceneWriterPrompt).toContain('【剧情推进】');
    expect(defaultBookTravelPlotPlannerPrompt).toContain('activeCharacters');
    expect(defaultBookTravelPlotPlannerPrompt).toContain('time');
    expect(defaultBookTravelPlotPlannerPrompt).toContain('location');
    expect(defaultBookTravelPlotPlannerPrompt).not.toContain('allowedCast');
    expect(defaultBookTravelSceneWriterPrompt).toContain('只输出 beat');
    expect(defaultBookTravelSceneWriterPrompt).not.toContain('activeCharacters：字符串数组');
    expect(defaultBookTravelMemoryKeeperPrompt).toContain('穿书记忆整理员');
    expect(defaultBookTravelEndingJudgePrompt).toContain('穿书结局裁判');
  });

  it('should define sillyTavernExporter config with required defaults and prompt', () => {
    const { agentConfigs } = useSettingsStore.getState();

    expect(agentConfigs.sillyTavernExporter).toEqual({
      temperature: 0,
      maxOutputTokens: 32000,
      maxContextTokens: 200000,
      thinkingDepth: 'high',
    });
    expect(defaultSillyTavernExporterPrompt).toContain('chara_card_v2');
    expect(defaultSillyTavernExporterPrompt).toContain('字段映射');
    expect(defaultSillyTavernExporterPrompt).toContain('纯 JSON');
    expect(defaultAgentConfigs.sillyTavernExporter.thinkingDepth).toBe('high');
    expect(useSettingsStore.getState().sillyTavernExporterPrompt).toBe(defaultSillyTavernExporterPrompt);
  });
});
