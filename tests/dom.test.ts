import { expect, it } from 'vitest';
import { avatar, describeError, element, person, profileLink, safeAvatar } from '../src/dom';
it('keeps adversarial profile fields as text and validates image URLs before property assignment',()=>{
  const p={did:'did:plc:x" onclick="alert(1)',handle:'x"><img src=x onerror=alert(1)>',displayName:'<script>bad()</script>',avatar:'https://images.example.test/a?x=" onerror="bad'};
  const node=person(p);document.body.append(node);expect(node.querySelector('script')).toBeNull();expect(node.textContent).toContain(p.displayName);expect(node.querySelector('img')?.getAttribute('onerror')).toBeNull();
  const link=profileLink(p);expect(link.getAttribute('onclick')).toBeNull();expect(link.href).toContain(encodeURIComponent(p.did));expect(link.rel).toBe('noopener noreferrer');
  expect(safeAvatar('javascript:alert(1)')).toBeNull();expect(safeAvatar('http://images.example.test/a')).toBeNull();expect(safeAvatar('https://user:pass@example.test')).toBeNull();expect(safeAvatar('not a url')).toBeNull();expect(safeAvatar()).toBeNull();
  const img=avatar(p);document.body.append(img);img.dispatchEvent(new Event('error'));expect(img.isConnected).toBe(false);expect(document.body.textContent).toContain('<');
  expect(avatar({did:'did:plc:x',handle:'x.example.test'}).textContent).toBe('X');
  expect(element('span').textContent).toBe('');expect(describeError(Error('plain error'))).toBe('plain error');expect(describeError('untrusted')).toContain('could not be completed');
});

it('gives result handles explicit HTTPS profile destinations without toggling their enclosing disclosure',()=>{
  const profile={did:'did:plc:binfire',handle:'binfire.bsky.social'};
  const details=document.createElement('details');const summary=document.createElement('summary');summary.append(person(profile,true));details.append(summary);document.body.append(details);
  let bubbled=false;summary.addEventListener('click',()=>{bubbled=true});
  const link=summary.querySelector('a')!;expect(link.href).toBe('https://bsky.app/profile/did:plc:binfire');expect(link.textContent).toBe('@binfire.bsky.social');expect(link.getAttribute('aria-label')).toBe('Open binfire.bsky.social on Bluesky (new tab)');
  const event=new Event('click',{bubbles:true,cancelable:true});link.dispatchEvent(event);expect(bubbled).toBe(false);expect(event.defaultPrevented).toBe(false);expect(details.open).toBe(false);
  expect(person(profile).querySelector('a')).toBeNull();
});

// Check serialized hrefs: these are the destinations users follow or copy.
it.each([
  ['did:plc:exy22rd4a26hwdph4pitcpzg', 'did:plc:exy22rd4a26hwdph4pitcpzg'],
  ['did:web:example.test:user:alice', 'did:web:example.test:user:alice'],
  ['did:web:example.test%3A8443:user', 'did:web:example.test%253A8443:user'],
  ['alice.bsky.social', 'alice.bsky.social'],
  ['did:plc:x/../../admin?x=1#fragment', 'did%3Aplc%3Ax%2F..%2F..%2Fadmin%3Fx%3D1%23fragment'],
  ['https://evil.test/profile', 'https%3A%2F%2Fevil.test%2Fprofile'],
  ['javascript:alert(1)', 'javascript%3Aalert(1)'],
  ['did:plc:x%2Fadmin', 'did:plc:x%252Fadmin'],
  ['did:plc:x\\admin', 'did%3Aplc%3Ax%5Cadmin'],
  ['did:plc:x\nadmin', 'did%3Aplc%3Ax%0Aadmin'],
])('builds a safe profile destination for %s', (did, path) => {
  const profile = { did, handle: 'alice.bsky.social' };
  for (const link of [profileLink(profile), person(profile, true).querySelector('a')!]) {
    expect(link.href).toBe('https://bsky.app/profile/' + path);
    const url = new URL(link.href);
    expect(url.origin).toBe('https://bsky.app');
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
  }
});
