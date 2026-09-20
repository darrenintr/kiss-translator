# TranslateGemma automatic launcher on Linux

This launcher lets the browser extension start the local llama.cpp TranslateGemma server only when it is needed.

## How it works

1. KISS Translator is about to request `http://127.0.0.1:8081/completion`.
2. The background service worker checks `/health`.
3. If llama.cpp is not running, the extension sends a Chrome Native Messaging request.
4. The native host runs `systemctl --user start kiss-translategemma.service`.
5. It waits until llama.cpp reports healthy, then the original translation request continues.

The systemd service is intentionally **not enabled**, so it does not start merely because you logged in.

## Install

Build/load the Chrome extension first, then open `chrome://extensions`, enable Developer mode and copy the 32-character ID shown for KISS Translator.

From the repository root:

```bash
DEVICE=Vulkan0 PARALLEL=4 ./native/install-linux.sh \
  YOUR_EXTENSION_ID \
  /home/darren/llama/translategemma-4b-it.Q4_K_M.gguf
```

Then rebuild the extension:

```bash
corepack pnpm build:chrome
```

Reload KISS Translator in `chrome://extensions`, then fully restart Chrome once.

## Verify

Make sure the service is not already running:

```bash
systemctl --user stop kiss-translategemma.service
```

Check:

```bash
systemctl --user status kiss-translategemma.service
```

It should be inactive.

Now translate something with the TranslateGemma provider. Then:

```bash
systemctl --user status kiss-translategemma.service
```

It should be active, started by the extension.

Live logs:

```bash
journalctl --user -u kiss-translategemma.service -f
```


## Sandboxed browsers (Brave/Chromium Snap)

Strictly confined browser packages cannot reliably launch arbitrary host executables through Native Messaging. The Linux installer therefore also installs a lightweight user service:

```text
kiss-translategemma-launcher.service
```

It listens only on:

```text
http://127.0.0.1:8765
```

The extension sends a privileged local `POST /start` request with a custom header. The launcher then starts `kiss-translategemma.service`, waits for llama.cpp on port 8081 to become healthy, and returns control to the original translation request.

The launcher itself does not load the model or use GPU/VRAM. The heavy llama.cpp service remains disabled at login and starts only when TranslateGemma is actually requested.

Verify the lightweight launcher:

```bash
systemctl --user status kiss-translategemma-launcher.service
curl -sS http://127.0.0.1:8765/health
```

Verify that the heavy backend is still idle before translation:

```bash
systemctl --user status kiss-translategemma.service
```
