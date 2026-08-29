import { beforeEach, vi } from 'vitest';

export const mockIdbStore = new Map<string, any>();
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => mockIdbStore.get(key)),
  set: vi.fn(async (key: string, val: any) => { mockIdbStore.set(key, val); }),
  del: vi.fn(async (key: string) => { mockIdbStore.delete(key); }),
  clear: vi.fn(async () => { mockIdbStore.clear(); })
}));

const HTML_FIXTURE = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Bluesky Mutual Block Checker</title>
  </head>
  <body>
    <div id="app">
      <header>
        <h1>Bluesky Mutual Block Checker</h1>
      </header>

      <main>
        <!-- Logged Out View -->
        <section id="auth-section" class="card">
          <h2>Sign In</h2>
          <p>Log in with your Bluesky handle to scan your mutuals.</p>
          <form id="login-form">
            <input
              type="text"
              id="handle-input"
              placeholder="e.g. alice.bsky.social"
              required
            />
            <button type="submit">Log in with Bluesky</button>
          </form>
        </section>

        <!-- Logged In View -->
        <section id="app-section" class="card hidden">
          <div class="user-header">
            <div id="user-profile-badge"></div>
            <button id="logout-btn" class="btn-secondary">Sign Out</button>
          </div>

          <div class="search-box">
            <label for="target-input">Target Bluesky Account</label>
            <div class="input-wrapper">
              <input
                type="text"
                id="target-input"
                placeholder="Enter handle or search..."
                autocomplete="off"
              />
              <ul id="suggestions-list" class="suggestions-dropdown hidden"></ul>
            </div>
            <button id="check-btn">Check Mutual Blocks</button>
            <div class="divider-text">or</div>
            <button id="scan-mutuals-btn" class="btn-secondary">Find Top Blockers Among Mutuals</button>
          </div>

          <div id="status-container" class="status-msg"></div>
          <div id="progress-container" class="progress-container hidden" aria-hidden="true">
            <div class="progress-track">
              <div id="progress-bar-fill" class="progress-fill" style="width: 0%"></div>
            </div>
          </div>
          <div id="results-container"></div>
        </section>
      </main>
    </div>
  </body>
</html>
`;

export function setupDOM() {
  document.documentElement.innerHTML = HTML_FIXTURE;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mockIdbStore.clear();
  sessionStorage.clear();
  localStorage.clear();
  setupDOM();
});
