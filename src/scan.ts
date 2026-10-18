import { Agent } from '@atproto/api';
import { del, keys } from 'idb-keyval';
import { fetchAllUserBlocks, mapConcurrent, MutualProfile, UserBlocksResult } from './bsky';

export type Mode = 'lookup' | 'sent' | 'received';
export interface Observation extends UserBlocksResult {
  moot: MutualProfile;
  fetchedAt: number;
  source: 'cache' | 'network';
}
export interface Snapshot {
  mode: Mode;
  target?: { did: string; handle?: string };
  mutuals: MutualProfile[];
  circleFetchedAt: number;
  observations: Observation[];
  finishedAt: number;
}
export interface ResultRow { account: MutualProfile; related: MutualProfile[]; count: number }
export interface ScanOptions {
  signal: AbortSignal;
  forceRefresh: boolean;
  previous?: Snapshot;
  onProgress: (processed: number, total: number) => void;
}

/** Each retry replaces only that author's observation. Old partial positives aren't silently treated as current. */
export async function scanCircle(
  _agent: Agent,
  input: Omit<Snapshot, 'observations' | 'finishedAt'>,
  options: ScanOptions
): Promise<Snapshot> {
  const previous = new Map(options.previous?.observations.map(o => [o.moot.did, o]));
  const pending = options.previous ? input.mutuals.filter(m => !previous.get(m.did)?.isComplete) : input.mutuals;
  let processed = 0;
  const observations = await mapConcurrent(pending, 5, async moot => {
    options.signal.throwIfAborted();
    let fetchedAt = Date.now();
    let source: Observation['source'] = 'network';
    const result = await fetchAllUserBlocks(moot.did, 3, {
      forceRefresh: options.forceRefresh,
      signal: options.signal,
      onSource: (value, timestamp) => { source = value; fetchedAt = timestamp; }
    });
    options.signal.throwIfAborted();
    options.onProgress(++processed, pending.length);
    return { ...result, moot, fetchedAt, source };
  });
  for (const observation of observations) previous.set(observation.moot.did, observation);
  options.signal.throwIfAborted();
  return { ...input, observations: input.mutuals.map(m => previous.get(m.did)!), finishedAt: Date.now() };
}

export function resultRows(snapshot: Snapshot): ResultRow[] {
  const mutuals = new Map(snapshot.mutuals.map(m => [m.did, m]));
  const rows = new Map<string, ResultRow>();
  for (const observation of snapshot.observations) {
    const subjects = new Set(observation.blockedDids);
    if (snapshot.mode === 'lookup') {
      if (subjects.has(snapshot.target!.did)) rows.set(observation.moot.did, { account: observation.moot, related: [], count: 1 });
      continue;
    }
    for (const subject of subjects) {
      const account = mutuals.get(subject);
      if (!account || account.did === observation.moot.did) continue;
      const person = snapshot.mode === 'sent' ? observation.moot : account;
      const related = snapshot.mode === 'sent' ? account : observation.moot;
      const row = rows.get(person.did) ?? { account: person, related: [], count: 0 };
      row.related.push(related);
      row.count++;
      rows.set(person.did, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || a.account.handle.localeCompare(b.account.handle));
}

const PREFIX = 'moots_circle_';
export const CIRCLE_TTL = 15 * 60 * 1000;
export function readCircle(did: string): { mutuals: MutualProfile[]; fetchedAt: number } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PREFIX + did) || 'null');
    if (!value || !Number.isFinite(value.fetchedAt) || value.fetchedAt > Date.now() || Date.now() - value.fetchedAt >= CIRCLE_TTL || !Array.isArray(value.mutuals)) return null;
    if (!value.mutuals.every((m: MutualProfile) => m && typeof m.did === 'string' && typeof m.handle === 'string')) return null;
    return value;
  } catch { return null; }
}
export function saveCircle(did: string, value: { mutuals: MutualProfile[]; fetchedAt: number }): void {
  try { sessionStorage.setItem(PREFIX + did, JSON.stringify(value)); } catch { /* Continue without persistence. */ }
}
export function clearCircleCache(): void {
  for (const key of Object.keys(sessionStorage)) if (key.startsWith(PREFIX) || key.startsWith('bsky_mutuals_cache_')) sessionStorage.removeItem(key);
}
export async function clearBlockCache(): Promise<void> {
  const cacheKeys = await keys();
  for (const key of cacheKeys) if (typeof key === 'string' && key.startsWith('blocks_')) await del(key);
}
