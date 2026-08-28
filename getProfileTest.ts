import { Agent } from '@atproto/api';

async function main() {
  const agent = new Agent('https://public.api.bsky.app');
  const res = await agent.getProfile({ actor: 'bsky.app' });

  const did = res.data.did;
  console.log("bsky.app did:", did);

  try {
    const list = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection: 'app.bsky.graph.block',
      limit: 10,
    });
    console.log(list.data.records);
  } catch (err) {
    console.log('Error fetching records using public.api.bsky.app:', err.message);
  }
}
main();
