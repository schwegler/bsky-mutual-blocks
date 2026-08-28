import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInit = vi.fn();
const mockSignInClient = vi.fn();

const mockBrowserOAuthClient = vi.fn().mockImplementation(function (this: any) {
  this.init = mockInit;
  this.signIn = mockSignInClient;
});

const mockAgentConstructor = vi.fn().mockImplementation(function (this: any, session: any) {
  this.session = session;
});

vi.mock('@atproto/oauth-client-browser', () => {
  return {
    BrowserOAuthClient: mockBrowserOAuthClient
  };
});

vi.mock('@atproto/api', () => {
  return {
    Agent: mockAgentConstructor
  };
});

describe('oauth module', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('initOAuth', () => {
    it('initializes OAuth client in local environment (127.0.0.1) and handles session presence', async () => {
      Object.defineProperty(window, 'location', {
        value: {
          hostname: '127.0.0.1',
          origin: 'http://127.0.0.1:5173'
        },
        writable: true
      });

      const mockSession = { sub: 'did:plc:user123', signOut: vi.fn() };
      mockInit.mockResolvedValue({ session: mockSession });

      const oauth = await import('../src/oauth');
      const result = await oauth.initOAuth();

      expect(mockBrowserOAuthClient).toHaveBeenCalledWith({
        handleResolver: 'https://bsky.social',
        clientMetadata: expect.objectContaining({
          client_id: 'http://127.0.0.1:5173/client-metadata.json',
          client_uri: 'http://127.0.0.1:5173/',
          redirect_uris: ['http://127.0.0.1:5173/']
        })
      });

      expect(mockInit).toHaveBeenCalled();
      expect(mockAgentConstructor).toHaveBeenCalledWith(mockSession);
      expect(result).toEqual({ session: mockSession, agent: { session: mockSession } });
      expect(oauth.getSession()).toBe(mockSession);
      expect(oauth.getAgent()).toEqual({ session: mockSession } as any);
    });

    it('initializes OAuth client in non-local environment when hostname is localhost or external domain, and handles null session', async () => {
      Object.defineProperty(window, 'location', {
        value: {
          hostname: 'localhost',
          origin: 'http://localhost:5173'
        },
        writable: true
      });

      mockInit.mockResolvedValue(null);

      const oauth = await import('../src/oauth');
      const result = await oauth.initOAuth();

      expect(mockBrowserOAuthClient).toHaveBeenCalledWith({
        handleResolver: 'https://bsky.social',
        clientMetadata: expect.objectContaining({
          client_id: 'http://127.0.0.1:5173/client-metadata.json'
        })
      });

      expect(result).toEqual({ session: null, agent: null });
      expect(oauth.getSession()).toBeNull();
      expect(() => oauth.getAgent()).toThrow('User not authenticated');

      // Test external domain
      vi.resetModules();
      Object.defineProperty(window, 'location', {
        value: {
          hostname: 'bsky-mutual-blocks.pages.dev',
          origin: 'https://bsky-mutual-blocks.pages.dev'
        },
        writable: true
      });

      mockInit.mockResolvedValue({});

      const oauthExternal = await import('../src/oauth');
      await oauthExternal.initOAuth();

      expect(mockBrowserOAuthClient).toHaveBeenCalledWith({
        handleResolver: 'https://bsky.social',
        clientMetadata: expect.objectContaining({
          client_id: 'https://bsky-mutual-blocks.pages.dev/client-metadata.json'
        })
      });
    });
  });

  describe('signIn', () => {
    it('throws error if OAuth client is not initialized', async () => {
      const oauth = await import('../src/oauth');
      await expect(oauth.signIn('alice.bsky.social')).rejects.toThrow(
        'OAuth client is not initialized'
      );
    });

    it('trims handle and calls oauthClient.signIn when initialized', async () => {
      mockInit.mockResolvedValue(null);
      mockSignInClient.mockResolvedValue(undefined);

      const oauth = await import('../src/oauth');
      await oauth.initOAuth();
      await oauth.signIn('  alice.bsky.social  ');

      expect(mockSignInClient).toHaveBeenCalledWith('alice.bsky.social');
    });
  });

  describe('signOut', () => {
    it('does nothing when no current session exists', async () => {
      mockInit.mockResolvedValue(null);

      const oauth = await import('../src/oauth');
      await oauth.initOAuth();
      await oauth.signOut();

      expect(oauth.getSession()).toBeNull();
    });

    it('calls currentSession.signOut and clears currentSession and currentAgent', async () => {
      const mockSignOutSession = vi.fn().mockResolvedValue(undefined);
      const mockSession = { sub: 'did:plc:user123', signOut: mockSignOutSession };

      mockInit.mockResolvedValue({ session: mockSession });

      const oauth = await import('../src/oauth');
      await oauth.initOAuth();

      expect(oauth.getSession()).toBe(mockSession);
      expect(oauth.getAgent()).toBeDefined();

      await oauth.signOut();

      expect(mockSignOutSession).toHaveBeenCalled();
      expect(oauth.getSession()).toBeNull();
      expect(() => oauth.getAgent()).toThrow('User not authenticated');
    });
  });
});
