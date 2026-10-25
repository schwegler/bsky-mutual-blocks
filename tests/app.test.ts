import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@atproto/api';
import type { Snapshot } from '../src/scan';
import { createApp, Services, validActor } from '../src/app';
import * as scanModule from '../src/scan';
import * as bsky from '../src/bsky';
import { mockIdbStore } from './setup';

const jun={did:'did:plc:jun',handle:'jun.example.test',displayName:'Jun Park'};
const river={did:'did:plc:river',handle:'river.example.test',displayName:'River Vale'};
const sol={did:'did:plc:sol',handle:'sol.example.test',displayName:'Sol Rivera'};
const mutuals=[jun,river,sol];
const $=<T extends HTMLElement=HTMLElement>(s:string)=>document.querySelector<T>(s)!;
const click=(s:string)=>$(s).click();
function submit(s:string){$(s).dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))}
function enter(s:string,value:string){const input=$<HTMLInputElement>(s);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}))}
function defer<T>(){let resolve!:(value:T)=>void;let reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
const flush=()=>vi.waitFor(()=>expect($('#content')?.getAttribute('aria-busy')).not.toBe('true'));
function fixture(mode: Snapshot['mode']='lookup',partial=false,cached=false):Snapshot{return {mode,target:river,mutuals,circleFetchedAt:Date.now()-60000,finishedAt:Date.now(),observations:[{moot:jun,blockedDids:[river.did,sol.did],isComplete:true,source:cached?'cache':'network',fetchedAt:Date.now()-60000},{moot:river,blockedDids:[],isComplete:true,source:'network',fetchedAt:Date.now()},{moot:sol,blockedDids:[river.did],isComplete:!partial,errorReason:partial?'rate_limit':undefined,source:'network',fetchedAt:Date.now()}]}}
let controller:ReturnType<typeof createApp>;
let services:Services;
let agent:Agent;
beforeEach(()=>{
  agent={getProfile:vi.fn(async()=>({data:{did:'did:plc:alex',handle:'alex.example.test',displayName:'Alex Morgan'}}))} as unknown as Agent;
  services={initOAuth:vi.fn(async()=>({session:{sub:'did:plc:alex'},agent})),signIn:vi.fn(async()=>{}),signOut:vi.fn(async()=>{})};
  vi.spyOn(bsky,'resolveActor').mockResolvedValue({did:river.did,profile:river});
  vi.spyOn(bsky,'fetchAllMutuals').mockResolvedValue(mutuals);
  vi.spyOn(scanModule,'scanCircle').mockImplementation(async(_agent,input,options)=>{options.onProgress(3,3);return {...fixture(input.mode),...input}});
  vi.spyOn(bsky,'searchActorsTypeahead').mockResolvedValue([river] as never);
  // Happy DOM does not implement dialog's modal methods.
  HTMLDialogElement.prototype.showModal=function(){this.open=true};
  HTMLDialogElement.prototype.close=function(){this.open=false};
});
afterEach(()=>controller?.cancel());
async function start(signed=true){if(!signed)vi.mocked(services.initOAuth).mockResolvedValue({session:null,agent:null});controller=createApp(services);await controller.start()}
async function lookup(){enter('#target','river.example.test');submit('.tool-form');await flush()}

describe('authentication and application shell',()=>{
  it('starts signed out, validates handle/DID and reports sign-in errors inline',async()=>{
    await start(false);expect($('h1').textContent).toContain('A clearer view');expect($<HTMLButtonElement>('[data-mode=sent]').disabled).toBe(true);
    enter('#login-handle','bad');submit('.auth-form');expect($('#login-error').textContent).toContain('full Bluesky');expect(document.activeElement).toBe($('#login-handle'));
    vi.mocked(services.signIn).mockRejectedValueOnce(Error('provider unavailable'));enter('#login-handle','@alex.example.test');submit('.auth-form');await vi.waitFor(()=>expect($('#login-error').textContent).toBe('Could not start sign-in. provider unavailable'));expect($<HTMLInputElement>('#login-handle').disabled).toBe(false);expect($<HTMLButtonElement>('.primary').disabled).toBe(false);
    vi.mocked(services.signIn).mockRejectedValueOnce('unknown error');submit('.auth-form');await vi.waitFor(()=>expect($('#login-error').textContent).toBe('Could not start sign-in. The request could not be completed. Please try again.'));expect($<HTMLInputElement>('#login-handle').disabled).toBe(false);expect($<HTMLButtonElement>('.primary').disabled).toBe(false);
    submit('.auth-form');await vi.waitFor(()=>expect(services.signIn).toHaveBeenCalledTimes(3));
    click('#login-privacy');expect($<HTMLDialogElement>('#modal').open).toBe(true);
  });
  it('locks duplicate sign-in submissions while redirect preparation is pending',async()=>{
    await start(false);const pending=defer<void>();vi.mocked(services.signIn).mockReturnValue(pending.promise);enter('#login-handle','alex.example.test');submit('.auth-form');submit('.auth-form');expect(services.signIn).toHaveBeenCalledTimes(1);pending.resolve();
  });
  it('recovers a failed restore and a mismatched session without pretending to be connected',async()=>{
    vi.mocked(services.initOAuth).mockRejectedValueOnce(Error('restore'));await start();expect($('#login-error').textContent).toContain('could not be restored');
    vi.mocked(services.initOAuth).mockResolvedValueOnce({session:null,agent});await start();expect($('#login-handle')).not.toBeNull();
  });
  it('uses DID fallback, safely renders the identity and signs out without deleting unrelated data',async()=>{
    vi.mocked(agent.getProfile).mockRejectedValueOnce(Error('profile'));await start();expect($('#identity').textContent).toContain('did:plc:alex');sessionStorage.setItem('oauth','keep');sessionStorage.setItem('moots_circle_old','old');click('#identity button');await vi.waitFor(()=>expect($('#login-handle')).not.toBeNull());expect(sessionStorage.getItem('oauth')).toBe('keep');expect(sessionStorage.getItem('moots_circle_old')).toBeNull();
  });
  it('completes sign-out even if clearCircleCache throws an error',async()=>{
    await start();
    vi.spyOn(scanModule,'clearCircleCache').mockImplementationOnce(()=>{throw new Error('sessionStorage quota exceeded')});
    click('#identity button');
    await vi.waitFor(()=>expect($('#login-handle')).not.toBeNull());
    expect($('#announcement').textContent).toContain('Signed out');
  });
  it('keeps the session visible on sign-out failure and allows retry',async()=>{
    await start();vi.mocked(services.signOut).mockRejectedValueOnce(Error('offline'));click('#identity button');await vi.waitFor(()=>expect($('.error-notice').textContent).toContain('Sign-out failed'));expect($<HTMLButtonElement>('#identity button').disabled).toBe(false);
  });
  it('opens help and storage dialogs and restores keyboard focus',async()=>{
    await start();$('#help').focus();click('#help');expect($('#modal-content').textContent).toContain('network-wide rankings');click('#close-dialog');expect(document.activeElement).toBe($('#help'));
    click('#scope');$('#modal').dispatchEvent(new Event('cancel'));expect($('#modal-content').textContent).toContain('15 minutes');
  });
  it('clears owned caches honestly and shows failures instead of claiming success',async()=>{
    await start();mockIdbStore.set('blocks_a',{});mockIdbStore.set('oauth',{});click('#scope');click('#clear-data');await vi.waitFor(()=>expect($('#clear-status').textContent).toContain('cleared'));expect(mockIdbStore.has('oauth')).toBe(true);expect(mockIdbStore.has('blocks_a')).toBe(false);
    vi.spyOn(scanModule,'clearBlockCache').mockRejectedValueOnce(Error('blocked'));click('#clear-data');await vi.waitFor(()=>expect($('#clear-status').textContent).toContain('could not be cleared'));expect($<HTMLButtonElement>('#clear-data').disabled).toBe(false);
  });
  it('validates syntactically supported handles and DIDs without accepting markup or URL input',()=>{
    for(const value of ['jun.example.test','@jun.example.test','https://bsky.app/profile/jun','a..test','did:plc:abc','did:web:example.test:user','did:key:x','<script>'])expect(validActor(value)).toBe(['jun.example.test','did:plc:abc','did:web:example.test:user'].includes(value));
  });
});
describe('guarded scan lifecycle',()=>{
  it('validates target inline and freezes the canonical target into the result',async()=>{
    await start();submit('.tool-form');expect($('#target-error').textContent).toContain('full Bluesky');expect(document.activeElement).toBe($('#target'));
    await lookup();expect($('h2').textContent).toBe('2 mutuals with direct block records');expect($('.result-context').textContent).toContain('@river.example.test');expect($('#announcement').textContent).toContain('Scan finished');
    expect(bsky.fetchAllMutuals).toHaveBeenCalledTimes(1);await lookup();expect(bsky.fetchAllMutuals).toHaveBeenCalledTimes(1);
    click('.scan-actions .secondary');await flush();expect(bsky.fetchAllMutuals).toHaveBeenCalledTimes(2);expect(vi.mocked(scanModule.scanCircle).mock.calls.at(-1)![2].forceRefresh).toBe(true);
  });
  it('disables mode/input/actions before resolution completes and cancels without publishing',async()=>{
    await start();const pending=defer<Awaited<ReturnType<typeof bsky.resolveActor>>>();vi.mocked(bsky.resolveActor).mockReturnValueOnce(pending.promise);enter('#target','river.example.test');submit('.tool-form');expect($<HTMLButtonElement>('[data-mode=sent]').disabled).toBe(true);expect($<HTMLInputElement>('#target').disabled).toBe(true);submit('.tool-form');expect(bsky.resolveActor).toHaveBeenCalledTimes(1);click('.loading .secondary');pending.resolve({did:river.did,profile:river});await Promise.resolve();await Promise.resolve();expect(scanModule.scanCircle).not.toHaveBeenCalled();expect($('.cancel-note').textContent).toContain('cancelled');
  });
  it('catches mutual-discovery failures and keeps retry available',async()=>{
    await start();vi.mocked(bsky.fetchAllMutuals).mockRejectedValueOnce(Error('following server failed'));await lookup();expect($('.empty').textContent).toContain('following server failed');click('.empty button');await flush();expect($('.records')).not.toBeNull();
  });
  it('handles zero mutuals and explicitly refreshes the circle',async()=>{
    await start();vi.mocked(bsky.fetchAllMutuals).mockResolvedValueOnce([]);await lookup();expect($('.empty').textContent).toContain('No mutual followers');click('.empty button');await flush();expect($('.records')).not.toBeNull();
  });
  it('handles an expired authorization session with reconnect',async()=>{
    await start();vi.mocked(bsky.fetchAllMutuals).mockRejectedValueOnce({status:401});await lookup();expect($('.empty').textContent).toContain('fresh start');click('.empty button');expect($('#login-handle')).not.toBeNull();
  });
  it('catches resolution errors and non-Error failures safely',async()=>{
    await start();vi.mocked(bsky.resolveActor).mockRejectedValueOnce('unknown');await lookup();expect($('.empty').textContent).toContain('could not be completed');
  });
  it('keeps retry on a second partial result and requests only incomplete authors through the snapshot',async()=>{
    await start();vi.mocked(scanModule.scanCircle).mockResolvedValue(fixture('lookup',true));await lookup();expect($('.notice').textContent).toContain('1 of 3');click('.notice button');await flush();expect(vi.mocked(scanModule.scanCircle).mock.calls.at(-1)![2]).toMatchObject({forceRefresh:true,previous:expect.objectContaining({mode:'lookup'})});expect($('.notice button').textContent).toBe('Retry incomplete');
    vi.mocked(scanModule.scanCircle).mockResolvedValueOnce(fixture());click('.notice button');await flush();expect($('.notice')).toBeNull();
  });
  it('distinguishes partial empty from complete empty without absolute block claims',async()=>{
    await start();const empty=fixture('lookup',true);empty.observations.forEach(o=>o.blockedDids=[]);vi.mocked(scanModule.scanCircle).mockResolvedValueOnce(empty);await lookup();expect($('.empty').textContent).toContain('could not be fully checked');expect(document.body.textContent).not.toContain('None of your');
    empty.observations.forEach(o=>o.isComplete=true);vi.mocked(scanModule.scanCircle).mockResolvedValueOnce(empty);await lookup();expect($('.empty').textContent).toContain('Nothing matched');
  });
  it('shows source age, repeats refresh and keeps prior results when cancellation interrupts a refresh',async()=>{
    await start();vi.mocked(scanModule.scanCircle).mockResolvedValueOnce(fixture('lookup',false,true));await lookup();expect($('.notice').textContent).toContain('Oldest cached list fetched');const pending=defer<Snapshot>();vi.mocked(scanModule.scanCircle).mockReturnValueOnce(pending.promise);click('.scan-actions .secondary');await vi.waitFor(()=>expect($('.loading')).not.toBeNull());click('.loading button');expect($('.notice').textContent).toContain('cached block lists');pending.resolve(fixture());await Promise.resolve();expect($('.notice').textContent).toContain('cached block lists');
  });
  it('does not publish a late scan failure after sign-out',async()=>{
    await start();const pending=defer<Snapshot>();vi.mocked(scanModule.scanCircle).mockReturnValueOnce(pending.promise);enter('#target','river.example.test');submit('.tool-form');await vi.waitFor(()=>expect(scanModule.scanCircle).toHaveBeenCalled());click('#identity button');await vi.waitFor(()=>expect($('#login-handle')).not.toBeNull());pending.reject(Error('late failure'));await Promise.resolve();expect($('#login-handle')).not.toBeNull();
  });
});
describe('results, ranks and safe disclosure content',()=>{
  it('renders directional rows, safe external links, name sorting and local filter recovery',async()=>{
    await start();await lookup();const row=$<HTMLDetailsElement>('.record');row.open=true;expect(row.textContent).toContain('→ did:plc:river');expect(row.querySelector('a')?.href).toContain('did%3Aplc%3Ajun');
    enter('.toolbar input','no match');expect($('.records').textContent).toContain('No accounts match');click('.records button');expect(document.activeElement).toBe($('.toolbar input'));expect(document.querySelectorAll('.record')).toHaveLength(2);
    const sort=$<HTMLSelectElement>('.toolbar select');sort.value='name';sort.dispatchEvent(new Event('change'));expect($('.person b').textContent).toBe('Jun Park');
  });
  it.each(['sent','received'] as const)('preserves %s ranking, related accounts and lower-bound partial counts',async mode=>{
    await start();click('[data-mode='+mode+']');vi.mocked(scanModule.scanCircle).mockResolvedValueOnce(fixture(mode,true));submit('.tool-form');await flush();expect($('.record').textContent).toContain('At least');expect($('.record-body').textContent).toContain(mode==='sent'?'subjects':'authors');expect($('.detail-person a').getAttribute('target')).toBe('_blank');expect($('.notice').textContent).toContain('ordering may change');
  });
  it('names DID-only targets, handles one match and missing display names',async()=>{
    await start();vi.mocked(bsky.resolveActor).mockResolvedValueOnce({did:river.did});const s=fixture();s.target={did:river.did};s.observations=s.observations.slice(0,1);s.mutuals=[jun];s.observations[0].moot={...jun,displayName:undefined};vi.mocked(scanModule.scanCircle).mockResolvedValueOnce(s);enter('#target',river.did);submit('.tool-form');await flush();expect($('h2').textContent).toBe('1 mutual with a direct block record');expect($('.result-context').textContent).toContain(river.did);expect($('.person b').textContent).toBe(jun.handle);
  });
  it('never turns malicious identity, result or error fields into executable markup',async()=>{
    const attack='<img src=x onerror="window.pwned=1">';vi.mocked(agent.getProfile).mockResolvedValueOnce({data:{did:jun.did,handle:attack,displayName:attack,avatar:'javascript:alert(1)'}} as never);await start();expect($('#identity').querySelector('img')).toBeNull();expect($('#identity').textContent).toContain(attack);
    const s=fixture('lookup',true);s.observations[0].moot={...jun,handle:attack,displayName:attack,avatar:'data:image/svg+xml,<svg onload=alert(1)>'};s.observations[2].moot={...sol,handle:attack};s.target={did:river.did,handle:attack};vi.mocked(scanModule.scanCircle).mockResolvedValueOnce(s);await lookup();expect(document.querySelector('[onerror]')).toBeNull();expect(document.querySelector('[onload]')).toBeNull();expect($('.result-context').textContent).toContain(attack);expect($('.warning-list').textContent).toContain(attack);
  });
});
describe('keyboard autocomplete and stale responses',()=>{
  it('supports ArrowDown/Up, Enter and Escape with expanded/selected state',async()=>{
    await start();enter('#target','ri');await vi.waitFor(()=>expect($<HTMLElement>('#suggestions').hidden).toBe(false));const input=$('#target');input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));expect(input.getAttribute('aria-activedescendant')).toBe('actor-0');expect($('[role=option]').getAttribute('aria-selected')).toBe('true');input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));expect($<HTMLInputElement>('#target').value).toBe(river.handle);expect(input.getAttribute('aria-expanded')).toBe('false');
    enter('#target','ri');await vi.waitFor(()=>expect(input.getAttribute('aria-expanded')).toBe('true'));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));expect(input.getAttribute('aria-activedescendant')).toBeNull();
  });
  it('selects by pointer without blurring, handles no suggestions and allows manual input on failure',async()=>{
    await start();enter('#target','ri');await vi.waitFor(()=>expect($('[role=option]')).not.toBeNull());const event=new MouseEvent('pointerdown',{cancelable:true});$('[role=option]').dispatchEvent(event);expect(event.defaultPrevented).toBe(true);click('[role=option]');expect($<HTMLInputElement>('#target').value).toBe(river.handle);
    vi.mocked(bsky.searchActorsTypeahead).mockResolvedValueOnce([]);enter('#target','no');await new Promise(r=>setTimeout(r,300));expect($<HTMLElement>('#suggestions').hidden).toBe(true);
    vi.mocked(bsky.searchActorsTypeahead).mockRejectedValueOnce(Error('offline'));enter('#target','fail');await vi.waitFor(()=>expect($('#target-error').textContent).toContain('still enter'));enter('#target','x');expect($('#target-error').textContent).toBe('');enter('#target',river.did);expect($<HTMLElement>('#suggestions').hidden).toBe(true);
  });

  it('selects a released touch even when focus blurs before click, without requiring a compatibility click',async()=>{
    await start();enter('#target','ri');await vi.waitFor(()=>expect($('[role=option]')).not.toBeNull());
    const option=$('[role=option]');
    const pointer=(type:string,id=1,x=20)=>{const event=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:20});Object.defineProperties(event,{pointerId:{value:id},pointerType:{value:'touch'}});option.dispatchEvent(event);return event};
    expect(pointer('pointerdown').defaultPrevented).toBe(false);
    $('#target').dispatchEvent(new Event('blur'));expect($<HTMLElement>('#suggestions').hidden).toBe(false);
    pointer('pointermove',2,60);pointer('pointermove',1,22);pointer('pointerup',2);
    expect(pointer('pointerup').defaultPrevented).toBe(true);expect($<HTMLInputElement>('#target').value).toBe(river.handle);expect($<HTMLElement>('#suggestions').hidden).toBe(true);
    pointer('pointerup');pointer('pointermove');option.dispatchEvent(new Event('pointerleave'));
    enter('#target','ri');await vi.waitFor(()=>expect($<HTMLElement>('#suggestions').hidden).toBe(false));const current=$('[role=option]');const down=new MouseEvent('pointerdown');current.dispatchEvent(down);current.dispatchEvent(new Event('pointerleave'));expect($<HTMLElement>('#suggestions').hidden).toBe(true);
  });
  it('does not select a suggestion after a touch scroll or pointer cancellation',async()=>{
    await start();
    const pointer=(type:string,x=20)=>{const event=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:20});Object.defineProperties(event,{pointerId:{value:1},pointerType:{value:'touch'}});$('[role=option]').dispatchEvent(event)};
    enter('#target','ri');await vi.waitFor(()=>expect($('[role=option]')).not.toBeNull());pointer('pointerdown');pointer('pointermove',45);pointer('pointerup',45);click('[role=option]');expect($<HTMLInputElement>('#target').value).toBe('ri');expect($<HTMLElement>('#suggestions').hidden).toBe(true);
    enter('#target','ri');await vi.waitFor(()=>expect($<HTMLElement>('#suggestions').hidden).toBe(false));pointer('pointerdown');pointer('pointercancel');pointer('pointerup');click('[role=option]');expect($<HTMLInputElement>('#target').value).toBe('ri');expect($<HTMLElement>('#suggestions').hidden).toBe(true);
  });
  it('ignores stale suggestions after editing, blur and navigation',async()=>{
    await start();const pending=defer<Awaited<ReturnType<typeof bsky.searchActorsTypeahead>>>();vi.mocked(bsky.searchActorsTypeahead).mockReturnValueOnce(pending.promise);enter('#target','old');await vi.waitFor(()=>expect(bsky.searchActorsTypeahead).toHaveBeenCalled());enter('#target','new');pending.resolve([river] as never);await Promise.resolve();expect($<HTMLElement>('#suggestions').hidden).toBe(true);$('#target').dispatchEvent(new Event('blur'));click('[data-mode=sent]');expect($('#suggestions')).toBeNull();
  });
});
describe('asynchronous and focus regression boundaries',()=>{
  it('ignores queued progress and completion after cancellation',async()=>{
    await start();const pending=defer<Snapshot>();let progress!:(processed:number,total:number)=>void;
    vi.mocked(bsky.fetchAllMutuals).mockImplementationOnce(async(_a,_did,onProgress)=>{onProgress?.(3);return mutuals});
    vi.mocked(scanModule.scanCircle).mockImplementationOnce((_a,_input,options)=>{progress=options.onProgress;return pending.promise});
    enter('#target',river.handle);submit('.tool-form');await vi.waitFor(()=>expect(scanModule.scanCircle).toHaveBeenCalled());click('.loading button');progress(3,3);pending.resolve(fixture());await new Promise(r=>setTimeout(r,0));expect($('.cancel-note').textContent).toContain('cancelled');expect($('.records')).toBeNull();
  });
  it('keeps the primary app guard even when a click is programmatically dispatched to disabled navigation',async()=>{
    await start(false);const disabled=$<HTMLButtonElement>('[data-mode=sent]');disabled.onclick?.call(disabled,new PointerEvent('click'));expect($('#login-handle')).not.toBeNull();
  });
  it.each(['sent','received'] as const)('renders complete %s ranks and sorts missing display names safely',async mode=>{
    await start();click('[data-mode='+mode+']');const data=fixture(mode);data.observations.forEach(o=>{o.moot={...o.moot,displayName:undefined}});data.mutuals=data.observations.map(o=>o.moot);vi.mocked(scanModule.scanCircle).mockResolvedValueOnce(data);submit('.tool-form');await flush();const select=$<HTMLSelectElement>('.toolbar select');select.value='name';select.dispatchEvent(new Event('change'));expect($('.records').textContent).not.toContain('At least');
  });
  it('allows cache clearing when signed out and handles a disconnected dialog opener after clearing results',async()=>{
    await start(false);click('#login-privacy');click('#clear-data');await vi.waitFor(()=>expect($('#clear-status').textContent).toContain('cleared'));click('#close-dialog');
    vi.mocked(services.initOAuth).mockResolvedValueOnce({session:{sub:'did:plc:alex'},agent});await start();await lookup();$('.scan-actions .text-button').focus();click('.scan-actions .text-button');click('#clear-data');await vi.waitFor(()=>expect($('#clear-status').textContent).toContain('cleared'));$('#modal').dispatchEvent(new Event('cancel'));click('#close-dialog');expect($<HTMLDialogElement>('#modal').open).toBe(false);
  });
  it('does not surface an outdated autocomplete error after navigation',async()=>{
    await start();const pending=defer<Awaited<ReturnType<typeof bsky.searchActorsTypeahead>>>();vi.mocked(bsky.searchActorsTypeahead).mockReturnValueOnce(pending.promise);enter('#target','old');await vi.waitFor(()=>expect(bsky.searchActorsTypeahead).toHaveBeenCalled());click('[data-mode=sent]');pending.reject(Error('old failure'));await new Promise(r=>setTimeout(r,0));expect($('#target-error')).toBeNull();
  });
  it('ArrowUp from an unselected multi-option list chooses the last option',async()=>{
    await start();vi.mocked(bsky.searchActorsTypeahead).mockResolvedValueOnce([jun,river] as never);enter('#target','ri');await vi.waitFor(()=>expect($<HTMLElement>('#suggestions').hidden).toBe(false));$('#target').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp'}));expect($('#target').getAttribute('aria-activedescendant')).toBe('actor-1');$('#target').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp'}));expect($('#target').getAttribute('aria-activedescendant')).toBe('actor-0');
  });
});
describe('recovery from interrupted account and storage actions',()=>{
  it('restores the previous result and enables controls when sign-out fails during a new scan',async()=>{
    await start();await lookup();const pending=defer<Snapshot>();vi.mocked(scanModule.scanCircle).mockReturnValueOnce(pending.promise);vi.mocked(services.signOut).mockRejectedValueOnce(Error('offline'));submit('.tool-form');await vi.waitFor(()=>expect($('.loading')).not.toBeNull());click('#identity button');await vi.waitFor(()=>expect($('.error-notice')).not.toBeNull());expect($('.records')).not.toBeNull();expect($<HTMLInputElement>('#target').disabled).toBe(false);pending.resolve(fixture());await new Promise(r=>setTimeout(r,0));expect($('.error-notice')).not.toBeNull();
  });
  it('cancels an active scan before clearing data and keeps the app usable if clearing fails',async()=>{
    await start();const pending=defer<Snapshot>();vi.mocked(scanModule.scanCircle).mockReturnValueOnce(pending.promise);vi.spyOn(scanModule,'clearBlockCache').mockRejectedValueOnce(Error('blocked'));enter('#target',river.handle);submit('.tool-form');await vi.waitFor(()=>expect(scanModule.scanCircle).toHaveBeenCalled());click('#scope');click('#clear-data');await vi.waitFor(()=>expect($('#clear-status').textContent).toContain('could not be cleared'));expect($<HTMLInputElement>('#target').disabled).toBe(false);pending.resolve(fixture());await new Promise(r=>setTimeout(r,0));expect($('.records')).toBeNull();
  });
});

describe('comparison circle copy',()=>{
  it('distinguishes the signed-in circle from the lookup subject and both ranking directions',async()=>{
    await start();expect($('.intro').textContent).toContain('lookup subject’s mutuals are not fetched');expect($('#target-note').textContent).toContain('mutuals of the signed-in account');
    click('[data-mode=sent]');expect($('.intro').textContent).toContain('row account → other mutuals');
    click('[data-mode=received]');expect($('.intro').textContent).toContain('other mutuals → row account');
    click('#scope');expect($('#modal-content').textContent).toContain('not the lookup subject');
  });
});

describe('profile handle destinations',()=>{
  it.each(['lookup','sent','received'] as const)('uses explicit profile links in %s result summaries and preserves contact mail',async mode=>{
    await start();if(mode==='lookup')await lookup();else{click('[data-mode='+mode+']');submit('.tool-form');await flush()}
    const link=$<HTMLAnchorElement>('.record summary .handle-link');expect(link.href).toBe('https://bsky.app/profile/'+encodeURIComponent(mode==='received'?river.did:jun.did));expect(link.getAttribute('aria-label')).toContain('on Bluesky');expect(document.querySelector('meta[name="format-detection"]')?.getAttribute('content')).toContain('email=no');expect(document.querySelector('a[href="mailto:andrew@schweg.xyz"]')).not.toBeNull();
    const row=$<HTMLDetailsElement>('.record');row.open=true;expect(row.open).toBe(true);
  });
});
