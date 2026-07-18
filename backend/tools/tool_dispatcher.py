"""
Tool Dispatcher — Central registry and dispatcher for agent tools.

Agents can query available tools, and the dispatcher handles
execution and result formatting.
"""

import logging
import json
import re
from typing import Any, Optional

from tools.github_tool import get_github_projects, get_github_readme, TOOL_SCHEMA as GITHUB_SCHEMA
from tools.leetcode_tool import get_leetcode_stats, TOOL_SCHEMA as LEETCODE_SCHEMA
from tools.web_search_tool import web_search, TOOL_SCHEMA as WEBSEARCH_SCHEMA

logger = logging.getLogger("CareerLens.Tools.Dispatcher")


# ──────────────────────────────────────────────
# Tool Registry
# ──────────────────────────────────────────────

TOOL_REGISTRY: dict[str, dict] = {
    "get_github_projects": {
        "fn": get_github_projects,
        "schema": GITHUB_SCHEMA,
    },
    "get_github_readme": {
        "fn": get_github_readme,
        "schema": {
            "name": "get_github_readme",
            "description": "Fetch the README of a specific GitHub repository.",
            "parameters": {
                "type": "object",
                "properties": {
                    "owner": {"type": "string", "description": "Repository owner"},
                    "repo": {"type": "string", "description": "Repository name"},
                },
                "required": ["owner", "repo"]
            }
        },
    },
    "get_leetcode_stats": {
        "fn": get_leetcode_stats,
        "schema": LEETCODE_SCHEMA,
    },
    "web_search": {
        "fn": web_search,
        "schema": WEBSEARCH_SCHEMA,
    },
}


def list_tools() -> list[dict]:
    """Return all tool schemas for display or LLM binding."""
    return [entry["schema"] for entry in TOOL_REGISTRY.values()]


def dispatch_tool(tool_name: str, params: dict) -> dict:
    """
    Execute a registered tool by name with given parameters.

    Args:
        tool_name: Name of the tool to call.
        params: Parameter dict matching the tool's schema.

    Returns:
        Tool result dict, or error dict on failure.
    """
    if tool_name not in TOOL_REGISTRY:
        logger.warning(f"[Dispatcher] Unknown tool: '{tool_name}'")
        return {"error": f"Tool '{tool_name}' not found. Available tools: {list(TOOL_REGISTRY.keys())}"}

    try:
        fn = TOOL_REGISTRY[tool_name]["fn"]
        logger.info(f"[Dispatcher] Dispatching tool: '{tool_name}' with params: {params}")
        result = fn(**params)
        logger.info(f"[Dispatcher] Tool '{tool_name}' completed.")
        return result
    except TypeError as e:
        logger.error(f"[Dispatcher] Invalid params for '{tool_name}': {e}")
        return {"error": f"Invalid parameters for tool '{tool_name}': {str(e)}"}
    except Exception as e:
        logger.error(f"[Dispatcher] Tool '{tool_name}' failed: {e}")
        return {"error": f"Tool execution failed: {str(e)}"}


def extract_tool_calls(llm_response: str) -> list[dict]:
    """
    Parse any structured tool-call JSON blocks from an LLM response.

    Supports two formats:
    1. JSON block: {"tool_call": {"name": "...", "params": {...}}}
    2. Function-call style: {"function": "name", "arguments": {...}}

    Args:
        llm_response: Raw LLM output string.

    Returns:
        List of {"name": str, "params": dict} dicts.
    """
    tool_calls = []

    # Try to find JSON blocks in the response
    json_pattern = re.compile(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', re.DOTALL)
    matches = json_pattern.findall(llm_response)

    for match in matches:
        try:
            obj = json.loads(match)

            # Format 1: {"tool_call": {"name": ..., "params": ...}}
            if "tool_call" in obj:
                tc = obj["tool_call"]
                name = tc.get("name") or tc.get("function")
                params = tc.get("params") or tc.get("arguments", {})
                if name and name in TOOL_REGISTRY:
                    tool_calls.append({"name": name, "params": params})

            # Format 2: {"function": ..., "arguments": ...}
            elif "function" in obj and "arguments" in obj:
                name = obj["function"]
                params = obj["arguments"] if isinstance(obj["arguments"], dict) else {}
                if name in TOOL_REGISTRY:
                    tool_calls.append({"name": name, "params": params})

        except (json.JSONDecodeError, KeyError):
            continue

    logger.info(f"[Dispatcher] Extracted {len(tool_calls)} tool call(s) from LLM response.")
    return tool_calls


def format_tool_result_for_prompt(tool_name: str, result: dict) -> str:
    """
    Format a tool result into a human-readable string for LLM context.

    Args:
        tool_name: Name of the tool that was called.
        result: The tool's result dict.

    Returns:
        Formatted string to prepend to LLM prompt.
    """
    lines = [f"--- Tool Result: {tool_name} ---"]

    if "error" in result:
        lines.append(f"Error: {result['error']}")
    else:
        lines.append(json.dumps(result, indent=2)[:1500])  # Truncate large results

    lines.append("-" * 30)
    return "\n".join(lines)
