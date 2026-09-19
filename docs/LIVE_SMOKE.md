# Live Smoke Gates

## Chrome Extension Gate

Build first:

```powershell
npm run check
```

Load the unpacked extension from the repository's `extension` directory:

```text
<repo>\extension
```

Then:

1. Keep an already signed-in `https://chatgpt.com/` tab open.
2. Open the ChatGPT Web Driver extension popup.
3. Submit exactly:

```text
Reply exactly DRIVER_SMOKE_OK
```

4. Required evidence:
   - submit result contains `started: true` and a `requestId`;
   - event log contains `request.accepted`;
   - event log contains at least one `assistant.status` or `assistant.snapshot`;
   - final event is `assistant.completed`;
   - final rendered text contains exactly `DRIVER_SMOKE_OK`.

The official ChatGPT page does not need to be visually clickable. An unrelated overlay may remain visible; the gate is valid as long as the underlying composer/send DOM still exists and the programmatic control path completes.

Do not claim this gate passed until the new unpacked extension itself produced the evidence above. Existing Watchdog/Sidecar evidence proves the source behavior, not this new package.

## Human Client Gate

Build and start the local client:

```powershell
npm run client:serve
```

Open:

```text
http://127.0.0.1:4317/
```

Required precondition: the unpacked extension from `<repo>\extension` is loaded in Chrome and a signed-in `https://chatgpt.com/` tab is open.

The client must first show `Extension connected`. Then submit exactly:

```text
Reply exactly CLIENT_SMOKE_OK
```

Required evidence:

1. The local page, not the official ChatGPT composer, initiates the request.
2. UI leaves `submitting` and reaches `accepted` / `generating` / `settling` as events arrive.
3. Assistant text is replaced from full `assistant.snapshot` events rather than appended as token deltas.
4. Final phase is `completed`.
5. Final rendered assistant text is exactly `CLIENT_SMOKE_OK`.
6. Previous turns remain visible in the local transcript during the page session.

The transport for this first gate is:

```text
localhost page
-> window.postMessage
-> localhost extension relay
-> service worker
-> ChatGPT content script
-> ChatGPT Web
-> normalized provider events
-> originating localhost client tab
```

A dedicated WebSocket Bridge Core is deliberately deferred until this loop is proven.
