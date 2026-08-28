import { Agent } from '@atproto/api';

async function main() {
  const agent = new Agent('https://public.api.bsky.app'); // AppView

  try {
    const res = await agent.getProfile({ actor: 'did:plc:z72i7hdynmk6r22z27h6tvur' });
    console.log(res);
  } catch (err) {
    console.log('Error:', err.message);
  }
}
main();
