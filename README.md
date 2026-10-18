# Moots — Bluesky block checker

A browser-side utility for exploring **public direct block records within your mutual-follow circle**. Built with TypeScript, Vite and AT Protocol OAuth.

## Views

- **Account lookup:** resolve a handle or DID and find mutuals whose direct `app.bsky.graph.block` records name that account.
- **Blocks sent:** rank mutuals by observed direct blocks naming other mutuals.
- **Blocks received:** invert those directed records to rank mutuals by observed authors within the same circle.

Results include coverage, incomplete-account reasons, observation timestamps, cached-source counts, expandable directional details, account filtering and name/count sorting. Rankings describe the returned mutual circle, not all of Bluesky. Native forms, keyboard autocomplete, details, progress and dialogs support desktop and mobile use.

## Interpretation and storage

Only `app.bsky.graph.block` is scanned. List-based blocking, mutes and motives are outside scope. A direct record does not prove why a person blocked an account, a reciprocal block, current application behavior or network-wide completeness. An incomplete scan may miss matches; ranking counts are lower bounds. Observation times can differ across accounts and retries.

Successful block lists are stored in IndexedDB and may be reused for up to 24 hours. Stored lists remain until overwritten or explicitly cleared; the reuse limit is not an automatic deletion timer. Mutual profiles are cached in this tab's sessionStorage for up to 15 minutes of reuse. Sign-out clears mutual caches but leaves stored public block lists. **Data sources & browser storage** offers explicit scan-cache clearing without deleting the OAuth session. **Refresh circle & records** bypasses both reusable caches. **Retry incomplete** bypasses block caches for incomplete authors, keeps completed observations and replaces the retried authors' observations rather than silently retaining stale partial positives.

The browser contacts identity, OAuth, Bluesky and personal data servers. Those services can log requests; client-side analysis does not imply anonymity. OAuth uses the existing `atproto transition:generic` scope. No application password is requested by this site; authorization happens at the account provider.

## Local development

Use Node.js 20 or later and npm:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. For local OAuth use that exact origin. The browser OAuth client identifies itself through `public/client-metadata.json`; the primary production origin is https://moots.schweg.xyz/. Its public metadata is `public/client-metadata-moots.json`. The existing `public/client-metadata.json` and its pages.dev client identity stay unchanged for compatibility. See [custom-domain OAuth requirements](docs/custom-domain.md).

```sh
npm run build
npm test -- --maxWorkers=1
npm run test:coverage -- --maxWorkers=1
npm audit
```

The build includes TypeScript checking; coverage enforces 100% statements, branches, functions and lines. Tests use synthetic data and the production HTML fixture. Node 26's experimental Web Storage can shadow Happy DOM storage; when testing on Node 26, use `NODE_OPTIONS=--no-experimental-webstorage` (CI runs Node 20).

## Architecture

- `src/app.ts`: authenticated views, guarded request lifecycle, keyboard autocomplete and result rendering.
- `src/scan.ts`: shared directed-graph model, per-author retry observations, bounded circle cache and scoped clearing.
- `src/bsky.ts`: handle resolution, mutual discovery, PDS direct-record pagination, timeouts, cancellation and rate-limit backoff.
- `src/dom.ts`: code-native profile rendering and safe HTTPS avatar/property assignment. Remote names, handles, errors and identifiers are never interpolated into HTML.
- `src/oauth.ts`: existing AT Protocol OAuth client and session lifecycle.

Scans use at most five concurrent account workers. Pagination anomalies are surfaced as errors or incomplete observations rather than reported as complete. Cancellation suppresses late results and aborts public-record requests/backoff; an already-issued authenticated mutual/profile request may finish, but its response cannot publish a cancelled result.

## Hosting

The repository is configured for Cloudflare static assets (`dist/`) and CI. Main-branch pushes may deploy automatically through existing hosting configuration; PR previews depend on that external configuration. The Worker serves a narrow OAuth metadata compatibility response for older custom-domain tabs; account analysis still runs in the browser. Deploy using `wrangler.jsonc` so this handler is included.

A [schweg.xyz](https://schweg.xyz/) project by Andrew Schwegler. The footer uses the approved transparent PNG signature; provenance and usage are retained in `public/assets/brand/` and `docs/approved-signature-logo.md`. Contact: [andrew@schweg.xyz](mailto:andrew@schweg.xyz). More at [taco 'bout it](https://tacobout.online), the shared public-facing brand. Bluesky: [@schwegler.lol](https://bsky.app/profile/schwegler.lol).

## License

MIT, as declared in the original repository README.
