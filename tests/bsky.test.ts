import { describe, it, expect, vi } from 'vitest';
import { Agent } from '@atproto/api';
import {
  resolveActor,
  mapConcurrent,
  fetchAllUserBlocks,
  searchActorsTypeahead,
  fetchAllMutuals,
  findMutualsBlockingTarget,
  findTopBlockersAmongMutuals,
  findMutualsBlockingMutuals,
  MutualProfile
} from '../src/bsky';

describe('bsky module', () => {
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

  describe('fetchAllUserBlocks', () => {
    it('fetches all user blocks using cursor pagination and limit: 100', async () => {
      const listRecordsMock = vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            cursor: 'cursor_page_2',
            records: [
              { value: { subject: 'did:plc:blocked1' } },
              { value: { subject: 'did:plc:blocked2' } },
              { value: {} } // Record without subject
            ]
          }
        })
        .mockResolvedValueOnce({
          data: {
            cursor: undefined,
            records: [{ value: { subject: 'did:plc:blocked3' } }]
          }
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

      const blocks = await fetchAllUserBlocks(mockAgent, 'did:plc:user1');

      expect(listRecordsMock).toHaveBeenCalledTimes(2);
      expect(listRecordsMock).toHaveBeenNthCalledWith(1, {
        repo: 'did:plc:user1',
        collection: 'app.bsky.graph.block',
        limit: 100,
        cursor: undefined
      });
      expect(listRecordsMock).toHaveBeenNthCalledWith(2, {
        repo: 'did:plc:user1',
        collection: 'app.bsky.graph.block',
        limit: 100,
        cursor: 'cursor_page_2'
      });

      expect(blocks).toEqual(['did:plc:blocked1', 'did:plc:blocked2', 'did:plc:blocked3']);
    });

    it('falls back to agent.api.com.atproto.repo.listRecords if agent.com is absent', async () => {
      const listRecordsMock = vi.fn().mockResolvedValueOnce({
        data: {
          cursor: undefined,
          records: [{ value: { subject: 'did:plc:blocked1' } }]
        }
      });

      const mockAgent = {
        api: {
          com: {
            atproto: {
              repo: {
                listRecords: listRecordsMock
              }
            }
          }
        }
      } as unknown as Agent;

      const blocks = await fetchAllUserBlocks(mockAgent, 'did:plc:user2');

      expect(listRecordsMock).toHaveBeenCalledTimes(1);
      expect(blocks).toEqual(['did:plc:blocked1']);
    });

    it('returns empty array when api is not available or listRecords is not a function', async () => {
      const mockAgentEmpty = {} as Agent;
      const blocks = await fetchAllUserBlocks(mockAgentEmpty, 'did:plc:user3');
      expect(blocks).toEqual([]);
    });

    it('returns empty array when response has no data/records', async () => {
      const listRecordsMock = vi.fn().mockResolvedValueOnce({
        data: null
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

      const blocks = await fetchAllUserBlocks(mockAgent, 'did:plc:user4');
      expect(blocks).toEqual([]);
    });

    it('handles listRecords generic exception gracefully', async () => {
      const listRecordsMock = vi.fn().mockRejectedValue(new Error('Generic failure'));

      const mockAgent = {
        com: {
          atproto: {
            repo: {
              listRecords: listRecordsMock
            }
          }
        }
      } as unknown as Agent;

      const blocks = await fetchAllUserBlocks(mockAgent, 'did:plc:user5');
      expect(blocks).toEqual([]);
    });

    it('retries on 429 status rate limit errors with exponential backoff and succeeds on retry', async () => {
      vi.useFakeTimers();
      const rateLimitErr = { status: 429, message: 'Too Many Requests' };
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const listRecordsMock = vi
        .fn()
        .mockRejectedValueOnce(rateLimitErr)
        .mockResolvedValueOnce({
          data: {
            cursor: undefined,
            records: [{ value: { subject: 'did:plc:blockedRetry' } }]
          }
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

      const blocksPromise = fetchAllUserBlocks(mockAgent, 'did:plc:rateLimitedUser', 3);
      await vi.runAllTimersAsync();
      const blocks = await blocksPromise;

      expect(listRecordsMock).toHaveBeenCalledTimes(2);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[429] Rate limit on did:plc:rateLimitedUser. Retrying in 2000ms...'
      );
      expect(blocks).toEqual(['did:plc:blockedRetry']);

      consoleWarnSpy.mockRestore();
      vi.useRealTimers();
    });

    it('retries on Rate Limit error message, exceeding maxRetries and exiting gracefully', async () => {
      vi.useFakeTimers();
      const rateLimitErr = new Error('Rate Limit exceeded');
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const listRecordsMock = vi.fn().mockRejectedValue(rateLimitErr);

      const mockAgent = {
        com: {
          atproto: {
            repo: {
              listRecords: listRecordsMock
            }
          }
        }
      } as unknown as Agent;

      const blocksPromise = fetchAllUserBlocks(mockAgent, 'did:plc:maxRetriesUser', 2);
      await vi.runAllTimersAsync();
      const blocks = await blocksPromise;

      expect(listRecordsMock).toHaveBeenCalledTimes(2);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(blocks).toEqual([]);

      consoleWarnSpy.mockRestore();
      vi.useRealTimers();
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

    it('matches target when block record stores target handle instead of DID', async () => {
      const m0: MutualProfile = { did: 'did:plc:mutual0', handle: 'mutual0.bsky.social' };
      const getProfileMock = vi.fn().mockResolvedValue({
        data: { did: 'did:plc:targetDid', handle: 'target.bsky.social' }
      });

      const listRecordsMock = vi.fn().mockResolvedValue({
        data: {
          cursor: undefined,
          records: [{ value: { subject: '@target.bsky.social' } }]
        }
      });

      const mockAgent = {
        getProfile: getProfileMock,
        com: { atproto: { repo: { listRecords: listRecordsMock } } }
      } as unknown as Agent;

      const blockers = await findMutualsBlockingTarget(
        mockAgent,
        'did:plc:targetDid',
        [m0]
      );

      expect(blockers).toEqual([m0]);
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

    it('matches mutual when block record stores mutual handle instead of DID and handles empty handle', async () => {
      const m1: MutualProfile = { did: 'did:plc:m1', handle: 'm1.bsky.social' };
      const m2: MutualProfile = { did: 'did:plc:m2', handle: 'm2.bsky.social' };
      const mNoHandle: MutualProfile = { did: 'did:plc:nohandle', handle: '' };

      const listRecordsMock = vi.fn().mockImplementation(({ repo }) => {
        if (repo === 'did:plc:m1') {
          return Promise.resolve({
            data: {
              cursor: undefined,
              records: [{ value: { subject: '@m2.bsky.social' } }]
            }
          });
        }
        return Promise.resolve({ data: { cursor: undefined, records: [] } });
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

      const summaries = await findTopBlockersAmongMutuals(mockAgent, [m1, m2, mNoHandle]);

      expect(summaries.length).toBe(1);
      expect(summaries[0].blocker).toEqual(m1);
      expect(summaries[0].blockedMutuals).toEqual([m2]);
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
});
