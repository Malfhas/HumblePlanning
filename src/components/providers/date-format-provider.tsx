"use client";

import { useEffect } from "react";
import { useConfig } from "@/hooks/use-config";
import { setDateFormats, setTimezone } from "@/lib/utils/dates";

/**
 * Reads PLANNING_DATE_FORMAT, TIME_FORMAT, and TIMEZONE from app config and sets the browser's
 * date settings read by useDateFormat() (client only: the server passes them explicitly).
 * Must be mounted inside QueryProvider (needs useConfig).
 */
export function DateFormatProvider() {
  const { data: config } = useConfig();

  useEffect(() => {
    if (config) {
      setDateFormats(
        config.PLANNING_DATE_FORMAT || "dd/MM/yyyy",
        (config.TIME_FORMAT as "24h" | "12h") || "24h"
      );
      setTimezone(config.TIMEZONE || "auto");
    }
  }, [config?.PLANNING_DATE_FORMAT, config?.TIME_FORMAT, config?.TIMEZONE]);

  return null;
}
