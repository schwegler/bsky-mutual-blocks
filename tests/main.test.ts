import { expect, it, vi } from 'vitest';
vi.mock('../src/oauth', () => ({ initOAuth: vi.fn(async () => ({ session: null, agent: null })), signIn: vi.fn(), signOut: vi.fn() }));
it('boots the real entry point into the accessible signed-out screen', async () => {
  await import('../src/main');
  await vi.waitFor(() => expect(document.querySelector('h1')?.textContent).toContain('A clearer view'));
  expect(document.querySelector('#login-handle')).not.toBeNull();
});
