#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="io.github.darrenintr.kiss_translator.translategemma"
SERVICE_NAME="kiss-translategemma.service"
ASR_SERVICE_NAME="kiss-qwen3-asr.service"
LAUNCHER_SERVICE_NAME="kiss-translategemma-launcher.service"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Usage:
  ./native/install-linux.sh <chrome-extension-id> <translate-model.gguf> [asr-model.gguf] [asr-mmproj.gguf]

Optional environment variables:
  DEVICE=Vulkan0
  PARALLEL=4
  CONTEXT=4096
  PORT=8081
  ASR_PORT=8082
  ASR_MODEL=/home/darren/llama/Qwen3-ASR-0.6B-Q8_0.gguf
  ASR_MMPROJ=/home/darren/llama/mmproj-Qwen3-ASR-0.6B-Q8_0.gguf

Example:
  DEVICE=Vulkan0 PARALLEL=4 ./native/install-linux.sh \
    abcdefghijklmnopqrstuvwxyzabcdef \
    /home/darren/llama/translategemma-4b-it.Q4_K_M.gguf \
    /home/darren/llama/Qwen3-ASR-0.6B-Q8_0.gguf \
    /home/darren/llama/mmproj-Qwen3-ASR-0.6B-Q8_0.gguf
EOF
}

if [[ $# -lt 2 || $# -gt 4 ]]; then
  usage
  exit 2
fi

EXTENSION_ID="$1"
MODEL_PATH="$2"
ASR_MODEL="${3:-${ASR_MODEL:-$HOME/llama/Qwen3-ASR-0.6B-Q8_0.gguf}}"
ASR_MMPROJ="${4:-${ASR_MMPROJ:-$HOME/llama/mmproj-Qwen3-ASR-0.6B-Q8_0.gguf}}"
DEVICE="${DEVICE:-Vulkan0}"
PARALLEL="${PARALLEL:-4}"
CONTEXT="${CONTEXT:-4096}"
PORT="${PORT:-8081}"
ASR_PORT="${ASR_PORT:-8082}"

if [[ ! "$EXTENSION_ID" =~ ^[a-p]{32}$ ]]; then
  echo "Error: '$EXTENSION_ID' does not look like a Chrome extension ID." >&2
  echo "Open chrome://extensions, enable Developer mode, then copy the ID shown under KISS Translator." >&2
  exit 2
fi

for file in "$MODEL_PATH" "$ASR_MODEL" "$ASR_MMPROJ"; do
  if [[ ! -f "$file" ]]; then
    echo "Error: model file not found: $file" >&2
    exit 1
  fi
done

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
LAUNCHER_PATH="$HOST_DIR/translategemma-launcher.py"
SYSTEMD_DIR="$HOME/.config/systemd/user"
SERVICE_PATH="$SYSTEMD_DIR/$SERVICE_NAME"
ASR_SERVICE_PATH="$SYSTEMD_DIR/$ASR_SERVICE_NAME"
LAUNCHER_SERVICE_PATH="$SYSTEMD_DIR/$LAUNCHER_SERVICE_NAME"

mkdir -p "$HOST_DIR" "$SYSTEMD_DIR"
install -m 0755 "$SCRIPT_DIR/translategemma-host.py" "$HOST_PATH"
install -m 0755 "$SCRIPT_DIR/translategemma-launcher.py" "$LAUNCHER_PATH"

cat > "$SERVICE_PATH" <<EOF
[Unit]
Description=KISS Translator local TranslateGemma llama.cpp server
After=graphical-session.target

[Service]
Type=simple
ExecStart=$LLAMA_SERVER -m "$MODEL_PATH" --host 127.0.0.1 --port $PORT --device $DEVICE -ngl all -c $CONTEXT --parallel $PARALLEL --flash-attn on --no-jinja
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
EOF

cat > "$ASR_SERVICE_PATH" <<EOF
[Unit]
Description=KISS Translator local Qwen3-ASR llama.cpp server
After=graphical-session.target

[Service]
Type=simple
ExecStart=$LLAMA_SERVER -m "$ASR_MODEL" --mmproj "$ASR_MMPROJ" --host 127.0.0.1 --port $ASR_PORT --device $DEVICE -ngl all -c 4096 --parallel 1
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
EOF

cat > "$LAUNCHER_SERVICE_PATH" <<EOF
[Unit]
Description=KISS Translator local AI localhost launcher
After=default.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 "$LAUNCHER_PATH"
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
# Heavy model services stay disabled and start only on demand.
systemctl --user disable "$SERVICE_NAME" >/dev/null 2>&1 || true
systemctl --user disable "$ASR_SERVICE_NAME" >/dev/null 2>&1 || true
# The lightweight localhost launcher stays enabled for sandboxed browsers.
systemctl --user enable --now "$LAUNCHER_SERVICE_NAME"

write_manifest() {
  local dir="$1"
  mkdir -p "$dir"
  cat > "$dir/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Starts local KISS Translator AI services",
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
echo "Installed KISS Translator local AI launcher."
echo "  llama-server: $LLAMA_SERVER"
echo "  Translate model: $MODEL_PATH"
echo "  Translate port:  $PORT"
echo "  Translate service: $SERVICE_PATH"
echo "  ASR model:       $ASR_MODEL"
echo "  ASR mmproj:      $ASR_MMPROJ"
echo "  ASR port:        $ASR_PORT"
echo "  ASR service:     $ASR_SERVICE_PATH"
echo "  device:          $DEVICE"
echo "  launcher:        $LAUNCHER_SERVICE_PATH"
echo
echo "The heavy llama.cpp services are NOT enabled at login."
echo "The lightweight launcher on 127.0.0.1:8765 starts either backend on demand."
echo
echo "Now rebuild/reload the extension."
