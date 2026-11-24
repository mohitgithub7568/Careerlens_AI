import os
import time

import requests
from dotenv import load_dotenv

load_dotenv()

HF_CHAT_URL = "https://router.huggingface.co/v1/chat/completions"
GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"


class LLMUnavailableError(RuntimeError):
    """Raised when the LLM provider rejects the request (no credits, bad key, ...)."""


def _resolve_provider() -> tuple[str, str, str]:
    """
    Returns (api_url, api_key, model).

    Any OpenAI-compatible provider works. Priority:
      1. LLM_BASE_URL + LLM_API_KEY (explicit override)
      2. GROQ_API_KEY            (free tier, https://console.groq.com)
      3. HUGGINGFACEHUB_API_TOKEN (HF router)
    """
    base_url = os.environ.get("LLM_BASE_URL", "").strip().rstrip("/")
    explicit_key = os.environ.get("LLM_API_KEY", "").strip()
    groq_key = os.environ.get("GROQ_API_KEY", "").strip()
    hf_key = os.environ.get("HUGGINGFACEHUB_API_TOKEN", "").strip()
    model = os.environ.get("LLM_MODEL", "openai/gpt-oss-120b").strip()

    if base_url and explicit_key:
        return f"{base_url}/chat/completions", explicit_key, model
    if groq_key:
        return GROQ_CHAT_URL, groq_key, model
    if hf_key:
        return HF_CHAT_URL, hf_key, model
    raise LLMUnavailableError(
        "No LLM API key configured. Set GROQ_API_KEY (or HUGGINGFACEHUB_API_TOKEN) in the environment."
    )


def generate_text(prompt: str) -> str:
    """Send a single-turn chat completion request and return the reply text."""
    api_url, api_key, model = _resolve_provider()

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 2048,
    }

    max_retries = 3
    base_delay = 2.0
    timeout = int(os.environ.get("LLM_TIMEOUT", "60"))

    for attempt in range(max_retries):
        try:
            response = requests.post(api_url, headers=headers, json=payload, timeout=timeout)
        except requests.exceptions.RequestException as err:
            if attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt)
                print(f"[LLM] Network error: {err}. Retrying in {delay}s ({attempt + 1}/{max_retries})...")
                time.sleep(delay)
                continue
            raise RuntimeError(f"LLM request failed: {err}")

        status = response.status_code
        if status in (401, 402, 403):
            # Retrying cannot help: bad key or out of credits.
            raise LLMUnavailableError(
                f"LLM provider rejected the request ({status}): {response.text[:300]}"
            )
        if status == 429 or status >= 500:
            if attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt)
                print(f"[LLM] Error {status}. Retrying in {delay}s ({attempt + 1}/{max_retries})...")
                time.sleep(delay)
                continue
        if status >= 400:
            raise RuntimeError(f"LLM HTTP {status}: {response.text[:500]}")

        try:
            data = response.json()
            return data["choices"][0]["message"]["content"] or ""
        except (ValueError, KeyError, IndexError):
            raise RuntimeError(f"Unexpected LLM response format: {response.text[:500]}")

    raise RuntimeError("LLM request failed after retries.")
