import { describe, expect, it } from 'vitest';
import { parseArchiveAnalysisResponse } from '../utils/archiveAnalysis';

describe('archive analysis response parser', () => {
  it('parses fenced json returned by memory analysis', () => {
    const parsed = parseArchiveAnalysisResponse(`\`\`\`json
{"sessionTitle":"归档标题","keyEvents":"共同完成一次对话"}
\`\`\``);

    expect(parsed.sessionTitle).toBe('归档标题');
    expect(parsed.keyEvents).toBe('共同完成一次对话');
  });

  it('accepts object responses', () => {
    const parsed = parseArchiveAnalysisResponse({ sessionTitle: '归档标题' });

    expect(parsed.sessionTitle).toBe('归档标题');
  });

  it('reports invalid json with a Chinese error', () => {
    expect(() => parseArchiveAnalysisResponse('{sessionTitle:"归档标题"}')).toThrow(
      '记忆分析结果不是合法 JSON，请重新分析'
    );
  });
});
