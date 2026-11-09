import { NextRequest } from "next/server";
import { apiSuccess, handleApiError, requireAuth } from "@/lib/utils/api";
import { loadUserPermissions } from "@/lib/services/permission-service";
import { getConfigValues } from "@/lib/services/config-service";
import { getProfile } from "@/lib/services/profile-service";
import { getAiChatAvailability } from "@/lib/ai-chat/availability";
import { GET as getBusinessUnits } from "@/app/api/business-units/route";
import { GET as getGroups } from "@/app/api/groups/route";
import { GET as getHolidays } from "@/app/api/holidays/route";
import { GET as getPlaces } from "@/app/api/places/route";
import { GET as getProjects } from "@/app/api/projects/route";
import { GET as getResources } from "@/app/api/resources/route";
import { GET as getStatuses } from "@/app/api/statuses/route";
import { GET as getTeams } from "@/app/api/teams/route";
import { GET as getUsers } from "@/app/api/users/route";
import { GET as getVehicles } from "@/app/api/vehicles/route";

/** Settings the app needs: modules, planning display, upload limits, password policy. */
const MOBILE_CONFIG_KEYS = [
  "APP_TITLE", "APP_LOGO_LIGHT", "APP_LOGO_DARK", "TIMEZONE", "TIME_FORMAT", "PLANNING_DATE_FORMAT",
  "MODULE_PLACES", "MODULE_RESOURCES", "MODULE_VEHICLES", "MODULE_TASKS",
  "AM_START", "AM_END", "PM_START", "PM_END", "DURATION_DAY",
  "HOURS_DISPLAYED", "PLANNING_DAYS_OF_WEEK_DISPLAY",
  "PLANNING_MAX_TASKS_PER_DAY", "PLANNING_ONE_ASSIGNMENT_MAX_PER_DAY",
  "ENABLE_FILE_UPLOAD", "WHITELIST_UPLOAD", "MAX_UPLOAD_SIZE_MB", "MAX_TOTAL_SIZE_MB", "MAX_FILES_PER_TASK",
  "TWOFACTOR_REQUIRED", "NOTIFICATION_PUSH_ENABLED", "MOBILE_PUSH_ENABLED", "MOBILE_PUSH_TRIGGERS", "MAINTENANCE_MODE",
  "PWD_MIN_LENGTH", "PWD_MAX_LENGTH", "PWD_REQUIRE_UPPERCASE", "PWD_REQUIRE_LOWERCASE", "PWD_REQUIRE_DIGIT", "PWD_REQUIRE_SPECIAL",
];

/** Result of a list route called in-process: null when the role cannot read it. */
async function section(call: Promise<Response>): Promise<unknown> {
  try {
    const response = await call;
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/mobile/bootstrap: everything the app loads at start-up, in one
 * response. Each list comes from its regular route, so permissions,
 * scopes and hidden contact fields stay the ones of the web client.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    const url = (path: string) => new NextRequest(new URL(path, request.url), { headers: request.headers });

    const [user, perms, config, assistant, statuses, places, projects, users, teams, businessUnits, groups, holidays, resources, vehicles] = await Promise.all([
      getProfile(session.user.id),
      loadUserPermissions(session.user.id),
      getConfigValues(MOBILE_CONFIG_KEYS),
      getAiChatAvailability(session.user.id),
      section(getStatuses()),
      section(getPlaces()),
      section(getProjects(url("/api/projects"))),
      section(getUsers(url("/api/users?planning=true"))),
      section(getTeams()),
      section(getBusinessUnits(url("/api/business-units"))),
      section(getGroups()),
      section(getHolidays(url("/api/holidays"))),
      section(getResources(url("/api/resources"))),
      section(getVehicles(url("/api/vehicles"))),
    ]);

    // Teams embed full user rows, contact fields included: the app only needs who is in them.
    const teamList = Array.isArray(teams)
      ? (teams as { id: string; name: string; color: string | null; sortOrder: number; businessUnitId: string; users?: { id: string }[] }[])
          .map(({ users: members, ...team }) => ({ ...team, userIds: (members ?? []).map((m) => m.id) }))
      : null;

    return apiSuccess({
      serverTime: new Date().toISOString(),
      user,
      permissions: perms.permissions,
      isAdmin: perms.isAdmin,
      config,
      // The conversations go through /api/ai-chat/*: same provider, quotas and approvals as the web
      assistant: { available: assistant.available, canWrite: assistant.canWrite },
      statuses,
      places,
      projects,
      users,
      teams: teamList,
      businessUnits,
      groups,
      holidays,
      resources,
      vehicles,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
