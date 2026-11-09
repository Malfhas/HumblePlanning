import { NextResponse } from "next/server";
import { fetchSocketHealth } from "@/lib/services/socket-health";

/** Proxies the /health of the standalone Socket.io server (see socket-health.ts). */
export async function GET() {
  const health = await fetchSocketHealth();
  return health.ok
    ? NextResponse.json(health.data)
    : NextResponse.json({ error: health.error }, { status: health.status });
}
