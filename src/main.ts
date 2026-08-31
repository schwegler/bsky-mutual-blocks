import './style.css';
import { initOAuth, signIn, signOut, getAgent, getSession } from './oauth';
import {
  searchActorsTypeahead,
  fetchAllMutuals,
  findMutualsBlockingTarget,
  findTopBlockersAmongMutuals,
  findTopBlockedAmongMutuals,
  resolveActor,
  MutualProfile,
  MutualBlockerSummary,
  MutualBlockedSummary,
  MootScanError,
  getErrorReasonMessage
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
const scanMutualsBtn = document.getElementById('scan-mutuals-btn') as HTMLButtonElement;
const scanTopBlockedBtn = document.getElementById('scan-top-blocked-btn') as HTMLButtonElement;

const statusContainer = document.getElementById('status-container')!;
const progressContainer = document.getElementById('progress-container')!;
const progressFill = document.getElementById('progress-bar-fill') as HTMLDivElement;
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
      /* v8 ignore start */
      targetInput.value = item.getAttribute('data-handle') || '';
      /* v8 ignore stop */
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

function renderScanWarningElement(
  incompleteMoots: MootScanError[],
  onRetry?: () => Promise<void>
): HTMLElement | null {


  /* v8 ignore start */
  if (!incompleteMoots || incompleteMoots.length === 0) return null;
  /* v8 ignore stop */

  const card = document.createElement('div');
  card.className = 'scan-warning-card';
  card.id = 'scan-warning-card';

  const count = incompleteMoots.length;
  card.innerHTML = `
    <div class="warning-header">
      <div class="warning-title-wrap">
        <span>⚠️</span>
        <span>${count} moot${count === 1 ? '' : 's'} could not be fully checked (rate limit or offline server)</span>
      </div>
      <div class="warning-actions">
        <button type="button" class="btn-warning-action" id="toggle-warning-details-btn">
          View Details &#9660;
        </button>
        ${onRetry ? `<button type="button" class="btn-warning-action" id="retry-incomplete-btn">🔄 Retry (${count})</button>` : ''}
      </div>
    </div>
    <div class="incomplete-moots-container hidden" id="incomplete-moots-container">
      <ul class="incomplete-moots-list">
        ${incompleteMoots
          .map((item) => {
            const handle = escapeHtml(item.moot.handle);
            const reasonMsg = escapeHtml(getErrorReasonMessage(item.reason));
            const partialText = item.partialCount > 0 ? ` (${item.partialCount} blocks scanned)` : '';
            return `
              <li class="incomplete-moot-item">
                <div class="incomplete-moot-info">
                  <a href="https://bsky.app/profile/${encodeURIComponent(item.moot.handle)}" target="_blank" rel="noopener noreferrer" class="handle-link">
                    @${handle}
                  </a>
                </div>
                <span class="reason-badge">${reasonMsg}${partialText}</span>
              </li>
            `;
          })
          .join('')}
      </ul>
    </div>
  `;

  const toggleBtn = card.querySelector('#toggle-warning-details-btn') as HTMLButtonElement;
  const container = card.querySelector('#incomplete-moots-container') as HTMLElement;
  toggleBtn?.addEventListener('click', () => {
    const isHidden = container.classList.contains('hidden');
    if (isHidden) {
      container.classList.remove('hidden');
      toggleBtn.innerHTML = 'Hide Details &#9650;';
    } else {
      container.classList.add('hidden');
      toggleBtn.innerHTML = 'View Details &#9660;';
    }
  });

  const retryBtn = card.querySelector('#retry-incomplete-btn') as HTMLButtonElement;
  if (retryBtn) {
    retryBtn.addEventListener('click', async () => {
      retryBtn.disabled = true;
      retryBtn.textContent = 'Retrying...';
      try {
        await onRetry();
      } catch (err: any) {
        console.error('Retry error:', err);
        retryBtn.disabled = false;
        retryBtn.textContent = `🔄 Retry (${count})`;
      }
    });
  }

  return card;
}

// Run check
checkBtn.addEventListener('click', async () => {
  const agent = getAgent();
  const session = getSession();
  if (!session) return;

  let targetDid = selectedTargetDid;
  const inputVal = targetInput.value.trim().replace(/^@/, '');
  if (!targetDid && !inputVal) {
    alert('Please enter a Bluesky username.');
    return;
  }

  if (!targetDid && inputVal) {
    try {
      statusContainer.textContent = 'Resolving handle...';
      progressContainer.classList.add('hidden');
      const resolved = await resolveActor(agent, inputVal);
      targetDid = resolved.did;
    } catch {
      statusContainer.textContent = 'Could not resolve handle. Check spelling.';
      progressContainer.classList.add('hidden');
      return;
    }
  }

  const finalTargetDid: string = targetDid!;

  resultsContainer.innerHTML = '';

  // 1. Fetch mutuals if not cached
  if (!cachedMutuals) {
    cachedMutuals = getCachedMutualsFromStorage(session.sub);
  }

  if (!cachedMutuals) {
    statusContainer.textContent = 'Fetching your moots list...';
    progressContainer.classList.add('hidden');
    cachedMutuals = await fetchAllMutuals(agent, session.sub, (count) => {
      statusContainer.textContent = `Fetching moots... (${count} found so far)`;
    });
    setCachedMutualsInStorage(session.sub, cachedMutuals);
  }

  if (cachedMutuals.length === 0) {
    statusContainer.textContent = 'You have no mutual followers (moots) on this account.';
    progressContainer.classList.add('hidden');
    return;
  }

  // 2. Scan mutuals for blocks against target
  statusContainer.textContent = `Checked 0 / ${cachedMutuals.length} moots...`;
  progressContainer.classList.remove('hidden');
  progressContainer.setAttribute('aria-busy', 'true');
  progressFill.style.width = '0%';

  checkBtn.disabled = true;
  scanMutualsBtn.disabled = true;
  scanTopBlockedBtn.disabled = true;

  try {
    const { blockingMutuals, incompleteMoots } = await findMutualsBlockingTarget(
      agent,
      finalTargetDid,
      cachedMutuals,
      ({ scanned, total }) => {
        statusContainer.textContent = `Checked ${scanned} / ${total} moots...`;
        const pct = Math.round((scanned / total) * 100);
        progressFill.style.width = `${pct}%`;
      }
    );

    statusContainer.textContent = `Scan complete. Found ${blockingMutuals.length} moot(s) blocking @${targetInput.value.trim().replace(/^@/, '')}.`;
    
    const handleRetry = async () => {
      const retryMoots = incompleteMoots.map((im) => im.moot);
      const retryResult = await findMutualsBlockingTarget(agent, finalTargetDid, retryMoots);
      const combined = [...blockingMutuals];
      for (const b of retryResult.blockingMutuals) {
        if (!combined.some((cb) => cb.did === b.did)) {
          combined.push(b);
        }
      }
      renderResults(combined, retryResult.incompleteMoots);
    };

    renderResults(blockingMutuals, incompleteMoots, incompleteMoots.length > 0 ? handleRetry : undefined);
  } catch (err: any) {
    console.error('Scan Error:', err);
    statusContainer.textContent = `Error performing block check: ${err.message || err}`;
  } finally {
    progressContainer.classList.add('hidden');
    progressContainer.setAttribute('aria-busy', 'false');
    checkBtn.disabled = false;
    scanMutualsBtn.disabled = false;
    scanTopBlockedBtn.disabled = false;
  }
});

// Run top blockers among mutuals scan
scanMutualsBtn.addEventListener('click', async () => {
  const agent = getAgent();
  const session = getSession();
  if (!session) return;

  resultsContainer.innerHTML = '';

  if (!cachedMutuals) {
    cachedMutuals = getCachedMutualsFromStorage(session.sub);
  }

  if (!cachedMutuals) {
    statusContainer.textContent = 'Fetching your moots list...';
    progressContainer.classList.add('hidden');
    cachedMutuals = await fetchAllMutuals(agent, session.sub, (count) => {
      statusContainer.textContent = `Fetching moots... (${count} found so far)`;
    });
    setCachedMutualsInStorage(session.sub, cachedMutuals);
  }

  if (cachedMutuals.length === 0) {
    statusContainer.textContent = 'You have no mutual followers (moots) on this account.';
    progressContainer.classList.add('hidden');
    return;
  }

  statusContainer.textContent = `Scanning relationships for 0 / ${cachedMutuals.length} moots...`;
  progressContainer.classList.remove('hidden');
  progressContainer.setAttribute('aria-busy', 'true');
  progressFill.style.width = '0%';

  checkBtn.disabled = true;
  scanMutualsBtn.disabled = true;
  scanTopBlockedBtn.disabled = true;

  try {
    const { summaries, incompleteMoots } = await findTopBlockersAmongMutuals(
      agent,
      cachedMutuals,
      ({ scanned, total }) => {
        statusContainer.textContent = `Scanning relationships for ${scanned} / ${total} moots...`;
        const pct = Math.round((scanned / total) * 100);
        progressFill.style.width = `${pct}%`;
      }
    );

    statusContainer.textContent = `Scan complete. Found ${summaries.length} moot(s) blocking other moots.`;

    const handleRetry = async () => {
      const retryResult = await findTopBlockersAmongMutuals(agent, cachedMutuals!);
      renderMutualBlockersResults(retryResult.summaries, retryResult.incompleteMoots);
    };

    renderMutualBlockersResults(summaries, incompleteMoots, incompleteMoots.length > 0 ? handleRetry : undefined);
  } catch (err: any) {
    console.error('Mutual Scan Error:', err);
    statusContainer.textContent = `Error: ${err.message || String(err)}`;
  } finally {
    progressContainer.classList.add('hidden');
    progressContainer.setAttribute('aria-busy', 'false');
    checkBtn.disabled = false;
    scanMutualsBtn.disabled = false;
    scanTopBlockedBtn.disabled = false;
  }
});

// Run top blocked among mutuals scan
scanTopBlockedBtn.addEventListener('click', async () => {
  const agent = getAgent();
  const session = getSession();
  if (!session) return;

  resultsContainer.innerHTML = '';

  if (!cachedMutuals) {
    cachedMutuals = getCachedMutualsFromStorage(session.sub);
  }

  if (!cachedMutuals) {
    statusContainer.textContent = 'Fetching your moots list...';
    progressContainer.classList.add('hidden');
    cachedMutuals = await fetchAllMutuals(agent, session.sub, (count) => {
      statusContainer.textContent = `Fetching moots... (${count} found so far)`;
    });
    setCachedMutualsInStorage(session.sub, cachedMutuals);
  }

  if (cachedMutuals.length === 0) {
    statusContainer.textContent = 'You have no mutual followers (moots) on this account.';
    progressContainer.classList.add('hidden');
    return;
  }

  statusContainer.textContent = `Scanning relationships for 0 / ${cachedMutuals.length} moots...`;
  progressContainer.classList.remove('hidden');
  progressContainer.setAttribute('aria-busy', 'true');
  progressFill.style.width = '0%';

  checkBtn.disabled = true;
  scanMutualsBtn.disabled = true;
  scanTopBlockedBtn.disabled = true;

  try {
    const { summaries, incompleteMoots } = await findTopBlockedAmongMutuals(
      agent,
      cachedMutuals,
      ({ scanned, total }) => {
        statusContainer.textContent = `Scanning relationships for ${scanned} / ${total} moots...`;
        const pct = Math.round((scanned / total) * 100);
        progressFill.style.width = `${pct}%`;
      }
    );

    statusContainer.textContent = `Scan complete. Found ${summaries.length} moot(s) blocked by other moots.`;

    const handleRetry = async () => {
      const retryResult = await findTopBlockedAmongMutuals(agent, cachedMutuals!);
      renderTopBlockedResults(retryResult.summaries, retryResult.incompleteMoots);
    };

    renderTopBlockedResults(summaries, incompleteMoots, incompleteMoots.length > 0 ? handleRetry : undefined);
  } catch (err: any) {
    console.error('Top Blocked Scan Error:', err);
    statusContainer.textContent = `Error: ${err.message || String(err)}`;
  } finally {
    progressContainer.classList.add('hidden');
    progressContainer.setAttribute('aria-busy', 'false');
    checkBtn.disabled = false;
    scanMutualsBtn.disabled = false;
    scanTopBlockedBtn.disabled = false;
  }
});

function renderResults(
  blockers: MutualProfile[],
  incompleteMoots?: MootScanError[],
  onRetry?: () => Promise<void>
) {
  resultsContainer.innerHTML = '';

  const warningElem = incompleteMoots && incompleteMoots.length > 0
    ? renderScanWarningElement(incompleteMoots, onRetry)
    : null;
  if (warningElem) {
    resultsContainer.appendChild(warningElem);
  }

  if (blockers.length === 0) {
    const noResultsP = document.createElement('p');
    noResultsP.className = 'no-results';
    noResultsP.textContent = 'None of your moots block this account.';
    resultsContainer.appendChild(noResultsP);
    return;
  }

  const listElement = document.createElement('ul');
  listElement.className = 'blocker-list';
  listElement.innerHTML = blockers
    .map((b, idx) => {
      const profileUrl = `https://bsky.app/profile/${encodeURIComponent(b.handle)}`;
      const avatarImg = b.avatar
        ? `<img src="${b.avatar}" class="avatar-md" alt="${escapeHtml(b.handle)} avatar" />`
        : `<div class="avatar-md avatar-placeholder"></div>`;
      const displayName = escapeHtml(b.displayName || b.handle);
      const handle = escapeHtml(b.handle);
      
      const delay = Math.min(idx * 50, 500);

      return `
        <li class="blocker-card" style="animation-delay: ${delay}ms;">
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
    .join('');

  resultsContainer.appendChild(listElement);
}

function renderMutualBlockersResults(
  summaries: MutualBlockerSummary[],
  incompleteMoots?: MootScanError[],
  onRetry?: () => Promise<void>
) {
  resultsContainer.innerHTML = '';

  const warningElem = incompleteMoots && incompleteMoots.length > 0
    ? renderScanWarningElement(incompleteMoots, onRetry)
    : null;
  if (warningElem) {
    resultsContainer.appendChild(warningElem);
  }

  if (summaries.length === 0) {
    const noResultsP = document.createElement('p');
    noResultsP.className = 'no-results';
    noResultsP.textContent = 'None of your moots block any of your other moots.';
    resultsContainer.appendChild(noResultsP);
    return;
  }

  const listElement = document.createElement('ul');
  listElement.className = 'blocker-list';

  summaries.forEach((summary, index) => {
    const blockerCard = document.createElement('li');
    blockerCard.className = 'mutual-blocker-card';
    const delay = Math.min(index * 50, 500);
    blockerCard.style.animationDelay = `${delay}ms`;

    const blockerProfileUrl = `https://bsky.app/profile/${encodeURIComponent(summary.blocker.handle)}`;
    const avatarImg = summary.blocker.avatar
      ? `<img src="${summary.blocker.avatar}" class="avatar-md" alt="${escapeHtml(summary.blocker.handle)} avatar" />`
      : `<div class="avatar-md avatar-placeholder"></div>`;
    const blockerDisplayName = escapeHtml(summary.blocker.displayName || summary.blocker.handle);
    const blockerHandle = escapeHtml(summary.blocker.handle);

    blockerCard.innerHTML = `
      <div class="mutual-blocker-header">
        <a href="${blockerProfileUrl}" target="_blank" rel="noopener noreferrer" class="avatar-link">
          ${avatarImg}
        </a>
        <div class="blocker-info">
          <a href="${blockerProfileUrl}" target="_blank" rel="noopener noreferrer" class="display-name">
            <strong>${blockerDisplayName}</strong>
          </a>
          <a href="${blockerProfileUrl}" target="_blank" rel="noopener noreferrer" class="handle-link">@${blockerHandle}</a>
        </div>
        <button class="toggle-expand-btn" id="toggle-btn-${index}">
          Blocks ${summary.blockedMutuals.length} moot${summary.blockedMutuals.length === 1 ? '' : 's'} &#9660;
        </button>
      </div>
      <div class="blocked-mutuals-container hidden" id="blocked-container-${index}">
        <ul class="blocked-mutuals-list">
          ${summary.blockedMutuals
            .map((bm) => {
              const bmUrl = `https://bsky.app/profile/${encodeURIComponent(bm.handle)}`;
              const bmAvatar = bm.avatar
                ? `<img src="${bm.avatar}" class="avatar-xs" alt="${escapeHtml(bm.handle)} avatar" />`
                : `<div class="avatar-xs avatar-placeholder"></div>`;
              return `
                <li class="blocked-mutual-item">
                  <a href="${bmUrl}" target="_blank" rel="noopener noreferrer" class="avatar-link">
                    ${bmAvatar}
                  </a>
                  <div class="blocker-info">
                    <a href="${bmUrl}" target="_blank" rel="noopener noreferrer" class="display-name">
                      <strong>${escapeHtml(bm.displayName || bm.handle)}</strong>
                    </a>
                    <a href="${bmUrl}" target="_blank" rel="noopener noreferrer" class="handle-link">@${escapeHtml(bm.handle)}</a>
                  </div>
                </li>
              `;
            })
            .join('')}
        </ul>
      </div>
    `;

    listElement.appendChild(blockerCard);
  });

  resultsContainer.appendChild(listElement);

  summaries.forEach((summary, index) => {
    const toggleBtn = document.getElementById(`toggle-btn-${index}`)!;
    const container = document.getElementById(`blocked-container-${index}`)!;
    toggleBtn.addEventListener('click', () => {
      const isHidden = container.classList.contains('hidden');
      if (isHidden) {
        container.classList.remove('hidden');
        toggleBtn.innerHTML = `Blocks ${summary.blockedMutuals.length} moot${summary.blockedMutuals.length === 1 ? '' : 's'} &#9650;`;
      } else {
        container.classList.add('hidden');
        toggleBtn.innerHTML = `Blocks ${summary.blockedMutuals.length} moot${summary.blockedMutuals.length === 1 ? '' : 's'} &#9660;`;
      }
    });
  });
}

function renderTopBlockedResults(
  summaries: MutualBlockedSummary[],
  incompleteMoots?: MootScanError[],
  onRetry?: () => Promise<void>
) {
  resultsContainer.innerHTML = '';

  const warningElem = incompleteMoots && incompleteMoots.length > 0
    ? renderScanWarningElement(incompleteMoots, onRetry)
    : null;
  if (warningElem) {
    resultsContainer.appendChild(warningElem);
  }

  if (summaries.length === 0) {
    const noResultsP = document.createElement('p');
    noResultsP.className = 'no-results';
    noResultsP.textContent = 'None of your moots are blocked by any of your other moots.';
    resultsContainer.appendChild(noResultsP);
    return;
  }

  const listElement = document.createElement('ul');
  listElement.className = 'blocker-list';

  summaries.forEach((summary, index) => {
    const card = document.createElement('li');
    card.className = 'mutual-blocker-card';
    const delay = Math.min(index * 50, 500);
    card.style.animationDelay = `${delay}ms`;

    const blockedProfileUrl = `https://bsky.app/profile/${encodeURIComponent(summary.blocked.handle)}`;
    const avatarImg = summary.blocked.avatar
      ? `<img src="${summary.blocked.avatar}" class="avatar-md" alt="${escapeHtml(summary.blocked.handle)} avatar" />`
      : `<div class="avatar-md avatar-placeholder"></div>`;
    const blockedDisplayName = escapeHtml(summary.blocked.displayName || summary.blocked.handle);
    const blockedHandle = escapeHtml(summary.blocked.handle);

    card.innerHTML = `
      <div class="mutual-blocker-header">
        <a href="${blockedProfileUrl}" target="_blank" rel="noopener noreferrer" class="avatar-link">
          ${avatarImg}
        </a>
        <div class="blocker-info">
          <a href="${blockedProfileUrl}" target="_blank" rel="noopener noreferrer" class="display-name">
            <strong>${blockedDisplayName}</strong>
          </a>
          <a href="${blockedProfileUrl}" target="_blank" rel="noopener noreferrer" class="handle-link">@${blockedHandle}</a>
        </div>
        <button class="toggle-expand-btn" id="blocked-toggle-btn-${index}">
          Blocked by ${summary.blockedByMutuals.length} moot${summary.blockedByMutuals.length === 1 ? '' : 's'} &#9660;
        </button>
      </div>
      <div class="blocked-mutuals-container hidden" id="blocked-by-container-${index}">
        <ul class="blocked-mutuals-list">
          ${summary.blockedByMutuals
            .map((bm) => {
              const bmUrl = `https://bsky.app/profile/${encodeURIComponent(bm.handle)}`;
              const bmAvatar = bm.avatar
                ? `<img src="${bm.avatar}" class="avatar-xs" alt="${escapeHtml(bm.handle)} avatar" />`
                : `<div class="avatar-xs avatar-placeholder"></div>`;
              return `
                <li class="blocked-mutual-item">
                  <a href="${bmUrl}" target="_blank" rel="noopener noreferrer" class="avatar-link">
                    ${bmAvatar}
                  </a>
                  <div class="blocker-info">
                    <a href="${bmUrl}" target="_blank" rel="noopener noreferrer" class="display-name">
                      <strong>${escapeHtml(bm.displayName || bm.handle)}</strong>
                    </a>
                    <a href="${bmUrl}" target="_blank" rel="noopener noreferrer" class="handle-link">@${escapeHtml(bm.handle)}</a>
                  </div>
                </li>
              `;
            })
            .join('')}
        </ul>
      </div>
    `;

    listElement.appendChild(card);
  });

  resultsContainer.appendChild(listElement);

  summaries.forEach((summary, index) => {
    const toggleBtn = document.getElementById(`blocked-toggle-btn-${index}`)!;
    const container = document.getElementById(`blocked-by-container-${index}`)!;
    toggleBtn.addEventListener('click', () => {
      const isHidden = container.classList.contains('hidden');
      if (isHidden) {
        container.classList.remove('hidden');
        toggleBtn.innerHTML = `Blocked by ${summary.blockedByMutuals.length} moot${summary.blockedByMutuals.length === 1 ? '' : 's'} &#9650;`;
      } else {
        container.classList.add('hidden');
        toggleBtn.innerHTML = `Blocked by ${summary.blockedByMutuals.length} moot${summary.blockedByMutuals.length === 1 ? '' : 's'} &#9660;`;
      }
    });
  });
}

bootstrap();
