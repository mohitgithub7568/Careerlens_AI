"""
MCP Tool Schemas — Pydantic models for MCP tool inputs and outputs.

These define the contract for each callable tool exposed via the MCP server.
"""

from pydantic import BaseModel, Field
from typing import Optional, Any


class MCPToolInvokeRequest(BaseModel):
    """Request body for POST /mcp/invoke"""
    tool: str = Field(..., description="Tool name to invoke")
    params: dict[str, Any] = Field(default_factory=dict, description="Tool parameters")


class MCPToolInvokeResponse(BaseModel):
    """Response body for POST /mcp/invoke"""
    tool: str
    result: dict[str, Any]
    success: bool
    error: Optional[str] = None


class MCPToolSchema(BaseModel):
    """Schema definition for a single MCP tool"""
    name: str
    description: str
    parameters: dict[str, Any]


class MCPToolsListResponse(BaseModel):
    """Response for GET /mcp/tools"""
    tools: list[MCPToolSchema]
    count: int
    server: str = "CareerLens AI MCP Server v1.0"
