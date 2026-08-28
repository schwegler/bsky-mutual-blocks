import { describe, it, expect, vi } from 'vitest';
import { Agent } from '@atproto/api';
import {
  searchActorsTypeahead,
  fetchAllMutuals,
  findMutualsBlockingTarget,
  findTopBlockersAmongMutuals,
  MutualProfile
} from '../src/bsky';

describe('bsky module', () => {
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
    it('batches relationship calls, identifies blockers, and reports progress', async () => {
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
      expect(progressCallback).toHaveBeenNthCalledWith(1, { scanned: 30, total: 35 });
      expect(progressCallback).toHaveBeenNthCalledWith(2, { scanned: 35, total: 35 });

      expect(blockers).toEqual([
        { did: 'did:plc:mutual0', handle: 'mutual0.bsky.social' },
        { did: 'did:plc:mutual32', handle: 'mutual32.bsky.social' }
      ]);
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
    it('aggregates blocking/blockedBy relationships, sorts blockers descending, and reports progress', async () => {
      const m1: MutualProfile = { did: 'did:plc:m1', handle: 'm1.bsky.social' };
      const m2: MutualProfile = { did: 'did:plc:m2', handle: 'm2.bsky.social' };
      const m3: MutualProfile = { did: 'did:plc:m3', handle: 'm3.bsky.social' };

      const mutuals = [m1, m2, m3];

      const getRelationshipsMock = vi
        .fn()
        // Iteration 0: current = m1, others = [m2, m3] (m1 blocks m2 and m3, plus unknown DIDs for branch coverage)
        .mockResolvedValueOnce({
          data: {
            relationships: [
              { did: 'did:plc:m2', blocking: 'at://did:plc:m1/app.bsky.graph.block/1', blockedBy: undefined },
              { did: 'did:plc:m3', blocking: 'at://did:plc:m1/app.bsky.graph.block/2', blockedBy: undefined },
              { did: 'did:plc:unknown1', blocking: 'at://did:plc:m1/app.bsky.graph.block/3', blockedBy: undefined },
              { did: 'did:plc:unknown2', blocking: undefined, blockedBy: 'at://did:plc:unknown2/app.bsky.graph.block/4' }
            ]
          }
        })
        // Iteration 1: current = m2, others = [m1, m3] (m2 is blocked by m1, m2 blocks m3)
        .mockResolvedValueOnce({
          data: {
            relationships: [
              { did: 'did:plc:m1', blocking: undefined, blockedBy: 'at://did:plc:m1/app.bsky.graph.block/1' },
              { did: 'did:plc:m3', blocking: 'at://did:plc:m2/app.bsky.graph.block/3', blockedBy: undefined }
            ]
          }
        })
        // Iteration 2: current = m3, others = [m1, m2] (m3 is blocked by m1 and m2)
        .mockResolvedValueOnce({
          data: {
            relationships: [
              { did: 'did:plc:m1', blocking: undefined, blockedBy: 'at://did:plc:m1/app.bsky.graph.block/2' },
              { did: 'did:plc:m2', blocking: undefined, blockedBy: 'at://did:plc:m2/app.bsky.graph.block/3' }
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
      const summaries = await findTopBlockersAmongMutuals(mockAgent, mutuals, progressCallback);

      expect(progressCallback).toHaveBeenNthCalledWith(1, { scanned: 1, total: 3 });
      expect(progressCallback).toHaveBeenNthCalledWith(2, { scanned: 2, total: 3 });
      expect(progressCallback).toHaveBeenNthCalledWith(3, { scanned: 3, total: 3 });

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

    it('works without onProgress callback and handles batches (>30 items)', async () => {
      const mutuals: MutualProfile[] = Array.from({ length: 32 }, (_, i) => ({
        did: `did:plc:m${i}`,
        handle: `m${i}.bsky.social`
      }));

      const getRelationshipsMock = vi.fn().mockResolvedValue({
        data: { relationships: [] }
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

      const summaries = await findTopBlockersAmongMutuals(mockAgent, mutuals);
      expect(summaries).toEqual([]);
    });

    it('catches and logs errors during relationship batch fetch in mutual scan', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mutuals: MutualProfile[] = [
        { did: 'did:plc:m1', handle: 'm1.bsky.social' },
        { did: 'did:plc:m2', handle: 'm2.bsky.social' }
      ];

      const getRelationshipsMock = vi.fn().mockRejectedValue(new Error('Batch error'));
      const mockAgent = {
        app: {
          bsky: {
            graph: {
              getRelationships: getRelationshipsMock
            }
          }
        }
      } as unknown as Agent;

      const summaries = await findTopBlockersAmongMutuals(mockAgent, mutuals);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error fetching relationship batch for mutual scan:',
        expect.any(Error)
      );
      expect(summaries).toEqual([]);

      consoleErrorSpy.mockRestore();
    });
  });
});
