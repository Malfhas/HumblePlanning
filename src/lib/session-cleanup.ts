/**
 * Clears all client-side session artifacts so the next sign-in starts from a
 * clean slate. Covers:
 *   - localStorage: Zustand persist stores ("bu-selector", "planning-filters",
 *     "home-preferences"), direct keys ("humble-planning-*", "announcement_dismissed")
 *   - sessionStorage: any transient state
 *
 * Why a nuke-and-pave approach: enumerating every key is brittle (we'd miss
 * future stores). The app does not store anything else on the same domain,
 * so clearing everything is safe and future-proof. If any third-party key
 * ever needs to survive, add it to the preservation list below.
 */
const PRESERVED_KEYS: readonly string[] = [];

export function clearLocalSession(): void {
  if (typeof window === "undefined") return;

  try {
    const preserved = new Map<string, string>();
    for (const key of PRESERVED_KEYS) {
      const value = localStorage.getItem(key);
      if (value !== null) preserved.set(key, value);
    }
    localStorage.clear();
    for (const [key, value] of preserved) {
      localStorage.setItem(key, value);
    }
  } catch {
    // localStorage may be unavailable (e.g. privacy mode) — best effort
  }

  try {
    sessionStorage.clear();
  } catch {
    // ignore
  }
}

/**
 * Temporarily suspends the automatic redirect to /login triggered by a 401
 * (see `handleGlobalError` in QueryProvider).
 *
 * Why: the SoPlanning migration purges every server-side session. Without
 * this suspension, the next background request (polling, refetch) returns
 * 401 and redirects the admin before they could write down the new
 * credentials. The redirect is done manually via "Finish migration", which
 * fully reloads the page (the flag goes back to false).
 */
let authRedirectSuspended = false;

export function suspendAuthRedirect(): void {
  authRedirectSuspended = true;
}

export function resumeAuthRedirect(): void {
  authRedirectSuspended = false;
}

export function isAuthRedirectSuspended(): boolean {
  return authRedirectSuspended;
}
