const VALID_SESSION_ID = /^[A-Za-z0-9_-]+$/;

export function createSessionId(prefix: 'partner-session' | 'story-session' | 'session') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ensureSessionId(id: unknown, prefix: 'partner-session' | 'story-session' | 'session') {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (trimmed.startsWith(`${prefix}-`) && VALID_SESSION_ID.test(trimmed)) {
    return trimmed;
  }
  return createSessionId(prefix);
}
