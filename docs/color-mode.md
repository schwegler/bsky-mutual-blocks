# Color mode

Appearance is available throughout the year. System is the default and follows `prefers-color-scheme`, including changes while the page is open. Light and Dark are explicit overrides in `localStorage['moots-color-mode:v1']`; System clears that override. Storage denial leaves working in-page controls, and storage events synchronize other tabs.

The small blocking `/appearance.js` script applies the resolved root mode before body paint. It creates the header disclosure once the header exists. The seasonal controller contributes its controls to this shared menu only during an approved pack window; expiry removes those seasonal controls and keeps the base menu. Base and seasonal choices use separate keys. Halloween temporarily overrides the base palette; Undo reveals the latest base choice.

Dark styling covers inputs, suggestions, dialogs, notices, results, hover states and the approved light footer signature. Existing navigation, account sessions, contacts and donation links are unchanged.

Five focused preference tests cover the device default, live changes, saved overrides, System reset, storage denial, cross-tab settings, seasonal independence and keyboard dismissal. The browser checks additionally cover rendered colors, 320/390/820px menus, reload persistence, no seasonal window, and the exclusive UTC expiry boundary. See [browser results](screenshots/color-mode/browser-results.json), [device dark](screenshots/color-mode/dark-desktop.png), [light](screenshots/color-mode/light-desktop.png), and [phone menu](screenshots/color-mode/dark-menu-390.png).
