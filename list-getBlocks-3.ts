import { Agent } from '@atproto/api';

async function main() {
  const agent = new Agent('https://bsky.social'); // PDS
  const profileRes = await agent.getProfile({ actor: 'bsky.app' });
  const did = profileRes.data.did;

  try {
    const list = await agent.app.bsky.graph.getBlocks();
    console.log('Records:', list.data.blocks);
  } catch (err) {
    console.log('Error:', err.message);
  }
}
main();
