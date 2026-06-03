import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDiskStorage } from './diskStorage';

const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe('createDiskStorage', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getItem returns data from Tauri when file exists', async () => {
    mockInvoke.mockResolvedValueOnce('{"key":"value"}');
    const storage = createDiskStorage('test-store');

    const result = await storage.getItem('test-store');

    expect(mockInvoke).toHaveBeenCalledWith('load_app_state', { name: 'test-store' });
    expect(result).toBe('{"key":"value"}');
  });

  it('getItem migrates from localStorage when Tauri misses and localStorage has data', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('not found'));
    mockInvoke.mockResolvedValueOnce(undefined);
    localStorage.setItem('old-key', '{"migrated":true}');
    const storage = createDiskStorage('test-store', 'old-key');

    const result = await storage.getItem('test-store');

    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'load_app_state', { name: 'test-store' });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'save_app_state', {
      name: 'test-store',
      content: '{"migrated":true}',
    });
    expect(localStorage.getItem('old-key')).toBeNull();
    expect(result).toBe('{"migrated":true}');
  });

  it('getItem returns null when both Tauri and localStorage miss', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('not found'));
    const storage = createDiskStorage('test-store', 'old-key');

    const result = await storage.getItem('test-store');

    expect(result).toBeNull();
  });

  it('setItem saves data via Tauri command', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    const storage = createDiskStorage('test-store');

    await storage.setItem('test-store', '{"data":1}');

    expect(mockInvoke).toHaveBeenCalledWith('save_app_state', {
      name: 'test-store',
      content: '{"data":1}',
    });
  });

  it('getItem skips localStorage migration when no localStorageKey provided', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('not found'));
    localStorage.setItem('some-key', 'data');
    const storage = createDiskStorage('test-store');

    const result = await storage.getItem('test-store');

    expect(result).toBeNull();
    expect(localStorage.getItem('some-key')).toBe('data');
  });
});
