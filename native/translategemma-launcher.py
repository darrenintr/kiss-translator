#!/usr/bin/env python3
import json
import subprocess
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 8765
BACKEND_SERVICE = "kiss-translategemma.service"
BACKEND_HEALTH_URL = "http://127.0.0.1:8081/health"
ASR_SERVICE = "kiss-qwen3-asr.service"
ASR_HEALTH_URL = "http://127.0.0.1:8082/health"
START_TIMEOUT_SECONDS = 45
REQUIRED_HEADER = "X-KISS-Translator-Launcher"
REQUIRED_VALUE = "1"


def backend_is_healthy(health_url):
    try:
        with urllib.request.urlopen(health_url, timeout=0.5) as response:
            return 200 <= response.status < 300
    except Exception:
        return False


def ensure_backend_started(service_name=BACKEND_SERVICE, health_url=BACKEND_HEALTH_URL):
    if backend_is_healthy(health_url):
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
        if backend_is_healthy(health_url):
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


class Handler(BaseHTTPRequestHandler):
    server_version = "KISSTranslatorLauncher/2"

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)

    def send_json(self, status, payload):
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"status": "ok"})
            return
        self.send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path not in ("/start", "/start-asr"):
            self.send_json(404, {"ok": False, "error": "not found"})
            return

        # Regular web pages cannot set this non-simple header without a CORS
        # preflight. We deliberately do not implement OPTIONS/CORS.
        if self.headers.get(REQUIRED_HEADER) != REQUIRED_VALUE:
            self.send_json(403, {"ok": False, "error": "forbidden"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
            if length:
                self.rfile.read(min(length, 4096))

            if self.path == "/start-asr":
                result = ensure_backend_started(ASR_SERVICE, ASR_HEALTH_URL)
            else:
                result = ensure_backend_started()
            self.send_json(200, result)
        except Exception as exc:
            self.send_json(500, {"ok": False, "error": str(exc)})


def main():
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    print(
        f"KISS Translator launcher listening on http://{LISTEN_HOST}:{LISTEN_PORT}",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
