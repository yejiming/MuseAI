import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AgentSessionRecord, AgentSessionSummary } from '../stores/useAgentStore';

interface ArchiveCharacterMemoryPayload {
  characterCardId: string;
  userRelationType: string;
  userInteractionModel: string;
  userRelationBottomLine: string;
  keyEvents: string;
}

interface ArchiveSessionPayload {
  title: string;
  userRelationType?: string;
  userInteractionModel?: string;
  userRelationBottomLine?: string;
  keyEvents?: string;
  characterMemories?: ArchiveCharacterMemoryPayload[];
}

type ChatCompletionRequest = Record<string, unknown> & {
  allowedTools?: string[];
};

type AgentSessionRecordResponse = AgentSessionRecord & {
  character_card_id?: string | null;
  character_card_ids?: string[] | null;
  selected_world_book_id?: string | null;
  context_compaction?: AgentSessionRecord['contextCompaction'];
  is_archived?: boolean;
  dynamic_role_loading_enabled?: boolean;
};

// Type-safe command definitions
export interface AppInvokeCommands {
  get_mobile_service_status: {
    args: void;
    result: { isRunning: boolean; url: string | null; token: string | null; error: string | null };
  };
  list_agent_sessions: {
    args: { prefix?: string; sessionKind?: string };
    result: AgentSessionSummary[];
  };
  load_agent_session: {
    args: { id: string };
    result: AgentSessionRecordResponse;
  };
  save_agent_session: {
    args: { session: AgentSessionRecord };
    result: AgentSessionSummary;
  };
  delete_agent_session: {
    args: { id: string };
    result: void;
  };
  update_agent_session_title: {
    args: { id: string; title: string };
    result: AgentSessionSummary;
  };
  summarize_text: {
    args: { request: { text: string } };
    result: string | { title: string };
  };
  analyze_character_memory: {
    args: { sessionId: string; characterCardId?: string | null };
    result: unknown;
  };
  archive_agent_session: {
    args: { sessionId: string; payload: ArchiveSessionPayload };
    result: void;
  };
  start_chat_completion_stream: {
    args: { request: ChatCompletionRequest };
    result: { runId: string };
  };
  stop_chat_stream: {
    args: { runId: string };
    result: void;
  };
  load_app_state: {
    args: { name: string };
    result: string;
  };
  save_app_state: {
    args: { name: string; content: string };
    result: void;
  };
  read_file: {
    args: { path: string };
    result: string;
  };
}

export type AppInvokeCommand = keyof AppInvokeCommands;

export const isTauriHost = (): boolean => {
  if (typeof window === 'undefined') return false;
  // If in vitest/jest test environment, default to desktop/tauri mock invoke
  if (
    typeof (globalThis as any).process !== 'undefined' &&
    ((globalThis as any).process.env?.NODE_ENV === 'test' || (globalThis as any).vi !== undefined)
  ) {
    if (!(globalThis as any).__TEST_MOBILE_BYPASS__) {
      return true;
    }
  }

  return (
    (window as any).__TAURI_INTERNALS__ !== undefined ||
    (window as any).__TAURI__ !== undefined ||
    (window as any).__TAURI_IPC__ !== undefined ||
    (typeof navigator !== 'undefined' && navigator.userAgent?.includes('Tauri'))
  );
};

export const isMobile = (): boolean => {
  if (typeof window === 'undefined') return false;
  // If in vitest/jest test environment, default to desktop layout
  if (
    typeof (globalThis as any).process !== 'undefined' &&
    ((globalThis as any).process.env?.NODE_ENV === 'test' || (globalThis as any).vi !== undefined)
  ) {
    if (!(globalThis as any).__TEST_MOBILE_BYPASS__) {
      return false;
    }
  }

  // isMobile is purely based on the actual device type (UA + screen size).
  // Token and port are for authentication/routing only, not device detection.

  // Check if user agent is a mobile device
  const ua = navigator.userAgent || '';
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  if (isMobileUA) {
    return true;
  }

  // Fallback: narrow screen (e.g. responsive browser resize)
  if (window.innerWidth > 0 && window.innerWidth < 768) {
    return true;
  }

  return false;
};

export const getMobileToken = (): string => {
  if (typeof window === 'undefined') return '';
  const token = new URLSearchParams(window.location.search).get('token');
  if (token) {
    localStorage.setItem('mobile_token', token);
    return token;
  }
  return localStorage.getItem('mobile_token') || '';
};

export const setMobileToken = (token: string): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('mobile_token', token);
  }
};

export const clearMobileToken = (): void => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('mobile_token');
    const params = new URLSearchParams(window.location.search);
    if (params.has('token')) {
      params.delete('token');
      const query = params.toString();
      const pathname = window.location.pathname || '/';
      const hash = window.location.hash || '';
      window.history.replaceState(null, '', `${pathname}${query ? `?${query}` : ''}${hash}`);
    }
  }
};

// Auto-extract and save token if present in URL
if (typeof window !== 'undefined') {
  const token = new URLSearchParams(window.location.search).get('token');
  if (token) {
    localStorage.setItem('mobile_token', token);
  }
}

export async function appInvoke<C extends AppInvokeCommand>(
  cmd: C,
  ...args: AppInvokeCommands[C]['args'] extends void ? [] : [AppInvokeCommands[C]['args']]
): Promise<AppInvokeCommands[C]['result']> {
  if (isTauriHost()) {
    // Type assertion needed because invoke doesn't know about our conditional args
    return invoke<AppInvokeCommands[C]['result']>(cmd, args[0] as any);
  }

  // Mobile HTTP mapping
  const token = getMobileToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Mobile-Token': token,
  };

  const getUrl = (path: string) => {
    // If running on mobile, we make requests to the same origin (host/port)
    return `${window.location.origin}${path}`;
  };

  const cmdArgs = args[0] as any;

  switch (cmd) {
    case 'get_mobile_service_status': {
      const res = await fetch(getUrl('/api/mobile/status'), { headers, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.json();
    }
    case 'list_agent_sessions': {
      const params = new URLSearchParams();
      if (cmdArgs?.prefix) params.set('prefix', cmdArgs.prefix);
      if (cmdArgs?.sessionKind) params.set('sessionKind', cmdArgs.sessionKind);
      const query = params.toString();
      const res = await fetch(getUrl(`/api/mobile/sessions${query ? `?${query}` : ''}`), { headers, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.json();
    }
    case 'load_agent_session': {
      const res = await fetch(getUrl(`/api/mobile/sessions/${cmdArgs.id}`), { headers, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.json();
    }
    case 'save_agent_session': {
      const res = await fetch(getUrl('/api/mobile/sessions'), {
        method: 'POST',
        headers,
        cache: 'no-store',
        body: JSON.stringify(cmdArgs.session),
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.json();
    }
    case 'delete_agent_session': {
      const res = await fetch(getUrl(`/api/mobile/sessions/${cmdArgs.id}`), {
        method: 'DELETE',
        headers,
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return undefined;
    }
    case 'update_agent_session_title': {
      const res = await fetch(getUrl(`/api/mobile/sessions/${cmdArgs.id}/title`), {
        method: 'PUT',
        headers,
        cache: 'no-store',
        body: JSON.stringify({ title: cmdArgs.title }),
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.json();
    }
    case 'summarize_text': {
      const res = await fetch(getUrl('/api/mobile/summarize'), {
        method: 'POST',
        headers,
        cache: 'no-store',
        body: JSON.stringify({ text: cmdArgs.request.text }),
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.json();
    }
    case 'analyze_character_memory': {
      // For memory analysis on mobile, we use the session ID from args to call the automated server-side endpoint.
      // Wait, args contains the 'request' parameter. How do we find the session ID?
      // On desktop, the request contains no session ID. But the store has the current session ID!
      // To keep it simple, we can pass `sessionId` inside our mobile invoke, or read it from args.
      // Let's check: can we pass `sessionId` as a field of args, e.g. invoke('analyze_character_memory', { request, sessionId })?
      // Yes! We will update Chat/Story to pass `sessionId` as well.
      const sessionId = cmdArgs.sessionId;
      if (!sessionId) {
        throw new Error('Missing sessionId for mobile memory analysis');
      }
      const res = await fetch(getUrl(`/api/mobile/sessions/${sessionId}/analyze-memory`), {
        method: 'POST',
        headers,
        cache: 'no-store',
        body: JSON.stringify({ characterCardId: cmdArgs.characterCardId ?? null }),
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.json();
    }
    case 'archive_agent_session': {
      // Special mobile-only cmd to archive session memory.
      const sessionId = cmdArgs.sessionId;
      const payload = cmdArgs.payload;
      if (!sessionId || !payload) {
        throw new Error('Missing sessionId or payload for mobile archiving');
      }
      const res = await fetch(getUrl(`/api/mobile/sessions/${sessionId}/archive`), {
        method: 'POST',
        headers,
        cache: 'no-store',
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return undefined;
    }
    case 'start_chat_completion_stream': {
      const isStory = cmdArgs.request?.allowedTools && cmdArgs.request.allowedTools.length > 0;
      const endpoint = isStory ? '/api/mobile/story/start' : '/api/mobile/chat/start';
      const res = await fetch(getUrl(endpoint), {
        method: 'POST',
        headers,
        cache: 'no-store',
        body: JSON.stringify(cmdArgs.request),
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.json();
    }
    case 'stop_chat_stream': {
      const res = await fetch(getUrl('/api/mobile/chat/stop'), {
        method: 'POST',
        headers,
        cache: 'no-store',
        body: JSON.stringify({ run_id: cmdArgs.runId }),
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return undefined;
    }
    case 'load_app_state': {
      const res = await fetch(getUrl(`/api/mobile/state/${cmdArgs.name}`), { headers, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.text();
    }
    case 'save_app_state': {
      const res = await fetch(getUrl(`/api/mobile/state/${cmdArgs.name}`), {
        method: 'POST',
        headers,
        cache: 'no-store',
        body: cmdArgs.content,
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return undefined;
    }
    default:
      throw new Error(`Command ${cmd} is not supported on mobile browser.`);
  }
}

export function listenStream(
  runId: string,
  onEvent: (event: { payload: any }) => void,
  onError?: (err: any) => void,
  onComplete?: () => void
): () => void {
  if (isTauriHost()) {
    let active = true;
    let unlisten: UnlistenFn | null = null;

    listen<any>('agent-chat-stream', (event) => {
      if (active) {
        onEvent({ payload: event.payload });
        if (event.payload?.eventType === 'done') {
          onComplete?.();
        } else if (event.payload?.eventType === 'error') {
          onError?.(event.payload?.message || 'Stream error');
        }
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      active = false;
      if (unlisten) {
        unlisten();
      }
    };
  }

  // Mobile SSE via fetch (allows custom headers for secure token transmission)
  const token = getMobileToken();
  const url = `${window.location.origin}/api/mobile/stream?runId=${encodeURIComponent(runId)}`;

  let aborted = false;
  const abortController = new AbortController();

  (async () => {
    try {
      const response = await fetch(url, {
        headers: {
          'X-Mobile-Token': token,
          'Accept': 'text/event-stream',
        },
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (reader && !aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const payload = JSON.parse(line.slice(6));
              onEvent({ payload });
              if (payload.eventType === 'done') {
                onComplete?.();
                aborted = true;
                break;
              } else if (payload.eventType === 'error') {
                onError?.(payload.message || 'Stream error');
                aborted = true;
                break;
              }
            } catch (err) {
              onError?.(err);
            }
          }
        }
      }
    } catch (err) {
      if (!aborted) {
        onError?.(err);
      }
    }
  })();

  return () => {
    aborted = true;
    abortController.abort();
  };
}
