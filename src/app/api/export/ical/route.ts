import { NextRequest } from "next/server";
import icalGenerator from "ical-generator";
import { db } from "@/db";
import { users, tasks, taskUsers } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { requireAuth, handleApiError, AppError } from "@/lib/utils/api";
import { getConfigValue } from "@/lib/services/config-service";
import { resolveRecipientLocale, resolveRequestLocale } from "@/i18n/resolve-locale";
import { getServerTranslator } from "@/i18n/server-translator";
import type { AppLocale } from "@/i18n/config";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const token = params.get("token");

    let userId: string;
    let locale: AppLocale;

    if (token) {
      // Public access by token (calendar subscription, no cookie; only exception
      // in `src/proxy.ts`: GET /api/export/ical?token=…): the route verifies the token
      // itself. Malformed token: rejected before the query (the column is a UUID,
      // the cast would fail with a 500). Equality lookup in the DB (random UUID v4
      // token, 122 bits); deactivated account: same refusal as an unknown token.
      const user = UUID_RE.test(token)
        ? await db.query.users.findFirst({
            where: eq(users.icalToken, token),
            columns: { id: true, locale: true, active: true },
          })
        : undefined;
      if (!user || user.active === false) {
        throw new AppError("exportFiles.errors.invalidToken", { status: 401 });
      }
      userId = user.id;
      locale = await resolveRecipientLocale(user.locale);
    } else {
      // Authenticated access: request language.
      const session = await requireAuth();
      userId = session.user.id;
      locale = await resolveRequestLocale();
    }
    const t = await getServerTranslator(locale);
    const untitled = t("exportFiles.ical.untitled");

    // Get user's tasks
    const userTaskRows = await db.select({ taskId: taskUsers.taskId })
      .from(taskUsers)
      .where(eq(taskUsers.userId, userId));

    const taskIds = userTaskRows.map(r => r.taskId);

    const userTasks = taskIds.length > 0
      ? await db.query.tasks.findMany({
          where: inArray(tasks.id, taskIds),
          with: { project: true, place: true },
        })
      : [];

    const timezone = await getConfigValue("TIMEZONE") || "Europe/Paris";
    const appTitle = await getConfigValue("APP_TITLE") || "HumblePlanning";

    const calendar = icalGenerator({
      name: appTitle,
      timezone,
      prodId: { company: "HumblePlanning", product: "HumblePlanning", language: locale.toUpperCase() },
    });

    for (const task of userTasks) {
      const isAllDay = !task.startTime || !task.endTime;

      if (isAllDay) {
        // All-day event
        const start = new Date(task.startDate);
        const end = task.endDate ? new Date(task.endDate) : new Date(task.startDate);
        // iCal all-day end date is exclusive, so add 1 day
        end.setDate(end.getDate() + 1);

        calendar.createEvent({
          start,
          end,
          allDay: true,
          summary: task.title || untitled,
          description: task.notes || undefined,
          location: task.place?.name || undefined,
          categories: task.project ? [{ name: task.project.name }] : undefined,
          url: task.link || undefined,
        });
      } else {
        // Timed event
        const startDateTime = new Date(`${task.startDate}T${task.startTime}`);
        const endDate = task.endDate || task.startDate;
        const endDateTime = new Date(`${endDate}T${task.endTime}`);

        calendar.createEvent({
          start: startDateTime,
          end: endDateTime,
          timezone,
          summary: task.title || untitled,
          description: task.notes || undefined,
          location: task.place?.name || undefined,
          categories: task.project ? [{ name: task.project.name }] : undefined,
          url: task.link || undefined,
        });
      }
    }

    return new Response(calendar.toString(), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="planning.ics"',
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// POST: Generate/regenerate iCal token for current user
export async function POST() {
  try {
    const session = await requireAuth();
    const newToken = crypto.randomUUID();

    await db.update(users)
      .set({ icalToken: newToken })
      .where(eq(users.id, session.user.id));

    return Response.json({ token: newToken });
  } catch (error) {
    return handleApiError(error);
  }
}
