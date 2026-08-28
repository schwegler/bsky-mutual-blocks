import { Agent, AppBskyActorDefs, AppBskyGraphDefs } from '@atproto/api';

export interface MutualProfile {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

export interface BlockCheckProgress {
  scanned: number;
  total: number;
}

// 1. Search actors for input autocomplete
export async function searchActorsTypeahead(
  agent: Agent,
  query: string
): Promise<AppBskyActorDefs.ProfileViewBasic[]> {
  if (!query.trim()) return [];
  const response = await agent.app.bsky.actor.searchActorsTypeahead({
    q: query.trim(),
    limit: 8
  });
  return response.data.actors;
}

// 2. Fetch all mutuals for the logged-in user
export async function fetchAllMutuals(
  agent: Agent,
  userDid: string,
  onProgress?: (count: number) => void
): Promise<MutualProfile[]> {
  const mutuals: MutualProfile[] = [];
  let cursor: string | undefined = undefined;

  do {
    const res = await agent.app.bsky.graph.getFollows({
      actor: userDid,
      limit: 100,
      cursor
    });

    for (const follow of res.data.follows) {
      // If viewer.followedBy is present, they follow the authenticated user back
      if (follow.viewer?.followedBy) {
        mutuals.push({
          did: follow.did,
          handle: follow.handle,
          displayName: follow.displayName,
          avatar: follow.avatar
        });
      }
    }

    if (onProgress) {
      onProgress(mutuals.length);
    }

    cursor = res.data.cursor;
  } while (cursor);

  return mutuals;
}

// 3. Check which mutuals block the target DID
export async function findMutualsBlockingTarget(
  agent: Agent,
  targetDid: string,
  mutuals: MutualProfile[],
  onProgress?: (progress: BlockCheckProgress) => void
): Promise<MutualProfile[]> {
  const blockingMutuals: MutualProfile[] = [];
  const BATCH_SIZE = 30; // max supported by getRelationships

  for (let i = 0; i < mutuals.length; i += BATCH_SIZE) {
    const batch = mutuals.slice(i, i + BATCH_SIZE);
    const others = batch.map((m) => m.did);

    try {
      const res = await agent.app.bsky.graph.getRelationships({
        actor: targetDid,
        others
      });

      const relationships = res.data.relationships as AppBskyGraphDefs.Relationship[];
      for (const rel of relationships) {
        // blockedBy indicates the 'other' account (the mutual) has blocked the target
        if (rel.blockedBy) {
          const mutual = batch.find((m) => m.did === rel.did);
          if (mutual) {
            blockingMutuals.push(mutual);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching relationship batch:', err);
    }

    if (onProgress) {
      onProgress({
        scanned: Math.min(i + BATCH_SIZE, mutuals.length),
        total: mutuals.length
      });
    }
  }

  return blockingMutuals;
}
