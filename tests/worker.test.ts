import { describe, expect, it, vi } from 'vitest';
import worker from '../src/worker';
import customMetadata from '../public/client-metadata-moots.json';
import legacyMetadata from '../public/client-metadata.json';

describe('OAuth metadata compatibility', () => {
  it('serves an exact custom-domain identity for older open tabs', async () => {
    const url = 'https://moots.schweg.xyz/client-metadata.json';
    const fetch = vi.fn();
    const response = await worker.fetch(new Request(url), { ASSETS: { fetch } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toEqual({ ...customMetadata, client_id: url });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['https://bsky-mutual-blocks.pages.dev/client-metadata.json', legacyMetadata],
    ['https://moots.schweg.xyz/client-metadata-moots.json', customMetadata],
    ['https://preview.example/client-metadata.json', legacyMetadata],
    ['https://moots.schweg.xyz/', '<html>app</html>']
  ])('preserves asset serving at %s', async (url, content) => {
    const asset = new Response(JSON.stringify(content));
    const fetch = vi.fn().mockResolvedValue(asset);
    const request = new Request(url);
    expect(await worker.fetch(request, { ASSETS: { fetch } })).toBe(asset);
    expect(fetch).toHaveBeenCalledWith(request);
  });
});
