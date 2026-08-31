import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks for oauth module functions used in main.ts
const mockInitOAuth = vi.fn();
const mockSignIn = vi.fn();
const mockSignOut = vi.fn();
const mockGetAgent = vi.fn();
const mockGetSession = vi.fn();

vi.mock('../src/oauth', () => ({
  initOAuth: (...args: any[]) => mockInitOAuth(...args),
  signIn: (...args: any[]) => mockSignIn(...args),
  signOut: (...args: any[]) => mockSignOut(...args),
  getAgent: (...args: any[]) => mockGetAgent(...args),
  getSession: (...args: any[]) => mockGetSession(...args)
}));

// Mocks for bsky module functions used in main.ts
const mockSearchActorsTypeahead = vi.fn();
const mockFetchAllMutuals = vi.fn();
const mockFindMutualsBlockingTarget = vi.fn();
const mockFindTopBlockersAmongMutuals = vi.fn();
const mockFindTopBlockedAmongMutuals = vi.fn();
const mockResolveActor = vi.fn();

vi.mock('../src/bsky', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/bsky')>();
  return {
    ...actual,
    searchActorsTypeahead: (...args: any[]) => mockSearchActorsTypeahead(...args),
    fetchAllMutuals: (...args: any[]) => mockFetchAllMutuals(...args),
    findMutualsBlockingTarget: (...args: any[]) => mockFindMutualsBlockingTarget(...args),
    findTopBlockersAmongMutuals: (...args: any[]) => mockFindTopBlockersAmongMutuals(...args),
    findTopBlockedAmongMutuals: (...args: any[]) => mockFindTopBlockedAmongMutuals(...args),
    resolveActor: (...args: any[]) => mockResolveActor(...args)
  };
});

describe('main module', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.useFakeTimers();
    window.alert = vi.fn();
  });

  async function loadMainModule() {
    await import('../src/main');
    // Allow bootstrap promise to complete
    await vi.runAllTimersAsync();
  }

  describe('bootstrap & auth state', () => {
    it('shows app view when session and agent exist on init (with avatar)', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      const mockAgent = {
        getProfile: vi.fn().mockResolvedValue({
          data: {
            handle: 'user.bsky.social',
            avatar: 'https://example.com/user.jpg'
          }
        })
      };

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: mockAgent });
      mockGetAgent.mockReturnValue(mockAgent);
      mockGetSession.mockReturnValue(mockSession);

      await loadMainModule();

      const authSection = document.getElementById('auth-section')!;
      const appSection = document.getElementById('app-section')!;
      const userProfileBadge = document.getElementById('user-profile-badge')!;

      expect(authSection.classList.contains('hidden')).toBe(true);
      expect(appSection.classList.contains('hidden')).toBe(false);
      expect(userProfileBadge.innerHTML).toContain('https://example.com/user.jpg');
      expect(userProfileBadge.innerHTML).toContain('@user.bsky.social');
    });

    it('shows app view when session and agent exist on init (without avatar)', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      const mockAgent = {
        getProfile: vi.fn().mockResolvedValue({
          data: {
            handle: 'noavatar.bsky.social',
            avatar: null
          }
        })
      };

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: mockAgent });
      mockGetAgent.mockReturnValue(mockAgent);
      mockGetSession.mockReturnValue(mockSession);

      await loadMainModule();

      const userProfileBadge = document.getElementById('user-profile-badge')!;
      expect(userProfileBadge.innerHTML).toContain('avatar-placeholder');
      expect(userProfileBadge.innerHTML).toContain('@noavatar.bsky.social');
    });

    it('falls back to displaying userDid if getProfile fails', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      const mockAgent = {
        getProfile: vi.fn().mockRejectedValue(new Error('Profile fetch failed'))
      };

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: mockAgent });
      mockGetAgent.mockReturnValue(mockAgent);
      mockGetSession.mockReturnValue(mockSession);

      await loadMainModule();

      const userProfileBadge = document.getElementById('user-profile-badge')!;
      expect(userProfileBadge.textContent).toBe('did:plc:user123');
    });

    it('shows login view when initOAuth resolves with no session', async () => {
      mockInitOAuth.mockResolvedValue({ session: null, agent: null });
      mockGetSession.mockReturnValue(null);

      await loadMainModule();

      const authSection = document.getElementById('auth-section')!;
      const appSection = document.getElementById('app-section')!;

      expect(authSection.classList.contains('hidden')).toBe(false);
      expect(appSection.classList.contains('hidden')).toBe(true);
    });

    it('shows login view and logs error when initOAuth throws an error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockInitOAuth.mockRejectedValue(new Error('OAuth error'));

      await loadMainModule();

      const authSection = document.getElementById('auth-section')!;
      expect(authSection.classList.contains('hidden')).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith('OAuth Init Error:', expect.any(Error));
    });
  });

  describe('sessionStorage helpers coverage', () => {
    it('handles non-cache keys in sessionStorage during logout (clearCachedMutualsStorage branch coverage)', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      const mockAgent = {
        getProfile: vi.fn().mockResolvedValue({ data: { handle: 'user.bsky.social' } })
      };

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: mockAgent });
      mockGetAgent.mockReturnValue(mockAgent);
      mockGetSession.mockReturnValue(mockSession);

      sessionStorage.setItem('other_unrelated_key', 'value');
      sessionStorage.setItem('bsky_mutuals_cache_user123', '[]');

      await loadMainModule();

      const logoutBtn = document.getElementById('logout-btn')!;
      logoutBtn.click();
      await vi.runAllTimersAsync();

      expect(sessionStorage.getItem('other_unrelated_key')).toBe('value');
      expect(sessionStorage.getItem('bsky_mutuals_cache_user123')).toBeNull();
    });

    it('handles invalid JSON in sessionStorage (reading mutuals) gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      sessionStorage.setItem('bsky_mutuals_cache_did:plc:user123', 'invalid-json{');

      const mockSession = { sub: 'did:plc:user123' };
      const mockAgent = {
        getProfile: vi.fn().mockResolvedValue({ data: { handle: 'user.bsky.social' } })
      };
      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: mockAgent });
      mockGetAgent.mockReturnValue(mockAgent);
      mockGetSession.mockReturnValue(mockSession);

      await loadMainModule();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error reading mutuals from sessionStorage',
        expect.any(SyntaxError)
      );
    });

    it('handles sessionStorage setItem exception in checkBtn handler gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const mockSession = { sub: 'did:plc:user123' };
      const mockAgent = {
        getProfile: vi.fn().mockResolvedValue({ data: { handle: 'user.bsky.social' } })
      };

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: mockAgent });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue(mockAgent);
      mockResolveActor.mockResolvedValue({ did: 'did:plc:target' });

      mockFetchAllMutuals.mockResolvedValue([
        { did: 'did:plc:m1', handle: 'm1.bsky.social' }
      ]);
      mockFindMutualsBlockingTarget.mockResolvedValue([]);

      const setItemSpy = vi.spyOn(sessionStorage, 'setItem').mockImplementation((key: string) => {
        if (key.startsWith('bsky_mutuals_cache_')) {
          throw new Error('Write error');
        }
      });

      try {
        await loadMainModule();

        const targetInput = document.getElementById('target-input') as HTMLInputElement;
        const checkBtn = document.getElementById('check-btn') as HTMLButtonElement;

        targetInput.value = 'target.bsky.social';
        checkBtn.click();
        await vi.runAllTimersAsync();

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error saving mutuals to sessionStorage',
          expect.any(Error)
        );
      } finally {
        setItemSpy.mockRestore();
      }
    });

    it('handles sessionStorage removeItem exception on logout gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const mockSession = { sub: 'did:plc:user123' };
      const mockAgent = {
        getProfile: vi.fn().mockResolvedValue({ data: { handle: 'user.bsky.social' } })
      };

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: mockAgent });
      mockGetAgent.mockReturnValue(mockAgent);
      mockGetSession.mockReturnValue(mockSession);

      sessionStorage.setItem('bsky_mutuals_cache_user123', '[]');

      const removeItemSpy = vi.spyOn(sessionStorage, 'removeItem').mockImplementation((key: string) => {
        if (key.startsWith('bsky_mutuals_cache_')) {
          throw new Error('Remove error');
        }
      });

      try {
        await loadMainModule();

        const logoutBtn = document.getElementById('logout-btn')!;
        logoutBtn.click();
        await vi.runAllTimersAsync();

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error clearing mutuals from sessionStorage',
          expect.any(Error)
        );
      } finally {
        removeItemSpy.mockRestore();
      }
    });
  });

  describe('login form interactions', () => {
    it('does nothing on submit if handle input is empty', async () => {
      mockInitOAuth.mockResolvedValue({ session: null, agent: null });
      mockGetSession.mockReturnValue(null);
      await loadMainModule();

      const loginForm = document.getElementById('login-form') as HTMLFormElement;
      const handleInput = document.getElementById('handle-input') as HTMLInputElement;

      handleInput.value = '   ';
      loginForm.dispatchEvent(new Event('submit'));

      expect(mockSignIn).not.toHaveBeenCalled();
    });

    it('calls signIn on submit with valid handle', async () => {
      mockInitOAuth.mockResolvedValue({ session: null, agent: null });
      mockGetSession.mockReturnValue(null);
      mockSignIn.mockResolvedValue(undefined);
      await loadMainModule();

      const loginForm = document.getElementById('login-form') as HTMLFormElement;
      const handleInput = document.getElementById('handle-input') as HTMLInputElement;

      handleInput.value = '  alice.bsky.social  ';
      loginForm.dispatchEvent(new Event('submit'));

      expect(handleInput.disabled).toBe(true);
      expect(mockSignIn).toHaveBeenCalledWith('alice.bsky.social');
    });

    it('alerts error and re-enables handle input if signIn fails', async () => {
      mockInitOAuth.mockResolvedValue({ session: null, agent: null });
      mockGetSession.mockReturnValue(null);
      mockSignIn.mockRejectedValue(new Error('Sign in failed'));

      await loadMainModule();

      const loginForm = document.getElementById('login-form') as HTMLFormElement;
      const handleInput = document.getElementById('handle-input') as HTMLInputElement;

      handleInput.value = 'alice.bsky.social';
      loginForm.dispatchEvent(new Event('submit'));
      await vi.runAllTimersAsync();

      expect(window.alert).toHaveBeenCalledWith('Failed to start sign in: Sign in failed');
      expect(handleInput.disabled).toBe(false);
    });
  });

  describe('typeahead autocomplete', () => {
    it('does not trigger search if input length is less than 2', async () => {
      mockInitOAuth.mockResolvedValue({ session: { sub: 'did:plc:user' }, agent: {} });
      await loadMainModule();

      const targetInput = document.getElementById('target-input') as HTMLInputElement;
      const suggestionsList = document.getElementById('suggestions-list')!;

      targetInput.value = 'a';
      targetInput.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(300);

      expect(mockSearchActorsTypeahead).not.toHaveBeenCalled();
      expect(suggestionsList.classList.contains('hidden')).toBe(true);
      expect(suggestionsList.innerHTML).toBe('');
    });

    it('renders autocomplete results after debounce and allows selection (with/without avatar)', async () => {
      const mockActors = [
        {
          did: 'did:plc:actor1',
          handle: 'actor1.bsky.social',
          displayName: '<Actor 1>',
          avatar: 'https://example.com/a1.jpg'
        },
        {
          did: 'did:plc:actor2',
          handle: 'actor2.bsky.social',
          displayName: '',
          avatar: null
        }
      ];

      mockInitOAuth.mockResolvedValue({ session: { sub: 'did:plc:user' }, agent: {} });
      mockSearchActorsTypeahead.mockResolvedValue(mockActors);

      await loadMainModule();

      const targetInput = document.getElementById('target-input') as HTMLInputElement;
      const suggestionsList = document.getElementById('suggestions-list')!;

      targetInput.value = 'act';
      targetInput.dispatchEvent(new Event('input'));

      // Before timer fires
      expect(mockSearchActorsTypeahead).not.toHaveBeenCalled();

      // Advance debounce timer
      vi.advanceTimersByTime(250);
      await vi.runAllTimersAsync();

      expect(mockSearchActorsTypeahead).toHaveBeenCalledWith(expect.anything(), 'act');
      expect(suggestionsList.classList.contains('hidden')).toBe(false);
      expect(suggestionsList.querySelectorAll('li')).toHaveLength(2);

      // Verify HTML escaping and avatar rendering
      expect(suggestionsList.innerHTML).toContain('&lt;Actor 1&gt;');
      expect(suggestionsList.innerHTML).toContain('https://example.com/a1.jpg');
      expect(suggestionsList.innerHTML).toContain('avatar-placeholder');

      // Click second suggestion
      const secondLi = suggestionsList.querySelectorAll('li')[1] as HTMLElement;
      secondLi.click();

      expect(targetInput.value).toBe('actor2.bsky.social');
      expect(suggestionsList.classList.contains('hidden')).toBe(true);
    });

    it('hides suggestion list if search returns empty array', async () => {
      mockInitOAuth.mockResolvedValue({ session: { sub: 'did:plc:user' }, agent: {} });
      mockSearchActorsTypeahead.mockResolvedValue([]);

      await loadMainModule();

      const targetInput = document.getElementById('target-input') as HTMLInputElement;
      const suggestionsList = document.getElementById('suggestions-list')!;

      targetInput.value = 'nonexistent';
      targetInput.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(250);
      await vi.runAllTimersAsync();

      expect(suggestionsList.classList.contains('hidden')).toBe(true);
      expect(suggestionsList.innerHTML).toBe('');
    });

    it('logs error when searchActorsTypeahead throws', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockInitOAuth.mockResolvedValue({ session: { sub: 'did:plc:user' }, agent: {} });
      mockSearchActorsTypeahead.mockRejectedValue(new Error('Network error'));

      await loadMainModule();

      const targetInput = document.getElementById('target-input') as HTMLInputElement;
      targetInput.value = 'throw';
      targetInput.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(250);
      await vi.runAllTimersAsync();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(Error));
      consoleErrorSpy.mockRestore();
    });
  });

  describe('check button mutual block scan workflow', () => {

    it('handles duplicate results in scan target retry and covers branch 197', async () => {


      const mockSession = { sub: 'did:plc:user123' };
      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: {} });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue({});

      const m1 = { did: 'did:plc:m1', handle: 'm1' };
      const m2 = { did: 'did:plc:m2', handle: 'm2' };
      sessionStorage.setItem('bsky_mutuals_cache_did:plc:user123', JSON.stringify([m1, m2]));

      mockFindMutualsBlockingTarget.mockResolvedValueOnce({
        blockingMutuals: [m1],
        incompleteMoots: [{ moot: m2, reason: 'timeout', partialCount: 0 }]
      }).mockResolvedValueOnce({
        blockingMutuals: [m1, m2], // Duplicate m1
        incompleteMoots: []
      });

      await loadMainModule();

      // For line 197 branch
      const item = document.createElement('li');
      // No data-handle!
      item.click();

      const targetInput = document.getElementById('target-input') as HTMLInputElement;
      targetInput.value = 'did:plc:target';

      const checkBtn = document.getElementById('check-btn') as HTMLButtonElement;
      checkBtn.click();
      await vi.runAllTimersAsync();

      const retryBtn = document.getElementById('retry-incomplete-btn') as HTMLButtonElement;
      retryBtn.click();
      await vi.runAllTimersAsync();

      expect(mockFindMutualsBlockingTarget).toHaveBeenCalledTimes(2);
    });

    it('returns early if getSession() returns null', async () => {
      mockInitOAuth.mockResolvedValue({ session: null, agent: null });
      mockGetSession.mockReturnValue(null);

      await loadMainModule();

      const checkBtn = document.getElementById('check-btn') as HTMLButtonElement;
      checkBtn.click();

      expect(mockFindMutualsBlockingTarget).not.toHaveBeenCalled();
    });

    it('alerts user if target input is empty and no suggestion was selected', async () => {
      mockInitOAuth.mockResolvedValue({ session: { sub: 'did:plc:user' }, agent: {} });
      mockGetSession.mockReturnValue({ sub: 'did:plc:user' });

      await loadMainModule();

      const checkBtn = document.getElementById('check-btn') as HTMLButtonElement;
      const targetInput = document.getElementById('target-input') as HTMLInputElement;
      targetInput.value = '';

      checkBtn.click();

      expect(window.alert).toHaveBeenCalledWith('Please enter a Bluesky username.');
      expect(mockFindMutualsBlockingTarget).not.toHaveBeenCalled();
    });

    it('resolves handle if selectedTargetDid is not set and updates status on failure', async () => {
      mockInitOAuth.mockResolvedValue({ session: { sub: 'did:plc:user' }, agent: {} });
      mockGetSession.mockReturnValue({ sub: 'did:plc:user' });
      mockResolveActor.mockRejectedValue(new Error('Handle not found'));

      await loadMainModule();

      const checkBtn = document.getElementById('check-btn') as HTMLButtonElement;
      const targetInput = document.getElementById('target-input') as HTMLInputElement;
      const statusContainer = document.getElementById('status-container')!;

      targetInput.value = '@unknown.bsky.social';
      checkBtn.click();
      await vi.runAllTimersAsync();

      expect(mockResolveActor).toHaveBeenCalledWith(expect.anything(), 'unknown.bsky.social');
      expect(statusContainer.textContent).toBe('Could not resolve handle. Check spelling.');
      expect(mockFindMutualsBlockingTarget).not.toHaveBeenCalled();
    });

    it('handles scenario where user has 0 mutuals', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: {} });
      mockGetSession.mockReturnValue(mockSession);
      mockResolveActor.mockResolvedValue({ did: 'did:plc:target' });
      mockFetchAllMutuals.mockResolvedValue([]);

      await loadMainModule();

      const targetInput = document.getElementById('target-input') as HTMLInputElement;
      const checkBtn = document.getElementById('check-btn') as HTMLButtonElement;
      const statusContainer = document.getElementById('status-container')!;

      targetInput.value = 'target.bsky.social';
      checkBtn.click();
      await vi.runAllTimersAsync();

      expect(statusContainer.textContent).toBe('You have no mutual followers (moots) on this account.');
      expect(mockFindMutualsBlockingTarget).not.toHaveBeenCalled();
    });

    it('uses cached mutuals from sessionStorage if available', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      const cachedList = [{ did: 'did:plc:m1', handle: 'm1.bsky.social' }];
      sessionStorage.setItem('bsky_mutuals_cache_did:plc:user123', JSON.stringify(cachedList));

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: {} });
      mockGetSession.mockReturnValue(mockSession);
      mockResolveActor.mockResolvedValue({ did: 'did:plc:target' });
      mockFindMutualsBlockingTarget.mockResolvedValue({ blockingMutuals: [], incompleteMoots: [] });

      await loadMainModule();

      const targetInput = document.getElementById('target-input') as HTMLInputElement;
      const checkBtn = document.getElementById('check-btn') as HTMLButtonElement;

      targetInput.value = 'target.bsky.social';
      checkBtn.click();
      await vi.runAllTimersAsync();

      expect(mockFetchAllMutuals).not.toHaveBeenCalled();
      expect(mockFindMutualsBlockingTarget).toHaveBeenCalledWith(
        expect.anything(),
        'did:plc:target',
        cachedList,
        expect.any(Function)
      );
    });

    it('fetches mutuals when uncached, updates progress, saves to cache, and renders blockers', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      const mockAgent = {
        getProfile: vi.fn().mockResolvedValue({ data: { handle: 'user.bsky.social' } })
      };

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: mockAgent });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue(mockAgent);
      mockResolveActor.mockResolvedValue({ did: 'did:plc:target' });

      const mutualList = [
        { did: 'did:plc:m1', handle: 'm1.bsky.social', displayName: '<M1>', avatar: 'http://m1.jpg' },
        { did: 'did:plc:m2', handle: 'm2.bsky.social', displayName: null, avatar: null }
      ];

      mockFetchAllMutuals.mockImplementation(async (_agent, _sub, onProgress) => {
        if (onProgress) onProgress(2);
        return mutualList;
      });

      const blockers = [mutualList[0], mutualList[1]];
      mockFindMutualsBlockingTarget.mockImplementation(async (_agent, _targetDid, _mutuals, onProgress) => {
        if (onProgress) onProgress({ scanned: 2, total: 2 });
        return { blockingMutuals: blockers, incompleteMoots: [] };
      });

      await loadMainModule();

      const targetInput = document.getElementById('target-input') as HTMLInputElement;
      const checkBtn = document.getElementById('check-btn') as HTMLButtonElement;
      const statusContainer = document.getElementById('status-container')!;
      const resultsContainer = document.getElementById('results-container')!;

      targetInput.value = 'target.bsky.social';
      checkBtn.click();
      await vi.runAllTimersAsync();

      expect(mockFetchAllMutuals).toHaveBeenCalled();
      expect(mockFindMutualsBlockingTarget).toHaveBeenCalled();
      expect(statusContainer.textContent).toBe(
        'Scan complete. Found 2 moot(s) blocking @target.bsky.social.'
      );
      expect(resultsContainer.innerHTML).toContain('blocker-card');
      expect(resultsContainer.innerHTML).toContain('&lt;M1&gt;');
      expect(resultsContainer.innerHTML).toContain('avatar-placeholder');
    });

    it('renders empty result message when no mutuals block the target', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      const mockAgent = {
        getProfile: vi.fn().mockResolvedValue({ data: { handle: 'user.bsky.social' } })
      };

      sessionStorage.setItem(
        'bsky_mutuals_cache_did:plc:user123',
        JSON.stringify([{ did: 'did:plc:m1', handle: 'm1.bsky.social' }])
      );

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: mockAgent });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue(mockAgent);

      mockFindMutualsBlockingTarget.mockResolvedValue({ blockingMutuals: [], incompleteMoots: [] });

      await loadMainModule();

      const targetInput = document.getElementById('target-input') as HTMLInputElement;
      const checkBtn = document.getElementById('check-btn') as HTMLButtonElement;
      const resultsContainer = document.getElementById('results-container')!;

      // Use selectedTargetDid route by selecting from typeahead first
      mockSearchActorsTypeahead.mockResolvedValue([
        { did: 'did:plc:selectedTarget', handle: 'selected.bsky.social' }
      ]);

      targetInput.value = 'selected';
      targetInput.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(250);
      await vi.runAllTimersAsync();

      const suggestionsList = document.getElementById('suggestions-list')!;
      const li = suggestionsList.querySelector('li') as HTMLElement;
      li.click();

      checkBtn.click();
      await vi.runAllTimersAsync();

      expect(resultsContainer.innerHTML).toContain(
        'None of your moots block this account.'
      );
    });

    it('renders warning banner and handles toggle and retry when incomplete moots exist', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      const mockAgent = {
        getProfile: vi.fn().mockResolvedValue({ data: { handle: 'user.bsky.social' } })
      };

      sessionStorage.setItem(
        'bsky_mutuals_cache_did:plc:user123',
        JSON.stringify([{ did: 'did:plc:m1', handle: 'm1.bsky.social' }, { did: 'did:plc:m2', handle: 'm2.bsky.social' }])
      );

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: mockAgent });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue(mockAgent);
      mockResolveActor.mockResolvedValue({ did: 'did:plc:target' });

      const moot1 = { did: 'did:plc:m1', handle: 'm1.bsky.social' };
      const moot2 = { did: 'did:plc:m2', handle: 'm2.bsky.social' };

      mockFindMutualsBlockingTarget.mockResolvedValueOnce({
        blockingMutuals: [moot1],
        incompleteMoots: [
          { moot: moot2, reason: 'rate_limit', partialCount: 150 }
        ]
      });

      await loadMainModule();

      const targetInput = document.getElementById('target-input') as HTMLInputElement;
      const checkBtn = document.getElementById('check-btn') as HTMLButtonElement;
      const statusContainer = document.getElementById('status-container')!;
      const resultsContainer = document.getElementById('results-container')!;

      targetInput.value = 'target.bsky.social';
      checkBtn.click();
      await vi.runAllTimersAsync();

      expect(statusContainer.textContent).toContain('Scan complete');
      expect(resultsContainer.innerHTML).toContain('scan-warning-card');
      expect(resultsContainer.innerHTML).toContain('1 moot could not be fully checked');
      expect(resultsContainer.innerHTML).toContain('Rate limit reached during scan (150 blocks scanned)');

      // Toggle details
      const toggleBtn = document.getElementById('toggle-warning-details-btn') as HTMLButtonElement;
      const container = document.getElementById('incomplete-moots-container') as HTMLElement;
      expect(container.classList.contains('hidden')).toBe(true);

      toggleBtn.click();
      expect(container.classList.contains('hidden')).toBe(false);
      expect(toggleBtn.textContent).toContain('Hide Details');

      toggleBtn.click();
      expect(container.classList.contains('hidden')).toBe(true);

      // Retry incomplete moots
      mockFindMutualsBlockingTarget.mockResolvedValueOnce({
        blockingMutuals: [moot2],
        incompleteMoots: []
      });

      const retryBtn = document.getElementById('retry-incomplete-btn') as HTMLButtonElement;
      retryBtn.click();
      await vi.runAllTimersAsync();

      // Now both blockers should be rendered, warning banner gone
      expect(resultsContainer.querySelectorAll('.blocker-card')).toHaveLength(2);
      expect(resultsContainer.querySelector('.scan-warning-card')).toBeNull();
    });

    it('handles scan error gracefully in catch block', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockSession = { sub: 'did:plc:user123' };
      const mockAgent = {
        getProfile: vi.fn().mockResolvedValue({ data: { handle: 'user.bsky.social' } })
      };

      sessionStorage.setItem(
        'bsky_mutuals_cache_did:plc:user123',
        JSON.stringify([{ did: 'did:plc:m1', handle: 'm1.bsky.social' }])
      );

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: mockAgent });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue(mockAgent);

      mockFindMutualsBlockingTarget.mockRejectedValue(new Error('API failure'));

      await loadMainModule();

      const targetInput = document.getElementById('target-input') as HTMLInputElement;
      const checkBtn = document.getElementById('check-btn') as HTMLButtonElement;
      const statusContainer = document.getElementById('status-container')!;

      targetInput.value = 'target.bsky.social';
      checkBtn.click();
      await vi.runAllTimersAsync();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Scan Error:', expect.any(Error));
      expect(statusContainer.textContent).toBe('Error performing block check: API failure');

      // Test fallback to string error
      mockFindMutualsBlockingTarget.mockRejectedValue('String error');
      checkBtn.click();
      await vi.runAllTimersAsync();
      expect(statusContainer.textContent).toBe('Error performing block check: String error');

      consoleErrorSpy.mockRestore();
    });
  });

  describe('scan mutuals button workflow', () => {

    it('catches and logs error from findTopBlockersAmongMutuals and displays it', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      sessionStorage.setItem('bsky_mutuals_cache_did:plc:user123', JSON.stringify([{ did: 'did:plc:m1', handle: 'm1' }]));

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: {} });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue({});

      mockFindTopBlockersAmongMutuals.mockRejectedValueOnce(new Error('Test scan mutuals error'));

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await loadMainModule();

      const scanMutualsBtn = document.getElementById('scan-mutuals-btn') as HTMLButtonElement;
      const statusContainer = document.getElementById('status-container')!;

      scanMutualsBtn.click();
      await vi.runAllTimersAsync();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Mutual Scan Error:', expect.any(Error));
      expect(statusContainer.textContent).toBe('Error: Test scan mutuals error');
    });

    it('renders warning element and handles retry click for scanMutualsBtn with duplicate results', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      const m1 = { did: 'did:plc:m1', handle: 'm1' };
      const m2 = { did: 'did:plc:m2', handle: 'm2' };
      const duplicateBlocker = { blocker: m1, blockedMutuals: [m2] };

      sessionStorage.setItem('bsky_mutuals_cache_did:plc:user123', JSON.stringify([m1, m2]));


      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: {} });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue({});

      mockFindTopBlockersAmongMutuals.mockResolvedValueOnce({
        summaries: [duplicateBlocker],
        incompleteMoots: [{ moot: m1, reason: 'timeout', partialCount: 0 }]
      }).mockResolvedValueOnce({
        summaries: [duplicateBlocker, { blocker: m2, blockedMutuals: [m1] }],
        incompleteMoots: []
      });

      await loadMainModule();

      const scanMutualsBtn = document.getElementById('scan-mutuals-btn') as HTMLButtonElement;
      scanMutualsBtn.click();
      await vi.runAllTimersAsync();

      const retryBtn = document.getElementById('retry-incomplete-btn') as HTMLButtonElement;
      expect(retryBtn).not.toBeNull();
      retryBtn.click();
      await vi.runAllTimersAsync();

      expect(mockFindTopBlockersAmongMutuals).toHaveBeenCalledTimes(2);
    });

    it('catches and logs error when retryBtn is clicked and onRetry throws', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      const m1 = { did: 'did:plc:m1', handle: 'm1' };
      sessionStorage.setItem('bsky_mutuals_cache_did:plc:user123', JSON.stringify([m1]));


      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: {} });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue({});

      mockFindTopBlockersAmongMutuals.mockResolvedValueOnce({
        summaries: [],
        incompleteMoots: [{ moot: m1, reason: 'timeout', partialCount: 0 }]
      }).mockRejectedValueOnce(new Error('Retry exception'));

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await loadMainModule();

      const scanMutualsBtn = document.getElementById('scan-mutuals-btn') as HTMLButtonElement;
      scanMutualsBtn.click();
      await vi.runAllTimersAsync();

      const retryBtn = document.getElementById('retry-incomplete-btn') as HTMLButtonElement;
      retryBtn.click();
      await vi.runAllTimersAsync();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Retry error:', expect.any(Error));
    });


    it('catches and logs error from findTopBlockersAmongMutuals and displays it', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      sessionStorage.setItem('bsky_mutuals_cache_did:plc:user123', JSON.stringify([{ did: 'did:plc:m1', handle: 'm1' }]));
      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: {} });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue({});

      mockFindTopBlockersAmongMutuals.mockRejectedValueOnce('Test scan mutuals error');

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await loadMainModule();

      const scanMutualsBtn = document.getElementById('scan-mutuals-btn') as HTMLButtonElement;
      const statusContainer = document.getElementById('status-container')!;

      scanMutualsBtn.click();
      await vi.runAllTimersAsync();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Mutual Scan Error:', 'Test scan mutuals error');
      expect(statusContainer.textContent).toBe('Error: Test scan mutuals error');
    });

    it('renders warning element and handles retry click for scanMutualsBtn', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      const m1 = { did: 'did:plc:m1', handle: 'm1' };
      sessionStorage.setItem('bsky_mutuals_cache_did:plc:user123', JSON.stringify([m1]));
      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: {} });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue({});

      mockFindTopBlockersAmongMutuals.mockResolvedValueOnce({
        summaries: [],
        incompleteMoots: [{ moot: m1, reason: 'timeout', partialCount: 0 }, { moot: m1, reason: 'pds_offline', partialCount: 0 }]
      }).mockResolvedValueOnce({
        summaries: [],
        incompleteMoots: []
      });

      await loadMainModule();

      const scanMutualsBtn = document.getElementById('scan-mutuals-btn') as HTMLButtonElement;
      scanMutualsBtn.click();
      await vi.runAllTimersAsync();

      const retryBtn = document.getElementById('retry-incomplete-btn') as HTMLButtonElement;
      expect(retryBtn).not.toBeNull();
      retryBtn.click();
      await vi.runAllTimersAsync();

      expect(mockFindTopBlockersAmongMutuals).toHaveBeenCalledTimes(2);
    });

    it('catches and logs error when retryBtn is clicked and onRetry throws', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      const m1 = { did: 'did:plc:m1', handle: 'm1' };
      sessionStorage.setItem('bsky_mutuals_cache_did:plc:user123', JSON.stringify([m1]));
      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: {} });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue({});

      mockFindTopBlockersAmongMutuals.mockResolvedValueOnce({
        summaries: [],
        incompleteMoots: [{ moot: m1, reason: 'timeout', partialCount: 0 }, { moot: m1, reason: 'pds_offline', partialCount: 0 }]
      }).mockRejectedValueOnce(new Error('Retry exception'));

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await loadMainModule();

      const scanMutualsBtn = document.getElementById('scan-mutuals-btn') as HTMLButtonElement;
      scanMutualsBtn.click();
      await vi.runAllTimersAsync();

      const retryBtn = document.getElementById('retry-incomplete-btn') as HTMLButtonElement;
      retryBtn.click();
      await vi.runAllTimersAsync();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Retry error:', expect.any(Error));
    });

    it('returns early if getSession() returns null', async () => {
      mockInitOAuth.mockResolvedValue({ session: null, agent: null });
      mockGetSession.mockReturnValue(null);

      await loadMainModule();

      const scanMutualsBtn = document.getElementById('scan-mutuals-btn') as HTMLButtonElement;
      scanMutualsBtn.click();

      expect(mockFindTopBlockersAmongMutuals).not.toHaveBeenCalled();
    });

    it('handles scenario where cached mutuals is empty array', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      sessionStorage.setItem('bsky_mutuals_cache_did:plc:user123', JSON.stringify([]));

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: {} });
      mockGetSession.mockReturnValue(mockSession);

      await loadMainModule();

      const scanMutualsBtn = document.getElementById('scan-mutuals-btn') as HTMLButtonElement;
      const statusContainer = document.getElementById('status-container')!;

      scanMutualsBtn.click();
      await vi.runAllTimersAsync();

      expect(statusContainer.textContent).toBe('You have no mutual followers (moots) on this account.');
    });

    it('fetches mutuals when uncached, scans mutual blockers, renders list, and handles toggle expansion (with/without avatar & singular/plural)', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      const mockAgent = {
        getProfile: vi.fn().mockResolvedValue({ data: { handle: 'user.bsky.social' } })
      };

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: mockAgent });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue(mockAgent);

      const mutualList = [
        { did: 'did:plc:m1', handle: 'm1.bsky.social', displayName: '<Blocker 1>', avatar: 'http://m1.jpg' },
        { did: 'did:plc:m2', handle: 'm2.bsky.social', displayName: null, avatar: null },
        { did: 'did:plc:m3', handle: 'm3.bsky.social', displayName: 'M3', avatar: 'http://m3.jpg' }
      ];

      mockFetchAllMutuals.mockImplementation(async (_agent, _sub, onProgress) => {
        if (onProgress) onProgress(3);
        return mutualList;
      });

      const summaries = [
        {
          blocker: mutualList[0],
          blockedMutuals: [mutualList[1], mutualList[2]]
        },
        {
          blocker: mutualList[1],
          blockedMutuals: [mutualList[2]]
        }
      ];

      mockFindTopBlockersAmongMutuals.mockImplementation(async (_agent, _mutuals, onProgress) => {
        if (onProgress) onProgress({ scanned: 3, total: 3 });
        return { summaries, incompleteMoots: [] };
      });

      await loadMainModule();

      const scanMutualsBtn = document.getElementById('scan-mutuals-btn') as HTMLButtonElement;
      const statusContainer = document.getElementById('status-container')!;
      const resultsContainer = document.getElementById('results-container')!;

      scanMutualsBtn.click();
      await vi.runAllTimersAsync();

      expect(mockFetchAllMutuals).toHaveBeenCalled();
      expect(mockFindTopBlockersAmongMutuals).toHaveBeenCalled();
      expect(statusContainer.textContent).toBe('Scan complete. Found 2 moot(s) blocking other moots.');

      expect(resultsContainer.innerHTML).toContain('mutual-blocker-card');
      expect(resultsContainer.innerHTML).toContain('&lt;Blocker 1&gt;');

      const toggleBtn0 = document.getElementById('toggle-btn-0') as HTMLButtonElement;
      const container0 = document.getElementById('blocked-container-0') as HTMLElement;

      expect(container0.classList.contains('hidden')).toBe(true);
      expect(toggleBtn0.innerHTML).toContain('Blocks 2 moots');

      // Expand container 0
      toggleBtn0.click();
      expect(container0.classList.contains('hidden')).toBe(false);
      expect(toggleBtn0.innerHTML).toContain('Blocks 2 moots');

      // Collapse container 0
      toggleBtn0.click();
      expect(container0.classList.contains('hidden')).toBe(true);

      // Click toggleBtn1 to test false branch in isHidden when expanding singular mutual
      const toggleBtn1 = document.getElementById('toggle-btn-1') as HTMLButtonElement;
      const container1 = document.getElementById('blocked-container-1') as HTMLElement;
      expect(toggleBtn1.innerHTML).toContain('Blocks 1 moot');
      toggleBtn1.click();
      expect(container1.classList.contains('hidden')).toBe(false);
      toggleBtn1.click();
      expect(container1.classList.contains('hidden')).toBe(true);
    });

    it('renders empty result message when no mutuals block other mutuals', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      const mockAgent = {
        getProfile: vi.fn().mockResolvedValue({ data: { handle: 'user.bsky.social' } })
      };

      sessionStorage.setItem(
        'bsky_mutuals_cache_did:plc:user123',
        JSON.stringify([{ did: 'did:plc:m1', handle: 'm1.bsky.social' }])
      );

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: mockAgent });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue(mockAgent);

      mockFindTopBlockersAmongMutuals.mockResolvedValue({ summaries: [], incompleteMoots: [] });

      await loadMainModule();

      const scanMutualsBtn = document.getElementById('scan-mutuals-btn') as HTMLButtonElement;
      const resultsContainer = document.getElementById('results-container')!;

      scanMutualsBtn.click();
      await vi.runAllTimersAsync();

      expect(resultsContainer.innerHTML).toContain(
        'None of your moots block any of your other moots.'
      );
    });
  });

  describe('scan top blocked button workflow', () => {

    it('renders warning element and handles retry click for scanTopBlockedBtn with duplicate results', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      const m1 = { did: 'did:plc:m1', handle: 'm1' };
      const m2 = { did: 'did:plc:m2', handle: 'm2' };
      const duplicateBlocked = { blocked: m1, blockedByMutuals: [m2] };

      sessionStorage.setItem('bsky_mutuals_cache_did:plc:user123', JSON.stringify([m1, m2]));


      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: {} });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue({});

      mockFindTopBlockedAmongMutuals.mockResolvedValueOnce({
        summaries: [duplicateBlocked],
        incompleteMoots: [{ moot: m1, reason: 'timeout', partialCount: 0 }]
      }).mockResolvedValueOnce({
        summaries: [duplicateBlocked, { blocked: m2, blockedByMutuals: [m1] }],
        incompleteMoots: []
      });

      await loadMainModule();

      const scanTopBlockedBtn = document.getElementById('scan-top-blocked-btn') as HTMLButtonElement;
      scanTopBlockedBtn.click();
      await vi.runAllTimersAsync();

      const retryBtn = document.getElementById('retry-incomplete-btn') as HTMLButtonElement;
      expect(retryBtn).not.toBeNull();
      retryBtn.click();
      await vi.runAllTimersAsync();

      expect(mockFindTopBlockedAmongMutuals).toHaveBeenCalledTimes(2);
    });


    it('renders warning element and handles retry click for scanTopBlockedBtn', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      const m1 = { did: 'did:plc:m1', handle: 'm1' };
      sessionStorage.setItem('bsky_mutuals_cache_did:plc:user123', JSON.stringify([m1]));
      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: {} });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue({});

      mockFindTopBlockedAmongMutuals.mockResolvedValueOnce({
        summaries: [],
        incompleteMoots: [{ moot: m1, reason: 'timeout', partialCount: 0 }, { moot: m1, reason: 'pds_offline', partialCount: 0 }]
      }).mockResolvedValueOnce({
        summaries: [],
        incompleteMoots: [{ moot: m1, reason: 'timeout', partialCount: 0 }] // Retry returns incomplete moots so onRetry=undefined branch is hit!
      });

      await loadMainModule();

      const scanTopBlockedBtn = document.getElementById('scan-top-blocked-btn') as HTMLButtonElement;
      scanTopBlockedBtn.click();
      await vi.runAllTimersAsync();

      const retryBtn = document.getElementById('retry-incomplete-btn') as HTMLButtonElement;
      expect(retryBtn).not.toBeNull();
      retryBtn.click();
      await vi.runAllTimersAsync();

      expect(mockFindTopBlockedAmongMutuals).toHaveBeenCalledTimes(2);
    });

    it('returns early if getSession() returns null', async () => {
      mockInitOAuth.mockResolvedValue({ session: null, agent: null });
      mockGetSession.mockReturnValue(null);

      await loadMainModule();

      const scanTopBlockedBtn = document.getElementById('scan-top-blocked-btn') as HTMLButtonElement;
      scanTopBlockedBtn.click();

      expect(mockFindTopBlockedAmongMutuals).not.toHaveBeenCalled();
    });

    it('handles scenario where cached mutuals is empty array', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      sessionStorage.setItem('bsky_mutuals_cache_did:plc:user123', JSON.stringify([]));

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: {} });
      mockGetSession.mockReturnValue(mockSession);

      await loadMainModule();

      const scanTopBlockedBtn = document.getElementById('scan-top-blocked-btn') as HTMLButtonElement;
      const statusContainer = document.getElementById('status-container')!;

      scanTopBlockedBtn.click();
      await vi.runAllTimersAsync();

      expect(statusContainer.textContent).toBe('You have no mutual followers (moots) on this account.');
    });

    it('fetches mutuals when uncached, scans top blocked mutuals, renders list, and handles toggle expansion (with/without avatar & singular/plural)', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      const mockAgent = {
        getProfile: vi.fn().mockResolvedValue({ data: { handle: 'user.bsky.social' } })
      };

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: mockAgent });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue(mockAgent);

      const mutualList = [
        { did: 'did:plc:m1', handle: 'm1.bsky.social', displayName: '<Blocked 1>', avatar: 'http://m1.jpg' },
        { did: 'did:plc:m2', handle: 'm2.bsky.social', displayName: null, avatar: null },
        { did: 'did:plc:m3', handle: 'm3.bsky.social', displayName: 'M3', avatar: 'http://m3.jpg' }
      ];

      mockFetchAllMutuals.mockImplementation(async (_agent, _sub, onProgress) => {
        if (onProgress) onProgress(3);
        return mutualList;
      });

      const summaries = [
        {
          blocked: mutualList[0],
          blockedByMutuals: [mutualList[1], mutualList[2]]
        },
        {
          blocked: mutualList[1],
          blockedByMutuals: [mutualList[2]]
        }
      ];

      mockFindTopBlockedAmongMutuals.mockImplementation(async (_agent, _mutuals, onProgress) => {
        if (onProgress) onProgress({ scanned: 3, total: 3 });
        return { summaries, incompleteMoots: [] };
      });

      await loadMainModule();

      const scanTopBlockedBtn = document.getElementById('scan-top-blocked-btn') as HTMLButtonElement;
      const statusContainer = document.getElementById('status-container')!;
      const resultsContainer = document.getElementById('results-container')!;

      scanTopBlockedBtn.click();
      await vi.runAllTimersAsync();

      expect(mockFetchAllMutuals).toHaveBeenCalled();
      expect(mockFindTopBlockedAmongMutuals).toHaveBeenCalled();
      expect(statusContainer.textContent).toBe('Scan complete. Found 2 moot(s) blocked by other moots.');

      expect(resultsContainer.innerHTML).toContain('mutual-blocker-card');
      expect(resultsContainer.innerHTML).toContain('&lt;Blocked 1&gt;');

      const toggleBtn0 = document.getElementById('blocked-toggle-btn-0') as HTMLButtonElement;
      const container0 = document.getElementById('blocked-by-container-0') as HTMLElement;

      expect(container0.classList.contains('hidden')).toBe(true);
      expect(toggleBtn0.innerHTML).toContain('Blocked by 2 moots');

      // Expand container 0
      toggleBtn0.click();
      expect(container0.classList.contains('hidden')).toBe(false);
      expect(toggleBtn0.innerHTML).toContain('Blocked by 2 moots');

      // Collapse container 0
      toggleBtn0.click();
      expect(container0.classList.contains('hidden')).toBe(true);

      // Click toggleBtn1 to test false branch in isHidden when expanding singular mutual
      const toggleBtn1 = document.getElementById('blocked-toggle-btn-1') as HTMLButtonElement;
      const container1 = document.getElementById('blocked-by-container-1') as HTMLElement;
      expect(toggleBtn1.innerHTML).toContain('Blocked by 1 moot');
      toggleBtn1.click();
      expect(container1.classList.contains('hidden')).toBe(false);
      toggleBtn1.click();
      expect(container1.classList.contains('hidden')).toBe(true);
    });

    it('renders empty result message when no mutuals are blocked by other mutuals', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      const mockAgent = {
        getProfile: vi.fn().mockResolvedValue({ data: { handle: 'user.bsky.social' } })
      };

      sessionStorage.setItem(
        'bsky_mutuals_cache_did:plc:user123',
        JSON.stringify([{ did: 'did:plc:m1', handle: 'm1.bsky.social' }])
      );

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: mockAgent });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue(mockAgent);

      mockFindTopBlockedAmongMutuals.mockResolvedValue({ summaries: [], incompleteMoots: [] });

      await loadMainModule();

      const scanTopBlockedBtn = document.getElementById('scan-top-blocked-btn') as HTMLButtonElement;
      const resultsContainer = document.getElementById('results-container')!;

      scanTopBlockedBtn.click();
      await vi.runAllTimersAsync();

      expect(resultsContainer.innerHTML).toContain(
        'None of your moots are blocked by any of your other moots.'
      );
    });

    it('handles top blocked scan error gracefully in catch block (Error object & non-Error object)', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockSession = { sub: 'did:plc:user123' };
      const mockAgent = {
        getProfile: vi.fn().mockResolvedValue({ data: { handle: 'user.bsky.social' } })
      };

      sessionStorage.setItem(
        'bsky_mutuals_cache_did:plc:user123',
        JSON.stringify([{ did: 'did:plc:m1', handle: 'm1.bsky.social' }])
      );

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: mockAgent });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue(mockAgent);

      mockFindTopBlockedAmongMutuals.mockRejectedValueOnce(new Error('API failure'));

      await loadMainModule();

      const scanTopBlockedBtn = document.getElementById('scan-top-blocked-btn') as HTMLButtonElement;
      const statusContainer = document.getElementById('status-container')!;

      scanTopBlockedBtn.click();
      await vi.runAllTimersAsync();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Top Blocked Scan Error:', expect.any(Error));
      expect(statusContainer.textContent).toBe('Error: API failure');

      // Test string error rejection
      mockFindTopBlockedAmongMutuals.mockRejectedValueOnce('String failure');
      scanTopBlockedBtn.click();
      await vi.runAllTimersAsync();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Top Blocked Scan Error:', 'String failure');
      expect(statusContainer.textContent).toBe('Error: String failure');

      consoleErrorSpy.mockRestore();
    });
  });
});
