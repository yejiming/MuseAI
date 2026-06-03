import { StateStorage } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';

export function createDiskStorage(
  name: string,
  localStorageKey?: string
): StateStorage {
  return {
    getItem: async () => {
      try {
        const content = await invoke<string>('load_app_state', { name });
        return content;
      } catch {
        if (localStorageKey) {
          const oldData = localStorage.getItem(localStorageKey);
          if (oldData !== null) {
            try {
              await invoke('save_app_state', { name, content: oldData });
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
      await invoke('save_app_state', { name, content: value });
    },
    removeItem: async () => {
      // no-op: app state deletion is not exposed
    },
  };
}
