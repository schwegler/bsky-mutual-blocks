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

vi.mock('../src/bsky', () => ({
  searchActorsTypeahead: (...args: any[]) => mockSearchActorsTypeahead(...args),
  fetchAllMutuals: (...args: any[]) => mockFetchAllMutuals(...args),
  findMutualsBlockingTarget: (...args: any[]) => mockFindMutualsBlockingTarget(...args)
}));

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
        getProfile: vi.fn().mockResolvedValue({ data: { handle: 'user.bsky.social' } }),
        resolveHandle: vi.fn().mockResolvedValue({ data: { did: 'did:plc:target' } })
      };

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: mockAgent });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue(mockAgent);

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
    it('hides suggestions list if input query is less than 2 characters', async () => {
      mockInitOAuth.mockResolvedValue({ session: null, agent: null });
      mockGetSession.mockReturnValue(null);
      await loadMainModule();

      const targetInput = document.getElementById('target-input') as HTMLInputElement;
      const suggestionsList = document.getElementById('suggestions-list')!;

      suggestionsList.classList.remove('hidden');
      suggestionsList.innerHTML = '<li>Item</li>';

      targetInput.value = 'a';
      targetInput.dispatchEvent(new Event('input'));

      expect(suggestionsList.classList.contains('hidden')).toBe(true);
      expect(suggestionsList.innerHTML).toBe('');
    });

    it('debounces typeahead query and renders suggestions list (with avatar & without avatar & fallback data-handle)', async () => {
      const mockAgent = {};
      mockInitOAuth.mockResolvedValue({ session: null, agent: null });
      mockGetSession.mockReturnValue(null);
      mockGetAgent.mockReturnValue(mockAgent);
      mockSearchActorsTypeahead.mockResolvedValue([
        {
          did: 'did:plc:actor1',
          handle: 'actor1.bsky.social',
          displayName: '<Actor & 1>',
          avatar: 'https://example.com/actor1.jpg'
        },
        {
          did: 'did:plc:actor2',
          handle: 'actor2.bsky.social',
          displayName: null,
          avatar: null
        }
      ]);

      await loadMainModule();

      const targetInput = document.getElementById('target-input') as HTMLInputElement;
      const suggestionsList = document.getElementById('suggestions-list')!;

      targetInput.value = 'actor';
      targetInput.dispatchEvent(new Event('input'));

      expect(mockSearchActorsTypeahead).not.toHaveBeenCalled();
      vi.advanceTimersByTime(250);
      await vi.runAllTimersAsync();

      expect(mockSearchActorsTypeahead).toHaveBeenCalledWith(mockAgent, 'actor');
      expect(suggestionsList.classList.contains('hidden')).toBe(false);
      expect(suggestionsList.innerHTML).toContain('&lt;Actor &amp; 1&gt;');
      expect(suggestionsList.innerHTML).toContain('avatar-placeholder');

      // Click suggestion item without data-handle attribute to test fallback || ''
      const liItem2 = suggestionsList.querySelector('li[data-did="did:plc:actor2"]') as HTMLElement;
      liItem2.removeAttribute('data-handle');
      liItem2.click();

      expect(targetInput.value).toBe('');
      expect(suggestionsList.classList.contains('hidden')).toBe(true);
    });

    it('renders no suggestions list if actors result is empty', async () => {
      mockInitOAuth.mockResolvedValue({ session: null, agent: null });
      mockGetSession.mockReturnValue(null);
      mockGetAgent.mockReturnValue({});
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

    it('catches and logs error if typeahead fails', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockInitOAuth.mockResolvedValue({ session: null, agent: null });
      mockGetSession.mockReturnValue(null);
      mockGetAgent.mockReturnValue({});
      mockSearchActorsTypeahead.mockRejectedValue(new Error('Typeahead error'));

      await loadMainModule();

      const targetInput = document.getElementById('target-input') as HTMLInputElement;
      targetInput.value = 'actor';
      targetInput.dispatchEvent(new Event('input'));

      vi.advanceTimersByTime(250);
      await vi.runAllTimersAsync();

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('check button mutual block scan workflow', () => {
    it('returns early if getSession() returns null', async () => {
      mockInitOAuth.mockResolvedValue({ session: null, agent: null });
      mockGetSession.mockReturnValue(null);

      await loadMainModule();

      const checkBtn = document.getElementById('check-btn') as HTMLButtonElement;
      checkBtn.click();

      expect(mockFindMutualsBlockingTarget).not.toHaveBeenCalled();
    });

    it('alerts if target handle input is empty (without selected target DID)', async () => {
      const mockSession = { sub: 'did:plc:user123' };

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: {} });
      mockGetSession.mockReturnValue(mockSession);

      await loadMainModule();

      const targetInput = document.getElementById('target-input') as HTMLInputElement;
      const checkBtn = document.getElementById('check-btn') as HTMLButtonElement;

      targetInput.value = '   ';
      checkBtn.click();

      expect(window.alert).toHaveBeenCalledWith('Please enter a Bluesky username.');
    });

    it('shows error message if resolveHandle fails', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      const mockAgent = {
        resolveHandle: vi.fn().mockRejectedValue(new Error('Resolve error'))
      };

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: mockAgent });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue(mockAgent);

      await loadMainModule();

      const targetInput = document.getElementById('target-input') as HTMLInputElement;
      const checkBtn = document.getElementById('check-btn') as HTMLButtonElement;
      const statusContainer = document.getElementById('status-container')!;

      targetInput.value = '@invalid.handle';
      checkBtn.click();
      await vi.runAllTimersAsync();

      expect(mockAgent.resolveHandle).toHaveBeenCalledWith({ handle: 'invalid.handle' });
      expect(statusContainer.textContent).toBe('Could not resolve handle. Check spelling.');
    });

    it('handles scenario where cached mutuals is empty array', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      const mockAgent = {
        resolveHandle: vi.fn().mockResolvedValue({ data: { did: 'did:plc:target' } })
      };

      sessionStorage.setItem('bsky_mutuals_cache_did:plc:user123', JSON.stringify([]));

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: mockAgent });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue(mockAgent);

      await loadMainModule();

      const targetInput = document.getElementById('target-input') as HTMLInputElement;
      const checkBtn = document.getElementById('check-btn') as HTMLButtonElement;
      const statusContainer = document.getElementById('status-container')!;

      targetInput.value = 'target.bsky.social';
      checkBtn.click();
      await vi.runAllTimersAsync();

      expect(statusContainer.textContent).toBe('You have no mutual followers on this account.');
    });

    it('fetches mutuals when uncached, updates progress, saves to cache, and renders blockers', async () => {
      const mockSession = { sub: 'did:plc:user123' };
      const mockAgent = {
        getProfile: vi.fn().mockResolvedValue({ data: { handle: 'user.bsky.social' } }),
        resolveHandle: vi.fn().mockResolvedValue({ data: { did: 'did:plc:target' } })
      };

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: mockAgent });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue(mockAgent);

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
        return blockers;
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
        'Scan complete. Found 2 mutual(s) blocking @target.bsky.social.'
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

      mockFindMutualsBlockingTarget.mockResolvedValue([]);

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
        'None of your mutuals block this account.'
      );
    });

    it('handles scan error gracefully in catch block', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockSession = { sub: 'did:plc:user123' };
      const mockAgent = {
        getProfile: vi.fn().mockResolvedValue({ data: { handle: 'user.bsky.social' } }),
        resolveHandle: vi.fn().mockResolvedValue({ data: { did: 'did:plc:target' } })
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
      expect(checkBtn.disabled).toBe(false);
    });

    it('handles scan error with non-Error object gracefully in catch block', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockSession = { sub: 'did:plc:user123' };
      const mockAgent = {
        getProfile: vi.fn().mockResolvedValue({ data: { handle: 'user.bsky.social' } }),
        resolveHandle: vi.fn().mockResolvedValue({ data: { did: 'did:plc:target' } })
      };

      sessionStorage.setItem(
        'bsky_mutuals_cache_did:plc:user123',
        JSON.stringify([{ did: 'did:plc:m1', handle: 'm1.bsky.social' }])
      );

      mockInitOAuth.mockResolvedValue({ session: mockSession, agent: mockAgent });
      mockGetSession.mockReturnValue(mockSession);
      mockGetAgent.mockReturnValue(mockAgent);

      mockFindMutualsBlockingTarget.mockRejectedValue('String error');

      await loadMainModule();

      const targetInput = document.getElementById('target-input') as HTMLInputElement;
      const checkBtn = document.getElementById('check-btn') as HTMLButtonElement;
      const statusContainer = document.getElementById('status-container')!;

      targetInput.value = 'target.bsky.social';
      checkBtn.click();
      await vi.runAllTimersAsync();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Scan Error:', 'String error');
      expect(statusContainer.textContent).toBe('Error performing block check: String error');
    });
  });
});
