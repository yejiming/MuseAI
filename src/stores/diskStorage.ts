import { StateStorage } from 'zustand/middleware';
import { appInvoke } from '../utils/runtime';

export function createDiskStorage(
  name: string,
  localStorageKey?: string
): StateStorage {
  return {
    getItem: async () => {
      try {
        const content = await appInvoke<string>('load_app_state', { name });
        return content;
      } catch {
        if (localStorageKey) {
          const oldData = localStorage.getItem(localStorageKey);
          if (oldData !== null) {
            try {
              await appInvoke('save_app_state', { name, content: oldData });
              localStorage.removeItem(localStorageKey);
            } catch {
              // ignore save errors during migration
            }
            return oldData;
          }
        }
        return null;
      }
    },
    setItem: async (_, value) => {
      await appInvoke('save_app_state', { name, content: value });
    },
    removeItem: async () => {
      // no-op: app state deletion is not exposed
    },
  };
}
