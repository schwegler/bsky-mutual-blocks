import { Agent } from '@atproto/api';
async function run() {
  const agent = new Agent('https://public.api.bsky.app');
  // see what's on agent.com.atproto.repo
  console.log('repo properties:', Object.getOwnPropertyNames(Object.getPrototypeOf(agent.com.atproto.repo)));
}
run().catch(console.error);
