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
