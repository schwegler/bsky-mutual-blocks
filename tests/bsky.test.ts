import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '@atproto/api';
import { get, set } from 'idb-keyval';
import {
  resolveActor,
  mapConcurrent,
  searchActorsTypeahead,
  fetchAllMutuals,
  fetchAllUserBlocks,
  findMutualsBlockingTarget,
  findTopBlockersAmongMutuals,
  findMutualsBlockingMutuals,
  findTopBlockedAmongMutuals,
  findMutualsBlockedByMutuals,
  MutualProfile
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
  });

  describe('fetchAllUserBlocks', () => {
    it('returns cached blocks if cache is fresh (< 24h)', async () => {
      await set('blocks_did:plc:cachedUser', {
        timestamp: Date.now(),
        blockedDids: ['did:plc:target1', 'did:plc:target2']
      });

      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      const blocks = await fetchAllUserBlocks('did:plc:cachedUser');
      expect(blocks).toEqual(['did:plc:target1', 'did:plc:target2']);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('warns and continues if cache read throws an error', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(get).mockRejectedValueOnce(new Error('IDB read failure'));

      const blocks = await fetchAllUserBlocks('did:plc:mutual0');
      expect(blocks).toEqual(['did:plc:resolvedTarget']);
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

      const blocks = await fetchAllUserBlocks('did:plc:mutual0');
      expect(blocks).toEqual(['did:plc:resolvedTarget']);
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

      const blocks = await fetchAllUserBlocks('did:plc:paginated');
      expect(blocks).toEqual(['did:plc:target1', 'did:plc:target2']);
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

      const blocks = await fetchAllUserBlocks('did:web:alice.example.com');
      expect(blocks).toEqual(['did:plc:blockedByWeb']);
    });

    it('returns empty array if did:plc: has no #atproto_pds or response is not ok', async () => {
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

      expect(await fetchAllUserBlocks('did:plc:nopds')).toEqual([]);
      expect(await fetchAllUserBlocks('did:plc:noservice')).toEqual([]);
      expect(await fetchAllUserBlocks('did:plc:notok')).toEqual([]);
    });

    it('returns empty array if did:web: has no #atproto_pds or response is not ok', async () => {
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

      expect(await fetchAllUserBlocks('did:web:nopds.com')).toEqual([]);
      expect(await fetchAllUserBlocks('did:web:noservice.com')).toEqual([]);
      expect(await fetchAllUserBlocks('did:web:notok.com')).toEqual([]);
    });

    it('returns empty array if DID format is unsupported (not did:plc or did:web)', async () => {
      expect(await fetchAllUserBlocks('did:key:z6Mku...')).toEqual([]);
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
      const blocks = await promise;
      expect(blocks).toEqual(['did:plc:retriedTarget']);
      expect(callCount).toBe(2);
      vi.useRealTimers();
    });

    it('handles 429 status code exceeding maxRetries, returning current blocks', async () => {
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
      const blocks = await promise;
      expect(blocks).toEqual([]);
      vi.useRealTimers();
    });

    it('handles !response.ok from PDS (e.g. 404, 500) and returns current blocks', async () => {
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

      const blocks = await fetchAllUserBlocks('did:plc:serverError');
      expect(blocks).toEqual([]);
    });

    it('handles missing records in response and returns current blocks', async () => {
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

      const blocks = await fetchAllUserBlocks('did:plc:noRecords');
      expect(blocks).toEqual([]);
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

      const blocks = await fetchAllUserBlocks('did:plc:jsonError');
      expect(blocks).toEqual([]);
    });

    it('warns when cache write throws an error', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(set).mockRejectedValueOnce(new Error('IDB write failure'));

      const blocks = await fetchAllUserBlocks('did:plc:mutual0');
      expect(blocks).toEqual(['did:plc:resolvedTarget']);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Cache write failed for did:plc:mutual0',
        expect.any(Error)
      );
      consoleWarnSpy.mockRestore();
    });

    it('handles top-level fetch exception (e.g. network failure)', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const blocks = await fetchAllUserBlocks('did:plc:networkFail');
      expect(blocks).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error fetching blocks for',
        'did:plc:networkFail',
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
    });
  });

  describe('findMutualsBlockingTarget', () => {
    it('scans blocks concurrently across mutuals, resolves handle target, identifies blockers, and reports progress', async () => {
      const m0: MutualProfile = { did: 'did:plc:mutual0', handle: 'mutual0.bsky.social' };
      const m1: MutualProfile = { did: 'did:plc:mutual1', handle: 'mutual1.bsky.social' };
      const m2: MutualProfile = { did: 'did:plc:mutual2', handle: 'mutual2.bsky.social' };
      const mutuals = [m0, m1, m2];

      const getProfileMock = vi.fn().mockResolvedValue({
        data: { did: 'did:plc:resolvedTarget', handle: 'britculpsapp.bsky.social' }
      });

      const listRecordsMock = vi.fn().mockImplementation(({ repo }) => {
        if (repo === 'did:plc:mutual0') {
          return Promise.resolve({
            data: {
              cursor: undefined,
              records: [{ value: { subject: 'did:plc:resolvedTarget' } }]
            }
          });
        }
        if (repo === 'did:plc:mutual2') {
          return Promise.resolve({
            data: {
              cursor: undefined,
              records: [{ value: { subject: 'did:plc:resolvedTarget' } }]
            }
          });
        }
        return Promise.resolve({ data: { cursor: undefined, records: [] } });
      });

      const mockAgent = {
        getProfile: getProfileMock,
        com: { atproto: { repo: { listRecords: listRecordsMock } } }
      } as unknown as Agent;

      const progressCallback = vi.fn();
      const blockers = await findMutualsBlockingTarget(
        mockAgent,
        'britculpsapp.bsky.social',
        mutuals,
        progressCallback
      );

      expect(getProfileMock).toHaveBeenCalledWith({ actor: 'britculpsapp.bsky.social' });
      expect(progressCallback).toHaveBeenCalledWith({ scanned: expect.any(Number), total: 3 });
      expect(blockers).toHaveLength(2);
      expect(blockers).toEqual(expect.arrayContaining([m0, m2]));
    });

    it('works without onProgress callback and falls back to targetInput if resolution fails', async () => {
      const m0: MutualProfile = { did: 'did:plc:mutual0', handle: 'mutual0.bsky.social' };
      const getProfileMock = vi.fn().mockRejectedValue(new Error('Resolve error'));
      const resolveHandleMock = vi.fn().mockRejectedValue(new Error('Resolve handle error'));

      const listRecordsMock = vi.fn().mockResolvedValue({
        data: { cursor: undefined, records: [] }
      });

      const mockAgent = {
        getProfile: getProfileMock,
        resolveHandle: resolveHandleMock,
        com: { atproto: { repo: { listRecords: listRecordsMock } } }
      } as unknown as Agent;

      const blockers = await findMutualsBlockingTarget(
        mockAgent,
        'did:plc:unresolvedTarget',
        [m0]
      );

      expect(blockers).toEqual([]);
    });

  });

  describe('findTopBlockersAmongMutuals', () => {
    it('aggregates direct block records, sorts blockers descending, and reports progress', async () => {
      const m1: MutualProfile = { did: 'did:plc:m1', handle: 'm1.bsky.social' };
      const m2: MutualProfile = { did: 'did:plc:m2', handle: 'm2.bsky.social' };
      const m3: MutualProfile = { did: 'did:plc:m3', handle: 'm3.bsky.social' };

      const mutuals = [m1, m2, m3];

      // m1 blocks m2 and m3 (and non-mutual did:plc:nonmutual)
      // m2 blocks m3
      // m3 blocks nobody
      const listRecordsMock = vi.fn().mockImplementation(({ repo }) => {
        if (repo === 'did:plc:m1') {
          return Promise.resolve({
            data: {
              cursor: undefined,
              records: [
                { value: { subject: 'did:plc:m2' } },
                { value: { subject: 'did:plc:m3' } },
                { value: { subject: 'did:plc:m1' } }, // Self block check filter
                { value: { subject: 'did:plc:nonmutual' } }
              ]
            }
          });
        }
        if (repo === 'did:plc:m2') {
          return Promise.resolve({
            data: {
              cursor: undefined,
              records: [{ value: { subject: 'did:plc:m3' } }]
            }
          });
        }
        return Promise.resolve({
          data: {
            cursor: undefined,
            records: []
          }
        });
      });

      const mockAgent = {
        com: {
          atproto: {
            repo: {
              listRecords: listRecordsMock
            }
          }
        }
      } as unknown as Agent;

      const progressCallback = vi.fn();
      const summaries = await findTopBlockersAmongMutuals(mockAgent, mutuals, progressCallback);

      expect(progressCallback).toHaveBeenCalledWith({ scanned: expect.any(Number), total: 3 });

      // m1 blocks m2 and m3 -> 2 blocked mutuals
      // m2 blocks m3 -> 1 blocked mutual
      // m3 blocks 0 -> filtered out
      expect(summaries.length).toBe(2);
      expect(summaries[0].blocker).toEqual(m1);
      expect(summaries[0].blockedMutuals).toHaveLength(2);
      expect(summaries[0].blockedMutuals).toEqual(expect.arrayContaining([m2, m3]));

      expect(summaries[1].blocker).toEqual(m2);
      expect(summaries[1].blockedMutuals).toHaveLength(1);
      expect(summaries[1].blockedMutuals).toEqual([m3]);
    });

    it('works without onProgress callback and handles profile resolution for missing profiles', async () => {
      const m1: MutualProfile = { did: 'did:plc:m1', handle: 'm1.bsky.social' };

      const listRecordsMock = vi.fn().mockResolvedValue({
        data: {
          cursor: undefined,
          records: [{ value: { subject: 'did:plc:m2' } }]
        }
      });

      const getProfilesMock = vi.fn().mockResolvedValue({
        data: {
          profiles: [
            {
              did: 'did:plc:m2',
              handle: 'm2.bsky.social',
              displayName: 'M2 Name',
              avatar: 'http://m2.avatar'
            }
          ]
        }
      });

      const mockAgent = {
        com: {
          atproto: {
            repo: {
              listRecords: listRecordsMock
            }
          }
        },
        getProfiles: getProfilesMock
      } as unknown as Agent;

      // Force profile refresh lookup by passing m2 with incomplete profile
      const summaries = await findTopBlockersAmongMutuals(mockAgent, [m1, { did: 'did:plc:m2', handle: 'm2.bsky.social' }]);
      expect(summaries.length).toBe(1);
      expect(summaries[0].blocker).toEqual(m1);
      expect(summaries[0].blockedMutuals[0]).toEqual({
        did: 'did:plc:m2',
        handle: 'm2.bsky.social',
        displayName: 'M2 Name',
        avatar: 'http://m2.avatar'
      });
    });

    it('falls back to default fallback objects when profile resolution returns no profile data', async () => {
      const listRecordsMock = vi.fn().mockImplementation(({ repo }) => {
        if (repo === 'did:plc:blockerX') {
          return Promise.resolve({
            data: { cursor: undefined, records: [{ value: { subject: 'did:plc:blockedY' } }] }
          });
        }
        return Promise.resolve({ data: { cursor: undefined, records: [] } });
      });

      const getProfilesMock = vi.fn().mockResolvedValue({
        data: { profiles: [] }
      });

      const mockAgent = {
        com: {
          atproto: {
            repo: {
              listRecords: listRecordsMock
            }
          }
        },
        getProfiles: getProfilesMock
      } as unknown as Agent;

      const summaries = await findTopBlockersAmongMutuals(mockAgent, [
        { did: 'did:plc:blockerX', handle: 'blockerX.bsky.social' },
        { did: 'did:plc:blockedY', handle: 'blockedY.bsky.social' }
      ]);

      expect(summaries.length).toBe(1);
      expect(summaries[0].blocker).toEqual({
        did: 'did:plc:blockerX',
        handle: 'blockerX.bsky.social'
      });
      expect(summaries[0].blockedMutuals[0]).toEqual({
        did: 'did:plc:blockedY',
        handle: 'blockedY.bsky.social'
      });
    });

    it('falls back to agent.app.bsky.actor.getProfiles if agent.getProfiles is absent and handles profile fetch errors gracefully', async () => {
      const m1: MutualProfile = { did: 'did:plc:m1', handle: 'm1.bsky.social' };
      const m2: MutualProfile = { did: 'did:plc:missing', handle: 'missing.bsky.social' };

      const mutuals = [m1, m2];

      const listRecordsMock = vi.fn().mockImplementation(({ repo }) => {
        if (repo === 'did:plc:m1') {
          return Promise.resolve({
            data: {
              cursor: undefined,
              records: [{ value: { subject: 'did:plc:missing' } }]
            }
          });
        }
        return Promise.resolve({ data: { cursor: undefined, records: [] } });
      });

      const getProfilesMock = vi.fn().mockRejectedValue(new Error('Profile resolution error'));

      const mockAgent = {
        com: {
          atproto: {
            repo: {
              listRecords: listRecordsMock
            }
          }
        },
        app: {
          bsky: {
            actor: {
              getProfiles: getProfilesMock
            }
          }
        }
      } as unknown as Agent;

      const summaries = await findTopBlockersAmongMutuals(mockAgent, mutuals);

      expect(summaries.length).toBe(1);
      expect(summaries[0].blockedMutuals[0]).toEqual({
        did: 'did:plc:missing',
        handle: 'missing.bsky.social'
      });
    });

  });

  describe('findMutualsBlockingMutuals', () => {
    it('returns empty array if fetchAllMutuals finds 0 mutuals', async () => {
      const getFollowsMock = vi.fn().mockResolvedValue({
        data: { cursor: undefined, follows: [] }
      });
      const mockAgent = {
        app: { bsky: { graph: { getFollows: getFollowsMock } } }
      } as unknown as Agent;

      const results = await findMutualsBlockingMutuals(mockAgent, 'did:plc:user');
      expect(results).toEqual([]);
    });

    it('scans mutuals, calls progress callback, and returns entries sorted with count', async () => {
      const getFollowsMock = vi.fn().mockResolvedValue({
        data: {
          cursor: undefined,
          follows: [
            {
              did: 'did:plc:m1',
              handle: 'm1.bsky.social',
              viewer: { followedBy: 'at://follow1' }
            },
            {
              did: 'did:plc:m2',
              handle: 'm2.bsky.social',
              viewer: { followedBy: 'at://follow2' }
            }
          ]
        }
      });

      const listRecordsMock = vi.fn().mockImplementation(({ repo }) => {
        if (repo === 'did:plc:m1') {
          return Promise.resolve({
            data: { cursor: undefined, records: [{ value: { subject: 'did:plc:m2' } }] }
          });
        }
        return Promise.resolve({ data: { cursor: undefined, records: [] } });
      });

      const mockAgent = {
        app: { bsky: { graph: { getFollows: getFollowsMock } } },
        com: { atproto: { repo: { listRecords: listRecordsMock } } }
      } as unknown as Agent;

      const progressCallback = vi.fn();
      const results = await findMutualsBlockingMutuals(
        mockAgent,
        'did:plc:user',
        5,
        progressCallback
      );

      expect(progressCallback).toHaveBeenCalledWith(2, 2);
      expect(results).toEqual([
        {
          blocker: { did: 'did:plc:m1', handle: 'm1.bsky.social', displayName: undefined, avatar: undefined },
          blockedMutuals: [{ did: 'did:plc:m2', handle: 'm2.bsky.social', displayName: undefined, avatar: undefined }],
          count: 1
        }
      ]);
    });

    it('works without progress callback provided', async () => {
      const getFollowsMock = vi.fn().mockResolvedValue({
        data: {
          cursor: undefined,
          follows: [
            {
              did: 'did:plc:m1',
              handle: 'm1.bsky.social',
              viewer: { followedBy: 'at://follow1' }
            }
          ]
        }
      });
      const listRecordsMock = vi.fn().mockResolvedValue({
        data: { cursor: undefined, records: [] }
      });
      const mockAgent = {
        app: { bsky: { graph: { getFollows: getFollowsMock } } },
        com: { atproto: { repo: { listRecords: listRecordsMock } } }
      } as unknown as Agent;

      const results = await findMutualsBlockingMutuals(mockAgent, 'did:plc:user');
      expect(results).toEqual([]);
    });
  });

  describe('findTopBlockedAmongMutuals', () => {
    it('aggregates blocks received by mutuals, sorts by blocker count descending, and reports progress', async () => {
      const m1: MutualProfile = { did: 'did:plc:m1', handle: 'm1.bsky.social' };
      const m2: MutualProfile = { did: 'did:plc:m2', handle: 'm2.bsky.social' };
      const m3: MutualProfile = { did: 'did:plc:m3', handle: 'm3.bsky.social' };

      const mutuals = [m1, m2, m3];

      // m1 blocks m2 and m3 (and non-mutual did:plc:nonmutual)
      // m2 blocks m3
      // m3 blocks nobody
      // Result for most blocked:
      // m3 is blocked by [m1, m2] -> count 2
      // m2 is blocked by [m1] -> count 1
      // m1 is blocked by [] -> 0 (filtered out)
      const listRecordsMock = vi.fn().mockImplementation(({ repo }) => {
        if (repo === 'did:plc:m1') {
          return Promise.resolve({
            data: {
              cursor: undefined,
              records: [
                { value: { subject: 'did:plc:m2' } },
                { value: { subject: 'did:plc:m3' } },
                { value: { subject: 'did:plc:m1' } }, // Self block filter
                { value: { subject: 'did:plc:nonmutual' } }
              ]
            }
          });
        }
        if (repo === 'did:plc:m2') {
          return Promise.resolve({
            data: {
              cursor: undefined,
              records: [{ value: { subject: 'did:plc:m3' } }]
            }
          });
        }
        return Promise.resolve({
          data: {
            cursor: undefined,
            records: []
          }
        });
      });

      const mockAgent = {
        com: {
          atproto: {
            repo: {
              listRecords: listRecordsMock
            }
          }
        }
      } as unknown as Agent;

      const progressCallback = vi.fn();
      const summaries = await findTopBlockedAmongMutuals(mockAgent, mutuals, progressCallback);

      expect(progressCallback).toHaveBeenCalledWith({ scanned: expect.any(Number), total: 3 });

      expect(summaries.length).toBe(2);
      expect(summaries[0].blocked).toEqual(m3);
      expect(summaries[0].blockedByMutuals).toHaveLength(2);
      expect(summaries[0].blockedByMutuals).toEqual(expect.arrayContaining([m1, m2]));

      expect(summaries[1].blocked).toEqual(m2);
      expect(summaries[1].blockedByMutuals).toHaveLength(1);
      expect(summaries[1].blockedByMutuals).toEqual([m1]);
    });

    it('works without onProgress callback and handles profile resolution for missing profiles', async () => {
      const m1: MutualProfile = { did: 'did:plc:m1', handle: 'm1.bsky.social' };

      const listRecordsMock = vi.fn().mockImplementation(({ repo }) => {
        if (repo === 'did:plc:m1') {
          return Promise.resolve({
            data: {
              cursor: undefined,
              records: [{ value: { subject: 'did:plc:m2' } }]
            }
          });
        }
        return Promise.resolve({ data: { cursor: undefined, records: [] } });
      });

      const getProfilesMock = vi.fn().mockResolvedValue({
        data: {
          profiles: [
            {
              did: 'did:plc:m2',
              handle: 'm2.bsky.social',
              displayName: 'M2 Resolved Name',
              avatar: 'http://m2.avatar'
            }
          ]
        }
      });

      const mockAgent = {
        com: {
          atproto: {
            repo: {
              listRecords: listRecordsMock
            }
          }
        },
        getProfiles: getProfilesMock
      } as unknown as Agent;

      const summaries = await findTopBlockedAmongMutuals(mockAgent, [
        m1,
        { did: 'did:plc:m2', handle: 'm2.bsky.social' }
      ]);
      expect(summaries.length).toBe(1);
      expect(summaries[0].blocked).toEqual({
        did: 'did:plc:m2',
        handle: 'm2.bsky.social',
        displayName: 'M2 Resolved Name',
        avatar: 'http://m2.avatar'
      });
      expect(summaries[0].blockedByMutuals[0]).toEqual(m1);
    });

    it('falls back to default fallback objects when profile resolution returns no profile data', async () => {
      const listRecordsMock = vi.fn().mockImplementation(({ repo }) => {
        if (repo === 'did:plc:blockerX') {
          return Promise.resolve({
            data: { cursor: undefined, records: [{ value: { subject: 'did:plc:blockedY' } }] }
          });
        }
        return Promise.resolve({ data: { cursor: undefined, records: [] } });
      });

      const getProfilesMock = vi.fn().mockResolvedValue({
        data: { profiles: [] }
      });

      const mockAgent = {
        com: {
          atproto: {
            repo: {
              listRecords: listRecordsMock
            }
          }
        },
        getProfiles: getProfilesMock
      } as unknown as Agent;

      const summaries = await findTopBlockedAmongMutuals(mockAgent, [
        { did: 'did:plc:blockerX', handle: 'blockerX.bsky.social' },
        { did: 'did:plc:blockedY', handle: 'blockedY.bsky.social' }
      ]);

      expect(summaries.length).toBe(1);
      expect(summaries[0].blocked).toEqual({
        did: 'did:plc:blockedY',
        handle: 'blockedY.bsky.social'
      });
      expect(summaries[0].blockedByMutuals[0]).toEqual({
        did: 'did:plc:blockerX',
        handle: 'blockerX.bsky.social'
      });
    });

    it('falls back to agent.app.bsky.actor.getProfiles if agent.getProfiles is absent and handles profile fetch errors gracefully', async () => {
      const m1: MutualProfile = { did: 'did:plc:m1', handle: 'm1.bsky.social' };
      const m2: MutualProfile = { did: 'did:plc:missing', handle: 'missing.bsky.social' };

      const mutuals = [m1, m2];

      const listRecordsMock = vi.fn().mockImplementation(({ repo }) => {
        if (repo === 'did:plc:m1') {
          return Promise.resolve({
            data: {
              cursor: undefined,
              records: [{ value: { subject: 'did:plc:missing' } }]
            }
          });
        }
        return Promise.resolve({ data: { cursor: undefined, records: [] } });
      });

      const getProfilesMock = vi.fn().mockRejectedValue(new Error('Profile resolution error'));

      const mockAgent = {
        com: {
          atproto: {
            repo: {
              listRecords: listRecordsMock
            }
          }
        },
        app: {
          bsky: {
            actor: {
              getProfiles: getProfilesMock
            }
          }
        }
      } as unknown as Agent;

      const summaries = await findTopBlockedAmongMutuals(mockAgent, mutuals);

      expect(summaries.length).toBe(1);
      expect(summaries[0].blocked).toEqual({
        did: 'did:plc:missing',
        handle: 'missing.bsky.social'
      });
    });
  });

  describe('findMutualsBlockedByMutuals', () => {
    it('returns empty array if fetchAllMutuals finds 0 mutuals', async () => {
      const getFollowsMock = vi.fn().mockResolvedValue({
        data: { cursor: undefined, follows: [] }
      });
      const mockAgent = {
        app: { bsky: { graph: { getFollows: getFollowsMock } } }
      } as unknown as Agent;

      const results = await findMutualsBlockedByMutuals(mockAgent, 'did:plc:user');
      expect(results).toEqual([]);
    });

    it('scans mutuals, calls progress callback, and returns entries sorted with count', async () => {
      const getFollowsMock = vi.fn().mockResolvedValue({
        data: {
          cursor: undefined,
          follows: [
            {
              did: 'did:plc:m1',
              handle: 'm1.bsky.social',
              viewer: { followedBy: 'at://follow1' }
            },
            {
              did: 'did:plc:m2',
              handle: 'm2.bsky.social',
              viewer: { followedBy: 'at://follow2' }
            }
          ]
        }
      });

      const listRecordsMock = vi.fn().mockImplementation(({ repo }) => {
        if (repo === 'did:plc:m1') {
          return Promise.resolve({
            data: { cursor: undefined, records: [{ value: { subject: 'did:plc:m2' } }] }
          });
        }
        return Promise.resolve({ data: { cursor: undefined, records: [] } });
      });

      const mockAgent = {
        app: { bsky: { graph: { getFollows: getFollowsMock } } },
        com: { atproto: { repo: { listRecords: listRecordsMock } } }
      } as unknown as Agent;

      const progressCallback = vi.fn();
      const results = await findMutualsBlockedByMutuals(
        mockAgent,
        'did:plc:user',
        5,
        progressCallback
      );

      expect(progressCallback).toHaveBeenCalledWith(2, 2);
      expect(results).toEqual([
        {
          blocked: { did: 'did:plc:m2', handle: 'm2.bsky.social', displayName: undefined, avatar: undefined },
          blockedByMutuals: [{ did: 'did:plc:m1', handle: 'm1.bsky.social', displayName: undefined, avatar: undefined }],
          count: 1
        }
      ]);
    });

    it('works without progress callback provided', async () => {
      const getFollowsMock = vi.fn().mockResolvedValue({
        data: {
          cursor: undefined,
          follows: [
            {
              did: 'did:plc:m1',
              handle: 'm1.bsky.social',
              viewer: { followedBy: 'at://follow1' }
            }
          ]
        }
      });
      const listRecordsMock = vi.fn().mockResolvedValue({
        data: { cursor: undefined, records: [] }
      });
      const mockAgent = {
        app: { bsky: { graph: { getFollows: getFollowsMock } } },
        com: { atproto: { repo: { listRecords: listRecordsMock } } }
      } as unknown as Agent;

      const results = await findMutualsBlockedByMutuals(mockAgent, 'did:plc:user');
      expect(results).toEqual([]);
    });
  });
});
