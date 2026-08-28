import { BskyAgent } from '@atproto/api';

async function main() {
  const agent = new BskyAgent({ service: 'https://public.api.bsky.app' });
  const repo = 'did:plc:z72i7hdynmk6r22z27h6tvur'; // bsky.app

  const response = await agent.com.atproto.repo.listRecords({
    repo,
    collection: 'app.bsky.graph.block',
    limit: 10,
  });
  console.log(response.data.records);
}
main().catch(console.error);
