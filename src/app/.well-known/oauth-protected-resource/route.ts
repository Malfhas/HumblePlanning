import { NextResponse } from "next/server";
import { buildProtectedResourceMetadata, OAUTH_CORS_HEADERS } from "@/lib/services/mcp-oauth-service";

// Metadata of the protected resource `/api/mcp` (RFC 9728). Served at the
// root AND at `/.well-known/oauth-protected-resource/api/mcp` (path-suffixed
// variant, probed first by MCP clients).
export async function GET() {
  return NextResponse.json(await buildProtectedResourceMetadata(), {
    headers: { ...OAUTH_CORS_HEADERS, "Cache-Control": "public, max-age=300" },
  });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: OAUTH_CORS_HEADERS });
}
