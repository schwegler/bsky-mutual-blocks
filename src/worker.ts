import customMetadata from '../public/client-metadata-moots.json';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Older open tabs still advertise this path on the custom domain.
    // Its response must identify this exact URL, never the pages.dev client.
    if (url.origin === 'https://moots.schweg.xyz' && url.pathname === '/client-metadata.json') {
      return Response.json({
        ...customMetadata,
        client_id: 'https://moots.schweg.xyz/client-metadata.json'
      }, {
        headers: {
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    return env.ASSETS.fetch(request);
  }
};
