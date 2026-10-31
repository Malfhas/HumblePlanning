"use client";

import { usePermissions } from "@/hooks/use-permissions";
import { useConfig } from "@/hooks/use-config";
import { Badge } from "@/components/ui/badge";
import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { tDyn } from "@/i18n/dynamic";
import type { Messages } from "@/messages/fr";
import { cn } from "@/lib/utils";
import {
  BookOpen,
  Lock,
  AlertTriangle,
  ChevronRight,
  Copy,
  Check,
  Zap,
  Server,
  FileJson,
  Shield,
  Languages,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Texts: `apiDocs` catalog. The constants below only keep
// message identifiers, translated at render time.
// i18n-dynamic: apiDocs.categories.*
// i18n-dynamic: apiDocs.endpoints.*
// i18n-dynamic: apiDocs.params.*
// i18n-dynamic: apiDocs.sections.*
// i18n-dynamic: apiDocs.errorHandling.statuses.*
// i18n-dynamic: apiDocs.errorHandling.fields.*
// i18n-dynamic: apiDocs.pagination.fields.*
type ApiDocsMessages = Messages["apiDocs"];
type CategoryId = keyof ApiDocsMessages["endpoints"];
type EndpointKey = {
  [C in CategoryId]: `${C}.${keyof ApiDocsMessages["endpoints"][C] & string}`;
}[CategoryId];

interface Param {
  name: string;
  type: string;
  required?: boolean;
  /** Key under `apiDocs.params`. */
  desc: keyof ApiDocsMessages["params"];
}

interface Endpoint {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  /** Key under `apiDocs.endpoints` (`<category>.<endpoint>`). */
  desc: EndpointKey;
  params?: Param[];
  body?: Param[];
  /** Response example (code, not translated). */
  responseExample: string;
  /** Example whose text depends on the language (translated CSV headers): replaces `responseExample`. */
  responseExampleKey?: "endpoint.csvExample";
  /** Binary response: the "(binary file)" note is added at render time. */
  binary?: boolean;
}

interface EndpointCategory {
  /** Section anchor and key under `apiDocs.categories`. */
  id: CategoryId;
  icon: React.ReactNode;
  endpoints: Endpoint[];
}

// ---------------------------------------------------------------------------
// Colors per HTTP method
// ---------------------------------------------------------------------------

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  POST: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  PUT: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  DELETE: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

// ---------------------------------------------------------------------------
// Endpoint data
// ---------------------------------------------------------------------------

const CATEGORIES: EndpointCategory[] = [
  {
    id: "tasks",
    icon: <FileJson className="size-4" />,
    endpoints: [
      {
        method: "GET",
        path: "/api/tasks",
        desc: "tasks.list",
        params: [
          {
            name: "projectId",
            type: "string",
            desc: "filterProjectId",
          },
          {
            name: "userId",
            type: "string",
            desc: "filterUserId",
          },
          {
            name: "statusId",
            type: "string",
            desc: "filterStatusId",
          },
          {
            name: "startDate",
            type: "string (YYYY-MM-DD)",
            desc: "minStartDate",
          },
          {
            name: "endDate",
            type: "string (YYYY-MM-DD)",
            desc: "maxEndDate",
          },
          {
            name: "search",
            type: "string",
            desc: "searchTitleNotes",
          },
          {
            name: "page",
            type: "number",
            desc: "page",
          },
          {
            name: "limit",
            type: "number",
            desc: "limit",
          },
        ],
        responseExample: `{
  "data": [
    {
      "id": "clx1abc...",
      "title": "Installation chantier A",
      "projectId": "clx1def...",
      "startDate": "2026-04-01",
      "endDate": "2026-04-03",
      "statusId": "clx1ghi...",
      "isMilestone": false,
      "users": [{ "id": "usr_1", "name": "Jean Dupont" }]
    }
  ],
  "total": 142,
  "page": 1,
  "limit": 200
}`,
      },
      {
        method: "POST",
        path: "/api/tasks",
        desc: "tasks.create",
        body: [
          {
            name: "projectId",
            type: "string",
            required: true,
            desc: "projectId",
          },
          {
            name: "userIds",
            type: "string[]",
            required: true,
            desc: "userIds",
          },
          {
            name: "startDate",
            type: "string (YYYY-MM-DD)",
            required: true,
            desc: "startDate",
          },
          {
            name: "endDate",
            type: "string (YYYY-MM-DD)",
            desc: "endDateOptional",
          },
          {
            name: "title",
            type: "string",
            desc: "taskTitle",
          },
          {
            name: "notes",
            type: "string",
            desc: "notes",
          },
          {
            name: "statusId",
            type: "string",
            required: true,
            desc: "statusId",
          },
          {
            name: "placeId",
            type: "string",
            desc: "placeId",
          },
          {
            name: "resourceId",
            type: "string",
            desc: "resourceId",
          },
          {
            name: "duration",
            type: "string (HH:mm)",
            desc: "duration",
          },
          {
            name: "startTime",
            type: "string (HH:mm)",
            desc: "startTime",
          },
          {
            name: "endTime",
            type: "string (HH:mm)",
            desc: "endTime",
          },
          {
            name: "isMilestone",
            type: "boolean",
            desc: "isMilestone",
          },
        ],
        responseExample: `{
  "id": "clx1abc...",
  "title": "Installation chantier A",
  "projectId": "clx1def...",
  "startDate": "2026-04-01",
  "endDate": "2026-04-03",
  "statusId": "clx1ghi...",
  "createdAt": "2026-04-01T08:30:00.000Z"
}`,
      },
      {
        method: "GET",
        path: "/api/tasks/[id]",
        desc: "tasks.get",
        params: [
          {
            name: "id",
            type: "string",
            required: true,
            desc: "taskIdUnique",
          },
        ],
        // i18n-ignore code example (sample data, not translated)
        responseExample: `{
  "id": "clx1abc...",
  "title": "Installation chantier A",
  "projectId": "clx1def...",
  "project": { "id": "clx1def...", "name": "Projet Alpha", "color": "#3b82f6" },
  "startDate": "2026-04-01",
  "endDate": "2026-04-03",
  "status": { "id": "clx1ghi...", "name": "En cours", "color": "#f59e0b" },
  "users": [{ "id": "usr_1", "name": "Jean Dupont" }],
  "files": [{ "id": "file_1", "name": "plan.pdf", "size": 204800 }],
  "duration": "02:00:00",
  "isMilestone": false,
  "notes": "Préparation du matériel incluse",
  "createdAt": "2026-04-01T08:30:00.000Z"
}`,
      },
      {
        method: "PUT",
        path: "/api/tasks/[id]",
        desc: "tasks.update",
        params: [
          {
            name: "id",
            type: "string",
            required: true,
            desc: "taskId",
          },
        ],
        body: [
          {
            name: "title",
            type: "string",
            desc: "newTitle",
          },
          {
            name: "startDate",
            type: "string (YYYY-MM-DD)",
            desc: "newStartDate",
          },
          {
            name: "endDate",
            type: "string (YYYY-MM-DD)",
            desc: "newEndDate",
          },
          {
            name: "statusId",
            type: "string",
            desc: "newStatus",
          },
          {
            name: "userIds",
            type: "string[]",
            desc: "newUserIds",
          },
        ],
        // i18n-ignore code example (sample data, not translated)
        responseExample: `{
  "id": "clx1abc...",
  "title": "Installation chantier A (modifié)",
  "startDate": "2026-04-02",
  "endDate": "2026-04-05",
  "updatedAt": "2026-04-02T10:15:00.000Z"
}`,
      },
      {
        method: "DELETE",
        path: "/api/tasks/[id]",
        desc: "tasks.delete",
        params: [
          {
            name: "id",
            type: "string",
            required: true,
            desc: "taskId",
          },
          {
            name: "scope",
            type: "string",
            desc: "deleteScope",
          },
        ],
        responseExample: `{
  "id": "clx1abc...",
  "title": "Installation chantier A",
  "...": "..."
}`,
      },
    ],
  },
  {
    id: "projects",
    icon: <FileJson className="size-4" />,
    endpoints: [
      {
        method: "GET",
        path: "/api/projects",
        desc: "projects.list",
        params: [
          {
            name: "search",
            type: "string",
            desc: "searchProjectName",
          },
          {
            name: "includeArchived",
            type: "boolean",
            desc: "includeArchived",
          },
        ],
        // i18n-ignore code example (sample data, not translated)
        responseExample: `[
  {
    "id": "clx1def...",
    "name": "Projet Alpha",
    "color": "#3b82f6",
    "status": "in_progress",
    "ownerId": "usr_1",
    "owner": { "id": "usr_1", "name": "Jean Dupont" },
    "groupId": "grp_1",
    "group": { "id": "grp_1", "name": "Bâtiment" },
    "description": "Construction site principal"
  }
]`,
      },
      {
        method: "POST",
        path: "/api/projects",
        desc: "projects.create",
        body: [
          {
            name: "name",
            type: "string",
            required: true,
            desc: "projectName",
          },
          {
            name: "color",
            type: "string",
            desc: "projectColor",
          },
          {
            name: "status",
            type: "string",
            desc: "projectStatus",
          },
          {
            name: "ownerId",
            type: "string",
            required: true,
            desc: "ownerId",
          },
          {
            name: "groupId",
            type: "string",
            desc: "groupId",
          },
          {
            name: "description",
            type: "string",
            desc: "projectDescription",
          },
        ],
        // i18n-ignore code example (sample data, not translated)
        responseExample: `{
  "id": "clx1def...",
  "name": "Projet Alpha",
  "color": "#3b82f6",
  "status": "active",
  "createdAt": "2026-04-01T08:00:00.000Z"
}`,
      },
      {
        method: "GET",
        path: "/api/projects/[id]",
        desc: "projects.get",
        params: [
          {
            name: "id",
            type: "string",
            required: true,
            desc: "projectIdUrl",
          },
        ],
        // i18n-ignore code example (sample data, not translated)
        responseExample: `{
  "id": "clx1def...",
  "name": "Projet Alpha",
  "color": "#3b82f6",
  "status": "active",
  "ownerId": "usr_1",
  "owner": { "id": "usr_1", "name": "Jean Dupont" },
  "groupId": "grp_1",
  "description": "Construction site principal",
  "createdAt": "2026-04-01T08:00:00.000Z"
}`,
      },
      {
        method: "PUT",
        path: "/api/projects/[id]",
        desc: "projects.update",
        params: [
          {
            name: "id",
            type: "string",
            required: true,
            desc: "projectIdUrl",
          },
        ],
        body: [
          { name: "name", type: "string", desc: "newName" },
          { name: "color", type: "string", desc: "newColor" },
          { name: "status", type: "string", desc: "newProjectStatus" },
          {
            name: "ownerId",
            type: "string",
            desc: "newOwner",
          },
        ],
        // i18n-ignore code example (sample data, not translated)
        responseExample: `{
  "id": "clx1def...",
  "name": "Projet Alpha (renommé)",
  "updatedAt": "2026-04-02T10:00:00.000Z"
}`,
      },
      {
        method: "DELETE",
        path: "/api/projects/[id]",
        desc: "projects.delete",
        params: [
          {
            name: "id",
            type: "string",
            required: true,
            desc: "projectIdUrl",
          },
        ],
        // i18n-ignore code example (sample data, not translated)
        responseExample: `{
  "id": "clx1def...",
  "name": "Projet Alpha",
  "...": "..."
}`,
      },
    ],
  },
  {
    id: "users",
    icon: <FileJson className="size-4" />,
    endpoints: [
      {
        method: "GET",
        path: "/api/users",
        desc: "users.list",
        params: [
          {
            name: "search",
            type: "string",
            desc: "searchUser",
          },
        ],
        // i18n-ignore code example (sample data, not translated)
        responseExample: `[
  {
    "id": "usr_1",
    "name": "Dupont",
    "firstName": "Jean",
    "displayName": "Jean Dupont",
    "email": "jean.dupont@example.com",
    "username": "jdupont",
    "active": true,
    "team": { "id": "team_1", "name": "Équipe A" },
    "role": { "id": "role_1", "name": "Manager", "isAdmin": false }
  }
]`,
      },
      {
        method: "GET",
        path: "/api/users/[id]",
        desc: "users.get",
        params: [
          {
            name: "id",
            type: "string",
            required: true,
            desc: "userIdUrl",
          },
        ],
        // i18n-ignore code example (sample data, not translated)
        responseExample: `{
  "id": "usr_1",
  "name": "Dupont",
  "firstName": "Jean",
  "displayName": "Jean Dupont",
  "email": "jean.dupont@example.com",
  "username": "jdupont",
  "active": true,
  "color": "#3b82f6",
  "team": { "id": "team_1", "name": "Équipe A" },
  "role": { "id": "role_1", "name": "Manager" },
  "qualifications": [{ "id": "q_1", "name": "Électricien" }],
  "lastLoginAt": "2026-03-28T14:30:00.000Z"
}`,
      },
    ],
  },
  {
    id: "teams",
    icon: <FileJson className="size-4" />,
    endpoints: [
      {
        method: "GET",
        path: "/api/teams",
        desc: "teams.list",
        // i18n-ignore code example (sample data, not translated)
        responseExample: `[
  {
    "id": "team_1",
    "name": "Équipe A",
    "color": "#10b981",
    "sortOrder": 0,
    "businessUnitId": "bu_1",
    "users": [{ "id": "usr_1", "name": "Dupont", "firstName": "Jean" }]
  }
]`,
      },
      {
        method: "GET",
        path: "/api/teams/[id]",
        desc: "teams.get",
        params: [
          {
            name: "id",
            type: "string",
            required: true,
            desc: "teamIdUrl",
          },
        ],
        // i18n-ignore code example (sample data, not translated)
        responseExample: `{
  "id": "team_1",
  "name": "Équipe A",
  "color": "#10b981",
  "users": [
    { "id": "usr_1", "name": "Dupont", "firstName": "Jean" }
  ]
}`,
      },
    ],
  },
  {
    id: "statuses",
    icon: <FileJson className="size-4" />,
    endpoints: [
      {
        method: "GET",
        path: "/api/statuses",
        desc: "statuses.list",
        // i18n-ignore code example (sample data, not translated)
        responseExample: `[
  {
    "id": "st_1",
    "name": "À faire",
    "color": "#6b7280",
    "sortOrder": 0
  },
  {
    "id": "st_2",
    "name": "En cours",
    "color": "#f59e0b",
    "sortOrder": 1
  },
  {
    "id": "st_3",
    "name": "Terminé",
    "color": "#10b981",
    "sortOrder": 2
  }
]`,
      },
    ],
  },
  {
    id: "places",
    icon: <FileJson className="size-4" />,
    endpoints: [
      {
        method: "GET",
        path: "/api/places",
        desc: "places.list",
        // i18n-ignore code example (sample data, not translated)
        responseExample: `[
  {
    "id": "pl_1",
    "name": "Chantier Nord",
    "comment": "Accès par la rue des Lilas",
    "exclusive": false,
    "color": "#8b5cf6"
  }
]`,
      },
    ],
  },
  {
    id: "resources",
    icon: <FileJson className="size-4" />,
    endpoints: [
      {
        method: "GET",
        path: "/api/resources",
        desc: "resources.list",
        responseExample: `[
  {
    "id": "res_1",
    "name": "Nacelle 20m",
    "color": "#f97316"
  }
]`,
      },
    ],
  },
  {
    id: "holidays",
    icon: <FileJson className="size-4" />,
    endpoints: [
      {
        method: "GET",
        path: "/api/holidays",
        desc: "holidays.list",
        params: [
          {
            name: "startDate",
            type: "string (YYYY-MM-DD)",
            desc: "rangeStart",
          },
          {
            name: "endDate",
            type: "string (YYYY-MM-DD)",
            desc: "rangeEnd",
          },
        ],
        // i18n-ignore code example (sample data, not translated)
        responseExample: `[
  {
    "id": "hol_1",
    "date": "2026-04-06",
    "label": "Lundi de Pâques",
    "color": "#ef4444"
  }
]`,
      },
    ],
  },
  {
    id: "vehicles",
    icon: <FileJson className="size-4" />,
    endpoints: [
      {
        method: "GET",
        path: "/api/vehicles",
        desc: "vehicles.list",
        responseExample: `[
  {
    "id": "veh_1",
    "name": "Camionnette 01",
    "registrationNumber": "AB-123-CD",
    "status": "available",
    "vehicleType": { "id": "vt_1", "name": "Utilitaire" }
  }
]`,
      },
      {
        method: "GET",
        path: "/api/vehicle-assignments",
        desc: "vehicles.assignments",
        params: [
          {
            name: "vehicleId",
            type: "string",
            desc: "filterVehicle",
          },
          {
            name: "startDate",
            type: "string (YYYY-MM-DD)",
            desc: "minStartDate",
          },
          {
            name: "endDate",
            type: "string (YYYY-MM-DD)",
            desc: "maxEndDate",
          },
        ],
        responseExample: `[
  {
    "id": "va_1",
    "vehicleId": "veh_1",
    "type": "task",
    "taskId": "clx1abc...",
    "projectId": "clx1def...",
    "startDate": "2026-04-01",
    "endDate": "2026-04-05",
    "vehicle": { "id": "veh_1", "name": "Camionnette 01" }
  }
]`,
      },
    ],
  },
  {
    id: "config",
    icon: <Server className="size-4" />,
    endpoints: [
      {
        method: "GET",
        path: "/api/config",
        desc: "config.get",
        responseExample: `{
  "APP_TITLE": "HumblePlanning",
  "APP_LOCALE": "fr",
  "PLANNING_DEFAULT_VIEW": "month",
  "PLANNING_SLOT_DURATION": "30",
  "TIMEZONE": "Europe/Paris",
  "...": "..."
}`,
      },
    ],
  },
  {
    id: "export",
    icon: <FileJson className="size-4" />,
    endpoints: [
      {
        method: "GET",
        path: "/api/export/csv",
        desc: "export.csv",
        params: [
          {
            name: "projectIds",
            type: "string",
            desc: "filterProjects",
          },
          {
            name: "userIds",
            type: "string",
            desc: "filterUsers",
          },
          {
            name: "startDate",
            type: "string (YYYY-MM-DD)",
            desc: "startDate",
          },
          {
            name: "endDate",
            type: "string (YYYY-MM-DD)",
            desc: "endDate",
          },
        ],
        // Column headers translated like the real export: text in the catalog
        responseExample: "",
        responseExampleKey: "endpoint.csvExample",
      },
      {
        method: "GET",
        path: "/api/export/excel",
        desc: "export.excel",
        params: [
          {
            name: "projectIds",
            type: "string",
            desc: "filterProjects",
          },
          {
            name: "startDate",
            type: "string (YYYY-MM-DD)",
            desc: "startDate",
          },
          {
            name: "endDate",
            type: "string (YYYY-MM-DD)",
            desc: "endDate",
          },
        ],
        responseExample: `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="planning_20260401.xlsx"`,
        binary: true,
      },
      {
        method: "GET",
        path: "/api/export/pdf",
        desc: "export.pdf",
        params: [
          {
            name: "projectIds",
            type: "string",
            desc: "filterProjects",
          },
          {
            name: "startDate",
            type: "string (YYYY-MM-DD)",
            desc: "startDate",
          },
          {
            name: "endDate",
            type: "string (YYYY-MM-DD)",
            desc: "endDate",
          },
        ],
        responseExample: `Content-Type: application/pdf
Content-Disposition: attachment; filename="planning_20260401.pdf"`,
        binary: true,
      },
      {
        method: "GET",
        path: "/api/export/ical",
        desc: "export.ical",
        responseExample: `Content-Type: text/calendar
Content-Disposition: attachment; filename="planning.ics"

BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:Installation chantier A
DTSTART:20260401
DTEND:20260403
END:VEVENT
END:VCALENDAR`,
      },
    ],
  },
];

// Non-endpoint sections (id = anchor; labelKey = key under `apiDocs.sections`)
const SECTIONS: { id: string; labelKey: keyof ApiDocsMessages["sections"] }[] = [
  { id: "introduction", labelKey: "introduction" },
  { id: "authentication", labelKey: "authentication" },
  { id: "rate-limiting", labelKey: "rateLimiting" },
  { id: "errors", labelKey: "errors" },
  { id: "language", labelKey: "language" },
  { id: "pagination", labelKey: "pagination" },
];

// HTTP codes: standard labels (English, not translated) + translated description
const HTTP_STATUSES: { code: string; label: string; descKey: keyof ApiDocsMessages["errorHandling"]["statuses"] }[] = [
  { code: "200", label: "OK", descKey: "ok" },
  { code: "201", label: "Created", descKey: "created" },
  { code: "400", label: "Bad Request", descKey: "badRequest" },
  { code: "401", label: "Unauthorized", descKey: "unauthorized" },
  { code: "403", label: "Forbidden", descKey: "forbidden" },
  { code: "404", label: "Not Found", descKey: "notFound" },
  { code: "409", label: "Conflict", descKey: "conflict" },
  { code: "422", label: "Unprocessable Entity", descKey: "unprocessable" },
  { code: "429", label: "Too Many Requests", descKey: "tooManyRequests" },
  { code: "503", label: "Service Unavailable", descKey: "unavailable" },
  { code: "500", label: "Internal Server Error", descKey: "internal" },
];

// Fields of an error response (`handleApiError`, src/lib/utils/api.ts)
const ERROR_FIELDS: (keyof ApiDocsMessages["errorHandling"]["fields"])[] = ["error", "code", "params", "fields", "details"];

// Pagination fields of GET /api/tasks
const PAGINATION_FIELDS: (keyof ApiDocsMessages["pagination"]["fields"])[] = ["data", "total", "page", "limit"];

// Styles shared by rich texts (t.rich)
const INLINE_CODE = "rounded bg-muted px-1.5 py-0.5 text-xs font-mono";
const inlineCode = (chunks: React.ReactNode) => <code className={INLINE_CODE}>{chunks}</code>;

// ---------------------------------------------------------------------------
// Component: copy button
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const tc = useTranslations("common");
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="absolute right-2 top-2 rounded-md bg-muted/80 p-1.5 text-muted-foreground opacity-0 backdrop-blur transition-opacity hover:text-foreground group-hover/code:opacity-100"
      title={tc("actions.copy")}
      aria-label={tc("actions.copy")}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Component: code block
// ---------------------------------------------------------------------------

function CodeBlock({ children, copyText }: { children: string; copyText?: string }) {
  return (
    <div className="group/code relative">
      <CopyButton text={copyText ?? children} />
      <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-4 text-[13px] leading-relaxed">
        <code>{children}</code>
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component: HTTP method badge
// ---------------------------------------------------------------------------

function MethodBadge({ method }: { method: string }) {
  return (
    <Badge
      className={cn(
        "rounded-md px-2.5 py-0.5 font-mono text-xs font-bold tracking-wide",
        METHOD_COLORS[method] ?? "bg-gray-100 text-gray-700"
      )}
    >
      {method}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Component: parameters table
// ---------------------------------------------------------------------------

function ParamTable({ params, title }: { params: Param[]; title: string }) {
  const t = useTranslations("apiDocs");
  return (
    <div className="mt-4">
      <h5 className="mb-2 text-sm font-semibold text-muted-foreground">{title}</h5>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-2 text-left font-medium">{t("table.parameter")}</th>
              <th className="px-4 py-2 text-left font-medium">{t("table.type")}</th>
              <th className="px-4 py-2 text-left font-medium">{t("table.required")}</th>
              <th className="px-4 py-2 text-left font-medium">{t("table.description")}</th>
            </tr>
          </thead>
          <tbody>
            {params.map((p) => (
              <tr key={p.name} className="border-b last:border-0">
                <td className="px-4 py-2 font-mono text-xs text-foreground">
                  {p.name}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                  {p.type}
                </td>
                <td className="px-4 py-2">
                  {p.required ? (
                    <Badge className="bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 text-[10px]">
                      {t("table.yes")}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("table.no")}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-muted-foreground">{tDyn(t, `params.${p.desc}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component: single endpoint
// ---------------------------------------------------------------------------

function EndpointBlock({
  endpoint,
  baseUrl,
}: {
  endpoint: Endpoint;
  baseUrl: string;
}) {
  const t = useTranslations("apiDocs");
  const apiKey = t("code.apiKeyPlaceholder");
  const displayPath = endpoint.path.replace(/\[(\w+)\]/g, ":$1");
  const curlPath = endpoint.path.replace(/\[(\w+)\]/g, "{$1}");

  const curlExample =
    endpoint.method === "GET"
      ? `curl -X GET "${baseUrl}${curlPath}" \\
  -H "Authorization: Bearer ${apiKey}"`
      : endpoint.method === "DELETE"
        ? `curl -X DELETE "${baseUrl}${curlPath}" \\
  -H "Authorization: Bearer ${apiKey}"`
        : `curl -X ${endpoint.method} "${baseUrl}${curlPath}" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{ ... }'`;

  const example = endpoint.responseExampleKey ? t(endpoint.responseExampleKey) : endpoint.responseExample;
  const responseExample = endpoint.binary ? `${example}\n\n${t("endpoint.binaryFile")}` : example;

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-3">
        <MethodBadge method={endpoint.method} />
        <code className="text-sm font-semibold text-foreground">{displayPath}</code>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{tDyn(t, `endpoints.${endpoint.desc}`)}</p>

      {/* Query parameters */}
      {endpoint.params && endpoint.params.length > 0 && (
        <ParamTable params={endpoint.params} title={t("endpoint.queryParams")} />
      )}

      {/* Request body */}
      {endpoint.body && endpoint.body.length > 0 && (
        <ParamTable params={endpoint.body} title={t("endpoint.body")} />
      )}

      {/* curl example */}
      <div className="mt-4">
        <h5 className="mb-2 text-sm font-semibold text-muted-foreground">
          {t("endpoint.curlExample")}
        </h5>
        <CodeBlock>{curlExample}</CodeBlock>
      </div>

      {/* Response example */}
      <div className="mt-4">
        <h5 className="mb-2 text-sm font-semibold text-muted-foreground">
          {t("endpoint.responseExample")}
        </h5>
        <CodeBlock>{responseExample}</CodeBlock>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ApiDocsPage() {
  const t = useTranslations("apiDocs");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const { can, isLoading } = usePermissions();
  const { data: config } = useConfig();
  const appName = config?.APP_TITLE || "HumblePlanning";
  const baseUrl = config?.APP_BASE_URL || "http://localhost:3000";
  const apiKey = t("code.apiKeyPlaceholder");
  const [activeSection, setActiveSection] = useState("introduction");
  const contentRef = useRef<HTMLDivElement>(null);

  // Scroll observation for the table of contents
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    // Use scroll event to find the section closest to the top of the viewport
    const mainEl = container.closest("main") || window;
    const handleScroll = () => {
      const sectionEls = container.querySelectorAll("[data-section]");
      let current = "introduction";
      for (const el of sectionEls) {
        const rect = el.getBoundingClientRect();
        if (rect.top <= 120) {
          current = el.id;
        }
      }
      setActiveSection(current);
    };

    mainEl.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => mainEl.removeEventListener("scroll", handleScroll);
  }, [isLoading]);

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <p className="text-muted-foreground">{tc("states.loading")}</p>
      </div>
    );
  }

  if (!can("pages:settings")) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3">
        <Shield className="size-12 text-muted-foreground/40" />
        <p className="text-muted-foreground">
          {t.rich("accessDenied", { code: (chunks) => <code className="text-xs">{chunks}</code> })}
        </p>
      </div>
    );
  }

  // Error examples: real messages from the `errors` catalog, in the current language
  const notFoundExample = `{
  "error": ${JSON.stringify(te("notFound"))},
  "code": "errors.notFound"
}`;
  const validationExample = `{
  "error": ${JSON.stringify(te("invalidData"))},
  "code": "errors.invalidData",
  "details": [
    { "path": ["projectId"], "message": "Invalid UUID" }
  ]
}`;

  return (
    <div className="flex -m-3 md:-m-6 min-h-[calc(100vh-3.5rem)]">
      {/* --- Sidebar TOC --- */}
      <aside className="hidden w-64 shrink-0 lg:block self-stretch border-r bg-muted/20">
        <div className="sticky top-0 max-h-screen overflow-y-auto px-4 py-6">
        <div className="mb-6 flex items-center gap-2 text-sm font-semibold text-foreground">
          <BookOpen className="size-4" />
          {t("toc.title")}
        </div>

        {/* General sections */}
        <nav className="flex flex-col gap-0.5">
          <p className="mb-1 mt-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
            {t("toc.general")}
          </p>
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={() => setActiveSection(s.id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-muted",
                activeSection === s.id
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground"
              )}
            >
              <ChevronRight
                className={cn(
                  "size-3 transition-transform",
                  activeSection === s.id && "rotate-90"
                )}
              />
              {tDyn(t, `sections.${s.labelKey}`)}
            </a>
          ))}

          {/* Endpoint categories */}
          <p className="mb-1 mt-5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
            {t("toc.endpoints")}
          </p>
          {CATEGORIES.map((cat) => (
            <a
              key={cat.id}
              href={`#${cat.id}`}
              onClick={() => setActiveSection(cat.id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-muted",
                activeSection === cat.id
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground"
              )}
            >
              <ChevronRight
                className={cn(
                  "size-3 transition-transform",
                  activeSection === cat.id && "rotate-90"
                )}
              />
              {tDyn(t, `categories.${cat.id}`)}
              <span className="ml-auto text-[10px] text-muted-foreground/50">
                {cat.endpoints.length}
              </span>
            </a>
          ))}
        </nav>
        </div>
      </aside>

      {/* --- Main content --- */}
      <div ref={contentRef} className="min-w-0 flex-1">
        <div className="mx-auto max-w-4xl px-6 py-8 lg:px-10">
          {/* ---- Header ---- */}
          <div className="mb-10">
            <h1 className="text-3xl font-bold tracking-tight">
              {t("header.title")}
            </h1>
            <p className="mt-2 text-lg text-muted-foreground">
              {t("header.subtitle", { appName })}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="gap-1">
                <Server className="size-3" />
                REST{/* i18n-ignore technical term */}
              </Badge>
              <Badge variant="outline" className="gap-1">
                <Lock className="size-3" />
                {t("header.apiKeyBadge")}
              </Badge>
              <Badge variant="outline" className="gap-1">
                <FileJson className="size-3" />
                JSON{/* i18n-ignore technical term */}
              </Badge>
              <span className="text-muted-foreground/50">|</span>
              <span>
                {t.rich("header.baseUrl", { baseUrl, code: (chunks) => <code className="font-mono">{chunks}</code> })}
              </span>
            </div>
          </div>

          {/* ================================================================
              INTRODUCTION
          ================================================================ */}
          <section id="introduction" data-section className="mb-12">
            <h2 className="text-xl font-bold">{t("sections.introduction")}</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p>{t("intro.p1", { appName })}</p>
              <p>{t.rich("intro.p2", { baseUrl, code: inlineCode })}</p>
            </div>
          </section>

          {/* ================================================================
              AUTHENTICATION
          ================================================================ */}
          <section id="authentication" data-section className="mb-12">
            <h2 className="flex items-center gap-2 text-xl font-bold">
              <Lock className="size-5" />
              {t("sections.authentication")}
            </h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p>{t.rich("auth.p1", { code: inlineCode })}</p>
              <p>{t.rich("auth.p2", { code: inlineCode })}</p>
              <p>{t.rich("auth.p3", { code: inlineCode, message: te("apiDisabled") })}</p>
            </div>

            <div className="mt-4">
              <CodeBlock>
                {`# ${t("auth.codeHeaderComment")}
Authorization: Bearer ${apiKey}

# ${t("auth.codeExampleComment")}
curl -X GET "${baseUrl}/api/tasks" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json"`}
              </CodeBlock>
            </div>

            <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-300">
                  {t("auth.securityTitle")}
                </p>
                <p className="mt-1 text-amber-700 dark:text-amber-400/80">
                  {t("auth.securityText")}
                </p>
              </div>
            </div>
          </section>

          {/* ================================================================
              RATE LIMITING
          ================================================================ */}
          <section id="rate-limiting" data-section className="mb-12">
            <h2 className="flex items-center gap-2 text-xl font-bold">
              <Zap className="size-5" />
              {t("sections.rateLimiting")}
            </h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p>
                {t.rich("rateLimiting.text", { code: inlineCode, b: (chunks) => <strong>{chunks}</strong> })}
              </p>
            </div>
          </section>

          {/* ================================================================
              ERRORS
          ================================================================ */}
          <section id="errors" data-section className="mb-12">
            <h2 className="flex items-center gap-2 text-xl font-bold">
              <AlertTriangle className="size-5" />
              {t("sections.errors")}
            </h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p>{t.rich("errorHandling.intro", { code: inlineCode })}</p>
              <p>
                {t.rich("errorHandling.codeIntro", {
                  code: inlineCode,
                  link: (chunks) => (
                    <a href="#language" onClick={() => setActiveSection("language")} className="underline underline-offset-2 hover:text-foreground">
                      {chunks}
                    </a>
                  ),
                })}
              </p>
            </div>

            <div className="mt-4">
              <h5 className="mb-2 text-sm font-semibold text-muted-foreground">
                {t("errorHandling.notFoundExample")}
              </h5>
              <CodeBlock>{notFoundExample}</CodeBlock>
            </div>

            <div className="mt-4">
              <h5 className="mb-2 text-sm font-semibold text-muted-foreground">
                {t("errorHandling.fieldsTitle")}
              </h5>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="px-4 py-2 text-left font-medium">{t("table.field")}</th>
                      <th className="px-4 py-2 text-left font-medium">{t("table.description")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ERROR_FIELDS.map((field) => (
                      <tr key={field} className="border-b last:border-0">
                        <td className="px-4 py-2 font-mono text-xs">{field}</td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {tDyn(t, `errorHandling.fields.${field}`)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-4 py-2 text-left font-medium">{t("table.code")}</th>
                    <th className="px-4 py-2 text-left font-medium">{t("table.meaning")}</th>
                    <th className="px-4 py-2 text-left font-medium">{t("table.description")}</th>
                  </tr>
                </thead>
                <tbody>
                  {HTTP_STATUSES.map((err) => (
                    <tr key={err.code} className="border-b last:border-0">
                      <td className="px-4 py-2">
                        <Badge
                          className={cn(
                            "font-mono text-xs",
                            err.code.startsWith("2")
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                              : err.code.startsWith("4")
                                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          )}
                        >
                          {err.code}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 font-medium">{err.label}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {tDyn(t, `errorHandling.statuses.${err.descKey}`)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4">
              <h5 className="mb-2 text-sm font-semibold text-muted-foreground">
                {t("errorHandling.validationExample")}
              </h5>
              <CodeBlock>{validationExample}</CodeBlock>
            </div>
          </section>

          {/* ================================================================
              RESPONSE LANGUAGE
          ================================================================ */}
          <section id="language" data-section className="mb-12">
            <h2 className="flex items-center gap-2 text-xl font-bold">
              <Languages className="size-5" />
              {t("sections.language")}
            </h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p>{t.rich("language.intro", { code: inlineCode })}</p>
              <p>{t("language.order")}</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>{t.rich("language.steps.cookie", { code: inlineCode })}</li>
                <li>{t.rich("language.steps.instance", { code: inlineCode })}</li>
                <li>{t.rich("language.steps.acceptLanguage", { code: inlineCode })}</li>
                <li>{t("language.steps.fallback")}</li>
              </ol>
              <p>{t.rich("language.apiKeyTip", { code: inlineCode })}</p>
            </div>
            <div className="mt-4">
              <CodeBlock>
                {`curl -X GET "${baseUrl}/api/tasks" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Accept-Language: en"`}
              </CodeBlock>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("language.icalTip")}</p>
          </section>

          {/* ================================================================
              PAGINATION
          ================================================================ */}
          <section id="pagination" data-section className="mb-12">
            <h2 className="text-xl font-bold">{t("sections.pagination")}</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p>{t.rich("pagination.p1", { code: inlineCode })}</p>
              <p>{t("pagination.p2")}</p>
            </div>
            <div className="mt-4">
              <CodeBlock>
                {`{
  "data": [ ... ],
  "total": 142,
  "page": 1,
  "limit": 200
}`}
              </CodeBlock>
            </div>
            <div className="mt-3 overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-4 py-2 text-left font-medium">{t("table.field")}</th>
                    <th className="px-4 py-2 text-left font-medium">{t("table.description")}</th>
                  </tr>
                </thead>
                <tbody>
                  {PAGINATION_FIELDS.map((field) => (
                    <tr key={field} className="border-b last:border-0">
                      <td className="px-4 py-2 font-mono text-xs">{field}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {tDyn(t, `pagination.fields.${field}`)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ================================================================
              ENDPOINTS BY CATEGORY
          ================================================================ */}
          {CATEGORIES.map((cat) => (
            <section
              key={cat.id}
              id={cat.id}
              data-section
              className="mb-14"
            >
              <div className="mb-6 flex items-center gap-2">
                {cat.icon}
                <h2 className="text-xl font-bold">{tDyn(t, `categories.${cat.id}`)}</h2>
                <Badge variant="secondary" className="ml-1 text-[10px]">
                  {t("endpoint.count", { count: cat.endpoints.length })}
                </Badge>
              </div>

              <div className="space-y-6">
                {cat.endpoints.map((ep, i) => (
                  <EndpointBlock
                    key={`${ep.method}-${ep.path}-${i}`}
                    endpoint={ep}
                    baseUrl={baseUrl}
                  />
                ))}
              </div>
            </section>
          ))}

          {/* ---- Footer ---- */}
          <div className="mt-16 border-t pt-6 pb-8" />
        </div>
      </div>
    </div>
  );
}
