/**
 * Health of the standalone Socket.io server (port 3001), read from the
 * Next.js side: in production the browser cannot reach port 3001 itself
 * (other origin for the CSP, port closed by the firewall). Used by
 * GET /api/socket-health and by System health.
 */
export type SocketHealth =
  | { ok: true; data: { status?: string; uptime?: number; clients?: number; connections?: number } }
  | { ok: false; status: 502 | 503; error: string };

export async function fetchSocketHealth(): Promise<SocketHealth> {
  const socketUrl = process.env.SOCKET_URL || "http://localhost:3001";
  try {
    const res = await fetch(`${socketUrl}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, status: 502, error: `Socket server returned HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, status: 503, error: err instanceof Error ? err.message : "Socket server unreachable" };
  }
}
