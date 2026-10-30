Retire Halloween overlays while preserving seasonal packs

Disable the Halloween 2026 pack. Saved Halloween preferences no longer activate it. Preserve all artwork, controller, dates and styles for future reviewed seasonal packs; Christmas remains inactive.

Validation: npm run build passed. Vitest: 136 passed, 1 failed in scan.test.ts storage quota spy assertion; unrelated to configuration.

Release notes, rollout and rollback: see docs/seasonal-appearance.md, Halloween retirement release notes. Main merge automatically deploys production; branch pushes publish previews. Revert the cleanup commit to roll back (existing November 1 UTC expiry still applies).
