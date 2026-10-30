import { socket } from "@/lib/socket-client";

/**
 * Subscription to a real-time message addressed to the user (`chat:reply`,
 * `chat:conversation`). Returns the unsubscribe function, to return from the
 * effect cleanup. The shared socket is connected by the session guard
 * (`useSocket`): the chat does not call it, it only subscribes to it, and keeps
 * a database re-read fallback while following a reply.
 */
export function listen<T>(event: string, handler: (payload: T) => void): () => void {
  socket.on(event, handler);
  return () => {
    socket.off(event, handler);
  };
}
