import os
import requests
import time
from dotenv import load_dotenv

load_dotenv()

def generate_text(prompt: str) -> str:
    """
    Calls a HuggingFace Inference API model using the provided prompt.
    Uses the OpenAI-compatible chat completions endpoint at router.huggingface.co/v1.
    """

    # 1. Get API token
    api_token = os.environ.get("HUGGINGFACEHUB_API_TOKEN")
    if not api_token:
        raise ValueError(
            "Error: HUGGINGFACEHUB_API_TOKEN environment variable is not set in .env or system."
        )

    # 2. Define API URL (OpenAI-compatible endpoint on HuggingFace)
    model = os.environ.get("LLM_MODEL", "openai/gpt-oss-120b")
    api_url = "https://router.huggingface.co/v1/chat/completions"

    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json",
    }

    # 3. Build the chat-completions payload
    payload = {
        "model": model,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "max_tokens": 2048,
    }

    # 4. Send request using requests library (with retries and backoff)
    max_retries = 3
    base_delay = 2.0  # seconds
    timeout = int(os.environ.get("LLM_TIMEOUT", "60"))

    for attempt in range(max_retries):
        try:
            response = requests.post(api_url, headers=headers, json=payload, timeout=timeout)
            response.raise_for_status() 
            data = response.json()
            return data["choices"][0]["message"]["content"]
        except requests.exceptions.HTTPError as errh:
            status_code = response.status_code if 'response' in locals() and response is not None else 500
            if (status_code == 429 or status_code >= 500) and attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt)
                print(f"[LLM] Error {status_code}. Retrying in {delay}s (attempt {attempt + 1}/{max_retries})...")
                time.sleep(delay)
                continue
            raise RuntimeError(f"HTTP Error: {errh} - Details: {response.text if 'response' in locals() and response is not None else 'No response context'}")
        except requests.exceptions.RequestException as err:
            if attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt)
                print(f"[LLM] Network error: {err}. Retrying in {delay}s (attempt {attempt + 1}/{max_retries})...")
                time.sleep(delay)
                continue
            raise RuntimeError(f"Request Error: {err}")
        except (KeyError, IndexError) as err:
            raise RuntimeError(f"Unexpected response format: {data}")
