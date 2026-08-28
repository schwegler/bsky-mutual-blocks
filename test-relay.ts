import { Agent } from '@atproto/api';

async function main() {
  const agent = new Agent('https://bsky.network');
  const repo = 'did:plc:ragtjsm2j2vmnmtekeeikstw'; // paul.bsky.social
  try {
    const res = await agent.com.atproto.repo.listRecords({
      repo,
      collection: 'app.bsky.graph.block',
      limit: 10,
    });
    console.log(res.data.records);
  } catch (err) {
    console.error(err);
  }
}
main();
