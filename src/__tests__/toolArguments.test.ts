import { describe, expect, it } from 'vitest';
import { sanitizeToolArguments } from '../utils/toolArguments';

describe('sanitizeToolArguments', () => {
  it('passes valid JSON through unchanged', () => {
    const valid = '{"file_path": "a.md", "content": "正文"}';
    expect(sanitizeToolArguments(valid)).toBe(valid);
    expect(sanitizeToolArguments('{}')).toBe('{}');
    expect(sanitizeToolArguments('[]')).toBe('[]');
  });

  it('trims surrounding whitespace and passes valid JSON through', () => {
    expect(sanitizeToolArguments('  {"a": 1}  ')).toBe('{"a": 1}');
  });

  it('falls back to empty object for empty input', () => {
    expect(sanitizeToolArguments('')).toBe('{}');
    expect(sanitizeToolArguments('   ')).toBe('{}');
  });

  it('falls back to empty object for garbage input', () => {
    expect(sanitizeToolArguments('不是JSON')).toBe('{}');
    expect(sanitizeToolArguments('{{{')).toBe('{}');
  });

  it('repairs truncated JSON by closing unclosed containers', () => {
    const repaired = sanitizeToolArguments('{"file_path": "a.md"');
    expect(JSON.parse(repaired)).toEqual({ file_path: 'a.md' });
  });

  it('repairs trailing commas', () => {
    const repaired = sanitizeToolArguments('{"a": 1, "b": 2,}');
    expect(JSON.parse(repaired)).toEqual({ a: 1, b: 2 });
  });

  it('strips code fences before repair', () => {
    const repaired = sanitizeToolArguments('```json\n{"file_path": "a.md"}\n```');
    expect(JSON.parse(repaired)).toEqual({ file_path: 'a.md' });
  });

  it('extracts a valid JSON slice embedded in surrounding text', () => {
    const repaired = sanitizeToolArguments('好的，参数是：{"file_path": "a.md"} 结束');
    expect(JSON.parse(repaired)).toEqual({ file_path: 'a.md' });
  });
});
