export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackupScheduler } = await import("@/lib/services/backup-service");
    startBackupScheduler();

    const { startWeeklySummaryScheduler } = await import("@/lib/services/weekly-summary-scheduler");
    startWeeklySummaryScheduler();

    // Ensure the Super Administrateur role always exists (first deploy +
    // recovery after DB imports / SoPlanning migrations). Fire-and-forget:
    // ensureSuperAdminRole() swallows its own errors and logs them.
    const { ensureSuperAdminRole } = await import("@/lib/services/role-service");
    ensureSuperAdminRole();

    // AI chat: a reply left "in progress" by a previous process
    // (restart, crash) is marked interrupted before any request.
    const { markStaleAiChatRepliesInterrupted } = await import("@/lib/ai-chat/chat-service");
    void markStaleAiChatRepliesInterrupted();

    // Demo instance (DEMO_MODE=true): data reset at start and every night
    const { startDemoScheduler } = await import("@/lib/demo/scheduler");
    startDemoScheduler();
  }
}
