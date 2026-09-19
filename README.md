# WebGPT

WebGPT is a local Chrome-extension-based client for controlling and mirroring the signed-in ChatGPT Web experience from a lightweight local interface.

> Unofficial project. It is not affiliated with or endorsed by OpenAI.

## Current MVP

- Bind an already-open ChatGPT conversation by URL.
- Mirror the visible conversation into a local client.
- Continue the bound conversation from the local client.
- Show indexed ChatGPT projects and conversations in the left sidebar.
- Click a conversation in the sidebar to navigate an existing ChatGPT tab and bind the selected conversation.
- Stream assistant state/content back to the local client.
- Reattach the extension after local extension reloads.
- Keep the control plane local to the browser and `127.0.0.1`.

The sidebar navigation reuses an existing ChatGPT tab; it does not create a new ChatGPT tab for every conversation switch.

## Repository layout

```text
client/        Local WebGPT UI
extension/     Chrome extension manifest, loaders, and built runtime
src/           TypeScript source
scripts/       Driver/build utilities
test/          Regression tests
docs/          Development and smoke-test notes
```

The built Chrome extension runtime under `extension/dist/` is committed so the repository can be loaded as an unpacked extension immediately.

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Verify/build

```bash
npm run check
```

### 3. Load the Chrome extension

Open:

```text
chrome://extensions
```

Enable **Developer mode**, choose **Load unpacked**, and select:

```text
<repo>/extension
```

Keep a signed-in `https://chatgpt.com/` tab open.

### 4. Start the local client

```bash
npm run client:serve
```

Then open:

```text
http://127.0.0.1:4317/
```

or, after the extension control path is available:

```bash
node scripts/web-driver.mjs client open
```

### 5. Use WebGPT

You can either:

1. Paste the URL of an already-open ChatGPT conversation and click **Bind**; or
2. Use the indexed project/conversation sidebar and click a conversation to switch the existing provider tab and bind it.

## Development checks

```bash
npm test
npm run typecheck
npm run build:extension
npm run check
```

See also:

- `docs/EXTENSION_CLI.md`
- `docs/LIVE_SMOKE.md`

## Current scope

This repository is currently an MVP focused on a reliable local control/mapping loop. Packaging, installer UX, broader browser support, and further performance work are intentionally deferred.
