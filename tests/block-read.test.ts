import { afterEach, expect, it, vi } from 'vitest';
import { abortableDelay, fetchAllMutuals, fetchAllUserBlocks, isSecurePds } from '../src/bsky';
import { mockIdbStore } from './setup';
import type { Agent } from '@atproto/api';
const doc={service:[{id:'#atproto_pds',serviceEndpoint:'https://pds.example.test'}]};
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()});
it('reports cached provenance, bypasses cache on refresh and rejects corrupt cache shapes',async()=>{
  const timestamp=Date.now()-1000;mockIdbStore.set('blocks_did:plc:a',{timestamp,blockedDids:['did:plc:b']});const source=vi.fn();
  const fetch=vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('plc.directory')?doc:{records:[]})));vi.stubGlobal('fetch',fetch);
  expect(await fetchAllUserBlocks('did:plc:a',3,{onSource:source})).toEqual({blockedDids:['did:plc:b'],isComplete:true});expect(source).toHaveBeenCalledWith('cache',timestamp);expect(fetch).not.toHaveBeenCalled();
  await fetchAllUserBlocks('did:plc:a',3,{forceRefresh:true,onSource:source});expect(source).toHaveBeenCalledWith('network',expect.any(Number));expect(fetch).toHaveBeenCalledTimes(2);
  for(const entry of [{timestamp:Date.now()+1000,blockedDids:[]},{timestamp:Date.now(),blockedDids:[3]},{timestamp:'bad',blockedDids:[]},{timestamp:Date.now(),blockedDids:'bad'}]){mockIdbStore.set('blocks_did:plc:a',entry);await fetchAllUserBlocks('did:plc:a')}
  expect(fetch).toHaveBeenCalledTimes(10);
});
it('cancels fetches/backoff and never stores a cancelled observation',async()=>{
  const controller=new AbortController();controller.abort();vi.stubGlobal('fetch',vi.fn(async()=>{throw controller.signal.reason}));
  const result=await fetchAllUserBlocks('did:plc:a',3,{signal:controller.signal});expect(result.isComplete).toBe(false);expect(mockIdbStore.size).toBe(0);
  vi.useFakeTimers();const later=new AbortController();const delay=abortableDelay(6000,later.signal);later.abort();await expect(delay).rejects.toThrow();
  await expect(abortableDelay(10,controller.signal)).rejects.toThrow();const done=abortableDelay(10,new AbortController().signal);await vi.runAllTimersAsync();await done;
});
it('propagates cancellation after a record request and aborts 429 backoff',async()=>{
  for(const backoff of [false,true]){
    const controller=new AbortController();
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>{if(url.includes('plc.directory'))return new Response(JSON.stringify(doc));controller.abort();if(backoff)return new Response('',{status:429});throw controller.signal.reason}));
    await expect(fetchAllUserBlocks('did:plc:a',3,{signal:controller.signal})).rejects.toThrow();expect(mockIdbStore.size).toBe(0);
  }
});
it('combines caller cancellation with timeout and resolves did:web paths',async()=>{
  const fetch=vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('did.json')?doc:{records:[]})));vi.stubGlobal('fetch',fetch);
  expect((await fetchAllUserBlocks('did:web:example.test:people:jun',3,{signal:new AbortController().signal})).isComplete).toBe(true);expect(fetch.mock.calls[0][0]).toBe('https://example.test/people/jun/did.json');
  expect((await fetchAllUserBlocks('did:web:%INVALID')).isComplete).toBe(false);
});
it('does not report an invalid or looping record cursor as complete',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('plc.directory')?doc:{records:[],cursor:23}))));
  expect(await fetchAllUserBlocks('did:plc:a')).toMatchObject({isComplete:false,errorReason:'unknown'});expect(mockIdbStore.size).toBe(0);
});
it('requires HTTPS PDS URLs without credentials, queries or fragments',()=>{
  expect(isSecurePds('https://pds.example.test/')).toBe(true);
  for(const url of ['http://pds.example.test','https://user:pw@pds.example.test','https://pds.example.test?token=x','https://pds.example.test/#fragment','bad','javascript:alert(1)'])expect(isSecurePds(url)).toBe(false);
});
it('checks cancellation before and after mutual discovery',async()=>{
  const controller=new AbortController();const agent={app:{bsky:{graph:{getFollows:vi.fn(async()=>{controller.abort();return {data:{follows:[]}}})}}}} as unknown as Agent;
  await expect(fetchAllMutuals(agent,'did:plc:a',undefined,controller.signal)).rejects.toThrow();
  await expect(fetchAllMutuals(agent,'did:plc:a',undefined,controller.signal)).rejects.toThrow();
});
it('classifies every public failure label and page-level timeout variant',async()=>{
  const { getErrorReasonMessage }=await import('../src/bsky');
  for(const reason of ['rate_limit','timeout','pds_offline','invalid_pds','unknown',undefined] as const)expect(getErrorReasonMessage(reason)).toBeTruthy();
  for(const error of [new DOMException('time','TimeoutError'),new DOMException('abort','AbortError'),Error('request timeout'),Error('request abort')]){
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>{if(url.includes('plc.directory'))return new Response(JSON.stringify(doc));throw error}));
    expect(await fetchAllUserBlocks('did:plc:a')).toMatchObject({isComplete:false,errorReason:'timeout'});
  }
});
it('handles did:web discovery timeouts, malformed encoding and zero retries without a false success',async()=>{
  for(const error of [new DOMException('time','TimeoutError'),Error('network')]){
    vi.stubGlobal('fetch',vi.fn(async()=>{throw error}));expect((await fetchAllUserBlocks('did:web:example.test')).isComplete).toBe(false);
  }
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(doc))));expect(await fetchAllUserBlocks('did:plc:a',0)).toMatchObject({isComplete:false,errorReason:'unknown'});
});
