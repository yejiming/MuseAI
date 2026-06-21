import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// Stream event types
export interface StreamEventBase {
  eventType: string;
  message?: string;
  runId: string;
}

export interface StreamDeltaEvent extends StreamEventBase {
  eventType: 'delta';
  delta: string;
}

export interface StreamThinkingDeltaEvent extends StreamEventBase {
  eventType: 'thinking_delta';
  delta: string;
}

export interface StreamThinkingSignatureEvent extends StreamEventBase {
  eventType: 'thinking_signature';
  delta: string;
}

export interface StreamContextCompactedEvent extends StreamEventBase {
  eventType: 'context_compacted';
  contextCompaction: {
    summary: string;
    compactedThroughMessageId?: string | null;
    compactedThroughIndex: number;
    sourceMessageCount: number;
    updatedAt: number;
    originalMessageCount: number;
    compactedMessageCount: number;
    removedCount: number;
  };
}

export interface StreamTextEvent extends StreamEventBase {
  eventType: 'text';
  text: string;
}

export interface StreamToolStartEvent extends StreamEventBase {
  eventType: 'tool_start';
  toolCallId: string;
  toolName: string;
  toolArguments?: any;
}

export interface StreamToolDeltaEvent extends StreamEventBase {
  eventType: 'tool_delta';
  toolCallId: string;
  delta: string;
}

export interface StreamToolDoneEvent extends StreamEventBase {
  eventType: 'tool_done';
  toolCallId: string;
}

export interface StreamToolEvent extends StreamEventBase {
  eventType: 'tool_use' | 'tool_result';
  toolName?: string;
  toolInput?: any;
  toolResult?: any;
}

export interface StreamDoneEvent extends StreamEventBase {
  eventType: 'done';
}

export interface StreamErrorEvent extends StreamEventBase {
  eventType: 'error';
  message: string;
}

export type StreamEvent =
  | StreamDeltaEvent
  | StreamThinkingDeltaEvent
  | StreamThinkingSignatureEvent
  | StreamContextCompactedEvent
  | StreamTextEvent
  | StreamToolStartEvent
  | StreamToolDeltaEvent
  | StreamToolDoneEvent
  | StreamToolEvent
  | StreamDoneEvent
  | StreamErrorEvent;

export interface StreamEventWrapper {
  payload: StreamEvent;
}

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

export async function appInvoke<T>(cmd: string, args?: any): Promise<T> {
  if (isTauriHost()) {
    return invoke<T>(cmd, args);
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

  switch (cmd) {
    case 'get_mobile_service_status': {
      const res = await fetch(getUrl('/api/mobile/status'), { headers, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.json() as Promise<T>;
    }
    case 'list_agent_sessions': {
      const params = new URLSearchParams();
      if (args?.prefix) params.set('prefix', args.prefix);
      if (args?.sessionKind) params.set('sessionKind', args.sessionKind);
      const query = params.toString();
      const res = await fetch(getUrl(`/api/mobile/sessions${query ? `?${query}` : ''}`), { headers, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.json() as Promise<T>;
    }
    case 'load_agent_session': {
      const res = await fetch(getUrl(`/api/mobile/sessions/${args.id}`), { headers, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.json() as Promise<T>;
    }
    case 'save_agent_session': {
      const res = await fetch(getUrl('/api/mobile/sessions'), {
        method: 'POST',
        headers,
        cache: 'no-store',
        body: JSON.stringify(args.session),
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.json() as Promise<T>;
    }
    case 'delete_agent_session': {
      const res = await fetch(getUrl(`/api/mobile/sessions/${args.id}`), {
        method: 'DELETE',
        headers,
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return undefined as any;
    }
    case 'update_agent_session_title': {
      const res = await fetch(getUrl(`/api/mobile/sessions/${args.id}/title`), {
        method: 'PUT',
        headers,
        cache: 'no-store',
        body: JSON.stringify({ title: args.title }),
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.json() as Promise<T>;
    }
    case 'summarize_text': {
      const res = await fetch(getUrl('/api/mobile/summarize'), {
        method: 'POST',
        headers,
        cache: 'no-store',
        body: JSON.stringify({ text: args.request.text }),
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.json() as Promise<T>;
    }
    case 'analyze_character_memory': {
      // For memory analysis on mobile, we use the session ID from args to call the automated server-side endpoint.
      // Wait, args contains the 'request' parameter. How do we find the session ID?
      // On desktop, the request contains no session ID. But the store has the current session ID!
      // To keep it simple, we can pass `sessionId` inside our mobile invoke, or read it from args.
      // Let's check: can we pass `sessionId` as a field of args, e.g. invoke('analyze_character_memory', { request, sessionId })?
      // Yes! We will update Chat/Story to pass `sessionId` as well.
      const sessionId = args?.sessionId;
      if (!sessionId) {
        throw new Error('Missing sessionId for mobile memory analysis');
      }
      const res = await fetch(getUrl(`/api/mobile/sessions/${sessionId}/analyze-memory`), {
        method: 'POST',
        headers,
        cache: 'no-store',
        body: JSON.stringify({ characterCardId: args?.characterCardId ?? null }),
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.json() as Promise<T>;
    }
    case 'archive_agent_session': {
      // Special mobile-only cmd to archive session memory.
      const sessionId = args?.sessionId;
      const payload = args?.payload;
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
      return undefined as any;
    }
    case 'start_chat_completion_stream': {
      const isStory = args?.request?.allowedTools && args.request.allowedTools.length > 0;
      const endpoint = isStory ? '/api/mobile/story/start' : '/api/mobile/chat/start';
      const res = await fetch(getUrl(endpoint), {
        method: 'POST',
        headers,
        cache: 'no-store',
        body: JSON.stringify(args.request),
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return res.json() as Promise<T>;
    }
    case 'stop_chat_stream': {
      const res = await fetch(getUrl('/api/mobile/chat/stop'), {
        method: 'POST',
        headers,
        cache: 'no-store',
        body: JSON.stringify({ run_id: args.runId }),
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return undefined as any;
    }
    case 'load_app_state': {
      const res = await fetch(getUrl(`/api/mobile/state/${args.name}`), { headers, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const text = await res.text();
      return text as unknown as T;
    }
    case 'save_app_state': {
      const res = await fetch(getUrl(`/api/mobile/state/${args.name}`), {
        method: 'POST',
        headers,
        cache: 'no-store',
        body: args.content,
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return undefined as any;
    }
    default:
      throw new Error(`Command ${cmd} is not supported on mobile browser.`);
  }
}

export function listenStream(
  runId: string,
  onEvent: (event: StreamEventWrapper) => void,
  onError?: (err: any) => void,
  onComplete?: () => void
): () => void {
  if (isTauriHost()) {
    let active = true;
    let unlisten: UnlistenFn | null = null;

    listen<StreamEvent>('agent-chat-stream', (event) => {
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

  // Mobile SSE
  const token = getMobileToken();
  const url = `${window.location.origin}/api/mobile/stream?runId=${encodeURIComponent(runId)}&token=${encodeURIComponent(token)}`;
  const eventSource = new EventSource(url);

  eventSource.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as StreamEvent;
      onEvent({ payload });
      if (payload.eventType === 'done') {
        onComplete?.();
        eventSource.close();
      } else if (payload.eventType === 'error') {
        onError?.(payload.message || 'Stream error');
        eventSource.close();
      }
    } catch (err) {
      onError?.(err);
    }
  };

  eventSource.onerror = (err) => {
    onError?.(err);
    eventSource.close();
  };

  return () => {
    eventSource.close();
  };
}
