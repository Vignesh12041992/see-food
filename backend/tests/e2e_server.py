"""Backend launcher used only by the end-to-end tests.

Starts two things in one process:

1. A tiny stub of the OpenRouter chat-completions API (default port 9100).
2. The real FastAPI app from ``main.py`` on port 8000, with ``OPENROUTER_URL``
   pointed at the stub.

No production code is modified. The stub decides what to return by looking for a
``SCENARIO:<name>`` marker inside the uploaded image bytes, so each Playwright
test controls the upstream behaviour just by choosing what image it uploads.

Scenarios:
    (none)       valid analysis (Grilled Chicken + Brown Rice, 612 kcal)
    second       a different valid analysis (Green Salad, 777 kcal)
    slow         valid analysis after a 1.5 s delay (to observe the loading state)
    upstream-502 upstream answers HTTP 502
    malformed    upstream answers 200 but the model content is not JSON

Test helper endpoints on the stub:
    GET  /__requests   what the backend sent upstream (auth header, model, image)
    POST /__reset      clear that log
"""
import base64
import json
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

E2E_API_KEY = "e2e-test-key"
os.environ["OPENROUTER_API_KEY"] = E2E_API_KEY  # must be set before importing main

import main  # noqa: E402
import uvicorn  # noqa: E402

STUB_PORT = int(os.environ.get("E2E_STUB_PORT", "9100"))
APP_PORT = int(os.environ.get("E2E_APP_PORT", "8000"))
CHAT_PATH = "/api/v1/chat/completions"

ANALYSES = {
    "default": {
        "detected_items": [
            {
                "name": "Grilled Chicken",
                "estimated_weight_g": 150,
                "calories": 248,
                "protein_g": 46.5,
                "carbs_g": 0,
                "fats_g": 5.4,
            },
            {
                "name": "Brown Rice",
                "estimated_weight_g": 200,
                "calories": 216,
                "protein_g": 5,
                "carbs_g": 45,
                "fats_g": 1.8,
            },
        ],
        "total_calories": 612,
        "total_protein_g": 48.5,
        "total_carbs_g": 62,
        "total_fats_g": 20.3,
        "confidence_score": 0.874,
        "disclaimer": "Estimates only. Not medical advice.",
    },
    "second": {
        "detected_items": [
            {
                "name": "Green Salad",
                "estimated_weight_g": 120,
                "calories": 35,
                "protein_g": 2,
                "carbs_g": 6,
                "fats_g": 0.5,
            }
        ],
        "total_calories": 777,
        "total_protein_g": 2,
        "total_carbs_g": 6,
        "total_fats_g": 0.5,
        "confidence_score": 0.5,
        "disclaimer": "Second analysis disclaimer.",
    },
}

REQUEST_LOG = []
MARKER = re.compile(rb"SCENARIO:([a-z0-9-]+)")


def completion(content):
    return {"choices": [{"message": {"content": content}}]}


class StubOpenRouter(BaseHTTPRequestHandler):
    def log_message(self, *args):  # keep test output quiet
        pass

    def _send(self, status, payload):
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/__requests":
            self._send(200, REQUEST_LOG)
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b""

        if self.path == "/__reset":
            REQUEST_LOG.clear()
            self._send(200, {"ok": True})
            return

        if self.path != CHAT_PATH:
            self._send(404, {"error": f"unexpected path {self.path}"})
            return

        payload = json.loads(raw)
        data_uri = ""
        for part in payload["messages"][-1]["content"]:
            if part.get("type") == "image_url":
                data_uri = part["image_url"]["url"]
        image_bytes = base64.b64decode(data_uri.split(",", 1)[1]) if "," in data_uri else b""
        match = MARKER.search(image_bytes)
        scenario = match.group(1).decode() if match else "default"

        REQUEST_LOG.append(
            {
                "authorization": self.headers.get("Authorization"),
                "model": payload.get("model"),
                "image_data_uri": data_uri,
                "scenario": scenario,
            }
        )

        if scenario == "upstream-502":
            self._send(502, {"error": "Bad gateway from stub"})
        elif scenario == "malformed":
            self._send(200, completion("I cannot analyze this image."))
        elif scenario == "second":
            self._send(200, completion(json.dumps(ANALYSES["second"])))
        elif scenario == "slow":
            time.sleep(1.5)
            self._send(200, completion(json.dumps(ANALYSES["default"])))
        else:
            self._send(200, completion(json.dumps(ANALYSES["default"])))


def main_entry():
    stub = ThreadingHTTPServer(("127.0.0.1", STUB_PORT), StubOpenRouter)
    threading.Thread(target=stub.serve_forever, daemon=True).start()

    main.OPENROUTER_URL = f"http://127.0.0.1:{STUB_PORT}{CHAT_PATH}"
    uvicorn.run(main.app, host="127.0.0.1", port=APP_PORT, log_level="warning")


if __name__ == "__main__":
    main_entry()
