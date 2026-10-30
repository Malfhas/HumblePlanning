import { io, type Socket } from "socket.io-client";

export const SOCKET_ENABLED = true;

// In dev, we target port 3001 directly, where `bun server.ts` runs,
// whatever the hostname (localhost OR a LAN IP like 192.168.x.x).
// In production, we always use the current origin: the reverse proxy
// (Caddy from the Docker install, or the host's own) routes
// `/socket.io/` to the Socket.io server. This also holds for an
// install on a local network or on `localhost`: port 3001 is not
// exposed there (and opening it would break the CSP).
//
// Explicit override via `NEXT_PUBLIC_SOCKET_URL` (read at build time) if the
// infra has a dedicated URL (e.g. `wss://socket.example.com`) or to test a
// production build without a reverse proxy in front (e.g. `http://localhost:3001`).
const isDev = process.env.NODE_ENV !== "production";

const envSocketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
const SOCKET_URL = typeof window !== "undefined"
  ? (envSocketUrl
      ? envSocketUrl
      : isDev
        ? `${window.location.protocol}//${window.location.hostname}:3001`
        : window.location.origin)
  : "http://localhost:3001";

// Prevent multiple socket instances during Next.js hot-reload in dev
const globalForSocket = globalThis as unknown as {
  _socket: Socket | undefined;
};

export const socket: Socket = globalForSocket._socket ?? io(SOCKET_URL, {
  autoConnect: false,
  transports: ["websocket", "polling"],
  withCredentials: true,
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
  timeout: 20000,
});

if (process.env.NODE_ENV !== "production") {
  globalForSocket._socket = socket;
}
