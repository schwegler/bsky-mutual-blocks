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

  const agent = getAgent();
  try {
    const profile = await agent.getProfile({ actor: userDid });
    userProfileBadge.innerHTML = `
      <img src="${profile.data.avatar || ''}" class="avatar-sm" alt="avatar" />
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
      (a) => `
      <li data-did="${a.did}" data-handle="${a.handle}">
        <img src="${a.avatar || ''}" class="avatar-xs" />
        <div class="suggestion-info">
          <span class="name">${a.displayName || a.handle}</span>
          <span class="handle">@${a.handle}</span>
        </div>
      </li>
    `
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
      const resolved = await agent.resolveHandle({ handle: handleVal });
      targetDid = resolved.data.did;
    } catch {
      statusContainer.textContent = 'Could not resolve handle. Check spelling.';
      return;
    }
  }

  resultsContainer.innerHTML = '';

  // 1. Fetch mutuals if not cached
  if (!cachedMutuals) {
    statusContainer.textContent = 'Fetching your mutuals list...';
    cachedMutuals = await fetchAllMutuals(agent, session.sub, (count) => {
      statusContainer.textContent = `Found ${count} mutuals so far...`;
    });
  }

  if (cachedMutuals.length === 0) {
    statusContainer.textContent = 'You have no mutual followers on this account.';
    return;
  }

  // 2. Scan mutuals for blocks against target
  statusContainer.textContent = `Checking ${cachedMutuals.length} mutuals for blocks...`;
  const blockers = await findMutualsBlockingTarget(
    agent,
    targetDid,
    cachedMutuals,
    ({ scanned, total }) => {
      statusContainer.textContent = `Scanning: ${scanned} / ${total} mutuals evaluated...`;
    }
  );

  statusContainer.textContent = `Scan complete. Found ${blockers.length} mutual(s) blocking @${targetInput.value.trim().replace(/^@/, '')}.`;

  renderResults(blockers);
});

function renderResults(blockers: MutualProfile[]) {
  if (blockers.length === 0) {
    resultsContainer.innerHTML = `<p class="no-results">None of your mutuals block this account.</p>`;
    return;
  }

  resultsContainer.innerHTML = `
    <ul class="blocker-list">
      ${blockers
        .map(
          (b) => `
        <li class="blocker-card">
          <img src="${b.avatar || ''}" class="avatar-md" />
          <div class="blocker-info">
            <strong>${b.displayName || b.handle}</strong>
            <a href="https://bsky.app/profile/${b.handle}" target="_blank" rel="noreferrer">@${b.handle}</a>
          </div>
          <span class="badge-block">Blocks Target</span>
        </li>
      `
        )
        .join('')}
    </ul>
  `;
}

bootstrap();
