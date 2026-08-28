import { describe, it, expect, vi } from 'vitest';
import { Agent } from '@atproto/api';
import {
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
    it('batches relationship calls concurrently, identifies blockers, and reports progress', async () => {
      const mutuals: MutualProfile[] = Array.from({ length: 35 }, (_, i) => ({
        did: `did:plc:mutual${i}`,
        handle: `mutual${i}.bsky.social`
      }));

      const getRelationshipsMock = vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            relationships: [
              {
                did: 'did:plc:mutual0',
                blockedBy: 'at://did:plc:mutual0/app.bsky.graph.block/1'
              },
              {
                did: 'did:plc:mutual1',
                blockedBy: undefined
              },
              {
                did: 'did:plc:unknown',
                blockedBy: 'at://did:plc:unknown/app.bsky.graph.block/1'
              }
            ]
          }
        })
        .mockResolvedValueOnce({
          data: {
            relationships: [
              {
                did: 'did:plc:mutual32',
                blockedBy: 'at://did:plc:mutual32/app.bsky.graph.block/1'
              }
            ]
          }
        });

      const mockAgent = {
        app: {
          bsky: {
            graph: {
              getRelationships: getRelationshipsMock
            }
          }
        }
      } as unknown as Agent;

      const progressCallback = vi.fn();
      const blockers = await findMutualsBlockingTarget(
        mockAgent,
        'did:plc:target',
        mutuals,
        progressCallback
      );

      expect(getRelationshipsMock).toHaveBeenCalledTimes(2);
      expect(progressCallback).toHaveBeenCalledWith({ scanned: 30, total: 35 });
      expect(progressCallback).toHaveBeenCalledWith({ scanned: 35, total: 35 });

      expect(blockers).toEqual(
        expect.arrayContaining([
          { did: 'did:plc:mutual0', handle: 'mutual0.bsky.social' },
          { did: 'did:plc:mutual32', handle: 'mutual32.bsky.social' }
        ])
      );
    });

    it('works without onProgress callback', async () => {
      const mutuals: MutualProfile[] = [
        { did: 'did:plc:mutual0', handle: 'mutual0.bsky.social' }
      ];

      const getRelationshipsMock = vi.fn().mockResolvedValueOnce({
        data: {
          relationships: []
        }
      });

      const mockAgent = {
        app: {
          bsky: {
            graph: {
              getRelationships: getRelationshipsMock
            }
          }
        }
      } as unknown as Agent;

      const blockers = await findMutualsBlockingTarget(
        mockAgent,
        'did:plc:target',
        mutuals
      );

      expect(blockers).toEqual([]);
    });

    it('handles batch errors gracefully and continues', async () => {
      const mutuals: MutualProfile[] = [
        { did: 'did:plc:mutual0', handle: 'mutual0.bsky.social' }
      ];

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const getRelationshipsMock = vi.fn().mockRejectedValue(new Error('Network error'));

      const mockAgent = {
        app: {
          bsky: {
            graph: {
              getRelationships: getRelationshipsMock
            }
          }
        }
      } as unknown as Agent;

      const progressCallback = vi.fn();
      const blockers = await findMutualsBlockingTarget(
        mockAgent,
        'did:plc:target',
        mutuals,
        progressCallback
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error fetching relationship batch:',
        expect.any(Error)
      );
      expect(progressCallback).toHaveBeenCalledWith({ scanned: 1, total: 1 });
      expect(blockers).toEqual([]);

      consoleErrorSpy.mockRestore();
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
});
