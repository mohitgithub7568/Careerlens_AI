"""
LeetCode Tool — Fetch public problem-solving stats for a candidate.

Uses the unofficial LeetCode public GraphQL endpoint.
No authentication required for public profile data.
"""

import logging
import requests
from typing import Optional

logger = logging.getLogger("CareerLens.Tools.LeetCode")

LEETCODE_API_URL = "https://leetcode.com/graphql"
DEFAULT_TIMEOUT = 10

TOOL_SCHEMA = {
    "name": "get_leetcode_stats",
    "description": "Fetch LeetCode problem-solving statistics for a candidate by username. Use this when the resume mentions LeetCode or competitive programming.",
    "parameters": {
        "type": "object",
        "properties": {
            "username": {
                "type": "string",
                "description": "The LeetCode username"
            }
        },
        "required": ["username"]
    }
}


def get_leetcode_stats(username: str) -> dict:
    """
    Fetch public LeetCode statistics for a given username.

    Args:
        username: LeetCode username.

    Returns:
        Dict with problem counts by difficulty, or error.
    """
    username = username.strip()
    if not username:
        return {"error": "Username is empty"}

    query = """
    query getUserStats($username: String!) {
      matchedUser(username: $username) {
        username
        profile {
          realName
          ranking
        }
        submitStats {
          acSubmissionNum {
            difficulty
            count
            submissions
          }
        }
      }
    }
    """

    try:
        headers = {
            "Content-Type": "application/json",
            "Referer": "https://leetcode.com",
            "User-Agent": "Mozilla/5.0",
        }
        payload = {"query": query, "variables": {"username": username}}
        resp = requests.post(LEETCODE_API_URL, json=payload, headers=headers, timeout=DEFAULT_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()

        user_data = data.get("data", {}).get("matchedUser")
        if not user_data:
            return {"error": f"LeetCode user '{username}' not found or profile is private."}

        submit_stats = user_data.get("submitStats", {}).get("acSubmissionNum", [])
        stats_by_diff = {}
        for entry in submit_stats:
            diff = entry.get("difficulty", "Unknown")
            stats_by_diff[diff.lower()] = {
                "solved": entry.get("count", 0),
                "submissions": entry.get("submissions", 0),
            }

        result = {
            "username": username,
            "real_name": user_data.get("profile", {}).get("realName") or username,
            "ranking": user_data.get("profile", {}).get("ranking", 0),
            "stats": stats_by_diff,
            "total_solved": stats_by_diff.get("all", {}).get("solved", 0),
        }

        logger.info(f"[LeetCode] Fetched stats for '{username}': {result['total_solved']} solved.")
        return result

    except requests.exceptions.Timeout:
        return {"error": "LeetCode API request timed out."}
    except requests.exceptions.RequestException as e:
        logger.error(f"[LeetCode] Request failed: {e}")
        return {"error": f"LeetCode API error: {str(e)}"}
