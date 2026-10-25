import { expect, it } from 'vitest';
import { avatar, describeError, element, person, profileLink, renderScope, safeAvatar } from '../src/dom';
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
  const link=summary.querySelector('a')!;expect(link.href).toBe('https://bsky.app/profile/did%3Aplc%3Abinfire');expect(link.textContent).toBe('@binfire.bsky.social');expect(link.getAttribute('aria-label')).toBe('Open binfire.bsky.social on Bluesky (new tab)');
  const event=new Event('click',{bubbles:true,cancelable:true});link.dispatchEvent(event);expect(bubbled).toBe(false);expect(event.defaultPrevented).toBe(false);expect(details.open).toBe(false);
  expect(person(profile).querySelector('a')).toBeNull();
});

it('renders scope notice safely using DOM methods without innerHTML string assignment',()=>{
  const node = renderScope();
  document.body.append(node);
  const scopeFoot = node.querySelector('.scope-foot');
  expect(scopeFoot).not.toBeNull();
  const svg = scopeFoot!.querySelector('svg');
  expect(svg).not.toBeNull();
  expect(svg!.getAttribute('aria-hidden')).toBe('true');
  expect(svg!.getAttribute('viewBox')).toBe('0 0 24 24');
  expect(svg!.querySelector('circle')?.getAttribute('r')).toBe('9');
  expect(svg!.querySelector('path')?.getAttribute('d')).toBe('M12 10v7m0-11v2');
  const span = scopeFoot!.querySelector('span');
  expect(span).not.toBeNull();
  expect(span!.textContent).toBe('Public direct block records only. List-based blocks and mutes are not included. Records do not explain why a block exists.');
});
