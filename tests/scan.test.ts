import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@atproto/api';
import * as bsky from '../src/bsky';
import { clearBlockCache, clearCircleCache, readCircle, saveCircle, scanCircle, resultRows, Snapshot, CIRCLE_TTL } from '../src/scan';
import { mockIdbStore } from './setup';
import { keys, del } from 'idb-keyval';
const a = { did: 'did:plc:a', handle: 'a.example.test' }, b = { did: 'did:plc:b', handle: 'b.example.test' }, c = { did: 'did:plc:c', handle: 'c.example.test' };
function fixture(mode: Snapshot['mode'] = 'lookup'): Snapshot {
  return { mode, target: b, mutuals: [a,b,c], circleFetchedAt: 10, finishedAt: 30, observations: [
    { moot:a, blockedDids:[b.did,b.did,c.did,a.did,'did:plc:outside'], isComplete:true, fetchedAt:20, source:'cache' },
    { moot:b, blockedDids:[c.did], isComplete:true, fetchedAt:22, source:'network' },
    { moot:c, blockedDids:[b.did], isComplete:false, errorReason:'timeout', fetchedAt:24, source:'network' }
  ] };
}
afterEach(()=>vi.useRealTimers());
describe('directed circle model',()=>{
  it('deduplicates direct target matches and counts only within-circle edges in each direction',()=>{
    expect(resultRows(fixture()).map(r=>r.account.did)).toEqual([a.did,c.did]);
    expect(resultRows(fixture('sent')).map(r=>[r.account.did,r.count])).toEqual([[a.did,2],[b.did,1],[c.did,1]]);
    expect(resultRows(fixture('received')).map(r=>[r.account.did,r.related.map(m=>m.did)])).toEqual([[b.did,[a.did,c.did]],[c.did,[a.did,b.did]]]);
  });
  it('does not invent zero-count rows',()=>{const s=fixture('sent');s.observations=[];expect(resultRows(s)).toEqual([])});
  it('reuses cached mutuals map across repeated resultRows calls on the same snapshot',()=>{
    const s = fixture('sent');
    const first = resultRows(s);
    const second = resultRows(s);
    expect(first).toEqual(second);
  });
  it('keeps cached source timestamps and processes fresh observations',async()=>{
    const fetch=vi.spyOn(bsky,'fetchAllUserBlocks').mockImplementation(async(did,_retry,options)=>{options?.onSource?.(did===a.did?'cache':'network',100);return {blockedDids:[b.did],isComplete:true}});
    const progress=vi.fn();const s=await scanCircle({} as Agent,{mode:'lookup',target:b,mutuals:[a,b],circleFetchedAt:1},{signal:new AbortController().signal,forceRefresh:false,onProgress:progress});
    expect(s.observations[0]).toMatchObject({source:'cache',fetchedAt:100});expect(s.observations[1].source).toBe('network');expect(progress).toHaveBeenLastCalledWith(2,2);expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('retries only incomplete authors, bypasses cache, and replaces stale partial positives',async()=>{
    const fetch=vi.spyOn(bsky,'fetchAllUserBlocks').mockResolvedValue({blockedDids:[],isComplete:false,errorReason:'rate_limit'});
    const previous=fixture();
    const options={signal:new AbortController().signal,forceRefresh:true,previous,onProgress:vi.fn()};
    const next=await scanCircle({} as Agent,previous,options);
    expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][0]).toBe(c.did);expect(fetch.mock.calls[0][2]?.forceRefresh).toBe(true);
    expect(next.observations[0]).toBe(previous.observations[0]);expect(next.observations[2].blockedDids).toEqual([]);
    await scanCircle({} as Agent,next,{...options,previous:next});expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not publish cancelled work or start another pending author',async()=>{
    const controller=new AbortController();controller.abort();
    await expect(scanCircle({} as Agent,fixture(),{signal:controller.signal,forceRefresh:false,onProgress:vi.fn()})).rejects.toThrow();
  });
  it('rejects cancellation after a response and before publication',async()=>{
    const controller=new AbortController();vi.spyOn(bsky,'fetchAllUserBlocks').mockImplementation(async()=>{controller.abort();return {blockedDids:[],isComplete:true}});
    await expect(scanCircle({} as Agent,{...fixture(),mutuals:[a]},{signal:controller.signal,forceRefresh:false,onProgress:vi.fn()})).rejects.toThrow();
  });
});
describe('bounded browser caches',()=>{
  it('roundtrips a circle, expires at fifteen minutes and rejects legacy/corrupt/future data',()=>{
    const now=Date.now();saveCircle(a.did,{mutuals:[a],fetchedAt:now});expect(readCircle(a.did)).toEqual({mutuals:[a],fetchedAt:now});
    for(const value of [null,{}, {mutuals:[],fetchedAt:now-CIRCLE_TTL},{mutuals:[],fetchedAt:now+1000},{mutuals:[null],fetchedAt:now},{mutuals:[{did:2,handle:3}],fetchedAt:now},{mutuals:'bad',fetchedAt:now}]){sessionStorage.setItem('moots_circle_'+a.did,JSON.stringify(value));expect(readCircle(a.did)).toBeNull()}
    sessionStorage.setItem('moots_circle_'+a.did,'{bad');expect(readCircle(a.did)).toBeNull();expect(readCircle('missing')).toBeNull();
  });
  it('continues when browser storage is blocked',()=>{
    vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('blocked')});expect(readCircle(a.did)).toBeNull();
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('blocked')});expect(()=>saveCircle(a.did,{mutuals:[],fetchedAt:1})).not.toThrow();
  });
  it('clears only owned scan keys, preserving unrelated and OAuth data',async()=>{
    sessionStorage.setItem('moots_circle_a','x');sessionStorage.setItem('bsky_mutuals_cache_a','x');sessionStorage.setItem('oauth','keep');clearCircleCache();expect(sessionStorage.length).toBe(1);
    mockIdbStore.set('blocks_a',{});mockIdbStore.set('oauth',{});mockIdbStore.set(5,{});await clearBlockCache();expect(mockIdbStore.has('blocks_a')).toBe(false);expect(mockIdbStore.size).toBe(2);
  });
  it('surfaces storage failure so the UI cannot claim clearing succeeded',async()=>{
    vi.mocked(keys).mockRejectedValueOnce(Error('blocked'));await expect(clearBlockCache()).rejects.toThrow('blocked');
    mockIdbStore.set('blocks_a',{});vi.mocked(del).mockRejectedValueOnce(Error('write'));await expect(clearBlockCache()).rejects.toThrow('write');
  });
});
