import { Agent } from '@atproto/api';

async function main() {
  const agent = new Agent('https://public.api.bsky.app');

  // Try resolving an actor via app.bsky.actor.getProfile
  const res = await agent.getProfile({ actor: 'did:plc:ragtjsm2j2vmnmtekeeikstw' });
  console.log(res.data);
}
main();
