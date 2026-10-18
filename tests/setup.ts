import { beforeEach, vi } from 'vitest';

export const mockIdbStore = new Map<IDBValidKey, any>();
vi.mock('idb-keyval', () => ({
  keys: vi.fn(async () => [...mockIdbStore.keys()]),
  get: vi.fn(async (key: string) => mockIdbStore.get(key)),
  set: vi.fn(async (key: string, val: any) => { mockIdbStore.set(key, val); }),
  del: vi.fn(async (key: string) => { mockIdbStore.delete(key); }),
  clear: vi.fn(async () => { mockIdbStore.clear(); })
}));

import { readFileSync } from 'node:fs';
const HTML_FIXTURE = readFileSync('index.html', 'utf8');

export function setupDOM() {
  document.documentElement.innerHTML = HTML_FIXTURE;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mockIdbStore.clear();
  sessionStorage.clear();
  window.localStorage?.clear();
  setupDOM();
});
