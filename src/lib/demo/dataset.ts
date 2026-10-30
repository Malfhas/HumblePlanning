/**
 * Demo dataset generator (pure, deterministic): the same seed gives the same
 * branches, people, projects and identifiers every night, while the schedule
 * follows the current date (from 4 weeks back to 8 weeks ahead, working days
 * only, French public holidays excluded).
 */
import type {
  businessUnits, holidays, laborTypes, places, projectGroups, projectLaborBudgets, projects, qualifications,
  resourceAssignments, resourceTypes, resources, statuses, taskUsers, tasks, teams, userQualifications, users,
  vehicleAssignments, vehicleTypes, vehicles,
} from "@/db/schema";
import { addDays, dayOfWeek, frenchHolidays, mondayOf } from "./clock";
import {
  BUSINESS_UNITS, FIRST_NAMES, LABOR_TYPES, LAST_NAMES, OFFICE_STAFF, PLACES, PROJECT_GROUPS, PROJECTS,
  QUALIFICATIONS, RESOURCES, RESOURCE_TYPES, STATUSES, TASK_NOTES, TASK_TITLES, TEAMS, VEHICLES, VEHICLE_TYPES,
  type LaborKey, type StatusKey, type WorkKind,
} from "./corpus";
import { DEMO_ROLE_ID, DEMO_USER_ID } from "./index";

export interface DemoDataset {
  statuses: (typeof statuses.$inferInsert)[];
  businessUnits: (typeof businessUnits.$inferInsert)[];
  teams: (typeof teams.$inferInsert)[];
  laborTypes: (typeof laborTypes.$inferInsert)[];
  qualifications: (typeof qualifications.$inferInsert)[];
  users: (typeof users.$inferInsert)[];
  userQualifications: (typeof userQualifications.$inferInsert)[];
  places: (typeof places.$inferInsert)[];
  vehicleTypes: (typeof vehicleTypes.$inferInsert)[];
  vehicles: (typeof vehicles.$inferInsert)[];
  resourceTypes: (typeof resourceTypes.$inferInsert)[];
  resources: (typeof resources.$inferInsert)[];
  projectGroups: (typeof projectGroups.$inferInsert)[];
  projects: (typeof projects.$inferInsert)[];
  projectLaborBudgets: (typeof projectLaborBudgets.$inferInsert)[];
  tasks: (typeof tasks.$inferInsert)[];
  taskUsers: (typeof taskUsers.$inferInsert)[];
  vehicleAssignments: (typeof vehicleAssignments.$inferInsert)[];
  resourceAssignments: (typeof resourceAssignments.$inferInsert)[];
  holidays: (typeof holidays.$inferInsert)[];
}

const SEED = 20261030;
const ROLE_MANAGER = "00000000-0000-0000-0000-000000000002";
const ROLE_MEMBER_PLUS = "00000000-0000-0000-0000-000000000003";
const ROLE_MEMBER = "00000000-0000-0000-0000-000000000004";

/** Labor types that each kind of work consumes (project labor budgets). */
const KIND_LABOR: Record<WorkKind, LaborKey[]> = {
  building: ["lead", "electrician"], lowCurrent: ["technician"], hvac: ["plumber"], studies: ["designer"],
  maintenance: ["technician"], lighting: ["electrician"], industry: ["lead", "electrician"], automation: ["technician"],
};

/** Deterministic pseudo-random generator (mulberry32). */
function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return {
    int,
    chance: (p: number) => next() < p,
    pick: <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)],
    shuffle: <T,>(list: readonly T[]): T[] => {
      const copy = [...list];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = int(0, i);
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
    uuid: () => {
      const hex = Array.from({ length: 32 }, () => Math.floor(next() * 16).toString(16));
      hex[12] = "4";
      hex[16] = "89ab"[Math.floor(next() * 4)];
      const s = hex.join("");
      return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
    },
  };
}

type Random = ReturnType<typeof createRandom>;

function toLogin(firstName: string, lastName: string): string {
  return `${firstName}.${lastName}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9.]/g, "");
}

function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function jitter(value: number, rng: Random): string {
  return (value + (rng.int(-300, 300) / 10000)).toFixed(7);
}

interface Person { id: string; teamIndex: number | null; bu: number; labor: LaborKey }
interface ProjectInfo { id: string; bu: number; kinds: readonly WorkKind[]; start: string; end: string; ownerId: string }

export function buildDemoDataset(today: string, account: { login: string }): DemoDataset {
  const rng = createRandom(SEED);
  const year = Number(today.slice(0, 4));

  // ── Reference data ─────────────────────────────────────────────────────
  const statusIds = {} as Record<StatusKey, string>;
  const statusRows = STATUSES.map((s, i) => {
    const id = rng.uuid();
    statusIds[s.key] = id;
    return {
      id, name: s.name, color: s.color, percentage: s.percentage, priority: s.priority, sortOrder: i + 1,
      isDefault: "isDefault" in s ? s.isDefault : false, displayMode: "tp",
      strikethrough: "strikethrough" in s ? s.strikethrough : false,
      italic: "italic" in s ? s.italic : false,
      bold: "bold" in s ? s.bold : false,
    };
  });

  const buRows = BUSINESS_UNITS.map((b) => ({
    id: rng.uuid(), name: b.name, number: b.number, address: b.address,
    latitude: b.lat.toFixed(7), longitude: b.lng.toFixed(7), color: b.color,
  }));
  const teamRows = TEAMS.map((t, i) => ({ id: rng.uuid(), name: t.name, color: t.color, sortOrder: i, businessUnitId: buRows[t.bu].id }));
  const laborIds = {} as Record<LaborKey, string>;
  const laborRows = LABOR_TYPES.map((l, i) => {
    laborIds[l.key] = rng.uuid();
    return { id: laborIds[l.key], name: l.name, initials: l.initials, sortOrder: i };
  });
  const laborByKey = Object.fromEntries(LABOR_TYPES.map((l) => [l.key, l])) as Record<LaborKey, (typeof LABOR_TYPES)[number]>;
  const qualificationRows = QUALIFICATIONS.map((q) => ({ id: rng.uuid(), ...q }));
  const placeRows = PLACES.map((p) => ({ id: rng.uuid(), ...p }));
  const vehicleTypeRows = VEHICLE_TYPES.map((v, i) => ({ id: rng.uuid(), ...v, sortOrder: i }));
  const vehicleRows = VEHICLES.map((v) => ({
    id: rng.uuid(), name: v.name, vehicleTypeId: vehicleTypeRows[v.type].id, businessUnitId: buRows[v.bu].id,
    color: VEHICLE_TYPES[v.type].color,
  }));
  const resourceTypeRows = RESOURCE_TYPES.map((r, i) => ({ id: rng.uuid(), ...r, sortOrder: i }));
  const resourceRows = RESOURCES.map((r) => ({
    id: rng.uuid(), name: r.name, resourceTypeId: resourceTypeRows[r.type].id, businessUnitId: buRows[r.bu].id,
    color: RESOURCE_TYPES[r.type].color,
  }));

  // ── People ─────────────────────────────────────────────────────────────
  const firstNames = rng.shuffle(FIRST_NAMES);
  const lastNames = rng.shuffle(LAST_NAMES);
  const userRows: (typeof users.$inferInsert)[] = [];
  const people: Person[] = [];
  const usedLogins = new Set([account.login]);
  const addPerson = (p: { teamIndex: number | null; bu: number; labor: LaborKey; roleId: string; job: string; visible: boolean }) => {
    const n = userRows.length;
    const firstName = firstNames[n % firstNames.length];
    const lastName = lastNames[n % lastNames.length];
    let login = toLogin(firstName, lastName);
    while (usedLogins.has(login)) login += "2";
    usedLogins.add(login);
    const id = rng.uuid();
    const labor = laborByKey[p.labor];
    userRows.push({
      id, firstName, name: lastName, username: login, email: `${login}@example.com`, emailVerified: true,
      roleId: p.roleId, teamId: p.teamIndex === null ? null : teamRows[p.teamIndex].id, businessUnitId: buRows[p.bu].id,
      laborTypeId: laborIds[p.labor], job: p.job,
      contractType: p.labor === "apprentice" ? "alternant" : rng.chance(0.06) ? "interimaire" : "salarie",
      defaultHourlyRate: String(labor.rate), color: hslToHex((n * 47) % 360, 55, 55),
      visibleOnPlanning: p.visible, sortOrder: n, active: true,
    });
    people.push({ id, teamIndex: p.teamIndex, bu: p.bu, labor: p.labor });
    return id;
  };

  const officeIds = OFFICE_STAFF.map((o) => addPerson({ teamIndex: null, bu: o.bu, labor: o.labor, roleId: o.roleId, job: o.job, visible: false }));
  const branchManagerOf = (bu: number) => officeIds[OFFICE_STAFF.findIndex((o) => o.bu === bu && o.roleId === ROLE_MANAGER)];
  TEAMS.forEach((team, teamIndex) => {
    team.crew.forEach((labor, i) => {
      const leader = i === 0;
      addPerson({
        teamIndex, bu: team.bu, labor, visible: true, job: laborByKey[labor].name,
        roleId: leader ? (labor === "manager" ? ROLE_MANAGER : ROLE_MEMBER_PLUS) : ROLE_MEMBER,
      });
    });
  });

  // The demo account: a site manager of the Lyon branch, with a few meetings on the schedule
  const studiesTeam = TEAMS.findIndex((t) => t.kind === "studies");
  userRows.push({
    id: DEMO_USER_ID, firstName: "Visiteur", name: "Démo", username: account.login, email: "demo@example.com",
    emailVerified: true, roleId: DEMO_ROLE_ID, teamId: teamRows[studiesTeam].id, businessUnitId: buRows[0].id,
    laborTypeId: laborIds.manager, job: "Conducteur de travaux", contractType: "salarie",
    defaultHourlyRate: String(laborByKey.manager.rate), color: "#0f766e", visibleOnPlanning: true,
    sortOrder: -1, active: true,
  });

  const userQualificationRows: (typeof userQualifications.$inferInsert)[] = [];
  for (const p of people) {
    if (p.teamIndex === null || p.labor === "designer" || p.labor === "manager") continue;
    const kind = TEAMS[p.teamIndex].kind;
    const odds = [kind === "hvac" ? 0.3 : 0.85, 0.35, kind === "lighting" ? 0.8 : 0.25, 0.5, 0.3, kind === "lighting" ? 0.8 : 0.15];
    qualificationRows.forEach((q, i) => {
      if (rng.chance(odds[i])) userQualificationRows.push({ id: rng.uuid(), userId: p.id, qualificationId: q.id });
    });
  }

  // ── Projects ───────────────────────────────────────────────────────────
  const groupRows = PROJECT_GROUPS.map((g, i) => ({
    id: rng.uuid(), name: g.name, businessUnitId: buRows[g.bu].id, color: BUSINESS_UNITS[g.bu].color, sortOrder: i,
  }));
  const streets = ["rue des Acacias", "avenue des Peupliers", "chemin des Vignes", "allée des Érables", "rue du Moulin", "boulevard des Sports", "rue de la Gare", "impasse des Lilas"];
  const projectRows: (typeof projects.$inferInsert)[] = [];
  const budgetRows: (typeof projectLaborBudgets.$inferInsert)[] = [];
  const projectInfos: ProjectInfo[] = [];
  PROJECTS.forEach((p, i) => {
    const bu = PROJECT_GROUPS[p.group].bu;
    // Works window relative to today: most sites are running, some finished, some to come
    const start = addDays(today, -7 * rng.int(-6, 26));
    const end = addDays(start, 7 * rng.int(8, 36));
    const status = end < today ? "done" : start > today ? "todo" : "in_progress";
    const budgetTime = rng.int(30, 160) * 10;
    const id = rng.uuid();
    const owner = rng.chance(0.6) ? branchManagerOf(bu) : people.find((x) => x.bu === bu && x.teamIndex !== null && TEAMS[x.teamIndex].crew[0] === x.labor)?.id ?? branchManagerOf(bu);
    const city = BUSINESS_UNITS[bu].address.split(", ")[1];
    projectRows.push({
      id, name: p.name, businessNumber: `AFF-${String(year).slice(2)}-${String(i + 101)}`,
      color: hslToHex((i * 37) % 360, 60, 50), status, sortOrder: i, groupId: groupRows[p.group].id,
      businessUnitId: buRows[bu].id, ownerId: owner, deliveryDate: end,
      budgetTime: String(budgetTime), budgetAmount: String(Math.round((budgetTime * rng.int(55, 72)) / 100) * 100),
      address: `${rng.int(2, 120)} ${rng.pick(streets)}, ${city}`,
      addressLat: jitter(BUSINESS_UNITS[bu].lat, rng), addressLng: jitter(BUSINESS_UNITS[bu].lng, rng),
    });
    const labors = [...new Set(p.kinds.flatMap((k) => KIND_LABOR[k]))];
    labors.forEach((labor, j) => {
      const share = j === labors.length - 1 ? budgetTime - Math.round(budgetTime / labors.length) * (labors.length - 1) : Math.round(budgetTime / labors.length);
      budgetRows.push({ id: rng.uuid(), projectId: id, laborTypeId: laborIds[labor], plannedHours: String(share) });
    });
    projectInfos.push({ id, bu, kinds: p.kinds, start, end, ownerId: owner });
  });

  // ── Calendar ───────────────────────────────────────────────────────────
  const rangeStart = mondayOf(addDays(today, -28));
  const rangeEnd = addDays(mondayOf(addDays(today, 56)), 4);
  const years = [...new Set([Number(rangeStart.slice(0, 4)), year, year + 1, Number(rangeEnd.slice(0, 4))])].sort();
  const holidayRows = years.flatMap((y) => frenchHolidays(y)).map((h) => ({ id: rng.uuid(), date: h.date, label: h.label, color: "#f97316" }));
  const holidayDates = new Set(holidayRows.map((h) => h.date));
  const workingDays: string[] = [];
  for (let d = rangeStart; d <= rangeEnd; d = addDays(d, 1)) {
    if (dayOfWeek(d) !== 0 && dayOfWeek(d) !== 6 && !holidayDates.has(d)) workingDays.push(d);
  }

  // ── Schedule ───────────────────────────────────────────────────────────
  const taskRows: (typeof tasks.$inferInsert)[] = [];
  const taskUserRows: (typeof taskUsers.$inferInsert)[] = [];
  const vehicleRowsOut: (typeof vehicleAssignments.$inferInsert)[] = [];
  const resourceRowsOut: (typeof resourceAssignments.$inferInsert)[] = [];
  const busy = new Set<string>(); // `${userId}|${date}|am` / `|pm`
  const equipmentBusy = new Set<string>(); // `${id}|${date}`
  const startsByTeamDay = new Map<string, { taskId: string; days: string[]; half: "am" | "pm" | null }[]>();

  const isFree = (userId: string, days: string[], half: "am" | "pm" | null) =>
    days.every((d) => (half ? !busy.has(`${userId}|${d}|${half}`) : !busy.has(`${userId}|${d}|am`) && !busy.has(`${userId}|${d}|pm`)));
  const occupy = (userId: string, days: string[], half: "am" | "pm" | null) => {
    for (const d of days) for (const h of half ? [half] : ["am", "pm"]) busy.add(`${userId}|${d}|${h}`);
  };
  const statusFor = (start: string, end: string): string => {
    if (end < today) return statusIds[rng.chance(0.05) ? "cancelled" : rng.chance(0.16) ? "validated" : "done"];
    if (start <= today) return statusIds.inProgress;
    return statusIds[rng.chance(0.12) ? "waiting" : "todo"];
  };

  const addTask = (t: {
    projectId: string; days: string[]; half: "am" | "pm" | null; userIds: string[]; title: string | null;
    kind: WorkKind | null; creatorId: string; placeId?: string | null; teamIndex?: number; bu: number;
  }) => {
    const id = rng.uuid();
    const start = t.days[0], end = t.days[t.days.length - 1];
    const statusId = statusFor(start, end);
    const times = t.half === "am" ? ["08:00", "12:00"] : t.half === "pm" ? ["13:30", "17:00"] : [null, null];
    taskRows.push({
      id, projectId: t.projectId, startDate: start, endDate: end, startTime: times[0], endTime: times[1],
      title: t.title, statusId, notes: rng.chance(0.06) ? rng.pick(TASK_NOTES) : null, placeId: t.placeId ?? null,
      isMilestone: t.title === "Mise en service" && t.days.length === 1,
      isLocked: statusId === statusIds.validated, creatorId: t.creatorId, lastModifierId: t.creatorId,
    });
    for (const userId of t.userIds) {
      taskUserRows.push({ id: rng.uuid(), taskId: id, userId });
      occupy(userId, t.days, t.half);
    }
    // Vans for multi-day field work, equipment now and then
    if (t.kind && t.kind !== "studies" && t.days.length > 1 && rng.chance(0.35)) {
      const vehicle = rng.shuffle(vehicleRows).find((v) => v.businessUnitId === buRows[t.bu].id && t.days.every((d) => !equipmentBusy.has(`${v.id}|${d}`)));
      if (vehicle) {
        t.days.forEach((d) => equipmentBusy.add(`${vehicle.id}|${d}`));
        vehicleRowsOut.push({ id: rng.uuid(), vehicleId: vehicle.id, taskId: id, startDate: start, endDate: end, type: "task", assignedBy: t.creatorId });
      }
    }
    if (t.kind && ["building", "industry", "lighting", "maintenance"].includes(t.kind) && rng.chance(0.12)) {
      const resource = rng.shuffle(resourceRows).find((r) => r.businessUnitId === buRows[t.bu].id && t.days.every((d) => !equipmentBusy.has(`${r.id}|${d}`)));
      if (resource) {
        t.days.forEach((d) => equipmentBusy.add(`${resource.id}|${d}`));
        resourceRowsOut.push({ id: rng.uuid(), resourceId: resource.id, taskId: id, startDate: start, endDate: end, type: "task", assignedBy: t.creatorId });
      }
    }
    if (t.teamIndex !== undefined) {
      const key = `${t.teamIndex}|${start}`;
      startsByTeamDay.set(key, [...(startsByTeamDay.get(key) ?? []), { taskId: id, days: t.days, half: t.half }]);
    }
    return id;
  };

  // Safety training: one morning per team, in the coming weeks, at the training room
  const futureDays = workingDays.filter((d) => d > addDays(today, 7));
  const trainingPlace = placeRows.find((p) => p.name === "Salle de formation")!;
  TEAMS.forEach((team, teamIndex) => {
    if (team.kind === "studies" || futureDays.length === 0) return;
    const day = futureDays[(teamIndex * 4) % futureDays.length];
    const members = people.filter((p) => p.teamIndex === teamIndex).map((p) => p.id);
    const projectId = projectInfos.find((p) => p.bu === team.bu)!.id;
    addTask({ projectId, days: [day], half: "am", userIds: members, title: "Formation sécurité", kind: null, creatorId: branchManagerOf(team.bu), placeId: trainingPlace.id, bu: team.bu });
  });

  const projectsFor = (teamIndex: number, day: string) => {
    const team = TEAMS[teamIndex];
    return projectInfos.filter((p) => p.bu === team.bu && p.start <= day && p.end >= day && (team.kind === "studies" || p.kinds.includes(team.kind)));
  };

  // Field work, person by person: a site for a few days, then another one
  const crewOrder = people.filter((p) => p.teamIndex !== null).sort((a, b) => Number(a.labor === "apprentice") - Number(b.labor === "apprentice"));
  for (const person of crewOrder) {
    const teamIndex = person.teamIndex!;
    const kind = TEAMS[teamIndex].kind;
    const depot = placeRows[TEAMS[teamIndex].bu];
    const creatorId = branchManagerOf(person.bu);
    let current: ProjectInfo | null = null;
    let streak = 0;
    for (let i = 0; i < workingDays.length; i++) {
      const day = workingDays[i];
      if (!isFree(person.id, [day], "am") && !isFree(person.id, [day], "pm")) continue;
      if (rng.chance(0.07)) continue; // day off, leave, office work

      // Join a teammate's task starting today (apprentices almost always do)
      const joinable = (startsByTeamDay.get(`${teamIndex}|${day}`) ?? []).filter((s) => isFree(person.id, s.days, s.half));
      if (joinable.length && rng.chance(person.labor === "apprentice" ? 0.85 : 0.22)) {
        const s = rng.pick(joinable);
        taskUserRows.push({ id: rng.uuid(), taskId: s.taskId, userId: person.id });
        occupy(person.id, s.days, s.half);
        continue;
      }

      const candidates = projectsFor(teamIndex, day);
      if (candidates.length === 0) continue;
      if (!current || streak <= 0 || current.end < day) {
        current = rng.pick(candidates);
        streak = rng.int(3, 8);
      }
      const titleOf = () => (rng.chance(0.85) ? rng.pick(TASK_TITLES[kind]) : null);
      const r = rng.chance(0.04) ? -1 : rng.int(0, 99);
      const wholeDayFree = isFree(person.id, [day], null);
      if (r === -1 && wholeDayFree) {
        addTask({ projectId: current.id, days: [day], half: null, userIds: [person.id], title: "Préparation du matériel", kind: null, creatorId, placeId: depot.id, teamIndex, bu: person.bu });
      } else if (r < 35 || !wholeDayFree) {
        const half = !isFree(person.id, [day], "am") ? "pm" : !isFree(person.id, [day], "pm") ? "am" : null;
        addTask({ projectId: current.id, days: [day], half, userIds: [person.id], title: titleOf(), kind, creatorId, teamIndex, bu: person.bu });
      } else if (r < 82) {
        // Several days on the same site, within the week
        const days = [day];
        const length = rng.int(2, 5);
        while (days.length < length && workingDays[i + days.length] && dayOfWeek(workingDays[i + days.length]) > dayOfWeek(day)) {
          days.push(workingDays[i + days.length]);
        }
        if (!isFree(person.id, days, null)) days.splice(1);
        addTask({ projectId: current.id, days, half: null, userIds: [person.id], title: titleOf(), kind, creatorId, teamIndex, bu: person.bu });
        i += days.length - 1;
        streak -= days.length - 1;
      } else {
        // Morning and afternoon on two sites
        addTask({ projectId: current.id, days: [day], half: "am", userIds: [person.id], title: titleOf(), kind, creatorId, teamIndex, bu: person.bu });
        addTask({ projectId: rng.pick(candidates).id, days: [day], half: "pm", userIds: [person.id], title: titleOf(), kind, creatorId, teamIndex, bu: person.bu });
      }
      streak--;
    }
  }

  // The demo account: site visits and meetings, about twice a week
  const lyonProjects = projectInfos.filter((p) => p.bu === 0);
  for (const day of workingDays) {
    if (!rng.chance(0.4)) continue;
    const running = lyonProjects.filter((p) => p.start <= day && p.end >= day);
    if (running.length === 0) continue;
    const meeting = rng.chance(0.3);
    addTask({
      projectId: rng.pick(running).id, days: [day], half: rng.chance(0.5) ? "am" : "pm", userIds: [DEMO_USER_ID],
      title: meeting ? "Réunion de chantier" : "Visite de chantier", kind: null, creatorId: DEMO_USER_ID,
      placeId: meeting && rng.chance(0.5) ? placeRows.find((p) => p.name === "Salle de réunion – siège")!.id : null, bu: 0,
    });
  }

  return {
    statuses: statusRows,
    businessUnits: buRows,
    teams: teamRows,
    laborTypes: laborRows,
    qualifications: qualificationRows,
    users: userRows,
    userQualifications: userQualificationRows,
    places: placeRows,
    vehicleTypes: vehicleTypeRows,
    vehicles: vehicleRows,
    resourceTypes: resourceTypeRows,
    resources: resourceRows,
    projectGroups: groupRows,
    projects: projectRows,
    projectLaborBudgets: budgetRows,
    tasks: taskRows,
    taskUsers: taskUserRows,
    vehicleAssignments: vehicleRowsOut,
    resourceAssignments: resourceRowsOut,
    holidays: holidayRows,
  };
}
