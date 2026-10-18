# Moots custom domain

The canonical public origin is https://moots.schweg.xyz/. Canonical and Open Graph URLs use this origin; app routes and logo assets stay relative so the pages.dev origin also works.

OAuth remains origin-specific. On moots.schweg.xyz the browser advertises `https://moots.schweg.xyz/client-metadata-moots.json`, with client URI and callback `https://moots.schweg.xyz/`. The public JSON must be served at that exact URL with HTTP 200 and Content-Type application/json, without a redirect or access challenge. The existing pages.dev `/client-metadata.json`, client ID, callback, scopes and grant types remain unchanged. Local development behavior is unchanged. No credentials, grants, or account settings are created or modified by this change.

Before using sign-in on the custom domain, the domain operator must finish Cloudflare binding, DNS and valid public HTTPS, then deploy this PR through the normal production process. Verify the metadata endpoint is public and its `client_id` exactly matches its URL. AT Protocol discovers this public metadata automatically; there is no app secret or central callback registration introduced here. See the [AT Protocol OAuth specification](https://atproto.com/specs/oauth).

Browser storage and OAuth sessions are scoped to the origin. Existing pages.dev sessions remain on pages.dev; users visiting the custom domain will need a separate sign-in. This change does not transfer tokens, redirect existing pages.dev visits, or run a live login. Live consent/callback verification requires a separately authorized user-driven sign-in after the domain and release are live.

## Compatibility for older open tabs

An older production bundle (`index-CGyk5oq-.js`) advertises `/client-metadata.json` on every origin. On the custom domain, that static document identifies pages.dev, producing `invalid_client_metadata: client_id does not match`. The current bundle uses the correct custom-domain path, but already-open tabs keep running the older code.

The Worker intercepts `/client-metadata.json` only on `https://moots.schweg.xyz` and returns the custom-domain metadata with that exact legacy URL as its client ID. It returns JSON directly, without a redirect, and disables caching of this compatibility response. The canonical metadata, pages.dev identity, scopes, and callbacks remain unchanged. Deploy with `wrangler.jsonc`, including its Worker entry point, `ASSETS` binding, and `run_worker_first` route; uploading only `dist/` does not include this handler.

Verify both metadata paths on the custom domain and `/client-metadata.json` on pages.dev. Each document must identify the exact URL requested. Retry sign-in from an old open tab and a freshly loaded page. Reaching the provider login screen verifies authorization initiation; completing consent and the callback is a separate check.

Both metadata documents intentionally exist in the same static build. A preview or legacy origin must continue using its existing metadata path, not the custom-domain document. The full production sign-in round trip has not been tested as part of this PR.
