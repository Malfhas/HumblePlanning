export type ViewMode = "users" | "projects" | "places" | "resources" | "vehicles";
export type ZoomLevel = "compact" | "normal" | "large" | "xlarge" | "xxlarge";
export type ColumnMode = "days" | "hours";
export type SortMode = "name-asc" | "name-desc" | "team-name-asc" | "team-name-desc"
  | "group-name-asc" | "group-name-desc" | "custom" | "custom-group"
  | "custom-bu" | "custom-bu-team" | "custom-bu-user"
  | "custom-bu-group" | "custom-bu-group-alpha"
  | "team-alpha-custom" | "group-alpha-custom"
  | "type-name-asc" | "type-name-desc";
export type CalendarMode = "off" | "personal";
/** Period shown by the calendar view: a number of days from the anchor, or the whole month. */
export type CalendarSpan = 1 | 3 | 5 | 7 | "month";
