import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { loadUserPermissions, hasPermission } from "@/lib/services/permission-service";

const PAGE_PERM_MAP: Record<string, string> = {
  "/planning": "pages:planning",
  "/home": "pages:home",
  "/tasks": "pages:tasks",
};

/**
 * Root page (/) — server-side redirect to the user's preferred home page,
 * with permission-aware fallback.
 */
export default async function RootPage() {
  let preferred = "/home";

  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session?.user?.id) {
      // Load user preferences
      const user = await db.query.users.findFirst({
        where: eq(users.id, session.user.id),
        columns: { preferences: true },
      });
      const prefs = (user?.preferences ?? {}) as Record<string, string>;
      preferred = prefs.defaultHomePage || "/planning";

      // Verify permission for the preferred page
      const perms = await loadUserPermissions(session.user.id);
      const perm = PAGE_PERM_MAP[preferred];
      if (perm && !hasPermission(perms, perm)) {
        // Fallback chain: /home → /planning → /tasks → /home
        if (hasPermission(perms, "pages:home")) preferred = "/home";
        else if (hasPermission(perms, "pages:planning")) preferred = "/planning";
        else if (hasPermission(perms, "pages:tasks")) preferred = "/tasks";
        else preferred = "/home";
      }
    }
  } catch {
    // If anything fails (no session, DB error), fall back to /home
    // The middleware will redirect to /login if not authenticated.
  }

  redirect(preferred);
}
