export type BackgroundExtractionMode = 'world_book_only' | 'character_cards_only' | 'world_book_and_character_cards';

export type CharacterExtractionStatus = 'pending' | 'running' | 'success' | 'failed';

export interface CharacterExtractionItem<T = unknown> {
  name: string;
  status: CharacterExtractionStatus;
  result?: T;
  error?: string;
  rawOutput?: string;
}

const BACKGROUND_CHARACTER_CONCURRENCY = 5;

export const splitCharacterNames = (value: string): string[] => {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of value.split(/[\n,，、；;]+/)) {
    const name = part.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
};

interface RunCharacterBatchOptions<T> {
  names?: string[];
  initialItems?: CharacterExtractionItem<T>[];
  worker: (name: string) => Promise<T>;
  concurrency?: number;
  onUpdate?: (items: CharacterExtractionItem<T>[]) => void;
  signal?: AbortSignal;
}

const backendErrorToString = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object') {
    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return String(error);
    }
  }
  return String(error);
};

export const parseBackgroundExtractionError = (error: unknown): { message: string; rawOutput?: string } => {
  const rawError = backendErrorToString(error);

  return {
    message: rawError,
    rawOutput: rawError,
  };
};

export const runCharacterExtractionBatch = async <T>({
  names,
  initialItems,
  worker,
  concurrency = BACKGROUND_CHARACTER_CONCURRENCY,
  onUpdate,
  signal,
}: RunCharacterBatchOptions<T>): Promise<CharacterExtractionItem<T>[]> => {
  const items: CharacterExtractionItem<T>[] = initialItems
    ? initialItems.map((item) => ({ ...item }))
    : (names || []).map((name) => ({ name, status: 'pending' }));

  const pendingIndices: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].status === 'pending') {
      pendingIndices.push(i);
    }
  }

  let nextPendingIndex = 0;
  let activeCount = 0;
  let resolved = false;
  let abortRequested = false;

  const notify = () => {
    if (!resolved) {
      onUpdate?.(items.map((item) => ({ ...item })));
    }
  };

  return new Promise((resolve) => {
    const resolveNow = () => {
      if (resolved) return;
      resolved = true;
      resolve(items.map((item) => ({ ...item })));
    };

    const tryResolve = () => {
      if (resolved) return;
      if (signal?.aborted) {
        if (!abortRequested) {
          abortRequested = true;
          items.forEach((item) => {
            if (item.status === 'running') {
              item.status = 'pending';
              delete item.error;
              delete item.rawOutput;
            }
          });
          notify();
        }
        if (activeCount === 0) {
          resolveNow();
        }
        return;
      }
      if (nextPendingIndex >= pendingIndices.length && activeCount === 0) {
        resolveNow();
      }
    };

    const runNext = async () => {
      if (resolved || signal?.aborted) {
        tryResolve();
        return;
      }

      const currentPendingIndex = nextPendingIndex;
      nextPendingIndex += 1;
      if (currentPendingIndex >= pendingIndices.length) {
        tryResolve();
        return;
      }

      const currentIndex = pendingIndices[currentPendingIndex];
      items[currentIndex] = { ...items[currentIndex], status: 'running' };
      notify();
      activeCount += 1;

      try {
        const result = await worker(items[currentIndex].name);
        if (!resolved) {
          if (signal?.aborted) {
            items[currentIndex] = { ...items[currentIndex], status: 'pending' };
          } else {
            items[currentIndex] = { ...items[currentIndex], status: 'success', result };
          }
          notify();
        }
      } catch (error) {
        if (!resolved) {
          if (signal?.aborted) {
            items[currentIndex] = { ...items[currentIndex], status: 'pending' };
          } else {
            const parsedError = parseBackgroundExtractionError(error);
            items[currentIndex] = {
              ...items[currentIndex],
              status: 'failed',
              error: parsedError.message,
              rawOutput: parsedError.rawOutput,
            };
          }
          notify();
        }
      }

      activeCount -= 1;
      if (abortRequested && activeCount === 0) {
        resolveNow();
      } else if (!resolved) {
        tryResolve();
        runNext();
      }
    };

    for (let i = 0; i < Math.min(concurrency, pendingIndices.length); i++) {
      runNext();
    }

    if (signal) {
      if (signal.aborted) {
        tryResolve();
      } else {
        signal.addEventListener('abort', () => {
          tryResolve();
        }, { once: true });
      }
    }
  });
};
