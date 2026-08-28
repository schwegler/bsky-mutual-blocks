# Bluesky Mutual Block Checker

A client-side web application built with TypeScript and Vite that checks for mutual blocks on Bluesky (AT Protocol).

## Features

- **Bluesky OAuth Login**: Authenticate securely directly in your browser using AT Protocol OAuth.
- **Mutual Block Detection**: Scan and identify mutual block relationships on Bluesky.
- **Client-Side Only**: Runs entirely in the browser with no backend server required.
- **Automated Deployment**: Configured for continuous deployment to [Cloudflare Pages](https://bsky-mutual-blocks.pages.dev).

## Tech Stack

- **Framework / Bundler**: [Vite](https://vitejs.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **API & Auth**: Bluesky / AT Protocol (`@atproto/api`, `@atproto/oauth-client-browser`)
- **Hosting**: [Cloudflare Pages](https://pages.cloudflare.com/)

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- `npm` or `pnpm` / `yarn`

### Installation

1. Clone the repository:
```bash
git clone [https://github.com/schwegler/bsky-mutual-blocks.git](https://github.com/schwegler/bsky-mutual-blocks.git)
cd bsky-mutual-blocks

```
2. Install dependencies:
```bash
npm install

```
### Development

Run the local development server:

```bash
npm run dev

```

Open `http://localhost:5173` in your browser.

### Building

Type-check and compile the production build:

```bash
npm run build

```

The output will be generated in the `dist/` directory.

### Previewing Production Build

```bash
npm run preview

```

## Deployment

This repository is connected to **Cloudflare Pages** for automatic deployments:

* **Build command**: `npm run build`
* **Output directory**: `dist`
* **Root directory**: `/`

Pushes to the `main` branch automatically trigger a production build and deployment to [https://bsky-mutual-blocks.pages.dev](https://www.google.com/url?sa=E&source=gmail&q=https://bsky-mutual-blocks.pages.dev). Pull requests generate preview deployments.

## License

MIT
