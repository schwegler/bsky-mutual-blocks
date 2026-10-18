import { expect, it } from 'vitest';
import { avatar, describeError, element, person, profileLink, safeAvatar } from '../src/dom';
it('keeps adversarial profile fields as text and validates image URLs before property assignment',()=>{
  const p={did:'did:plc:x" onclick="alert(1)',handle:'x"><img src=x onerror=alert(1)>',displayName:'<script>bad()</script>',avatar:'https://images.example.test/a?x=" onerror="bad'};
  const node=person(p);document.body.append(node);expect(node.querySelector('script')).toBeNull();expect(node.textContent).toContain(p.displayName);expect(node.querySelector('img')?.getAttribute('onerror')).toBeNull();
  const link=profileLink(p);expect(link.getAttribute('onclick')).toBeNull();expect(link.href).toContain(encodeURIComponent(p.did));expect(link.rel).toBe('noopener noreferrer');
  expect(safeAvatar('javascript:alert(1)')).toBeNull();expect(safeAvatar('http://images.example.test/a')).toBeNull();expect(safeAvatar('https://user:pass@example.test')).toBeNull();expect(safeAvatar('not a url')).toBeNull();expect(safeAvatar()).toBeNull();
  const img=avatar(p);document.body.append(img);img.dispatchEvent(new Event('error'));expect(img.isConnected).toBe(false);expect(document.body.textContent).toContain('<S');
  expect(avatar({did:'did:plc:x',handle:'x.example.test'}).textContent).toBe('X.');
  expect(element('span').textContent).toBe('');expect(describeError(Error('plain error'))).toBe('plain error');expect(describeError('untrusted')).toContain('could not be completed');
});
