import { describe, expect, it } from 'vitest';
import { buildStoryModelMessages } from '../pages/storyAgent';
import type { Message } from '../stores/useAgentStore';

function agentMessageWithTools(tools: Message['tools']): Message {
  return {
    id: 'agent-1',
    role: 'agent',
    content: '先看一下文件。\n\n[[TOOL:call_1]]\n\n写好了。',
    thinkingBlocks: [],
    tools,
  };
}

describe('buildStoryModelMessages tool argument sanitization', () => {
  it('passes valid tool arguments through unchanged', () => {
    const messages = buildStoryModelMessages([
      agentMessageWithTools([
        {
          id: 'call_1',
          name: 'read',
          result: '文件内容',
          status: 'success',
          arguments: '{"file_path": "a.md"}',
        },
      ]),
    ]);

    const toolCall = messages.find((m) => m.toolCalls?.length)?.toolCalls?.[0];
    expect(toolCall?.arguments).toBe('{"file_path": "a.md"}');
  });

  it('repairs truncated stored tool arguments into valid JSON', () => {
    const messages = buildStoryModelMessages([
      agentMessageWithTools([
        {
          id: 'call_1',
          name: 'read',
          result: '文件内容',
          status: 'success',
          arguments: '{"file_path": "a.md"',
        },
      ]),
    ]);

    const toolCall = messages.find((m) => m.toolCalls?.length)?.toolCalls?.[0];
    expect(toolCall?.arguments).toBeDefined();
    expect(JSON.parse(toolCall!.arguments)).toEqual({ file_path: 'a.md' });
  });

  it('falls back to empty object for garbage stored tool arguments', () => {
    const messages = buildStoryModelMessages([
      agentMessageWithTools([
        {
          id: 'call_1',
          name: 'read',
          result: '文件内容',
          status: 'success',
          arguments: '坏参数坏参数',
        },
      ]),
    ]);

    const toolCall = messages.find((m) => m.toolCalls?.length)?.toolCalls?.[0];
    expect(toolCall?.arguments).toBe('{}');
  });

  it('falls back to empty object when arguments are missing', () => {
    const messages = buildStoryModelMessages([
      agentMessageWithTools([
        {
          id: 'call_1',
          name: 'read',
          result: '文件内容',
          status: 'success',
          arguments: '',
        },
      ]),
    ]);

    const toolCall = messages.find((m) => m.toolCalls?.length)?.toolCalls?.[0];
    expect(toolCall?.arguments).toBe('{}');
  });
});
