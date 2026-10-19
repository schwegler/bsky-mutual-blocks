import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
const source = readFileSync('public/appearance.js', 'utf8');
function setup(dark = true, saved?: string, denied = false) {
  const win = new Window({ url: 'https://moots.example/' });
  const system = new win.EventTarget() as InstanceType<typeof win.EventTarget> & { matches: boolean };
  system.matches = dark;
  Object.defineProperty(win, 'matchMedia', { value: () => system });
  if (saved) win.localStorage.setItem('moots-color-mode:v1', saved);
  if (denied) Object.defineProperty(win, 'localStorage', { get() { throw Error('denied'); } });
  win.document.body.innerHTML = '<header><div class="header-right"></div></header><main></main>';
  win.eval(source);
  const beforeMount = win.document.documentElement.dataset.theme;
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  const button = (text: string) => [...win.document.querySelectorAll('button')].find(n => n.textContent === text)!;
  return { win, system, button, root: win.document.documentElement, beforeMount };
}
describe('Moots base color preferences', () => {
  it('applies the device default before menu mount and follows live OS changes', () => {
    const { win, system, root, beforeMount } = setup();
    expect(beforeMount).toBe('dark'); expect(root.dataset.colorMode).toBe('system');
    system.matches = false; system.dispatchEvent(new win.Event('change'));
    expect(root.dataset.theme).toBe('light');
  });
  it('keeps explicit choices and lets System clear the override', () => {
    const { win, system, root, button } = setup(true, 'light');
    expect(root.dataset.theme).toBe('light'); system.dispatchEvent(new win.Event('change'));
    expect(root.dataset.theme).toBe('light'); button('System').click();
    expect(root.dataset.theme).toBe('dark'); expect(win.localStorage.getItem('moots-color-mode:v1')).toBeNull();
    button('Dark').click(); expect(win.localStorage.getItem('moots-color-mode:v1')).toBe('dark');
    expect(button('Dark').getAttribute('aria-pressed')).toBe('true'); expect(button('System').getAttribute('aria-pressed')).toBe('false');
  });
  it('keeps seasonal selection separate and synchronizes another tab’s base choice', () => {
    const { win, root, button } = setup(); root.dataset.season = 'halloween';
    button('Light').click(); expect(root.dataset.season).toBe('halloween');
    win.localStorage.setItem('moots-color-mode:v1', 'dark');
    win.dispatchEvent(new win.StorageEvent('storage', { key: 'moots-color-mode:v1' }));
    expect(root.dataset.theme).toBe('dark'); expect(root.dataset.season).toBe('halloween');
  });
  it('keeps in-page choices usable with blocked storage', () => {
    const { root, button } = setup(false, undefined, true);
    expect(root.dataset.theme).toBe('light'); button('Dark').click(); expect(root.dataset.theme).toBe('dark');
  });
  it('closes on Escape or outside click and returns keyboard focus', () => {
    const { win, button } = setup(); const toggle = button('Appearance'); toggle.click(); button('System').focus();
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false'); expect(win.document.activeElement).toBe(toggle);
    toggle.click(); win.document.querySelector('main')!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});
