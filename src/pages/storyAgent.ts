import type { AgentToolEntry, Message, ThinkingBlock } from '../stores/useAgentStore';

const USER_INFO_LABELS: Record<string, string> = {
  name: '姓名',
  age: '年龄',
  gender: '性别',
  race: '种族',
  birthplace: '出生地',
  occupation: '职业',
  socialClass: '社会阶层',
  identityTags: '身份标签',
  heightBuild: '身高体型',
  iconicFeatures: '标志性特征',
  clothingStyle: '衣着风格',
  overallVibe: '整体气质',
  externalPersonality: '外在性格',
  internalPersonality: '内在性格',
  coreDesire: '核心欲望',
  fearWeakness: '恐惧与弱点',
  moralValues: '道德观念',
  quirk: '怪癖',
  skills: '技能专长',
  backgroundStory: '背景故事',
  relationships: '人际关系',
  speakingStyle: '说话方式',
  typicalReactions: '典型反应',
};

export interface StoryCharacterPromptSource {
  name: string;
  content: string;
}

export interface StoryPromptOptions {
  basePrompt: string;
  worldBookContent: string | null;
  characterCards: StoryCharacterPromptSource[];
  userInfo: Record<string, unknown>;
  dynamicRoleLoadingEnabled: boolean;
}

export interface StoryModelMessage {
  id?: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  thinkingBlocks?: ThinkingBlock[];
}

const filterBlankMarkdownFields = (content: string): string => {
  const lines = content.split('\n');
  const afterListFilter = lines.filter(line => !/^\s*-\s*\*\*[^*]+\*\*：\s*$/.test(line));
  const result: string[] = [];
  let i = 0;
  while (i < afterListFilter.length) {
    const line = afterListFilter[i];
    if (/^##\s/.test(line)) {
      let j = i + 1;
      while (j < afterListFilter.length && afterListFilter[j].trim() === '') {
        j++;
      }
      if (j >= afterListFilter.length || /^##\s/.test(afterListFilter[j]) || /^# /.test(afterListFilter[j])) {
        i = j;
        continue;
      }
    }
    result.push(line);
    i++;
  }
  return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

export function compileStorySystemPrompt({
  basePrompt,
  worldBookContent,
  characterCards,
  userInfo,
  dynamicRoleLoadingEnabled,
}: StoryPromptOptions): string {
  let prompt = basePrompt.trim();

  if (worldBookContent && worldBookContent.trim()) {
    prompt += `\n\n## 故事主世界背景设定\n请严格遵守以下世界背景设定展开叙事，不要脱离该设定范围：\n${filterBlankMarkdownFields(worldBookContent.trim())}`;
  }

  if (dynamicRoleLoadingEnabled) {
    if (characterCards.length > 0) {
      const roleNames = characterCards.map((card) => `- ${card.name}`).join('\n');
      prompt += `\n\n## 本局可动态调用角色\n以下角色可以通过 role_play 工具按角色名动态生成角色本人回复。需要某个角色以自身人格说话时，必须调用 role_play 工具并传入角色名：\n${roleNames}`;
      prompt += `\n\n## 故事参与活跃角色设定（背景NPC设定）\n以下是本次冒险中参与互动的活跃NPC角色设定。即使开启动态加载，你也必须理解这些角色的存在、关系和行动边界；当需要角色本人说话时，再调用 role_play：`;
      characterCards.forEach((card, index) => {
        prompt += `\n\n【NPC角色 ${index + 1}：${card.name}】\n${filterBlankMarkdownFields(card.content.trim())}`;
      });
    }
  } else if (characterCards.length > 0) {
    prompt += `\n\n## 故事参与活跃角色设定（背景NPC设定）\n以下是本次冒险中参与互动的活跃NPC角色设定，你扮演这些角色时，语气、言行举止与动作必须与人设高度一致：`;
    characterCards.forEach((card, index) => {
      prompt += `\n\n【NPC角色 ${index + 1}：${card.name}】\n${filterBlankMarkdownFields(card.content.trim())}`;
    });
  }

  const userFields = formatUserInfo(userInfo);
  if (userFields) {
    prompt += `\n\n## 我（用户）的角色人设设定\n这是用户所扮演的冒险主角人设设定，请记住此人设并以此决定NPC们对他的态度与互动反应：\n${userFields}`;
  }

  return prompt;
}

export function buildStoryModelMessages(messages: Message[]): StoryModelMessage[] {
  return messages.flatMap((message) => {
    if (message.role === 'user') {
      return [{ id: message.id, role: 'user' as const, content: message.content }];
    }
    return buildAssistantHistoryMessages(message);
  });
}

export function getStoryAllowedTools(dynamicRoleLoadingEnabled: boolean): string[] {
  return dynamicRoleLoadingEnabled ? ['role_play'] : [];
}

export function getRolePlayCharacterName(argumentsText?: string): string {
  if (!argumentsText) return '角色';
  try {
    const parsed = JSON.parse(argumentsText);
    const value = parsed.characterName ?? parsed.character_name;
    return typeof value === 'string' && value.trim() ? value.trim() : '角色';
  } catch {
    return '角色';
  }
}

function formatUserInfo(userInfo: Record<string, unknown>): string {
  return Object.entries(userInfo)
    .map(([key, value]) => {
      if (!USER_INFO_LABELS[key]) return null;
      if (typeof value === 'string' && value.trim() !== '') {
        return `- **${USER_INFO_LABELS[key]}**：${value.trim()}`;
      }
      if (Array.isArray(value) && value.length > 0) {
        return `- **${USER_INFO_LABELS[key]}**：${value.join('、')}`;
      }
      return null;
    })
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

function buildAssistantHistoryMessages(message: Message): StoryModelMessage[] {
  const tools = message.tools ?? [];
  const toolsById = new Map(tools.filter((tool) => tool.id).map((tool) => [tool.id!, tool]));
  const emittedToolIds = new Set<string>();
  const modelMessages: StoryModelMessage[] = [];
  const parts = message.content.split(/(\[\[TOOL:[^\]]+\]\])/);
  let assistantText = '';

  parts.forEach((part) => {
    const match = part.match(/^\[\[TOOL:([^\]]+)\]\]$/);
    if (!match) {
      assistantText += part;
      return;
    }

    const tool = toolsById.get(match[1]);
    if (!tool) return;

    modelMessages.push(buildAssistantToolCallMessage(assistantText, [tool], message.thinkingBlocks));
    modelMessages.push(buildToolResultMessage(tool));
    emittedToolIds.add(match[1]);
    assistantText = '';
  });

  const remainingTools = tools.filter((tool) => !tool.id || !emittedToolIds.has(tool.id));
  if (remainingTools.length > 0) {
    modelMessages.push(buildAssistantToolCallMessage(assistantText, remainingTools, message.thinkingBlocks));
    remainingTools.forEach((tool) => modelMessages.push(buildToolResultMessage(tool)));
    assistantText = '';
  }

  if (assistantText.trim()) {
    modelMessages.push({
      id: message.id,
      role: 'assistant',
      content: assistantText,
      thinkingBlocks: message.thinkingBlocks,
    });
  }

  return modelMessages;
}

function buildAssistantToolCallMessage(
  content: string,
  tools: AgentToolEntry[],
  thinkingBlocks?: ThinkingBlock[],
): StoryModelMessage {
  return {
    id: tools[0]?.id ? `assistant-tool-${tools[0].id}` : undefined,
    role: 'assistant',
    content,
    toolCalls: tools.map((tool, index) => ({
      id: tool.id || `tool-${index}`,
      name: tool.name,
      arguments: tool.arguments || '{}',
    })),
    thinkingBlocks,
  };
}

function buildToolResultMessage(tool: AgentToolEntry): StoryModelMessage {
  return {
    id: tool.id ? `tool-result-${tool.id}` : undefined,
    role: 'tool',
    content: tool.result,
    toolCallId: tool.id,
  };
}
