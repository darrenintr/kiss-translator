#!/usr/bin/env python3
import json
import struct
import subprocess
import sys
import time
import urllib.request

SERVICE_NAME = "kiss-translategemma.service"
HEALTH_URL = "http://127.0.0.1:8081/health"
ASR_SERVICE_NAME = "kiss-qwen3-asr.service"
ASR_HEALTH_URL = "http://127.0.0.1:8082/health"
START_TIMEOUT_SECONDS = 45


def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    if len(raw_length) != 4:
        raise RuntimeError("invalid native message length prefix")
    message_length = struct.unpack("=I", raw_length)[0]
    payload = sys.stdin.buffer.read(message_length)
    if len(payload) != message_length:
        raise RuntimeError("incomplete native message")
    return json.loads(payload.decode("utf-8"))


def write_message(payload):
    encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("=I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def is_healthy(url):
    try:
        with urllib.request.urlopen(url, timeout=0.5) as response:
            return 200 <= response.status < 300
    except Exception:
        return False


def ensure_service_started(service_name, health_url):
    if is_healthy(health_url):
        return {"ok": True, "already_running": True}

    result = subprocess.run(
        ["systemctl", "--user", "start", service_name],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=10,
        check=False,
    )
    if result.returncode != 0:
        error = (result.stderr or result.stdout or "systemctl failed").strip()
        raise RuntimeError(error)

    deadline = time.monotonic() + START_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if is_healthy(health_url):
            return {"ok": True, "already_running": False}
        time.sleep(0.2)

    status = subprocess.run(
        ["systemctl", "--user", "status", service_name, "--no-pager"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=5,
        check=False,
    )
    raise RuntimeError(
        "llama.cpp did not become ready in time. "
        + (status.stdout or "").strip()[-1200:]
    )


def main():
    try:
        message = read_message()
        if message is None:
            return

        action = message.get("action")
        if action == "ensure_started":
            write_message(ensure_service_started(SERVICE_NAME, HEALTH_URL))
            return
        if action == "ensure_asr_started":
            write_message(ensure_service_started(ASR_SERVICE_NAME, ASR_HEALTH_URL))
            return

        write_message({"ok": False, "error": "unsupported action"})
    except Exception as exc:
        print(f"KISS Translator native host error: {exc}", file=sys.stderr)
        try:
            write_message({"ok": False, "error": str(exc)})
        except Exception:
            pass


if __name__ == "__main__":
    main()
