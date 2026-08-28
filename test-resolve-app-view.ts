import { Agent } from '@atproto/api';

async function main() {
  const agent = new Agent('https://public.api.bsky.app'); // AppView

  try {
    const list = await agent.app.bsky.graph.getBlocks({
      limit: 1,
    });
    console.log(list);
  } catch (err) {
    console.log('Error public API getBlocks:', err.message);
  }
}
main();
