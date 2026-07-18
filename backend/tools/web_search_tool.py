"""
Web Search Tool — DuckDuckGo Instant Answer API

Provides free web search capability for agents.
No API key required.
"""

import logging
import requests
from typing import Optional

logger = logging.getLogger("CareerLens.Tools.WebSearch")

DDG_API_URL = "https://api.duckduckgo.com/"
DEFAULT_TIMEOUT = 8

# DuckDuckGo HTML search fallback (using simple html extraction) for general queries
DDG_HTML_URL = "https://html.duckduckgo.com/html/"

TOOL_SCHEMA = {
    "name": "web_search",
    "description": "Search the web for information about a topic, technology, or skill. Use this to get up-to-date context about a technology, framework, or industry trend mentioned in the resume.",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query string"
            },
            "max_results": {
                "type": "integer",
                "description": "Max number of results to return (default: 3)",
                "default": 3
            }
        },
        "required": ["query"]
    }
}


def web_search(query: str, max_results: int = 3) -> dict:
    """
    Search DuckDuckGo for a query and return top result snippets.

    Args:
        query: Search query string.
        max_results: Number of results to return.

    Returns:
        Dict with 'results' list of {title, snippet, url} dicts.
    """
    if not query or not query.strip():
        return {"error": "Query is empty", "results": []}

    try:
        params = {
            "q": query,
            "format": "json",
            "no_redirect": "1",
            "no_html": "1",
            "skip_disambig": "1",
        }
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
        resp = requests.get(DDG_API_URL, params=params, headers=headers, timeout=DEFAULT_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()

        results = []

        # Abstract (best single answer)
        if data.get("AbstractText"):
            results.append({
                "title": data.get("Heading", query),
                "snippet": data["AbstractText"][:500],
                "url": data.get("AbstractURL", ""),
                "source": data.get("AbstractSource", ""),
            })

        # Related topics
        for topic in data.get("RelatedTopics", [])[:max_results - len(results)]:
            if isinstance(topic, dict) and topic.get("Text"):
                results.append({
                    "title": topic.get("Text", "")[:80],
                    "snippet": topic.get("Text", "")[:500],
                    "url": topic.get("FirstURL", ""),
                    "source": "DuckDuckGo",
                })

        if not results:
            # Fallback direct search link if no instant answer
            results.append({
                "title": f"Search: {query}",
                "snippet": f"No instant answers found for '{query}'. Please see search results directly at the URL.",
                "url": f"https://duckduckgo.com/?q={requests.utils.quote(query)}",
                "source": "DuckDuckGo",
            })

        logger.info(f"[WebSearch] Query: '{query[:50]}' → {len(results)} results.")
        return {"query": query, "results": results[:max_results]}

    except requests.exceptions.Timeout:
        return {"error": "Web search timed out.", "results": []}
    except Exception as e:
        logger.error(f"[WebSearch] Failed: {e}")
        return {"error": str(e), "results": []}
