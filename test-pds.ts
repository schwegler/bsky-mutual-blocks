import { Agent } from '@atproto/api';

async function main() {
  const agent = new Agent('https://bsky.social'); // PDS
  const profileRes = await agent.getProfile({ actor: 'bsky.app' });
  const did = profileRes.data.did;

  try {
    const list = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection: 'app.bsky.graph.block',
      limit: 10,
    });
    console.log('Records:', list.data.records);
  } catch (err) {
    console.log('Error:', err.message);
  }
}
main();
