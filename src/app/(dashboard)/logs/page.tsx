import { permanentRedirect } from "next/navigation";

/** Former « Logs » page, replaced by System health: kept so existing links still work. */
export default function LegacyLogsPage() {
  permanentRedirect("/system-health");
}
