import { Agent } from '@atproto/api';

async function main() {
  const agent = new Agent('https://bsky.network');

  try {
    const list = await agent.com.atproto.repo.listRecords({
      repo: 'did:plc:z72i7hdynmk6r22z27h6tvur',
      collection: 'app.bsky.graph.block',
      limit: 10,
    });
    console.log(list.data.records);
  } catch (err) {
    console.log('Error relay:', err.message);
  }
}
main();
