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

export interface MutualBlockerSummary {
  blocker: MutualProfile;
  blockedMutuals: MutualProfile[];
}

export interface MutualBlockerEntry {
  blocker: MutualProfile;
  blockedMutuals: MutualProfile[];
  count: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 1. Resolve any handle or DID input to a canonical DID & Profile.
 */
export async function resolveActor(
  agent: Agent,
  actorInput: string
): Promise<{ did: string; profile?: AppBskyActorDefs.ProfileViewBasic }> {
  const cleanInput = actorInput.trim().replace(/^@/, '');
  if (!cleanInput) {
    throw new Error('Input handle or DID cannot be empty');
  }

  // If input is already a DID, resolve profile if possible, otherwise return DID
  if (cleanInput.startsWith('did:')) {
    try {
      const getProfileFn = agent.getProfile
        ? (actor: string) => agent.getProfile({ actor })
        : (actor: string) => agent.app.bsky.actor.getProfile({ actor });
      const res = await getProfileFn(cleanInput);
      return { did: res.data.did, profile: res.data };
    } catch {
      return { did: cleanInput };
    }
  }

  // Try agent.getProfile or agent.app.bsky.actor.getProfile
  try {
    const getProfileFn = agent.getProfile
      ? (actor: string) => agent.getProfile({ actor })
      : (actor: string) => agent.app.bsky.actor.getProfile({ actor });
    const res = await getProfileFn(cleanInput);
    return { did: res.data.did, profile: res.data };
  } catch {
    // Fallback to resolveHandle if getProfile fails
    const resolveHandleFn = agent.resolveHandle
      ? (handle: string) => agent.resolveHandle({ handle })
      : (handle: string) => agent.com.atproto.identity.resolveHandle({ handle });
    const res = await resolveHandleFn(cleanInput);
    return { did: res.data.did };
  }
}

// Helper: Process array concurrently with a concurrency limit
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  if (items.length === 0) return results;

  let index = 0;
  const workerCount = Math.min(limit, items.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await fn(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Fetch all direct block records for a single user using full pagination with 429 retry backoff.
 */
export async function fetchAllUserBlocks(
  agent: Agent,
  repoDid: string,
  maxRetries = 3
): Promise<string[]> {
  const blockedDids: string[] = [];
  let cursor: string | undefined = undefined;

  do {
    let attempts = 0;
    let success = false;

    while (attempts < maxRetries && !success) {
      try {
        const api = agent.com?.atproto?.repo
          ? agent.com.atproto.repo
          : agent.api?.com?.atproto?.repo
          ? agent.api.com.atproto.repo
          : null;

        if (!api || typeof api.listRecords !== 'function') {
          return blockedDids;
        }

        const response = await api.listRecords({
          repo: repoDid,
          collection: 'app.bsky.graph.block',
          limit: 100,
          cursor
        });

        if (!response?.data?.records) {
          return blockedDids;
        }

        for (const record of response.data.records) {
          const subject = (record.value as { subject?: string })?.subject;
          if (subject) {
            blockedDids.push(subject);
          }
        }

        cursor = response.data.cursor;
        success = true;
      } catch (err: any) {
        attempts++;
        const isRateLimit = err?.status === 429 || err?.message?.includes('Rate Limit');

        if (isRateLimit && attempts < maxRetries) {
          const waitMs = Math.pow(2, attempts) * 1000;
          console.warn(`[429] Rate limit on ${repoDid}. Retrying in ${waitMs}ms...`);
          await sleep(waitMs);
        } else {
          // If deactivated, deleted, private repo, or max retries exceeded, safely exit
          return blockedDids;
        }
      }
    }
  } while (cursor);

  return blockedDids;
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

// 3. Check which mutuals block the target (DID or handle)
export async function findMutualsBlockingTarget(
  agent: Agent,
  targetInput: string,
  mutuals: MutualProfile[],
  onProgress?: (progress: BlockCheckProgress) => void,
  concurrency = 5
): Promise<MutualProfile[]> {
  let targetDid = targetInput;
  try {
    const resolved = await resolveActor(agent, targetInput);
    targetDid = resolved.did;
  } catch {
    // Fall back to targetInput if resolution fails
  }

  const blockingMutuals: MutualProfile[] = [];
  let scannedCount = 0;

  await mapConcurrent(mutuals, concurrency, async (mutual) => {
    const blocks = await fetchAllUserBlocks(agent, mutual.did);
    if (blocks.includes(targetDid)) {
      blockingMutuals.push(mutual);
    }
    scannedCount++;
    if (onProgress) {
      onProgress({
        scanned: scannedCount,
        total: mutuals.length
      });
    }
  });

  return blockingMutuals;
}

// 4. Find which mutuals block the most of your other mutuals
export async function findTopBlockersAmongMutuals(
  agent: Agent,
  mutuals: MutualProfile[],
  onProgress?: (progress: BlockCheckProgress) => void,
  concurrency = 5
): Promise<MutualBlockerSummary[]> {
  const mutualsMap = new Map<string, MutualProfile>();
  for (const m of mutuals) {
    mutualsMap.set(m.did, m);
  }

  // Map to hold DID -> Set of mutual DIDs that they block
  const blockerMap = new Map<string, Set<string>>();
  let scannedCount = 0;

  // Fetch all blocks concurrently across mutuals
  await mapConcurrent(mutuals, concurrency, async (mutual) => {
    const blocks = await fetchAllUserBlocks(agent, mutual.did);
    for (const blockedDid of blocks) {
      if (blockedDid !== mutual.did && mutualsMap.has(blockedDid)) {
        let set = blockerMap.get(mutual.did);
        if (!set) {
          set = new Set<string>();
          blockerMap.set(mutual.did, set);
        }
        set.add(blockedDid);
      }
    }
    scannedCount++;
    if (onProgress) {
      onProgress({
        scanned: scannedCount,
        total: mutuals.length
      });
    }
  });

  // Sort by block count descending
  const sortedEntries = Array.from(blockerMap.entries())
    .map(([did, blockedSet]) => ({
      did,
      count: blockedSet.size,
      blockedDids: Array.from(blockedSet)
    }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);

  const allNeededDids = new Set<string>();
  for (const entry of sortedEntries) {
    allNeededDids.add(entry.did);
    for (const bDid of entry.blockedDids) {
      allNeededDids.add(bDid);
    }
  }

  const profilesMap = new Map<string, MutualProfile>();
  for (const [did, profile] of mutualsMap.entries()) {
    profilesMap.set(did, profile);
  }

  // Batch resolve profile metadata in chunks of up to 25 for any missing or incomplete profiles
  const missingDids = Array.from(allNeededDids).filter((did) => {
    const p = profilesMap.get(did);
    return !p || (!p.displayName && !p.avatar);
  });

  for (let i = 0; i < missingDids.length; i += 25) {
    const chunk = missingDids.slice(i, i + 25);
    try {
      const getProfilesFn = agent.getProfiles
        ? (chunkDids: string[]) => agent.getProfiles({ actors: chunkDids })
        : (chunkDids: string[]) => agent.app.bsky.actor.getProfiles({ actors: chunkDids });

      const { data } = await getProfilesFn(chunk);
      for (const p of data.profiles) {
        profilesMap.set(p.did, {
          did: p.did,
          handle: p.handle,
          displayName: p.displayName,
          avatar: p.avatar
        });
      }
    } catch {
      // Gracefully continue if some profiles cannot be resolved
    }
  }

  return sortedEntries.map((entry) => {
    const blockerProfile = profilesMap.get(entry.did)!;
    const blockedMutuals = entry.blockedDids.map((bDid) => profilesMap.get(bDid)!);

    return {
      blocker: blockerProfile,
      blockedMutuals
    };
  });
}

/**
 * Scan mutuals blocking other mutuals, sorted by most blocks (end-to-end helper).
 */
export async function findMutualsBlockingMutuals(
  agent: Agent,
  userDid: string,
  concurrency = 5,
  onProgress?: (scanned: number, total: number) => void
): Promise<MutualBlockerEntry[]> {
  const mutuals = await fetchAllMutuals(agent, userDid);
  if (mutuals.length === 0) return [];

  const summaries = await findTopBlockersAmongMutuals(
    agent,
    mutuals,
    onProgress ? (p) => onProgress(p.scanned, p.total) : undefined,
    concurrency
  );

  return summaries.map((s) => ({
    blocker: s.blocker,
    blockedMutuals: s.blockedMutuals,
    count: s.blockedMutuals.length
  }));
}
