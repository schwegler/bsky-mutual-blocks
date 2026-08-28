import { Agent } from '@atproto/api';

async function main() {
  const agent = new Agent('https://public.api.bsky.app'); // AppView

  try {
    const res = await agent.com.atproto.identity.resolveHandle({ handle: 'bsky.app' });
    console.log(res);
  } catch (err) {
    console.log('Error:', err.message);
  }
}
main();
