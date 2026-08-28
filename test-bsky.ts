import { BskyAgent } from '@atproto/api';

async function main() {
  const agent = new BskyAgent({ service: 'https://public.api.bsky.app' });
  const repo = 'did:plc:ragtjsm2j2vmnmtekeeikstw'; // paul.bsky.social
  const profile = await agent.getProfile({ actor: repo });
  console.log('Profile:', profile.data.handle);

  const response = await agent.app.bsky.graph.getBlocks({
    limit: 10,
  });
  console.log(response);
}

main().catch(console.error);
