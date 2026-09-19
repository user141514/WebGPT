# Human Client Design

## Goal

Build a local frontend that becomes the user's primary ChatGPT interaction surface while ChatGPT Web remains a hidden/provider-side execution surface controlled by the browser extension.

## Scope

The first client intentionally does not recreate all ChatGPT features. It proves the human-facing loop:

`local input -> bridge -> extension -> ChatGPT Web -> normalized events -> local render`

## Architecture

### Human Client
A small dependency-free TypeScript frontend served from localhost with:
- prompt composer
- submit button
- connection state
- request status (`accepted`, `generating`, `complete`, `error`)
- progressively replaced assistant snapshot
- final assistant response
- raw event inspector for development

### Phase-1 Local Transport
A Node built-in HTTP server serves the frontend at `http://127.0.0.1:4317`. A narrow localhost content-script relay bridges `window.postMessage` to Chrome runtime messaging. The service worker assigns provider `requestId`, binds it to the ChatGPT provider tab and originating client tab, and routes normalized events back to that client.

This is intentionally simpler than a dedicated WebSocket Bridge Core. Once the end-to-end client gate is proven, the transport may be replaced by a standalone Bridge Core without changing the frontend event model or ChatGPT adapter boundary.

## Core Invariant

The frontend never queries or interprets ChatGPT DOM. All ChatGPT-specific selectors and page state stay behind the extension adapter boundary.

## Rendering Model

Phase 1 uses full `assistant.snapshot` replacement rather than token deltas. The UI reconciles the latest snapshot per `requestId`. This avoids pretending the DOM is an append-only token stream.

## Failure Model

- Extension relay unavailable -> frontend remains disconnected and does not submit.
- Local server unavailable -> the frontend cannot load; no provider request is attempted.
- ChatGPT tab unavailable -> extension returns an explicit provider-tab-unavailable error.
- Page selector drift -> content script emits an adapter error; frontend preserves the last valid snapshot.

## MVP Acceptance Gate

1. Open the local frontend.
2. Type `Reply exactly CLIENT_SMOKE_OK`.
3. Submit without touching the ChatGPT page.
4. UI transitions through accepted/generating or equivalent observable state.
5. UI progressively shows assistant snapshots.
6. UI ends with `CLIENT_SMOKE_OK`.

## Out of Scope

- Pixel-identical ChatGPT clone
- Account/settings UI
- Search/history sidebar parity
- File uploads
- model picker
- tools/citations/images
- Markdown AST beyond safe plain/preformatted rendering
- persistence beyond the current page session

These are added only after the end-to-end client gate is stable.
