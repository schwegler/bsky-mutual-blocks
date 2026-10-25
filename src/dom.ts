import { MutualProfile } from './bsky';
export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function safeAvatar(value?: string): string | null {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export function avatar(profile: MutualProfile): HTMLElement {
  const url = safeAvatar(profile.avatar);
  if (url) {
    const img = element('img', 'avatar');
    img.src = url;
    img.alt = '';
    img.width = img.height = 42;
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.replaceWith(initials(profile)), { once: true });
    return img;
  }
  return initials(profile);
}
function initials(profile: MutualProfile): HTMLElement {
  const label = profile.displayName || profile.handle;
  const node = element('span', 'avatar', label.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toUpperCase());
  node.setAttribute('aria-hidden', 'true');
  return node;
}
export function person(profile: MutualProfile, linkedHandle = false): HTMLElement {
  const node = element('span', 'person');
  const info = element('span');
  const handle = element('small');
  if (linkedHandle) {
    const link = profileLink(profile);
    link.className = 'handle-link'; link.textContent = '@' + profile.handle;
    handle.append(link);
  } else handle.textContent = '@' + profile.handle;
  info.append(element('b', '', profile.displayName || profile.handle), handle);
  node.append(avatar(profile), info);
  return node;
}
export function profileLink(profile: MutualProfile): HTMLAnchorElement {
  const link = element('a', 'profile-link', 'Open Bluesky profile ↗');
  link.href = 'https://bsky.app/profile/' + encodeURIComponent(profile.did);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  // Keep a profile link inside summary independent from its disclosure action.
  link.addEventListener('click', event => event.stopPropagation());
  link.setAttribute('aria-label', 'Open ' + profile.handle + ' on Bluesky (new tab)');
  return link;
}
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed. Please try again.';
}

export function createScopeElement(): HTMLElement {
  const div = element('div', 'scope-foot');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '0 0 24 24');
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '9');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 10v7m0-11v2');
  svg.append(circle, path);
  const span = element('span', '', 'Public direct block records only. List-based blocks and mutes are not included. Records do not explain why a block exists.');
  div.append(svg, span);
  return div;
}
