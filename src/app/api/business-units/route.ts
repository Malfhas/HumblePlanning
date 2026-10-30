import { requireAuth, requirePermission, validateBody, apiSuccess, apiError, handleApiError } from "@/lib/utils/api";
import { getBusinessUnits, createBusinessUnit } from "@/lib/services/business-unit-service";
import { createBusinessUnitSchema } from "@/lib/validators/business-unit";
import { loadUserPermissions, getVisibleBusinessUnitIds, hasPermission } from "@/lib/services/permission-service";

export async function GET(request: Request) {
  try {
    const session = await requireAuth();
    // Auth-only: BUs are reference data used by planning filters, user form,
    // project form. Scope filtering still applies to limit visible BUs.
    const perms = await loadUserPermissions(session.user.id);
    let businessUnits = await getBusinessUnits();

    // Bypass scope:bu_* when the caller has pages:business_units (management page).
    // Prevents the top-left BU selector and the "own BU only" role scope from
    // hiding BUs on this page — it's an explicit exception.
    const url = new URL(request.url);
    const unscoped =
      url.searchParams.get("unscoped") === "true" &&
      hasPermission(perms, "pages:business_units");

    if (!unscoped) {
      const visibleIds = getVisibleBusinessUnitIds(perms);
      if (visibleIds) {
        const visibleSet = new Set(visibleIds);
        businessUnits = businessUnits.filter((bu: { id: string }) => visibleSet.has(bu.id));
      }
    }

    return apiSuccess(businessUnits);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "business_units:create");
    const data = await validateBody(request, createBusinessUnitSchema);
    const bu = await createBusinessUnit(data, session.user.id);
    return apiSuccess(bu, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
