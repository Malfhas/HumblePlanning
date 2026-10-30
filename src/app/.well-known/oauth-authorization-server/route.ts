import { NextResponse } from "next/server";
import { buildAuthorizationServerMetadata, OAUTH_CORS_HEADERS } from "@/lib/services/mcp-oauth-service";

// Authorization server metadata (RFC 8414). The issuer is the instance origin
// (no path): clients therefore probe this URL at the root.
export async function GET() {
  return NextResponse.json(await buildAuthorizationServerMetadata(), {
    headers: { ...OAUTH_CORS_HEADERS, "Cache-Control": "public, max-age=300" },
  });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: OAUTH_CORS_HEADERS });
}
