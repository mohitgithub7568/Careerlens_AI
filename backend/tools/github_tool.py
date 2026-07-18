"""
GitHub Tool — Fetches public repository data for a candidate.

Uses the GitHub public REST API (no authentication required for public repos).
Rate limit: 60 requests/hour unauthenticated.
"""

import logging
import requests
from typing import Optional

logger = logging.getLogger("CareerLens.Tools.GitHub")

GITHUB_API_BASE = "https://api.github.com"
DEFAULT_TIMEOUT = 8  # seconds

TOOL_SCHEMA = {
    "name": "get_github_projects",
    "description": "Fetch public GitHub repositories for a candidate by username. Use this when the resume mentions a GitHub profile or username.",
    "parameters": {
        "type": "object",
        "properties": {
            "username": {
                "type": "string",
                "description": "The GitHub username (e.g., 'torvalds', 'octocat')"
            },
            "limit": {
                "type": "integer",
                "description": "Maximum number of repos to return (default: 5)",
                "default": 5
            }
        },
        "required": ["username"]
    }
}


def get_github_projects(username: str, limit: int = 5) -> dict:
    """
    Fetch the top public repositories for a GitHub user.

    Args:
        username: GitHub username.
        limit: Max number of repos to return.

    Returns:
        Dict with 'repos' list and 'profile' info, or 'error' on failure.
    """
    username = username.strip().lstrip("@")
    if not username:
        return {"error": "Username is empty"}

    try:
        # Fetch user profile
        profile_url = f"{GITHUB_API_BASE}/users/{username}"
        profile_resp = requests.get(profile_url, timeout=DEFAULT_TIMEOUT)

        if profile_resp.status_code == 404:
            return {"error": f"GitHub user '{username}' not found."}
        profile_resp.raise_for_status()
        profile_data = profile_resp.json()

        # Fetch repos sorted by stars
        repos_url = f"{GITHUB_API_BASE}/users/{username}/repos"
        repos_resp = requests.get(
            repos_url,
            params={"sort": "stars", "direction": "desc", "per_page": limit},
            timeout=DEFAULT_TIMEOUT
        )
        repos_resp.raise_for_status()
        repos_data = repos_resp.json()

        repos = []
        for repo in repos_data[:limit]:
            repos.append({
                "name": repo.get("name", ""),
                "description": repo.get("description") or "No description",
                "language": repo.get("language") or "Unknown",
                "stars": repo.get("stargazers_count", 0),
                "forks": repo.get("forks_count", 0),
                "url": repo.get("html_url", ""),
                "topics": repo.get("topics", []),
            })

        result = {
            "username": username,
            "profile": {
                "name": profile_data.get("name") or username,
                "bio": profile_data.get("bio") or "",
                "public_repos": profile_data.get("public_repos", 0),
                "followers": profile_data.get("followers", 0),
                "url": profile_data.get("html_url", ""),
            },
            "repos": repos,
            "total_fetched": len(repos),
        }

        logger.info(f"[GitHub] Fetched {len(repos)} repos for '{username}'.")
        return result

    except requests.exceptions.Timeout:
        return {"error": "GitHub API request timed out."}
    except requests.exceptions.RequestException as e:
        logger.error(f"[GitHub] Request failed: {e}")
        return {"error": f"GitHub API error: {str(e)}"}


def get_github_readme(owner: str, repo: str) -> dict:
    """
    Fetch the README content of a specific GitHub repository.

    Args:
        owner: Repository owner username.
        repo: Repository name.

    Returns:
        Dict with 'content' (plain text) or 'error'.
    """
    try:
        import base64
        url = f"{GITHUB_API_BASE}/repos/{owner}/{repo}/readme"
        resp = requests.get(url, timeout=DEFAULT_TIMEOUT)
        if resp.status_code == 404:
            return {"content": "", "error": "README not found."}
        resp.raise_for_status()
        data = resp.json()
        content_b64 = data.get("content", "")
        content = base64.b64decode(content_b64).decode("utf-8", errors="ignore")
        # Truncate to 2000 chars
        return {"content": content[:2000], "repo": f"{owner}/{repo}"}
    except Exception as e:
        return {"error": str(e), "content": ""}
