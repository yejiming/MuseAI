/**
 * 工具调用参数清洗：保证发给模型的 toolCalls.arguments 一定是合法 JSON。
 * 解析成功原样返回；失败时做轻量修复（去围栏、去尾随逗号、补全未闭合的容器），
 * 仍失败则回退为 `{}`，避免把截断/损坏的参数原样回放进下一次请求。
 */
export function sanitizeToolArguments(argumentsStr: string): string {
  const trimmed = argumentsStr.trim();
  if (trimmed === '') {
    return '{}';
  }
  if (isValidJson(trimmed)) {
    return trimmed;
  }

  const withoutFences = stripJsonFences(trimmed);
  const withoutTrailingCommas = removeTrailingCommas(withoutFences);
  const closed = closeUnclosedContainers(withoutTrailingCommas);
  if (isValidJson(closed)) {
    return closed;
  }

  const firstBrace = closed.indexOf('{');
  const lastBrace = closed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const slice = closed.slice(firstBrace, lastBrace + 1);
    if (isValidJson(slice)) {
      return slice;
    }
  }

  return '{}';
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function stripJsonFences(text: string): string {
  let cleaned = text;
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice('```json'.length);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice('```'.length);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -'```'.length);
  }
  return cleaned.trim();
}

function removeTrailingCommas(text: string): string {
  let repaired = '';
  for (let i = 0; i < text.length; i += 1) {
    const current = text[i];
    if (current === ',') {
      let next = i + 1;
      while (next < text.length && /\s/.test(text[next])) {
        next += 1;
      }
      if (next < text.length && (text[next] === '}' || text[next] === ']')) {
        continue;
      }
    }
    repaired += current;
  }
  return repaired;
}

function closeUnclosedContainers(text: string): string {
  let repaired = text;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const current of text) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (current === '\\') {
        escaped = true;
      } else if (current === '"') {
        inString = false;
      }
      continue;
    }
    if (current === '"') {
      inString = true;
    } else if (current === '{') {
      stack.push('}');
    } else if (current === '[') {
      stack.push(']');
    } else if (current === '}' || current === ']') {
      if (stack[stack.length - 1] === current) {
        stack.pop();
      }
    }
  }
  while (stack.length > 0) {
    repaired += stack.pop();
  }
  return repaired;
}
