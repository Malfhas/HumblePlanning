import { NextResponse } from "next/server";

/**
 * Proxies the /health of the standalone Socket.io server (port 3001) through Next.js.
 *
 * Why: in prod, the client cannot request `https://domain:3001/health`
 *   - CSP block (different origin)
 *   - Firewall does not let 3001 through externally (only Nginx reaches it on 127.0.0.1)
 *
 * This route runs on the Next.js side (port 3000), connects to the socket server
 * on localhost:3001, and returns its response.
 */
export async function GET() {
  const socketUrl = process.env.SOCKET_URL || "http://localhost:3001";
  try {
    const res = await fetch(`${socketUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Socket server returned HTTP ${res.status}` },
        { status: 502 }
      );
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Socket server unreachable" },
      { status: 503 }
    );
  }
}
