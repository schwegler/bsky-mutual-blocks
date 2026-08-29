import { Agent, AppBskyActorDefs } from '@atproto/api';
import { get, set } from 'idb-keyval';

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

export interface MutualBlockedSummary {
  blocked: MutualProfile;
  blockedByMutuals: MutualProfile[];
}

export interface MutualBlockedEntry {
  blocked: MutualProfile;
  blockedByMutuals: MutualProfile[];
  count: number;
}

export type BlockFetchErrorReason = 'rate_limit' | 'timeout' | 'pds_offline' | 'invalid_pds' | 'unknown';

export interface UserBlocksResult {
  blockedDids: string[];
  isComplete: boolean;
  errorReason?: BlockFetchErrorReason;
}

export interface MootScanError {
  moot: MutualProfile;
  reason: BlockFetchErrorReason;
  partialCount: number;
}

export interface TargetScanResult {
  blockingMutuals: MutualProfile[];
  incompleteMoots: MootScanError[];
}

export interface TopBlockersScanResult {
  summaries: MutualBlockerSummary[];
  incompleteMoots: MootScanError[];
}

export interface TopBlockedScanResult {
  summaries: MutualBlockedSummary[];
  incompleteMoots: MootScanError[];
}

export function getErrorReasonMessage(reason?: BlockFetchErrorReason): string {
  switch (reason) {
    case 'rate_limit':
      return 'Rate limit reached during scan';
    case 'timeout':
      return 'Server timed out (10s limit exceeded)';
    case 'pds_offline':
      return 'PDS server unreachable or returned error';
    case 'invalid_pds':
      return 'Invalid or unsupported PDS endpoint';
    default:
      return 'Could not complete scan';
  }
}

/**
 * Cache structure for user block lists.
 */
interface BlockCacheEntry {
  timestamp: number;
  blockedDids: string[];
}
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours


/**
 * 1. Resolve any handle or DID input to a canonical DID & Profile.
 */
export async function resolveActor(
  agent: Agent,
  actorInput: string
): Promise<{ did: string; profile?: AppBskyActorDefs.ProfileViewBasic | AppBskyActorDefs.ProfileViewDetailed | any }> {
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
      return { did: res.data.did, profile: res.data as any };
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
    return { did: res.data.did, profile: res.data as any };
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

export async function fetchAllUserBlocks(
  repoDid: string,
  maxRetries = 3
): Promise<UserBlocksResult> {
  const cacheKey = `blocks_${repoDid}`;
  try {
    const cached = await get<BlockCacheEntry>(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return { blockedDids: cached.blockedDids, isComplete: true };
    }
  } catch (err) {
    console.warn(`Cache read failed for ${repoDid}`, err);
  }

  const blockedDids: string[] = [];

  try {
    let pdsUrl: string | undefined;

    if (repoDid.startsWith('did:plc:')) {
      try {
        const res = await fetch(`https://plc.directory/${repoDid}`, {
          signal: AbortSignal.timeout(10000)
        });
        if (res.ok) {
          const doc = await res.json();
          const pdsService = doc.service?.find((s: any) => s.id === '#atproto_pds');
          if (pdsService?.serviceEndpoint) {
            pdsUrl = pdsService.serviceEndpoint;
          }
        } else {
          return { blockedDids, isComplete: false, errorReason: 'pds_offline' };
        }
      } catch (err: any) {
        return {
          blockedDids,
          isComplete: false,
          errorReason: err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'pds_offline'
        };
      }
    } else if (repoDid.startsWith('did:web:')) {
      const domain = repoDid.replace('did:web:', '');
      try {
        const res = await fetch(`https://${domain}/.well-known/did.json`, {
          signal: AbortSignal.timeout(10000)
        });
        if (res.ok) {
          const doc = await res.json();
          const pdsService = doc.service?.find((s: any) => s.id === '#atproto_pds');
          if (pdsService?.serviceEndpoint) {
            pdsUrl = pdsService.serviceEndpoint;
          }
        } else {
          return { blockedDids, isComplete: false, errorReason: 'pds_offline' };
        }
      } catch (err: any) {
        return {
          blockedDids,
          isComplete: false,
          errorReason: err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'pds_offline'
        };
      }
    } else {
      return { blockedDids, isComplete: false, errorReason: 'invalid_pds' };
    }

    if (!pdsUrl || (!pdsUrl.startsWith('http://') && !pdsUrl.startsWith('https://'))) {
      return { blockedDids, isComplete: false, errorReason: 'invalid_pds' };
    }

    pdsUrl = pdsUrl.replace(/\/+$/, '');

    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    let errorReason: BlockFetchErrorReason | undefined;

    do {
      let attempts = 0;
      let success = false;

      while (attempts < maxRetries && !success) {
        try {
          let url = `${pdsUrl}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(repoDid)}&collection=app.bsky.graph.block&limit=100`;
          if (cursor) {
            url += `&cursor=${encodeURIComponent(cursor)}`;
          }

          const response = await fetch(url, {
            signal: AbortSignal.timeout(10000)
          });

          if (response.status === 429) {
            throw { status: 429 };
          }

          if (!response.ok) {
            errorReason = 'pds_offline';
            return { blockedDids, isComplete: false, errorReason };
          }

          const data = await response.json();

          if (!data?.records || !Array.isArray(data.records)) {
            errorReason = 'pds_offline';
            return { blockedDids, isComplete: false, errorReason };
          }

          for (const record of data.records) {
            const subject = record.value?.subject;
            if (subject && typeof subject === 'string') {
              blockedDids.push(subject);
            }
          }

          if (data.cursor && typeof data.cursor === 'string' && data.cursor !== cursor && !seenCursors.has(data.cursor)) {
            seenCursors.add(data.cursor);
            cursor = data.cursor;
          } else {
            cursor = undefined;
          }

          success = true;
        } catch (err: any) {
          attempts++;
          const isRateLimit = err?.status === 429 || err?.message?.includes('Rate Limit');
          if (attempts < maxRetries && isRateLimit) {
            const waitMs = Math.pow(2, attempts) * 1000;
            console.warn(`[429] Rate limit on ${repoDid}. Retrying in ${waitMs}ms...`);
            await new Promise(r => setTimeout(r, waitMs));
          } else {
            if (isRateLimit) {
              errorReason = 'rate_limit';
            } else if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || err?.message?.includes('timeout') || err?.message?.includes('abort')) {
              errorReason = 'timeout';
            } else {
              errorReason = 'pds_offline';
            }
            return { blockedDids, isComplete: false, errorReason };
          }
        }
      }

      if (!success) {
        return { blockedDids, isComplete: false, errorReason: errorReason || 'unknown' };
      }
    } while (cursor);
    
    // Save to cache ONLY after successfully paginating through all records
    try {
      await set(cacheKey, { timestamp: Date.now(), blockedDids });
    } catch (err) {
      console.warn(`Cache write failed for ${repoDid}`, err);
    }

    return { blockedDids, isComplete: true };
  } catch (err: any) {
    console.error('Error fetching blocks for', repoDid, err);
    const errorReason: BlockFetchErrorReason =
      err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'unknown';
    return { blockedDids, isComplete: false, errorReason };
  }
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
  const seenCursors = new Set<string>();

  do {
    const res = await agent.app.bsky.graph.getFollows({
      actor: userDid,
      limit: 100,
      cursor
    });

    if (!res.data?.follows || res.data.follows.length === 0) {
      break;
    }

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

    const nextCursor = res.data.cursor;
    if (nextCursor && typeof nextCursor === 'string' && nextCursor !== cursor && !seenCursors.has(nextCursor)) {
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    } else {
      cursor = undefined;
    }
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
): Promise<TargetScanResult> {
  let targetDid = targetInput;

  try {
    const resolved = await resolveActor(agent, targetInput);
    targetDid = resolved.did;
  } catch {
    // Fall back to targetInput if resolution fails
  }

  const blockingMutuals: MutualProfile[] = [];
  const incompleteMoots: MootScanError[] = [];
  let scannedCount = 0;

  await mapConcurrent(mutuals, concurrency, async (mutual) => {
    try {
      const result = await fetchAllUserBlocks(mutual.did);
      const isBlocked = result.blockedDids.some((b) => b === targetDid);

      if (isBlocked) {
        blockingMutuals.push(mutual);
      }

      if (!result.isComplete) {
        incompleteMoots.push({
          moot: mutual,
          reason: result.errorReason || 'unknown',
          partialCount: result.blockedDids.length
        });
      }
    } catch (err: any) {
      console.warn(`Failed checking blocks for ${mutual.did}`, err);
      incompleteMoots.push({
        moot: mutual,
        reason: 'unknown',
        partialCount: 0
      });
    } finally {
      scannedCount++;
      if (onProgress) {
        onProgress({
          scanned: scannedCount,
          total: mutuals.length
        });
      }
    }
  });

  return { blockingMutuals, incompleteMoots };
}

// 4. Find which mutuals block the most of your other mutuals
export async function findTopBlockersAmongMutuals(
  agent: Agent,
  mutuals: MutualProfile[],
  onProgress?: (progress: BlockCheckProgress) => void,
  concurrency = 5
): Promise<TopBlockersScanResult> {
  const mutualsMap = new Map<string, MutualProfile>();
  for (const m of mutuals) {
    mutualsMap.set(m.did, m);
  }

  // Map to hold DID -> Set of mutual DIDs that they block
  const blockerMap = new Map<string, Set<string>>();
  const incompleteMoots: MootScanError[] = [];
  let scannedCount = 0;

  // Fetch all blocks concurrently across mutuals
  await mapConcurrent(mutuals, concurrency, async (mutual) => {
    try {
      const result = await fetchAllUserBlocks(mutual.did);
      for (const blockedSubject of result.blockedDids) {
        const matchedMutual = mutualsMap.get(blockedSubject);
        if (matchedMutual && matchedMutual.did !== mutual.did) {
          let set = blockerMap.get(mutual.did);
          if (!set) {
            set = new Set<string>();
            blockerMap.set(mutual.did, set);
          }
          set.add(matchedMutual.did);
        }
      }

      if (!result.isComplete) {
        incompleteMoots.push({
          moot: mutual,
          reason: result.errorReason || 'unknown',
          partialCount: result.blockedDids.length
        });
      }
    } catch (err: any) {
      console.warn(`Failed checking blocks for ${mutual.did}`, err);
      incompleteMoots.push({
        moot: mutual,
        reason: 'unknown',
        partialCount: 0
      });
    } finally {
      scannedCount++;
      if (onProgress) {
        onProgress({
          scanned: scannedCount,
          total: mutuals.length
        });
      }
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
  for (const m of mutuals) {
    profilesMap.set(m.did, m);
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

  const summaries: MutualBlockerSummary[] = sortedEntries.map((entry) => {
    const blockerProfile = profilesMap.get(entry.did) || {
      did: entry.did,
      handle: entry.did
    };
    const blockedMutuals = entry.blockedDids
      .map((bDid) => profilesMap.get(bDid) || { did: bDid, handle: bDid })
      .filter(Boolean);

    return {
      blocker: blockerProfile,
      blockedMutuals
    };
  });

  return { summaries, incompleteMoots };
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

  const scanResult = await findTopBlockersAmongMutuals(
    agent,
    mutuals,
    onProgress ? (p) => onProgress(p.scanned, p.total) : undefined,
    concurrency
  );

  return scanResult.summaries.map((s) => ({
    blocker: s.blocker,
    blockedMutuals: s.blockedMutuals,
    count: s.blockedMutuals.length
  }));
}

// 5. Find which mutuals are blocked by the most of your other mutuals
export async function findTopBlockedAmongMutuals(
  agent: Agent,
  mutuals: MutualProfile[],
  onProgress?: (progress: BlockCheckProgress) => void,
  concurrency = 5
): Promise<TopBlockedScanResult> {
  const mutualsMap = new Map<string, MutualProfile>();
  for (const m of mutuals) {
    mutualsMap.set(m.did, m);
  }

  // Map to hold DID -> Set of mutual DIDs that block them
  const blockedMap = new Map<string, Set<string>>();
  const incompleteMoots: MootScanError[] = [];
  let scannedCount = 0;

  // Fetch all blocks concurrently across mutuals
  await mapConcurrent(mutuals, concurrency, async (mutual) => {
    try {
      const result = await fetchAllUserBlocks(mutual.did);
      for (const blockedSubject of result.blockedDids) {
        const matchedMutual = mutualsMap.get(blockedSubject);
        if (matchedMutual && matchedMutual.did !== mutual.did) {
          let set = blockedMap.get(matchedMutual.did);
          if (!set) {
            set = new Set<string>();
            blockedMap.set(matchedMutual.did, set);
          }
          set.add(mutual.did);
        }
      }

      if (!result.isComplete) {
        incompleteMoots.push({
          moot: mutual,
          reason: result.errorReason || 'unknown',
          partialCount: result.blockedDids.length
        });
      }
    } catch (err: any) {
      console.warn(`Failed checking blocks for ${mutual.did}`, err);
      incompleteMoots.push({
        moot: mutual,
        reason: 'unknown',
        partialCount: 0
      });
    } finally {
      scannedCount++;
      if (onProgress) {
        onProgress({
          scanned: scannedCount,
          total: mutuals.length
        });
      }
    }
  });

  // Sort by blocker count descending
  const sortedEntries = Array.from(blockedMap.entries())
    .map(([did, blockerSet]) => ({
      did,
      count: blockerSet.size,
      blockerDids: Array.from(blockerSet)
    }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);

  const allNeededDids = new Set<string>();
  for (const entry of sortedEntries) {
    allNeededDids.add(entry.did);
    for (const bDid of entry.blockerDids) {
      allNeededDids.add(bDid);
    }
  }

  const profilesMap = new Map<string, MutualProfile>();
  for (const m of mutuals) {
    profilesMap.set(m.did, m);
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

  const summaries: MutualBlockedSummary[] = sortedEntries.map((entry) => {
    const blockedProfile = profilesMap.get(entry.did) || {
      did: entry.did,
      handle: entry.did
    };
    const blockedByMutuals = entry.blockerDids
      .map((bDid) => profilesMap.get(bDid) || { did: bDid, handle: bDid })
      .filter(Boolean);

    return {
      blocked: blockedProfile,
      blockedByMutuals
    };
  });

  return { summaries, incompleteMoots };
}

/**
 * Scan mutuals blocked by other mutuals, sorted by most blockers (end-to-end helper).
 */
export async function findMutualsBlockedByMutuals(
  agent: Agent,
  userDid: string,
  concurrency = 5,
  onProgress?: (scanned: number, total: number) => void
): Promise<MutualBlockedEntry[]> {
  const mutuals = await fetchAllMutuals(agent, userDid);
  if (mutuals.length === 0) return [];

  const scanResult = await findTopBlockedAmongMutuals(
    agent,
    mutuals,
    onProgress ? (p) => onProgress(p.scanned, p.total) : undefined,
    concurrency
  );

  return scanResult.summaries.map((s) => ({
    blocked: s.blocked,
    blockedByMutuals: s.blockedByMutuals,
    count: s.blockedByMutuals.length
  }));
}
