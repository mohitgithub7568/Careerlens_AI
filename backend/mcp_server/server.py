"""
MCP Server — Model Context Protocol compatible FastAPI sub-application.

Exposes CareerLens AI tools as callable endpoints following the MCP spec.
Mount this at /mcp in the main FastAPI app.

Endpoints:
    GET  /mcp/health    — Health check
    GET  /mcp/tools     — List all registered tools with schemas
    POST /mcp/invoke    — Invoke a tool by name with parameters
"""

import logging
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from mcp_server.tool_schemas import (
    MCPToolInvokeRequest,
    MCPToolInvokeResponse,
    MCPToolsListResponse,
    MCPToolSchema,
)
from tools.tool_dispatcher import dispatch_tool, list_tools

logger = logging.getLogger("CareerLens.MCP")

# ──────────────────────────────────────────────
# MCP Sub-Application
# ──────────────────────────────────────────────

mcp_app = FastAPI(
    title="CareerLens AI — MCP Server",
    description="Model Context Protocol server exposing CareerLens AI tools to agents.",
    version="1.0.0",
    docs_url="/docs",
    openapi_url="/openapi.json",
)

mcp_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@mcp_app.get("/health")
async def mcp_health():
    """Health check for the MCP server."""
    return {"status": "ok", "server": "CareerLens AI MCP v1.0"}


@mcp_app.get("/tools", response_model=MCPToolsListResponse)
async def mcp_list_tools():
    """
    List all available MCP tools with their JSON schemas.

    Returns:
        MCPToolsListResponse with list of tool schemas.
    """
    tools = list_tools()
    tool_schemas = [
        MCPToolSchema(
            name=t["name"],
            description=t["description"],
            parameters=t["parameters"]
        )
        for t in tools
    ]
    logger.info(f"[MCP] Listed {len(tool_schemas)} tools.")
    return MCPToolsListResponse(tools=tool_schemas, count=len(tool_schemas))


@mcp_app.post("/invoke", response_model=MCPToolInvokeResponse)
async def mcp_invoke_tool(request: MCPToolInvokeRequest):
    """
    Invoke a registered tool by name with provided parameters.

    Args:
        request: MCPToolInvokeRequest with tool name and params.

    Returns:
        MCPToolInvokeResponse with tool result.
    """
    logger.info(f"[MCP] Invoking tool: '{request.tool}' with params: {request.params}")

    result = dispatch_tool(request.tool, request.params)

    success = "error" not in result
    error_msg = result.get("error") if not success else None

    if not success:
        logger.warning(f"[MCP] Tool '{request.tool}' returned error: {error_msg}")

    return MCPToolInvokeResponse(
        tool=request.tool,
        result=result,
        success=success,
        error=error_msg,
    )
