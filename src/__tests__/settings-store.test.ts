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
      thinkingDepth: 'off',
    });
    expect(agentConfigs.storyDynamicAgent).toEqual({
      temperature: 0.7,
      maxOutputTokens: 4096,
      maxContextTokens: 128000,
      thinkingDepth: 'off',
    });
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
});
