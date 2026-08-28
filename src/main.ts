import './style.css';
import { initOAuth, signIn, signOut, getAgent, getSession } from './oauth';
import {
  searchActorsTypeahead,
  fetchAllMutuals,
  findMutualsBlockingTarget,
  MutualProfile
} from './bsky';
import { AppBskyActorDefs } from '@atproto/api';

// Cached mutuals to avoid refetching on multiple searches
let cachedMutuals: MutualProfile[] | null = null;
let selectedTargetDid: string | null = null;

const SESSION_CACHE_KEY_PREFIX = 'bsky_mutuals_cache_';

function getCachedMutualsFromStorage(userDid: string): MutualProfile[] | null {
  try {
    const raw = sessionStorage.getItem(`${SESSION_CACHE_KEY_PREFIX}${userDid}`);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Error reading mutuals from sessionStorage', err);
  }
  return null;
}

function setCachedMutualsInStorage(userDid: string, mutuals: MutualProfile[]): void {
  try {
    sessionStorage.setItem(`${SESSION_CACHE_KEY_PREFIX}${userDid}`, JSON.stringify(mutuals));
  } catch (err) {
    console.error('Error saving mutuals to sessionStorage', err);
  }
}

function clearCachedMutualsStorage(): void {
  try {
    const keys = Object.keys(sessionStorage);
    for (const key of keys) {
      if (key.startsWith(SESSION_CACHE_KEY_PREFIX)) {
        sessionStorage.removeItem(key);
      }
    }
  } catch (err) {
    console.error('Error clearing mutuals from sessionStorage', err);
  }
}

// DOM Elements
const authSection = document.getElementById('auth-section')!;
const loginForm = document.getElementById('login-form') as HTMLFormElement;
const handleInput = document.getElementById('handle-input') as HTMLInputElement;

const appSection = document.getElementById('app-section')!;
const userProfileBadge = document.getElementById('user-profile-badge')!;
const logoutBtn = document.getElementById('logout-btn')!;

const targetInput = document.getElementById('target-input') as HTMLInputElement;
const suggestionsList = document.getElementById('suggestions-list')!;
const checkBtn = document.getElementById('check-btn') as HTMLButtonElement;

const statusContainer = document.getElementById('status-container')!;
const progressContainer = document.getElementById('progress-container')!;
const progressBar = document.getElementById('progress-bar') as HTMLProgressElement;
const resultsContainer = document.getElementById('results-container')!;

async function bootstrap() {
  try {
    const { session, agent } = await initOAuth();
    if (session && agent) {
      showAppView(session.sub);
    } else {
      showLoginView();
    }
  } catch (err) {
    console.error('OAuth Init Error:', err);
    showLoginView();
  }
}

function showLoginView() {
  authSection.classList.remove('hidden');
  appSection.classList.add('hidden');
}

async function showAppView(userDid: string) {
  authSection.classList.add('hidden');
  appSection.classList.remove('hidden');

  cachedMutuals = getCachedMutualsFromStorage(userDid);

  const agent = getAgent();
  try {
    const profile = await agent.getProfile({ actor: userDid });
    const avatarUrl = profile.data.avatar;
    const avatarImg = avatarUrl
      ? `<img src="${avatarUrl}" class="avatar-sm" alt="avatar" />`
      : `<div class="avatar-sm avatar-placeholder"></div>`;
    userProfileBadge.innerHTML = `
      ${avatarImg}
      <span>@${profile.data.handle}</span>
    `;
  } catch {
    userProfileBadge.textContent = userDid;
  }
}

// Sign-in handler
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const handle = handleInput.value.trim();
  if (!handle) return;

  try {
    handleInput.disabled = true;
    await signIn(handle);
  } catch (err: any) {
    alert(`Failed to start sign in: ${err.message}`);
    handleInput.disabled = false;
  }
});

// Logout handler
logoutBtn.addEventListener('click', async () => {
  await signOut();
  clearCachedMutualsStorage();
  cachedMutuals = null;
  selectedTargetDid = null;
  showLoginView();
});

// Autocomplete with Debounce
let debounceTimer: number | undefined;
targetInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  selectedTargetDid = null;
  const q = targetInput.value.trim();

  if (q.length < 2) {
    suggestionsList.classList.add('hidden');
    suggestionsList.innerHTML = '';
    return;
  }

  debounceTimer = window.setTimeout(async () => {
    try {
      const agent = getAgent();
      const actors = await searchActorsTypeahead(agent, q);
      renderSuggestions(actors);
    } catch (err) {
      console.error(err);
    }
  }, 250);
});

function renderSuggestions(actors: AppBskyActorDefs.ProfileViewBasic[]) {
  if (actors.length === 0) {
    suggestionsList.classList.add('hidden');
    suggestionsList.innerHTML = '';
    return;
  }

  suggestionsList.innerHTML = actors
    .map(
      (a) => {
        const avatarImg = a.avatar
          ? `<img src="${a.avatar}" class="avatar-xs" alt="avatar" />`
          : `<div class="avatar-xs avatar-placeholder"></div>`;
        return `
      <li data-did="${a.did}" data-handle="${a.handle}">
        ${avatarImg}
        <div class="suggestion-info">
          <span class="name">${escapeHtml(a.displayName || a.handle)}</span>
          <span class="handle">@${escapeHtml(a.handle)}</span>
        </div>
      </li>
    `;
      }
    )
    .join('');

  suggestionsList.classList.remove('hidden');

  suggestionsList.querySelectorAll('li').forEach((item) => {
    item.addEventListener('click', () => {
      selectedTargetDid = item.getAttribute('data-did');
      targetInput.value = item.getAttribute('data-handle') || '';
      suggestionsList.classList.add('hidden');
    });
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Run check
checkBtn.addEventListener('click', async () => {
  const agent = getAgent();
  const session = getSession();
  if (!session) return;

  let targetDid = selectedTargetDid;
  if (!targetDid) {
    const handleVal = targetInput.value.trim().replace(/^@/, '');
    if (!handleVal) {
      alert('Please enter a Bluesky username.');
      return;
    }
    try {
      statusContainer.textContent = 'Resolving handle...';
      progressContainer.classList.add('hidden');
      const resolved = await agent.resolveHandle({ handle: handleVal });
      targetDid = resolved.data.did;
    } catch {
      statusContainer.textContent = 'Could not resolve handle. Check spelling.';
      progressContainer.classList.add('hidden');
      return;
    }
  }

  resultsContainer.innerHTML = '';

  // 1. Fetch mutuals if not cached
  if (!cachedMutuals) {
    cachedMutuals = getCachedMutualsFromStorage(session.sub);
  }

  if (!cachedMutuals) {
    statusContainer.textContent = 'Fetching your mutuals list...';
    progressContainer.classList.add('hidden');
    cachedMutuals = await fetchAllMutuals(agent, session.sub, (count) => {
      statusContainer.textContent = `Fetching mutuals... (${count} found so far)`;
    });
    setCachedMutualsInStorage(session.sub, cachedMutuals);
  }

  if (cachedMutuals.length === 0) {
    statusContainer.textContent = 'You have no mutual followers on this account.';
    progressContainer.classList.add('hidden');
    return;
  }

  // 2. Scan mutuals for blocks against target
  statusContainer.textContent = `Checked 0 / ${cachedMutuals.length} mutuals...`;
  progressContainer.classList.remove('hidden');
  progressBar.max = cachedMutuals.length;
  progressBar.value = 0;

  checkBtn.disabled = true;

  try {
    const blockers = await findMutualsBlockingTarget(
      agent,
      targetDid,
      cachedMutuals,
      ({ scanned, total }) => {
        statusContainer.textContent = `Checked ${scanned} / ${total} mutuals...`;
        progressBar.max = total;
        progressBar.value = scanned;
      }
    );

    statusContainer.textContent = `Scan complete. Found ${blockers.length} mutual(s) blocking @${targetInput.value.trim().replace(/^@/, '')}.`;
    renderResults(blockers);
  } catch (err: any) {
    console.error('Scan Error:', err);
    statusContainer.textContent = `Error performing block check: ${err.message || err}`;
  } finally {
    checkBtn.disabled = false;
    progressContainer.classList.add('hidden');
  }
});

function renderResults(blockers: MutualProfile[]) {
  if (blockers.length === 0) {
    resultsContainer.innerHTML = `<p class="no-results">None of your mutuals block this account.</p>`;
    return;
  }

  resultsContainer.innerHTML = `
    <ul class="blocker-list">
      ${blockers
        .map((b) => {
          const profileUrl = `https://bsky.app/profile/${encodeURIComponent(b.handle)}`;
          const avatarImg = b.avatar
            ? `<img src="${b.avatar}" class="avatar-md" alt="${escapeHtml(b.handle)} avatar" />`
            : `<div class="avatar-md avatar-placeholder"></div>`;
          const displayName = escapeHtml(b.displayName || b.handle);
          const handle = escapeHtml(b.handle);

          return `
        <li class="blocker-card">
          <a href="${profileUrl}" target="_blank" rel="noopener noreferrer" class="avatar-link">
            ${avatarImg}
          </a>
          <div class="blocker-info">
            <a href="${profileUrl}" target="_blank" rel="noopener noreferrer" class="display-name">
              <strong>${displayName}</strong>
            </a>
            <a href="${profileUrl}" target="_blank" rel="noopener noreferrer" class="handle-link">@${handle}</a>
          </div>
          <span class="badge-block">Blocks Target</span>
        </li>
      `;
        })
        .join('')}
    </ul>
  `;
}

bootstrap();
