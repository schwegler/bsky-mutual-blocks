import { BskyAgent } from '@atproto/api';

async function main() {
  const agent = new BskyAgent({ service: 'https://bsky.social' });
  const repo = 'did:plc:ragtjsm2j2vmnmtekeeikstw'; // paul.bsky.social
  const response = await agent.com.atproto.repo.listRecords({
    repo,
    collection: 'app.bsky.graph.block',
    limit: 1,
  });
  console.log(JSON.stringify(response.data.records, null, 2));
}

main().catch(console.error);
