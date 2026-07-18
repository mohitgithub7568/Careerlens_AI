"""
Text-to-Speech (TTS) — Synthesizes spoken audio from text.

Uses HuggingFace Inference API with microsoft/speecht5_tts.
"""

import logging
import os
import requests
from typing import Optional

logger = logging.getLogger("CareerLens.Voice.TTS")

TTS_MODEL = "microsoft/speecht5_tts"


def synthesize_speech_hf(text: str) -> bytes:
    """
    Synthesize speech using HuggingFace Inference API.

    Args:
        text: Text to convert to speech.

    Returns:
        Audio bytes (FLAC or WAV format from HF API).
    """
    api_token = os.environ.get("HUGGINGFACEHUB_API_TOKEN", "")
    if not api_token:
        raise ValueError("HUGGINGFACEHUB_API_TOKEN not set for TTS.")

    url = f"https://api-inference.huggingface.co/models/{TTS_MODEL}"
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json"
    }
    payload = {"inputs": text[:500]}  # Limit input length

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)
        response.raise_for_status()
        audio_bytes = response.content
        logger.info(f"[TTS] Synthesized {len(audio_bytes)} bytes for text: '{text[:50]}...'")
        return audio_bytes
    except Exception as e:
        logger.error(f"[TTS] HF TTS failed: {e}")
        raise RuntimeError(f"TTS synthesis failed: {str(e)}")


def synthesize_speech(text: str) -> bytes:
    """
    Main entry point for text-to-speech synthesis.

    Args:
        text: Text to synthesize.

    Returns:
        Audio bytes.
    """
    if not text or not text.strip():
        return b""

    # Clean text for TTS (remove markdown, special chars)
    clean_text = text.replace("*", "").replace("#", "").replace("`", "").strip()
    clean_text = " ".join(clean_text.split())  # Normalize whitespace

    try:
        return synthesize_speech_hf(clean_text)
    except Exception as e:
        logger.error(f"[TTS] Synthesis failed: {e}")
        raise
