#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="io.github.darrenintr.kiss_translator.translategemma"
SERVICE_NAME="kiss-translategemma.service"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Usage:
  ./native/install-linux.sh <chrome-extension-id> <model.gguf>

Optional environment variables:
  DEVICE=Vulkan0
  PARALLEL=4
  CONTEXT=4096
  PORT=8081

Example:
  DEVICE=Vulkan0 PARALLEL=4 ./native/install-linux.sh \
    abcdefghijklmnopqrstuvwxyzabcdef \
    /home/darren/llama/translategemma-4b-it.Q4_K_M.gguf
EOF
}

if [[ $# -ne 2 ]]; then
  usage
  exit 2
fi

EXTENSION_ID="$1"
MODEL_PATH="$2"
DEVICE="${DEVICE:-Vulkan0}"
PARALLEL="${PARALLEL:-4}"
CONTEXT="${CONTEXT:-4096}"
PORT="${PORT:-8081}"

if [[ ! "$EXTENSION_ID" =~ ^[a-p]{32}$ ]]; then
  echo "Error: '$EXTENSION_ID' does not look like a Chrome extension ID." >&2
  echo "Open chrome://extensions, enable Developer mode, then copy the ID shown under KISS Translator." >&2
  exit 2
fi

if [[ ! -f "$MODEL_PATH" ]]; then
  echo "Error: model not found: $MODEL_PATH" >&2
  exit 1
fi

LLAMA_SERVER="$(command -v llama-server || true)"
if [[ -z "$LLAMA_SERVER" ]]; then
  echo "Error: llama-server is not in PATH." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 is required." >&2
  exit 1
fi

HOST_DIR="$HOME/.local/lib/kiss-translator"
HOST_PATH="$HOST_DIR/translategemma-host.py"
SYSTEMD_DIR="$HOME/.config/systemd/user"
SERVICE_PATH="$SYSTEMD_DIR/$SERVICE_NAME"

mkdir -p "$HOST_DIR" "$SYSTEMD_DIR"
install -m 0755 "$SCRIPT_DIR/translategemma-host.py" "$HOST_PATH"

cat > "$SERVICE_PATH" <<EOF
[Unit]
Description=KISS Translator local TranslateGemma llama.cpp server
After=graphical-session.target

[Service]
Type=simple
ExecStart=$LLAMA_SERVER -m "$MODEL_PATH" --host 127.0.0.1 --port $PORT --device $DEVICE -ngl all -c $CONTEXT --parallel $PARALLEL --no-jinja
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
# Deliberately do not enable the service. The browser extension starts it on demand.
systemctl --user disable "$SERVICE_NAME" >/dev/null 2>&1 || true

write_manifest() {
  local dir="$1"
  mkdir -p "$dir"
  cat > "$dir/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Starts the local TranslateGemma llama.cpp service for KISS Translator",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF
}

write_manifest "$HOME/.config/google-chrome/NativeMessagingHosts"
write_manifest "$HOME/.config/google-chrome-for-testing/NativeMessagingHosts"
write_manifest "$HOME/.config/chromium/NativeMessagingHosts"
write_manifest "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"

echo
echo "Installed TranslateGemma native launcher."
echo "  llama-server: $LLAMA_SERVER"
echo "  model:        $MODEL_PATH"
echo "  device:       $DEVICE"
echo "  parallel:     $PARALLEL"
echo "  service:      $SERVICE_PATH"
echo
echo "The service is NOT enabled at login."
echo "KISS Translator will start it automatically on the first request to localhost:$PORT."
echo
echo "Now rebuild/reload the extension, then completely restart Chrome once."
