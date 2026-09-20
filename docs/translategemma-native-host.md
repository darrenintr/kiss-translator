# TranslateGemma automatic launcher on Linux

This launcher lets the browser extension start the local llama.cpp TranslateGemma server and Qwen3-ASR live-caption server only when they are needed.

## How it works

For TranslateGemma:

1. KISS Translator is about to request `http://127.0.0.1:8081/completion`.
2. The background service worker checks `/health`.
3. If llama.cpp is not running, the extension asks the local launcher or Native Messaging host to start `kiss-translategemma.service`.
4. It waits until llama.cpp reports healthy, then the original translation request continues.

For local AI live captions:

1. Press **Alt+L** on a tab containing video or audio.
2. The extension starts `kiss-qwen3-asr.service` on `127.0.0.1:8082` if needed.
3. Chromium `tabCapture` sends the tab audio to an offscreen document.
4. Audio is converted to 16 kHz mono WAV chunks and sent to `/v1/audio/transcriptions`.
5. Qwen3-ASR returns text which is rendered as a live subtitle overlay.

The systemd service is intentionally **not enabled**, so it does not start merely because you logged in.

## Install

Build/load the Chrome extension first, then open `chrome://extensions`, enable Developer mode and copy the 32-character ID shown for KISS Translator.

From the repository root:

```bash
DEVICE=Vulkan0 PARALLEL=4 ./native/install-linux.sh \
  YOUR_EXTENSION_ID \
  /home/darren/llama/translategemma-4b-it.Q4_K_M.gguf \
  /home/darren/llama/Qwen3-ASR-0.6B-Q8_0.gguf \
  /home/darren/llama/mmproj-Qwen3-ASR-0.6B-Q8_0.gguf
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


## Qwen3-ASR live captions

The ASR backend is fixed to port **8082** by default and is installed as:

```text
kiss-qwen3-asr.service
```

It is intentionally disabled at login and starts only when live captions are requested.

Manual equivalent command:

```bash
llama-server \
  -m /home/darren/llama/Qwen3-ASR-0.6B-Q8_0.gguf \
  --mmproj /home/darren/llama/mmproj-Qwen3-ASR-0.6B-Q8_0.gguf \
  --host 127.0.0.1 \
  --port 8082 \
  --device Vulkan0 \
  -ngl all \
  -c 4096 \
  --parallel 1
```

Health check:

```bash
curl -sS http://127.0.0.1:8082/health
```

Live logs:

```bash
journalctl --user -u kiss-qwen3-asr.service -f
```

The Chrome/Chromium extension uses **Alt+L** to toggle local AI captions. Recognition language, audio chunk length, and overlap can be changed under the subtitle settings.
