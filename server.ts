import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server as SocketServer } from "socket.io";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { pgTable, uuid, text, varchar, timestamp, boolean, jsonb, decimal } from "drizzle-orm/pg-core";

// --- Inline schema (no @/ aliases in standalone Bun script) ---
const sessions = pgTable("session", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull(),
  firstName: varchar("first_name", { length: 100 }),
  color: varchar("color", { length: 7 }).default("#FFFFFF"),
  image: text("image"),
});

// --- Database connection ---
// drizzle-orm 0.45 + Bun runtime: `drizzle(url)` crashes with
// `TypeError: undefined is not an object (evaluating 'client.options')`
// because the postgres-js driver expects an already instantiated client, not a URL.
// So we explicitly instantiate the postgres-js client first.
const pgClient = postgres(process.env.DATABASE_URL!);
const db = drizzle(pgClient);

// --- Presence ---
type PresenceUser = {
  userId: string;
  name: string;
  color: string;
  image: string | null;
  lastActivity: number;
};

const presenceMap = new Map<string, PresenceUser>();
const PRESENCE_TIMEOUT = 5 * 60 * 1000;
const CLEANUP_INTERVAL = 30_000;

// --- Cookie parser ---
function parseCookie(cookieStr: string, name: string): string | undefined {
  const match = cookieStr.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

// --- HTTP server (handles /emit endpoint for API routes) ---
const port = parseInt(process.env.SOCKET_PORT || "3001", 10);
const corsOrigin = process.env.APP_BASE_URL || "http://localhost:3000";

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  // Internal emit endpoint
  if (req.method === "POST" && req.url === "/emit") {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.SOCKET_SECRET || "humbleplanning-internal"}`) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const event = JSON.parse(body);
        const channel = event.channel || "task:changed";

        // Targeted event: emit only to sockets of a specific user (single)
        // or to a set of users (targeted broadcast in 1 round-trip). Targeting via
        // the `user:<id>` room (joined on connection) and not via the presence
        // map: the latter is purged after 5 min of inactivity, and a background
        // tab no longer received anything (end of an AI chat reply,
        // notification, session revocation).
        if (event.targetUserId) {
          io.to(`user:${event.targetUserId}`).emit(channel, event);
        } else if (Array.isArray(event.targetUserIds) && event.targetUserIds.length > 0) {
          io.to(event.targetUserIds.map((id: string) => `user:${id}`)).emit(channel, event);
        } else {
          io.emit(channel, event);
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      } catch {
        res.writeHead(400);
        res.end("Bad request");
      }
    });
    return;
  }

  // Health check (public, CORS enabled for settings page)
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": corsOrigin,
    });
    res.end(JSON.stringify({
      status: "ok",
      uptime: Math.floor(process.uptime()),
      clients: io.engine.clientsCount,
      connections: presenceMap.size,
    }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// --- Socket.io ---
const io = new SocketServer(httpServer, {
  cors: { origin: corsOrigin, credentials: true },
  transports: ["websocket", "polling"],
});

function broadcastPresence() {
  const seen = new Map<string, PresenceUser>();
  for (const entry of presenceMap.values()) {
    const existing = seen.get(entry.userId);
    if (!existing || entry.lastActivity > existing.lastActivity) {
      seen.set(entry.userId, entry);
    }
  }
  io.emit("presence:update", Array.from(seen.values()));
}

// Auth middleware
io.use(async (socket, next) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie ?? "";
    // Better Auth prefixes the cookie with "__Secure-" over HTTPS (prod).
    // We try the secure name first, then the HTTP fallback (dev).
    const token =
      parseCookie(cookieHeader, "__Secure-better-auth.session_token") ??
      parseCookie(cookieHeader, "better-auth.session_token");
    if (!token) return next(new Error("Not authenticated"));

    const cleanToken = token.split(".")[0];

    const [session] = await db
      .select({ userId: sessions.userId, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.token, cleanToken))
      .limit(1);

    if (!session) return next(new Error("Invalid session"));
    if (new Date(session.expiresAt) < new Date()) return next(new Error("Session expired"));

    const [user] = await db
      .select({ id: users.id, name: users.name, firstName: users.firstName, color: users.color, image: users.image })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user) return next(new Error("User not found"));

    // Build display name "FirstName LastName" and avatar URL
    const displayName = [user.firstName, user.name].filter(Boolean).join(" ");
    const avatarUrl = user.image ? `/api/avatars/${user.image.replace("avatars/", "")}` : null;
    socket.data.user = { ...user, displayName, avatarUrl };
    next();
  } catch {
    next(new Error("Authentication error"));
  }
});

io.on("connection", (socket) => {
  const user = socket.data.user;
  console.log(`[Socket.io] ${user.displayName} connected (${socket.id})`);
  // Personal room: all of the user's connections, regardless of presence
  socket.join(`user:${user.id}`);

  presenceMap.set(socket.id, {
    userId: user.id,
    name: user.displayName,
    color: user.color ?? "#FFFFFF",
    image: user.avatarUrl,
    lastActivity: Date.now(),
  });
  broadcastPresence();

  // Send current presence list to the newly connected socket
  socket.on("presence:request", () => {
    const seen = new Map<string, PresenceUser>();
    for (const entry of presenceMap.values()) {
      const existing = seen.get(entry.userId);
      if (!existing || entry.lastActivity > existing.lastActivity) {
        seen.set(entry.userId, entry);
      }
    }
    socket.emit("presence:update", Array.from(seen.values()));
  });

  socket.on("presence:heartbeat", () => {
    const entry = presenceMap.get(socket.id);
    if (entry) {
      entry.lastActivity = Date.now();
      return;
    }
    // The entry was removed by the inactivity cleanup (>5 min without a
    // heartbeat, typically a background tab). We re-insert it
    // from `socket.data.user` (filled on connect by the auth
    // middleware) and broadcast so the avatar reappears for
    // every other connected client.
    const u = socket.data.user;
    if (!u) return; // unauthenticated socket, should never happen
    presenceMap.set(socket.id, {
      userId: u.id,
      name: u.displayName,
      color: u.color ?? "#FFFFFF",
      image: u.avatarUrl,
      lastActivity: Date.now(),
    });
    broadcastPresence();
  });

  socket.on("disconnect", () => {
    console.log(`[Socket.io] ${user.name} disconnected (${socket.id})`);
    presenceMap.delete(socket.id);
    broadcastPresence();
  });
});

// Cleanup inactive
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [socketId, entry] of presenceMap) {
    if (now - entry.lastActivity > PRESENCE_TIMEOUT) {
      presenceMap.delete(socketId);
      changed = true;
    }
  }
  if (changed) broadcastPresence();
}, CLEANUP_INTERVAL);

// --- Start ---
httpServer.listen(port, () => {
  console.log(`[Socket.io] Server ready on http://localhost:${port}`);
});

// Graceful shutdown
function shutdown() {
  console.log("[Socket.io] Shutting down gracefully...");
  io.disconnectSockets(true);
  httpServer.close(() => {
    console.log("[Socket.io] Server closed");
    process.exit(0);
  });
  // Force exit after 10s if graceful shutdown fails
  setTimeout(() => {
    console.error("[Socket.io] Forced exit after timeout");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
