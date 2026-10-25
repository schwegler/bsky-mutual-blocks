import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '@atproto/api';
import { get, set } from 'idb-keyval';
import {
  resolveActor,
  mapConcurrent,
  searchActorsTypeahead,
  fetchAllMutuals,
  fetchAllUserBlocks
} from '../src/bsky';

describe('bsky module', () => {




const originalFetch = global.fetch;
beforeEach(() => {
  global.fetch = vi.fn().mockImplementation(async (url) => {
    if (url.includes('plc.directory')) {
      return { ok: true, json: async () => ({ service: [{ id: '#atproto_pds', serviceEndpoint: 'https://mock.pds' }] }) };
    }
    if (url.includes('com.atproto.repo.listRecords')) {
      const urlObj = new URL(url);
      const repo = urlObj.searchParams.get('repo');
      
      if (repo === 'did:plc:mutual0' || repo === 'did:plc:mutual2') {
        return { ok: true, json: async () => ({ records: [{ value: { subject: 'did:plc:resolvedTarget' } }] }) };
      }
      if (repo === 'did:plc:m1') {
        return { ok: true, json: async () => ({ records: [{ value: { subject: 'did:plc:m2' } }, { value: { subject: 'did:plc:m3' } }, { value: { subject: 'did:plc:missing' } }] }) };
      }
      if (repo === 'did:plc:m2') {
        return { ok: true, json: async () => ({ records: [{ value: { subject: 'did:plc:m3' } }] }) };
      }
      if (repo === 'did:plc:blockerX') {
         return { ok: true, json: async () => ({ records: [{ value: { subject: 'did:plc:m1' } }, { value: { subject: 'did:plc:blockedY' } }] }) };
      }
      
      if (url.includes('missing')) return { ok: true, json: async () => ({ records: [] }) };
      
      return { ok: true, json: async () => ({ records: [] }) };
    }
    return { ok: false };
  });
});
afterEach(() => {
  global.fetch = originalFetch;
});

  describe('resolveActor', () => {
    it('throws error if input handle/DID is empty or whitespace', async () => {
      const mockAgent = {} as Agent;
      await expect(resolveActor(mockAgent, '')).rejects.toThrow('Input handle or DID cannot be empty');
      await expect(resolveActor(mockAgent, '   ')).rejects.toThrow('Input handle or DID cannot be empty');
    });

    it('resolves DID input directly with agent.getProfile if available', async () => {
      const mockProfile = { did: 'did:plc:123', handle: 'target.bsky.social' };
      const getProfileMock = vi.fn().mockResolvedValue({ data: mockProfile });
      const mockAgent = { getProfile: getProfileMock } as unknown as Agent;

      const result = await resolveActor(mockAgent, 'did:plc:123');
      expect(getProfileMock).toHaveBeenCalledWith({ actor: 'did:plc:123' });
      expect(result).toEqual({ did: 'did:plc:123', profile: mockProfile });
    });

    it('resolves DID input via agent.app.bsky.actor.getProfile when agent.getProfile is absent', async () => {
      const mockProfile = { did: 'did:plc:123', handle: 'target.bsky.social' };
      const getProfileMock = vi.fn().mockResolvedValue({ data: mockProfile });
      const mockAgent = {
        app: { bsky: { actor: { getProfile: getProfileMock } } }
      } as unknown as Agent;

      const result = await resolveActor(mockAgent, 'did:plc:123');
      expect(getProfileMock).toHaveBeenCalledWith({ actor: 'did:plc:123' });
      expect(result).toEqual({ did: 'did:plc:123', profile: mockProfile });
    });

    it('returns DID object if DID input profile lookup fails', async () => {
      const getProfileMock = vi.fn().mockRejectedValue(new Error('Profile error'));
      const mockAgent = { getProfile: getProfileMock } as unknown as Agent;

      const result = await resolveActor(mockAgent, 'did:plc:123');
      expect(result).toEqual({ did: 'did:plc:123' });
    });

    it('resolves handle input via agent.getProfile', async () => {
      const mockProfile = { did: 'did:plc:456', handle: 'user.bsky.social' };
      const getProfileMock = vi.fn().mockResolvedValue({ data: mockProfile });
      const mockAgent = { getProfile: getProfileMock } as unknown as Agent;

      const result = await resolveActor(mockAgent, '@user.bsky.social');
      expect(getProfileMock).toHaveBeenCalledWith({ actor: 'user.bsky.social' });
      expect(result).toEqual({ did: 'did:plc:456', profile: mockProfile });
    });

    it('falls back to resolveHandle when getProfile fails for handle input', async () => {
      const getProfileMock = vi.fn().mockRejectedValue(new Error('Profile not found'));
      const resolveHandleMock = vi.fn().mockResolvedValue({ data: { did: 'did:plc:789' } });
      const mockAgent = {
        getProfile: getProfileMock,
        resolveHandle: resolveHandleMock
      } as unknown as Agent;

      const result = await resolveActor(mockAgent, 'user.bsky.social');
      expect(resolveHandleMock).toHaveBeenCalledWith({ handle: 'user.bsky.social' });
      expect(result).toEqual({ did: 'did:plc:789' });
    });

    it('falls back to agent.com.atproto.identity.resolveHandle when agent.resolveHandle is absent', async () => {
      const getProfileMock = vi.fn().mockRejectedValue(new Error('Profile not found'));
      const resolveHandleMock = vi.fn().mockResolvedValue({ data: { did: 'did:plc:abc' } });
      const mockAgent = {
        app: { bsky: { actor: { getProfile: getProfileMock } } },
        com: { atproto: { identity: { resolveHandle: resolveHandleMock } } }
      } as unknown as Agent;

      const result = await resolveActor(mockAgent, 'user.bsky.social');
      expect(resolveHandleMock).toHaveBeenCalledWith({ handle: 'user.bsky.social' });
      expect(result).toEqual({ did: 'did:plc:abc' });
    });

    it('bubbles the error when both getProfile and resolveHandle fail for handle input', async () => {
      const getProfileMock = vi.fn().mockRejectedValue(new Error('Profile fetch failed'));
      const resolveHandleMock = vi.fn().mockRejectedValue(new Error('Handle resolution failed'));
      const mockAgent = {
        getProfile: getProfileMock,
        resolveHandle: resolveHandleMock
      } as unknown as Agent;

      await expect(resolveActor(mockAgent, 'user.bsky.social')).rejects.toThrow('Handle resolution failed');
      expect(getProfileMock).toHaveBeenCalledWith({ actor: 'user.bsky.social' });
      expect(resolveHandleMock).toHaveBeenCalledWith({ handle: 'user.bsky.social' });
    });
  });
  describe('mapConcurrent', () => {
    it('returns empty array when items array is empty', async () => {
      const results = await mapConcurrent([], 5, async (x) => x);
      expect(results).toEqual([]);
    });

    it('processes items concurrently with concurrency limit while preserving order', async () => {
      const items = [1, 2, 3, 4, 5];
      let activeWorkers = 0;
      let maxActiveWorkers = 0;

      const results = await mapConcurrent(items, 2, async (item) => {
        activeWorkers++;
        if (activeWorkers > maxActiveWorkers) {
          maxActiveWorkers = activeWorkers;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeWorkers--;
        return item * 10;
      });

      expect(maxActiveWorkers).toBeLessThanOrEqual(2);
      expect(results).toEqual([10, 20, 30, 40, 50]);
    });

    it('propagates rejection when map function throws or rejects asynchronously', async () => {
      const items = [1, 2, 3, 4, 5];
      const errorMsg = 'Worker processing failed';

      await expect(
        mapConcurrent(items, 2, async (item) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          if (item === 3) {
            throw new Error(errorMsg);
          }
          return item * 10;
        })
      ).rejects.toThrow(errorMsg);
    });
  });

  describe('searchActorsTypeahead', () => {
    it('returns empty array when query is empty or whitespace', async () => {
      const mockAgent = {} as Agent;
      const resultEmpty = await searchActorsTypeahead(mockAgent, '');
      const resultWhitespace = await searchActorsTypeahead(mockAgent, '   ');

      expect(resultEmpty).toEqual([]);
      expect(resultWhitespace).toEqual([]);
    });

    it('trims query and calls agent.app.bsky.actor.searchActorsTypeahead', async () => {
      const mockActors = [
        { did: 'did:plc:1', handle: 'alice.bsky.social' },
        { did: 'did:plc:2', handle: 'bob.bsky.social' }
      ];
      const searchActorsTypeaheadMock = vi.fn().mockResolvedValue({
        data: { actors: mockActors }
      });
      const mockAgent = {
        app: {
          bsky: {
            actor: {
              searchActorsTypeahead: searchActorsTypeaheadMock
            }
          }
        }
      } as unknown as Agent;

      const results = await searchActorsTypeahead(mockAgent, '  alice  ');

      expect(searchActorsTypeaheadMock).toHaveBeenCalledWith({
        q: 'alice',
        limit: 8
      });
      expect(results).toEqual(mockActors);
    });
  });

  describe('fetchAllMutuals', () => {
    it('fetches all mutual followers, handling pagination and filtering non-mutuals', async () => {
      const getFollowsMock = vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            cursor: 'page2',
            follows: [
              {
                did: 'did:plc:mutual1',
                handle: 'mutual1.bsky.social',
                displayName: 'Mutual One',
                avatar: 'https://example.com/avatar1.jpg',
                viewer: { followedBy: 'at://did:plc:user/app.bsky.graph.follow/1' }
              },
              {
                did: 'did:plc:nonmutual',
                handle: 'nonmutual.bsky.social',
                viewer: {}
              }
            ]
          }
        })
        .mockResolvedValueOnce({
          data: {
            cursor: undefined,
            follows: [
              {
                did: 'did:plc:mutual2',
                handle: 'mutual2.bsky.social',
                viewer: { followedBy: 'at://did:plc:user/app.bsky.graph.follow/2' }
              }
            ]
          }
        });

      const mockAgent = {
        app: {
          bsky: {
            graph: {
              getFollows: getFollowsMock
            }
          }
        }
      } as unknown as Agent;

      const progressCallback = vi.fn();
      const mutuals = await fetchAllMutuals(mockAgent, 'did:plc:user', progressCallback);

      expect(getFollowsMock).toHaveBeenCalledTimes(2);
      expect(getFollowsMock).toHaveBeenNthCalledWith(1, {
        actor: 'did:plc:user',
        limit: 100,
        cursor: undefined
      });
      expect(getFollowsMock).toHaveBeenNthCalledWith(2, {
        actor: 'did:plc:user',
        limit: 100,
        cursor: 'page2'
      });

      expect(progressCallback).toHaveBeenCalledWith(1);
      expect(progressCallback).toHaveBeenCalledWith(2);

      expect(mutuals).toEqual([
        {
          did: 'did:plc:mutual1',
          handle: 'mutual1.bsky.social',
          displayName: 'Mutual One',
          avatar: 'https://example.com/avatar1.jpg'
        },
        {
          did: 'did:plc:mutual2',
          handle: 'mutual2.bsky.social',
          displayName: undefined,
          avatar: undefined
        }
      ]);
    });

    it('works without onProgress callback', async () => {
      const getFollowsMock = vi.fn().mockResolvedValueOnce({
        data: {
          cursor: undefined,
          follows: []
        }
      });
      const mockAgent = {
        app: {
          bsky: {
            graph: {
              getFollows: getFollowsMock
            }
          }
        }
      } as unknown as Agent;

      const mutuals = await fetchAllMutuals(mockAgent, 'did:plc:user');
      expect(mutuals).toEqual([]);
    });

    it('handles duplicate cursor from getFollows without infinite loop', async () => {
      const getFollowsMock = vi.fn().mockResolvedValue({
        data: {
          cursor: 'repeatCursor',
          follows: [
            {
              did: 'did:plc:mutual1',
              handle: 'mutual1.bsky.social',
              viewer: { followedBy: 'at://follow1' }
            }
          ]
        }
      });
      const mockAgent = {
        app: {
          bsky: {
            graph: {
              getFollows: getFollowsMock
            }
          }
        }
      } as unknown as Agent;

      await expect(fetchAllMutuals(mockAgent, 'did:plc:user')).rejects.toThrow('pagination cursor');
      expect(getFollowsMock).toHaveBeenCalledTimes(2);
    });

    it('terminates pagination when follows is empty even if cursor is provided', async () => {
      const getFollowsMock = vi.fn().mockResolvedValue({
        data: {
          cursor: 'extraCursor',
          follows: []
        }
      });
      const mockAgent = {
        app: {
          bsky: {
            graph: {
              getFollows: getFollowsMock
            }
          }
        }
      } as unknown as Agent;

      const mutuals = await fetchAllMutuals(mockAgent, 'did:plc:user');
      expect(getFollowsMock).toHaveBeenCalledTimes(1);
      expect(mutuals).toEqual([]);
    });
  });

  describe('fetchAllUserBlocks', () => {
    it('returns cached blocks if cache is fresh (< 24h)', async () => {
      await set('blocks_did:plc:cachedUser', {
        timestamp: Date.now(),
        blockedDids: ['did:plc:target1', 'did:plc:target2']
      });

      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      const result = await fetchAllUserBlocks('did:plc:cachedUser');
      expect(result).toEqual({ blockedDids: ['did:plc:target1', 'did:plc:target2'], isComplete: true });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('warns and continues if cache read throws an error', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(get).mockRejectedValueOnce(new Error('IDB read failure'));

      const result = await fetchAllUserBlocks('did:plc:mutual0');
      expect(result).toEqual({ blockedDids: ['did:plc:resolvedTarget'], isComplete: true });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Cache read failed for did:plc:mutual0',
        expect.any(Error)
      );
      consoleWarnSpy.mockRestore();
    });

    it('refetches when cache entry is expired (> 24h)', async () => {
      await set('blocks_did:plc:mutual0', {
        timestamp: Date.now() - (25 * 60 * 60 * 1000),
        blockedDids: ['did:plc:oldBlock']
      });

      const result = await fetchAllUserBlocks('did:plc:mutual0');
      expect(result).toEqual({ blockedDids: ['did:plc:resolvedTarget'], isComplete: true });
    });

    it('resolves did:plc: and fetches block records with pagination and parses subjects', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url === 'https://plc.directory/did:plc:paginated') {
          return {
            ok: true,
            json: async () => ({
              service: [{ id: '#atproto_pds', serviceEndpoint: 'https://pds.example.com' }]
            })
          };
        }
        if (url.includes('com.atproto.repo.listRecords') && !url.includes('cursor=')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              cursor: 'cursor2',
              records: [
                { value: { subject: 'did:plc:target1' } },
                { value: {} } // without subject
              ]
            })
          };
        }
        if (url.includes('cursor=cursor2')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              cursor: undefined,
              records: [
                { value: { subject: 'did:plc:target2' } }
              ]
            })
          };
        }
        return { ok: false, status: 404 };
      });

      const result = await fetchAllUserBlocks('did:plc:paginated');
      expect(result).toEqual({ blockedDids: ['did:plc:target1', 'did:plc:target2'], isComplete: true });
    });

    it('resolves did:web: by fetching .well-known/did.json and parses block records', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url === 'https://alice.example.com/.well-known/did.json') {
          return {
            ok: true,
            json: async () => ({
              service: [{ id: '#atproto_pds', serviceEndpoint: 'https://pds.web.com' }]
            })
          };
        }
        if (url.startsWith('https://pds.web.com')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              records: [{ value: { subject: 'did:plc:blockedByWeb' } }]
            })
          };
        }
        return { ok: false, status: 404 };
      });

      const result = await fetchAllUserBlocks('did:web:alice.example.com');
      expect(result).toEqual({ blockedDids: ['did:plc:blockedByWeb'], isComplete: true });
    });

    it('returns error result if did:plc: has no #atproto_pds or response is not ok', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url === 'https://plc.directory/did:plc:nopds') {
          return {
            ok: true,
            json: async () => ({ service: [{ id: '#other_service', serviceEndpoint: 'https://other.com' }] })
          };
        }
        if (url === 'https://plc.directory/did:plc:noservice') {
          return {
            ok: true,
            json: async () => ({})
          };
        }
        if (url === 'https://plc.directory/did:plc:notok') {
          return { ok: false };
        }
        return { ok: false };
      });

      expect(await fetchAllUserBlocks('did:plc:nopds')).toEqual({ blockedDids: [], isComplete: false, errorReason: 'invalid_pds' });
      expect(await fetchAllUserBlocks('did:plc:noservice')).toEqual({ blockedDids: [], isComplete: false, errorReason: 'invalid_pds' });
      expect(await fetchAllUserBlocks('did:plc:notok')).toEqual({ blockedDids: [], isComplete: false, errorReason: 'pds_offline' });
    });

    it('returns error result if did:web: has no #atproto_pds or response is not ok', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url === 'https://nopds.com/.well-known/did.json') {
          return {
            ok: true,
            json: async () => ({ service: [{ id: '#other_service' }] })
          };
        }
        if (url === 'https://noservice.com/.well-known/did.json') {
          return {
            ok: true,
            json: async () => ({})
          };
        }
        if (url === 'https://notok.com/.well-known/did.json') {
          return { ok: false };
        }
        return { ok: false };
      });

      expect(await fetchAllUserBlocks('did:web:nopds.com')).toEqual({ blockedDids: [], isComplete: false, errorReason: 'invalid_pds' });
      expect(await fetchAllUserBlocks('did:web:noservice.com')).toEqual({ blockedDids: [], isComplete: false, errorReason: 'invalid_pds' });
      expect(await fetchAllUserBlocks('did:web:notok.com')).toEqual({ blockedDids: [], isComplete: false, errorReason: 'pds_offline' });
    });

    it('returns error result if DID format is unsupported (not did:plc or did:web)', async () => {
      expect(await fetchAllUserBlocks('did:key:z6Mku...')).toEqual({ blockedDids: [], isComplete: false, errorReason: 'invalid_pds' });
    });

    it('handles 429 status code with retry and backoff, succeeding on retry', async () => {
      vi.useFakeTimers();
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('plc.directory')) {
          return {
            ok: true,
            json: async () => ({
              service: [{ id: '#atproto_pds', serviceEndpoint: 'https://mock.pds' }]
            })
          };
        }
        if (url.includes('com.atproto.repo.listRecords')) {
          callCount++;
          if (callCount === 1) {
            return { status: 429, ok: false };
          }
          return {
            status: 200,
            ok: true,
            json: async () => ({ records: [{ value: { subject: 'did:plc:retriedTarget' } }] })
          };
        }
        return { ok: false };
      });

      const promise = fetchAllUserBlocks('did:plc:rateLimited', 3);
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result).toEqual({ blockedDids: ['did:plc:retriedTarget'], isComplete: true });
      expect(callCount).toBe(2);
      vi.useRealTimers();
    });

    it('handles 429 status code exceeding maxRetries, returning current blocks with rate_limit error reason', async () => {
      vi.useFakeTimers();
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('plc.directory')) {
          return {
            ok: true,
            json: async () => ({
              service: [{ id: '#atproto_pds', serviceEndpoint: 'https://mock.pds' }]
            })
          };
        }
        if (url.includes('com.atproto.repo.listRecords')) {
          return { status: 429, ok: false };
        }
        return { ok: false };
      });

      const promise = fetchAllUserBlocks('did:plc:rateLimitedForever', 1);
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result).toEqual({ blockedDids: [], isComplete: false, errorReason: 'rate_limit' });
      vi.useRealTimers();
    });

    it('handles !response.ok from PDS (e.g. 404, 500) and returns current blocks with pds_offline error reason', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('plc.directory')) {
          return {
            ok: true,
            json: async () => ({
              service: [{ id: '#atproto_pds', serviceEndpoint: 'https://mock.pds' }]
            })
          };
        }
        if (url.includes('com.atproto.repo.listRecords')) {
          return { status: 500, ok: false };
        }
        return { ok: false };
      });

      const result = await fetchAllUserBlocks('did:plc:serverError');
      expect(result).toEqual({ blockedDids: [], isComplete: false, errorReason: 'pds_offline' });
    });

    it('handles missing records in response and returns current blocks with pds_offline error reason', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('plc.directory')) {
          return {
            ok: true,
            json: async () => ({
              service: [{ id: '#atproto_pds', serviceEndpoint: 'https://mock.pds' }]
            })
          };
        }
        if (url.includes('com.atproto.repo.listRecords')) {
          return { status: 200, ok: true, json: async () => ({}) };
        }
        return { ok: false };
      });

      const result = await fetchAllUserBlocks('did:plc:noRecords');
      expect(result).toEqual({ blockedDids: [], isComplete: false, errorReason: 'pds_offline' });
    });

    it('handles non-429 exception thrown during record fetching loop and returns current blocks', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('plc.directory')) {
          return {
            ok: true,
            json: async () => ({
              service: [{ id: '#atproto_pds', serviceEndpoint: 'https://mock.pds' }]
            })
          };
        }
        if (url.includes('com.atproto.repo.listRecords')) {
          return {
            ok: true,
            status: 200,
            json: async () => {
              throw new Error('Malformed JSON');
            }
          };
        }
        return { ok: false };
      });

      const result = await fetchAllUserBlocks('did:plc:jsonError');
      expect(result).toEqual({ blockedDids: [], isComplete: false, errorReason: 'pds_offline' });
    });

    it('warns when cache write throws an error', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(set).mockRejectedValueOnce(new Error('IDB write failure'));

      const result = await fetchAllUserBlocks('did:plc:mutual0');
      expect(result).toEqual({ blockedDids: ['did:plc:resolvedTarget'], isComplete: true });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Cache write failed for did:plc:mutual0',
        expect.any(Error)
      );
      consoleWarnSpy.mockRestore();
    });

    it('handles 429 status code on paginated request (page 2) exceeding maxRetries, returning partial blocks without infinite loop', async () => {
      vi.useFakeTimers();
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('plc.directory')) {
          return {
            ok: true,
            json: async () => ({
              service: [{ id: '#atproto_pds', serviceEndpoint: 'https://mock.pds' }]
            })
          };
        }
        if (url.includes('com.atproto.repo.listRecords')) {
          callCount++;
          if (!url.includes('cursor=')) {
            // First page succeeds
            return {
              ok: true,
              status: 200,
              json: async () => ({
                cursor: 'page2cursor',
                records: [{ value: { subject: 'did:plc:page1Subject' } }]
              })
            };
          } else {
            // Second page always 429s
            return { status: 429, ok: false };
          }
        }
        return { ok: false };
      });

      const promise = fetchAllUserBlocks('did:plc:rateLimitedPage2', 2);
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result).toEqual({ blockedDids: ['did:plc:page1Subject'], isComplete: false, errorReason: 'rate_limit' });
      // 1 call for page 1, 2 calls (initial + retry) for page 2
      expect(callCount).toBe(3);
      vi.useRealTimers();
    });

    it('handles duplicate or looping cursor from broken PDS without infinite loop', async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('plc.directory')) {
          return {
            ok: true,
            json: async () => ({
              service: [{ id: '#atproto_pds', serviceEndpoint: 'https://mock.pds' }]
            })
          };
        }
        if (url.includes('com.atproto.repo.listRecords')) {
          callCount++;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              cursor: 'sameCursor',
              records: [{ value: { subject: `did:plc:sub_${callCount}` } }]
            })
          };
        }
        return { ok: false };
      });

      const result = await fetchAllUserBlocks('did:plc:duplicateCursor');
      expect(callCount).toBe(2); // Initial call (returns sameCursor), second call with cursor=sameCursor terminates
      expect(result.blockedDids).toHaveLength(2);
      expect(result.isComplete).toBe(false);
    });

    it('handles invalid or non-http/https PDS endpoint gracefully', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('plc.directory')) {
          return {
            ok: true,
            json: async () => ({
              service: [{ id: '#atproto_pds', serviceEndpoint: 'ftp://invalid-protocol.com' }]
            })
          };
        }
        return { ok: false };
      });

      const result = await fetchAllUserBlocks('did:plc:invalidPds');
      expect(result).toEqual({ blockedDids: [], isComplete: false, errorReason: 'invalid_pds' });
    });

    it('handles top-level fetch exception (e.g. network failure or timeout abort)', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error / AbortError'));

      const result = await fetchAllUserBlocks('did:plc:networkFail');
      expect(result).toEqual({ blockedDids: [], isComplete: false, errorReason: 'pds_offline' });
    });
  });

});
