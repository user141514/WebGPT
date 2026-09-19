# Chrome Extension Update CLI

`chatgpt-web-driver` exposes a local CLI so the agent can verify and reload the unpacked Chrome extension without clicking `chrome://extensions` after the one-time bootstrap reload.

## Commands

```powershell
.\chatgpt-web-driver.cmd extension status
.\chatgpt-web-driver.cmd extension reload
.\chatgpt-web-driver.cmd extension doctor
```

Equivalent npm form:

```powershell
npm run driver -- extension reload
```

Machine-readable output:

```powershell
.\chatgpt-web-driver.cmd extension status --json
.\chatgpt-web-driver.cmd extension reload --json --timeout-ms 60000
```

## Reload contract

`extension reload` does not treat request acceptance as success. It:

1. Builds the extension and writes deterministic `extension/build.json`.
2. Starts an ephemeral control server on `127.0.0.1:4318`.
3. Opens a fixed local control page in the already-running Google Chrome profile.
4. The installed extension records a reload receipt and calls `chrome.runtime.reload()`.
5. The new service worker verifies the expected `buildId` and that the runtime `instanceId` changed.
6. It reinjects the current extension loaders into eligible existing ChatGPT and localhost client tabs.
7. The new worker reports a terminal `verified` or `failed` receipt to the CLI.
8. The temporary control tab is closed.

Only a terminal `verified` receipt returns success.

## Why this still needs one manual reload

The currently installed pre-CLI extension does not know the `extension.control` protocol and cannot call its future code. After loading the build that contains this CLI support once through `chrome://extensions`, all later source updates can use `extension reload`.

## Safety boundaries

- Control requests are accepted only from `http://127.0.0.1:4318/__extension-control.html` or the localhost equivalent.
- The CLI does not use a separate Chrome profile and never supplies `--user-data-dir`.
- It does not rewrite Chrome profile files or extension registries.
- Build identity is content-derived; manifest version alone is not considered sufficient verification.
- Reload failure or reattachment failure returns a non-zero exit status.
