import { Agent } from '@atproto/api';

async function main() {
  const agent = new Agent('https://public.api.bsky.app');

  try {
    const list = await agent.com.atproto.repo.listRecords({
      repo: 'did:plc:z72i7hdynmk6r22z27h6tvur',
      collection: 'app.bsky.graph.block',
      limit: 10,
    });
    console.log(list.data.records);
  } catch (err) {
    console.log('Error public API:', err.message);
  }
}
main();
