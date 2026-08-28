import { Agent } from '@atproto/api';

async function main() {
  const agent = new Agent('https://public.api.bsky.app');
  const repo = 'did:plc:ragtjsm2j2vmnmtekeeikstw';
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
