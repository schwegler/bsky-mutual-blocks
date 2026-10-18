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
  const node = element('span', 'avatar', label.slice(0, 2).toUpperCase());
  node.setAttribute('aria-hidden', 'true');
  return node;
}
export function person(profile: MutualProfile): HTMLElement {
  const node = element('span', 'person');
  const info = element('span');
  info.append(element('b', '', profile.displayName || profile.handle), element('small', '', '@' + profile.handle));
  node.append(avatar(profile), info);
  return node;
}
export function profileLink(profile: MutualProfile): HTMLAnchorElement {
  const link = element('a', 'profile-link', 'Open Bluesky profile ↗');
  link.href = 'https://bsky.app/profile/' + encodeURIComponent(profile.did);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', 'Open ' + profile.handle + ' on Bluesky (new tab)');
  return link;
}
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed. Please try again.';
}
