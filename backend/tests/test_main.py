"""Tests for the AI Nutrition Agent API (backend/main.py).

The only thing mocked is the outbound HTTP call to OpenRouter. Everything else
(FastAPI routing, multipart parsing, CORS, pydantic validation) is real.
"""
import base64
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

import main

ENDPOINT = "/api/analyze-nutrition"
FRONTEND_ORIGIN = "http://localhost:3000"

VALID_ANALYSIS = {
    "detected_items": [
        {
            "name": "Grilled Chicken",
            "estimated_weight_g": 150,
            "calories": 248,
            "protein_g": 46.5,
            "carbs_g": 0.0,
            "fats_g": 5.4,
        },
        {
            "name": "Brown Rice",
            "estimated_weight_g": 200,
            "calories": 216,
            "protein_g": 5.0,
            "carbs_g": 45.0,
            "fats_g": 1.8,
        },
    ],
    "total_calories": 464,
    "total_protein_g": 51.5,
    "total_carbs_g": 45.0,
    "total_fats_g": 7.2,
    "confidence_score": 0.87,
    "disclaimer": "Estimates only. Not medical advice.",
}

IMAGE_BYTES = b"\x89PNG\r\n\x1a\nfake-image-bytes"


# --------------------------------------------------------------------------- #
# Helpers / fixtures
# --------------------------------------------------------------------------- #
class FakeResponse:
    def __init__(self, status_code=200, json_data=None, text=""):
        self.status_code = status_code
        self._json = json_data
        self.text = text or (json.dumps(json_data) if json_data is not None else "")

    def json(self):
        return self._json


def openrouter_reply(content):
    """Build the chat-completions envelope OpenRouter returns."""
    return FakeResponse(200, {"choices": [{"message": {"content": content}}]})


class Upstream:
    """Stands in for httpx.AsyncClient and records how it was used."""

    def __init__(self):
        self.response = openrouter_reply(json.dumps(VALID_ANALYSIS))
        self.exception = None
        self.calls = []
        self.client_kwargs = None

    def client_factory(self, *args, **kwargs):
        upstream = self
        upstream.client_kwargs = kwargs

        class _Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc_info):
                return False

            async def post(self, url, json=None, headers=None):
                upstream.calls.append(
                    SimpleNamespace(url=url, json=json, headers=headers)
                )
                if upstream.exception is not None:
                    raise upstream.exception
                return upstream.response

        return _Client()


@pytest.fixture
def upstream(monkeypatch):
    fake = Upstream()
    monkeypatch.setattr(main, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(main, "httpx", SimpleNamespace(AsyncClient=fake.client_factory))
    return fake


@pytest.fixture
def client():
    return TestClient(main.app)


def post_image(client, content=IMAGE_BYTES, filename="plate.png", content_type="image/png"):
    return client.post(ENDPOINT, files={"file": (filename, content, content_type)})


# --------------------------------------------------------------------------- #
# Health endpoint
# --------------------------------------------------------------------------- #
def test_root_reports_api_is_online(client):
    response = client.get("/")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "online"
    assert "/api/analyze-nutrition" in body["message"]


# --------------------------------------------------------------------------- #
# Successful analysis
# --------------------------------------------------------------------------- #
def test_successful_analysis_returns_parsed_result(client, upstream):
    response = post_image(client)

    assert response.status_code == 200
    assert response.json() == VALID_ANALYSIS


def test_response_has_every_field_the_frontend_renders(client, upstream):
    body = post_image(client).json()

    for field in (
        "total_calories",
        "total_protein_g",
        "total_carbs_g",
        "total_fats_g",
        "confidence_score",
        "disclaimer",
        "detected_items",
    ):
        assert field in body
    for item in body["detected_items"]:
        for field in (
            "name",
            "estimated_weight_g",
            "calories",
            "protein_g",
            "carbs_g",
            "fats_g",
        ):
            assert field in item


def test_model_output_with_surrounding_whitespace_is_accepted(client, upstream):
    upstream.response = openrouter_reply("\n  " + json.dumps(VALID_ANALYSIS) + "  \n")

    response = post_image(client)

    assert response.status_code == 200
    assert response.json()["total_calories"] == 464


def test_empty_detected_items_is_a_valid_analysis(client, upstream):
    empty = {**VALID_ANALYSIS, "detected_items": [], "total_calories": 0}
    upstream.response = openrouter_reply(json.dumps(empty))

    response = post_image(client)

    assert response.status_code == 200
    assert response.json()["detected_items"] == []


# --------------------------------------------------------------------------- #
# What gets sent to OpenRouter
# --------------------------------------------------------------------------- #
def test_openrouter_url_is_the_chat_completions_endpoint():
    assert main.OPENROUTER_URL == "https://openrouter.ai/api/v1/chat/completions"


def test_request_goes_to_openrouter_with_auth_headers(client, upstream):
    post_image(client)

    assert len(upstream.calls) == 1
    call = upstream.calls[0]
    assert call.url == main.OPENROUTER_URL
    assert call.headers["Authorization"] == "Bearer test-key"
    assert call.headers["Content-Type"] == "application/json"
    assert call.headers["HTTP-Referer"] == FRONTEND_ORIGIN
    assert call.headers["X-Title"] == "AI Nutrition Agent"


def test_payload_requests_json_from_the_configured_model(client, upstream):
    post_image(client)

    payload = upstream.calls[0].json
    assert payload["model"] == main.TARGET_MODEL
    assert payload["response_format"] == {"type": "json_object"}
    assert payload["temperature"] == 0.1


def test_payload_embeds_uploaded_image_as_base64_data_uri(client, upstream):
    post_image(client, content=IMAGE_BYTES, content_type="image/png")

    messages = upstream.calls[0].json["messages"]
    assert messages[0]["role"] == "system"
    assert messages[1]["role"] == "user"
    image_part = next(p for p in messages[1]["content"] if p["type"] == "image_url")
    expected = "data:image/png;base64," + base64.b64encode(IMAGE_BYTES).decode()
    assert image_part["image_url"]["url"] == expected


def test_uploaded_content_type_is_used_in_the_data_uri(client, upstream):
    post_image(client, filename="plate.webp", content_type="image/webp")

    messages = upstream.calls[0].json["messages"]
    image_part = next(p for p in messages[1]["content"] if p["type"] == "image_url")
    assert image_part["image_url"]["url"].startswith("data:image/webp;base64,")


def test_user_message_includes_a_text_instruction(client, upstream):
    post_image(client)

    content = upstream.calls[0].json["messages"][1]["content"]
    text_part = next(p for p in content if p["type"] == "text")
    assert text_part["text"]


def test_system_prompt_describes_the_expected_json_schema():
    for field in ("detected_items", "total_calories", "confidence_score", "disclaimer"):
        assert field in main.SYSTEM_PROMPT
    assert "raw JSON only" in main.SYSTEM_PROMPT


def test_upstream_request_has_a_timeout(client, upstream):
    post_image(client)

    assert upstream.client_kwargs == {"timeout": 45.0}


# --------------------------------------------------------------------------- #
# Error handling
# --------------------------------------------------------------------------- #
def test_missing_api_key_returns_500_without_calling_openrouter(client, upstream, monkeypatch):
    monkeypatch.setattr(main, "OPENROUTER_API_KEY", None)

    response = post_image(client)

    assert response.status_code == 500
    assert "OPENROUTER_API_KEY" in response.json()["detail"]
    assert upstream.calls == []


def test_empty_api_key_is_treated_as_missing(client, upstream, monkeypatch):
    monkeypatch.setattr(main, "OPENROUTER_API_KEY", "")

    response = post_image(client)

    assert response.status_code == 500
    assert "OPENROUTER_API_KEY" in response.json()["detail"]


@pytest.mark.parametrize("upstream_status", [401, 402, 429, 500, 503])
def test_upstream_error_status_surfaces_as_an_error_with_gateway_message(
    client, upstream, upstream_status
):
    upstream.response = FakeResponse(upstream_status, text="upstream says no")

    response = post_image(client)

    # main.py wraps everything in `except Exception`, so the original upstream
    # status is replaced with a 500; the gateway message is preserved.
    assert response.status_code == 500
    detail = response.json()["detail"]
    assert "OpenRouter Gateway Error" in detail
    assert "upstream says no" in detail


def test_network_failure_returns_500(client, upstream):
    upstream.exception = httpx.ConnectError("connection refused")

    response = post_image(client)

    assert response.status_code == 500
    assert "Analysis engine failed" in response.json()["detail"]
    assert "connection refused" in response.json()["detail"]


def test_upstream_timeout_returns_500(client, upstream):
    upstream.exception = httpx.ReadTimeout("timed out")

    response = post_image(client)

    assert response.status_code == 500
    assert "Analysis engine failed" in response.json()["detail"]


def test_model_returning_non_json_returns_500(client, upstream):
    upstream.response = openrouter_reply("Sorry, I can't analyze that image.")

    response = post_image(client)

    assert response.status_code == 500
    assert "Analysis engine failed" in response.json()["detail"]


def test_model_json_missing_required_fields_returns_500(client, upstream):
    incomplete = {k: v for k, v in VALID_ANALYSIS.items() if k != "total_calories"}
    upstream.response = openrouter_reply(json.dumps(incomplete))

    response = post_image(client)

    assert response.status_code == 500
    assert "Analysis engine failed" in response.json()["detail"]


def test_model_json_with_wrong_types_returns_500(client, upstream):
    wrong = {**VALID_ANALYSIS, "total_calories": "lots"}
    upstream.response = openrouter_reply(json.dumps(wrong))

    response = post_image(client)

    assert response.status_code == 500


def test_upstream_200_without_choices_returns_500(client, upstream):
    upstream.response = FakeResponse(200, {"error": {"message": "model unavailable"}})

    response = post_image(client)

    assert response.status_code == 500
    assert "Analysis engine failed" in response.json()["detail"]


# --------------------------------------------------------------------------- #
# Request validation
# --------------------------------------------------------------------------- #
def test_request_without_a_file_is_rejected_with_422(client, upstream):
    response = client.post(ENDPOINT)

    assert response.status_code == 422
    assert upstream.calls == []


def test_file_must_use_the_field_name_file(client, upstream):
    response = client.post(ENDPOINT, files={"image": ("plate.png", IMAGE_BYTES, "image/png")})

    assert response.status_code == 422
    assert upstream.calls == []


def test_get_on_the_analyze_endpoint_is_not_allowed(client):
    assert client.get(ENDPOINT).status_code == 405


# --------------------------------------------------------------------------- #
# CORS (the Next.js frontend runs on localhost:3000)
# --------------------------------------------------------------------------- #
def test_cors_preflight_allows_the_frontend_origin(client):
    response = client.options(
        ENDPOINT,
        headers={
            "Origin": FRONTEND_ORIGIN,
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == FRONTEND_ORIGIN
    assert "POST" in response.headers["access-control-allow-methods"]


def test_cors_preflight_rejects_other_origins(client):
    response = client.options(
        ENDPOINT,
        headers={
            "Origin": "http://evil.example.com",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_actual_response_carries_cors_header_for_frontend_origin(client, upstream):
    response = client.post(
        ENDPOINT,
        files={"file": ("plate.png", IMAGE_BYTES, "image/png")},
        headers={"Origin": FRONTEND_ORIGIN},
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == FRONTEND_ORIGIN


# --------------------------------------------------------------------------- #
# Pydantic models
# --------------------------------------------------------------------------- #
def test_nutrition_analysis_accepts_valid_data():
    analysis = main.NutritionAnalysis.model_validate(VALID_ANALYSIS)

    assert analysis.total_calories == 464
    assert analysis.detected_items[0].name == "Grilled Chicken"


def test_nutrition_analysis_rejects_missing_item_fields():
    broken = {
        **VALID_ANALYSIS,
        "detected_items": [{"name": "Mystery", "calories": 100}],
    }

    with pytest.raises(ValidationError):
        main.NutritionAnalysis.model_validate(broken)
