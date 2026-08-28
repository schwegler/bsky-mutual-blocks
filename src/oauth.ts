import { BrowserOAuthClient, OAuthSession } from '@atproto/oauth-client-browser';
import { Agent } from '@atproto/api';

let oauthClient: BrowserOAuthClient | null = null;
let currentSession: OAuthSession | null = null;
let currentAgent: Agent | null = null;

export async function initOAuth(): Promise<{ session: OAuthSession | null; agent: Agent | null }> {
  const isLocal = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
  const clientId = isLocal
    ? `http://127.0.0.1:5173/client-metadata.json`
    : `${window.location.origin}/client-metadata.json`;

  oauthClient = new BrowserOAuthClient({
    handleResolver: 'https://bsky.social',
    clientMetadata: {
      client_id: clientId,
      client_name: 'Bluesky Mutual Block Checker',
      client_uri: `${window.location.origin}/`,
      redirect_uris: [`${window.location.origin}/`],
      scope: 'atproto transition:generic',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'web',
      dpop_bound_access_tokens: true
    }
  });

  const result = await oauthClient.init();
  if (result?.session) {
    currentSession = result.session;
    currentAgent = new Agent(result.session);
  }

  return { session: currentSession, agent: currentAgent };
}

export async function signIn(handle: string): Promise<void> {
  if (!oauthClient) throw new Error('OAuth client is not initialized');
  await oauthClient.signIn(handle.trim());
}

export async function signOut(): Promise<void> {
  if (currentSession) {
    await currentSession.signOut();
    currentSession = null;
    currentAgent = null;
  }
}

export function getAgent(): Agent {
  if (!currentAgent) throw new Error('User not authenticated');
  return currentAgent;
}

export function getSession(): OAuthSession | null {
  return currentSession;
}
