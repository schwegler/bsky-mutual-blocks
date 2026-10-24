import { Agent, AppBskyActorDefs } from '@atproto/api';
import { get, set } from 'idb-keyval';

export interface MutualProfile {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

export type BlockFetchErrorReason = 'rate_limit' | 'timeout' | 'pds_offline' | 'invalid_pds' | 'unknown';

export interface UserBlocksResult {
  blockedDids: string[];
  isComplete: boolean;
  errorReason?: BlockFetchErrorReason;
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

export interface BlockReadOptions {
  forceRefresh?: boolean;
  signal?: AbortSignal;
  onSource?: (source: 'cache' | 'network', fetchedAt: number) => void;
}

async function resolvePdsUrlFromDocUrl(
  docUrl: string,
  signal: AbortSignal
): Promise<{ pdsUrl?: string; errorReason?: BlockFetchErrorReason }> {
  try {
    const res = await fetch(docUrl, { signal });
    if (res.ok) {
      const doc = await res.json();
      const pdsService = doc.service?.find((s: any) => s.id === '#atproto_pds');
      return { pdsUrl: pdsService?.serviceEndpoint };
    } else {
      return { errorReason: 'pds_offline' };
    }
  } catch (err: any) {
    return {
      errorReason: err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'pds_offline'
    };
  }
}

export async function fetchAllUserBlocks(
  repoDid: string,
  maxRetries = 3,
  options: BlockReadOptions = {}
): Promise<UserBlocksResult> {
  const cacheKey = `blocks_${repoDid}`;
  try {
    const cached = await get<BlockCacheEntry>(cacheKey);
    if (!options.forceRefresh && cached && Number.isFinite(cached.timestamp) && cached.timestamp <= Date.now() && Date.now() - cached.timestamp < CACHE_TTL_MS && Array.isArray(cached.blockedDids) && cached.blockedDids.every((did) => typeof did === 'string')) {
      options.onSource?.('cache', cached.timestamp);
      return { blockedDids: cached.blockedDids, isComplete: true };
    }
  } catch (err) {
    console.warn(`Cache read failed for ${repoDid}`, err);
  }

  const blockedDids: string[] = [];
  const requestSignal = () => options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);

  try {
    let docUrl: string;

    if (repoDid.startsWith('did:plc:')) {
      docUrl = `https://plc.directory/${repoDid}`;
    } else if (repoDid.startsWith('did:web:')) {
      const parts = repoDid.slice('did:web:'.length).split(':').map(decodeURIComponent);
      const domain = parts.shift()!;
      const didPath = parts.length ? '/' + parts.map(encodeURIComponent).join('/') + '/did.json' : '/.well-known/did.json';
      docUrl = `https://${domain}${didPath}`;
    } else {
      return { blockedDids, isComplete: false, errorReason: 'invalid_pds' };
    }

    const { pdsUrl: rawPdsUrl, errorReason: docError } = await resolvePdsUrlFromDocUrl(docUrl, requestSignal());
    if (docError) {
      return { blockedDids, isComplete: false, errorReason: docError };
    }

    let pdsUrl = rawPdsUrl;

    if (!pdsUrl || !isSecurePds(pdsUrl)) {
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
          options.signal?.throwIfAborted();
          let url = `${pdsUrl}/xrpc/com.atproto.repo.listRecords?repo=${encodeURIComponent(repoDid)}&collection=app.bsky.graph.block&limit=100`;
          if (cursor) {
            url += `&cursor=${encodeURIComponent(cursor)}`;
          }

          const response = await fetch(url, {
            signal: requestSignal()
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

          if (data.cursor && (typeof data.cursor !== 'string' || data.cursor === cursor || seenCursors.has(data.cursor))) {
            return { blockedDids, isComplete: false, errorReason: 'unknown' };
          }
          if (data.cursor && typeof data.cursor === 'string' && data.cursor !== cursor && !seenCursors.has(data.cursor)) {
            seenCursors.add(data.cursor);
            cursor = data.cursor;
          } else {
            cursor = undefined;
          }

          success = true;
        } catch (err: any) {
          options.signal?.throwIfAborted();
          attempts++;
          const isRateLimit = err?.status === 429 || err?.message?.includes('Rate Limit');
          if (attempts < maxRetries && isRateLimit) {
            const waitMs = Math.pow(2, attempts) * 1000;
            console.warn(`[429] Rate limit on ${repoDid}. Retrying in ${waitMs}ms...`);
            await abortableDelay(waitMs, options.signal);
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
      options.signal?.throwIfAborted();
      await set(cacheKey, { timestamp: Date.now(), blockedDids });
    } catch (err) {
      console.warn(`Cache write failed for ${repoDid}`, err);
    }

    options.signal?.throwIfAborted();
    return { blockedDids, isComplete: true };
  } catch (err: any) {
    options.signal?.throwIfAborted();
    console.error('Error fetching blocks for', repoDid, err);
    return { blockedDids, isComplete: false, errorReason: 'unknown' };
  } finally {
    options.onSource?.('network', Date.now());
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
  onProgress?: (count: number) => void,
  signal?: AbortSignal
): Promise<MutualProfile[]> {
  const mutuals: MutualProfile[] = [];
  let cursor: string | undefined = undefined;
  const seenCursors = new Set<string>();

  do {
    signal?.throwIfAborted();
    const res = await agent.app.bsky.graph.getFollows({
      actor: userDid,
      limit: 100,
      cursor
    });

    signal?.throwIfAborted();
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
    } else if (nextCursor) {
      throw new Error('The mutual-follower response repeated an invalid pagination cursor. Try refreshing your circle.');
    } else {
      cursor = undefined;
    }
  } while (cursor);

  return mutuals;
}

/** Reject active content, credentials and insecure transport in remote DID service endpoints. */
export function isSecurePds(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(done, ms);
    const abort = () => { clearTimeout(timer); signal!.removeEventListener('abort', abort); reject(signal!.reason); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
