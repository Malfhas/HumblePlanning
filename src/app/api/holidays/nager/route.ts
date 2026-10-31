import { NextRequest } from "next/server";
import { requireAuth, requirePermission, apiSuccess, apiError, handleApiError } from "@/lib/utils/api";

const NAGER_BASE = "https://date.nager.at/api/v3";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth();
    await requirePermission(session.user.id, "holidays:edit");

    const type = request.nextUrl.searchParams.get("type");
    const country = request.nextUrl.searchParams.get("country");
    const year = request.nextUrl.searchParams.get("year");

    if (type === "status") {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(`${NAGER_BASE}/AvailableCountries`, { signal: controller.signal });
        clearTimeout(timeout);
        return apiSuccess({ available: res.ok });
      } catch {
        clearTimeout(timeout);
        return apiSuccess({ available: false });
      }
    }

    if (type === "countries") {
      const res = await fetch(`${NAGER_BASE}/AvailableCountries`);
      if (!res.ok) return apiSuccess([]);
      const data = await res.json();
      return apiSuccess(data);
    }

    if (type === "holidays") {
      // Strict formats: the values end up in the URL path of the external API
      if (!country || !year || !/^\d{4}$/.test(year) || !/^[A-Za-z]{2}$/.test(country)) {
        return apiError("admin.holidays.errors.nagerParamsRequired");
      }
      const res = await fetch(`${NAGER_BASE}/PublicHolidays/${encodeURIComponent(year)}/${encodeURIComponent(country.toUpperCase())}`);
      if (!res.ok) return apiSuccess([]);
      const data = await res.json();
      return apiSuccess(data);
    }

    return apiError("admin.holidays.errors.nagerInvalidType");
  } catch (error) {
    return handleApiError(error);
  }
}
