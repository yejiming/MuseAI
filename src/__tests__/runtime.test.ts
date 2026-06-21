import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  appInvoke,
  clearMobileToken,
  getMobileToken,
  isMobile,
  listenStream,
  setMobileToken,
} from '../utils/runtime';

describe('Runtime Utility & Bridge', () => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = (globalThis as any).EventSource;

  beforeEach(() => {
    (globalThis as any).__TEST_MOBILE_BYPASS__ = true;
    localStorage.clear();
    // Setup clean window location
    delete (window as any).__TAURI_INTERNALS__;
    delete (window as any).__TAURI__;
    delete (window as any).__TAURI_IPC__;
    
    // Define a basic window location mock
    const location = {
      search: '',
      origin: 'http://localhost:3000',
    };
    Object.defineProperty(window, 'location', {
      value: location,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    (globalThis as any).__TEST_MOBILE_BYPASS__ = false;
    globalThis.fetch = originalFetch;
    (globalThis as any).EventSource = originalEventSource;
    delete (window as any).__TAURI_IPC__;
  });

  describe('isMobile detection', () => {
    it('detects desktop when tauri globals are present', () => {
      (window as any).__TAURI_IPC__ = () => {};
      expect(isMobile()).toBe(false);
    });

    it('detects desktop layout on PC browsers even when tauri globals are absent', () => {
      expect(isMobile()).toBe(false);
    });

    it('detects mobile layout on mobile devices when tauri globals are absent', () => {
      Object.defineProperty(navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15',
        configurable: true,
        writable: true,
      });
      expect(isMobile()).toBe(true);
    });

    it('detects mobile even with tauri globals if token query param is present', () => {
      (window as any).__TAURI_IPC__ = () => {};
      window.location.search = '?token=abcd';
      expect(isMobile()).toBe(true);
    });
  });

  describe('getMobileToken', () => {
    it('extracts token from URL search parameters and stores it in localStorage', () => {
      window.location.search = '?token=my-secret-token-123';
      const token = getMobileToken();
      expect(token).toBe('my-secret-token-123');
      expect(localStorage.getItem('mobile_token')).toBe('my-secret-token-123');
    });

    it('reads token from localStorage when not present in URL', () => {
      window.location.search = '';
      localStorage.setItem('mobile_token', 'local-token-val');
      const token = getMobileToken();
      expect(token).toBe('local-token-val');
    });

    it('sets and clears the stored token', () => {
      setMobileToken('manual-token');
      expect(localStorage.getItem('mobile_token')).toBe('manual-token');

      clearMobileToken();
      expect(localStorage.getItem('mobile_token')).toBeNull();
    });

    it('removes an invalid token from the current URL when clearing it', () => {
      window.location.search = '?token=expired-token&source=mobile';
      const replaceState = vi.spyOn(window.history, 'replaceState');

      clearMobileToken();

      expect(replaceState).toHaveBeenCalledWith(null, '', '/?source=mobile');
    });
  });

  describe('appInvoke HTTP Adapter (Mobile mode)', () => {
    beforeEach(() => {
      localStorage.setItem('mobile_token', 'secret-token');
    });

    it('calls GET /api/mobile/status for get_mobile_service_status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ isRunning: true }),
      });
      globalThis.fetch = mockFetch;

      const result = await appInvoke<any>('get_mobile_service_status');
      expect(result.isRunning).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/mobile/status', {
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-Mobile-Token': 'secret-token',
        },
      });
    });

    it('calls GET /api/mobile/sessions?prefix=... for list_agent_sessions', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      });
      globalThis.fetch = mockFetch;

      const result = await appInvoke<any>('list_agent_sessions', { prefix: 'partner-session-' });
      expect(result).toEqual([]);
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/mobile/sessions?prefix=partner-session-', {
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-Mobile-Token': 'secret-token',
        },
      });
    });

    it('adds the session kind filter when listing mobile story sessions', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      });
      globalThis.fetch = mockFetch;

      await appInvoke<any>('list_agent_sessions', {
        prefix: 'story-session-',
        sessionKind: 'story',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/mobile/sessions?prefix=story-session-&sessionKind=story',
        expect.anything(),
      );
    });

    it('calls POST /api/mobile/sessions with raw session object for save_agent_session', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 's1' }),
      });
      globalThis.fetch = mockFetch;

      const sessionObj = { id: 's1', title: 'test session' };
      const result = await appInvoke<any>('save_agent_session', { session: sessionObj });
      expect(result.id).toBe('s1');
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/mobile/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Mobile-Token': 'secret-token',
        },
        cache: 'no-store',
        body: JSON.stringify(sessionObj),
      });
    });

    it('preserves camelCase session fields when saving mobile sessions', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'partner-session-1' }),
      });
      globalThis.fetch = mockFetch;

      const sessionObj = {
        id: 'partner-session-1',
        title: '新聊天',
        savedAt: 123,
        messages: [],
        selectedReferenceFiles: [],
        selectedOutlineFile: null,
        todos: [],
        contextCompaction: null,
        isArchived: false,
        characterCardId: 'card-1',
        selectedWorldBookId: null,
      };
      await appInvoke<any>('save_agent_session', { session: sessionObj });

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/mobile/sessions', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(sessionObj),
      }));
    });

    it('calls POST /api/mobile/chat/start for start_chat_completion_stream in chat mode', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ runId: 'run-123' }),
      });
      globalThis.fetch = mockFetch;

      const reqBody = { messages: [] };
      const result = await appInvoke<any>('start_chat_completion_stream', { request: reqBody });
      expect(result.runId).toBe('run-123');
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/api/mobile/chat/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Mobile-Token': 'secret-token',
        },
        cache: 'no-store',
        body: JSON.stringify(reqBody),
      });
    });
  });

  describe('listenStream (Mobile mode)', () => {
    it('instantiates EventSource and registers message callbacks', () => {
      localStorage.setItem('mobile_token', 'secret-token');

      const mockClose = vi.fn();
      let lastUrl = '';
      let sseInstance: any = null;

      class MockEventSource {
        url: string;
        onmessage: ((e: any) => void) | null = null;
        onerror: ((e: any) => void) | null = null;
        close = mockClose;
        constructor(url: string) {
          this.url = url;
          lastUrl = url;
          sseInstance = this;
        }
      }
      (globalThis as any).EventSource = MockEventSource;

      const onEvent = vi.fn();
      const onComplete = vi.fn();
      const onError = vi.fn();

      const unsubscribe = listenStream('run-abc', onEvent, onError, onComplete);

      expect(unsubscribe).toBeTypeOf('function');
      expect(lastUrl).toContain('/api/mobile/stream?runId=run-abc&token=secret-token');
      expect(sseInstance).not.toBeNull();

      // Simulate stream message
      if (sseInstance.onmessage) {
        sseInstance.onmessage({
          data: JSON.stringify({ runId: 'run-abc', eventType: 'delta', delta: 'hello' }),
        });
      }
      expect(onEvent).toHaveBeenCalledWith({
        payload: { runId: 'run-abc', eventType: 'delta', delta: 'hello' },
      });

      // Simulate stream completion
      if (sseInstance.onmessage) {
        sseInstance.onmessage({
          data: JSON.stringify({ runId: 'run-abc', eventType: 'done' }),
        });
      }
      expect(onComplete).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
    });
  });
});
