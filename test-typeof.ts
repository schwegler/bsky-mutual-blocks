import { Agent } from '@atproto/api';
const agent = new Agent('https://public.api.bsky.app');
const api = agent.com?.atproto?.repo;
console.log(typeof api?.listRecords);
