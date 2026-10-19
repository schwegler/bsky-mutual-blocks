/* Add reviewed seasons and their date windows here; no controller rewrite required. */
window.SchwegSeasonalConfig = {
  "schemaVersion": 2,
  "invitationDelayMs": 1000,
  "profile": {
    "id": "moots",
    "character": "the ghosts",
    "placement": "before-shell"
  },
  "seasons": [
    {
      "id": "halloween-2026",
      "theme": "halloween",
      "label": "Halloween",
      "enabled": true,
      "window": {
        "from": "2026-10-01",
        "until": "2026-11-01"
      },
      "asset": "mascot.png",
      "kicker": "HALLOWEEN / 2026",
      "title": "A clearer view. A little more boo.",
      "detail": "A pumpkin-coloured corner of Bluesky, with friendly ghosts and the same clear data.",
      "prompt": "A little boo for your circle?"
    }
  ]
};
