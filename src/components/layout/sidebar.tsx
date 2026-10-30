"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  Home,
  CalendarDays,
  ListTodo,
  FolderKanban,
  Users,
  UsersRound,
  Wrench,
  CircleDot,
  CalendarOff,
  Layers,
  BarChart3,
  FileText,
  Settings,
  Shield,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  ChevronRight,
  ChevronDown,
  Award,
  HardHat,
  ShieldCheck,
  Truck,
  Tags,
  Building2,
  Terminal,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { create } from "zustand";
import { usePermissions } from "@/hooks/use-permissions";
import { useAiChatAvailability } from "@/hooks/use-ai-chat-availability";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useConfig } from "@/hooks/use-config";
import { useTheme } from "next-themes";
import { resolveThemedAsset } from "@/lib/utils/themed-asset";
import { SidebarFooter } from "./sidebar-footer";
import { UpdateBanner } from "./update-banner";
import type { Messages } from "@/messages/fr";

export const useSidebarStore = create<{
  collapsed: boolean;
  mobileOpen: boolean;
  /** ids of the open groups (stable identifiers, never the labels) */
  openGroups: string[];
  toggle: () => void;
  setMobileOpen: (open: boolean) => void;
  toggleGroup: (id: string) => void;
  setOpenGroups: (groups: string[]) => void;
}>((set) => ({
  collapsed: false,
  mobileOpen: false,
  openGroups: [],
  toggle: () => set((s) => ({ collapsed: !s.collapsed })),
  setMobileOpen: (open) => set({ mobileOpen: open }),
  toggleGroup: (id) =>
    set((s) => ({
      openGroups: s.openGroups.includes(id)
        ? s.openGroups.filter((g) => g !== id)
        : [...s.openGroups, id],
    })),
  setOpenGroups: (groups) => set({ openGroups: groups }),
}));

/** Stable identifier of an entry: label `layout.nav.<id>`. */
type NavId = keyof Messages["layout"]["nav"];

type NavLink = {
  id: NavId;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  configKey?: string;
  permission?: string | string[];
  /** AI chat entry: shown only if the chat is available to the user. */
  aiChat?: boolean;
};

type NavItem =
  | NavLink
  | {
      type: "group";
      /** Stable identifier (open groups state, React key, label). */
      id: NavId;
      icon: React.ComponentType<{ className?: string }>;
      configKey?: string;
      children: NavLink[];
    };

const ALL_NAV_ITEMS: NavItem[] = [
  { id: "home", href: "/home", icon: Home, permission: "pages:home" },
  { id: "planning", href: "/planning", icon: CalendarDays, permission: "pages:planning" },
  { id: "tasks", href: "/tasks", icon: ListTodo, permission: "pages:tasks" },
  { id: "assistant", href: "/assistant", icon: Sparkles, aiChat: true },
  { id: "businessUnits", href: "/business-units", icon: Building2, permission: "pages:business_units" },
  {
    type: "group",
    id: "team",
    icon: Users,
    children: [
      { id: "users", href: "/users", icon: Users, permission: "pages:users" },
      { id: "teams", href: "/teams", icon: UsersRound, permission: "pages:teams" },
      { id: "qualifications", href: "/qualifications", icon: Award, permission: "pages:qualifications" },
      { id: "laborTypes", href: "/labor-types", icon: HardHat, permission: "pages:labor_types" },
    ],
  },
  {
    type: "group",
    id: "worksites",
    icon: FolderKanban,
    children: [
      // The Groups and Statuses sub-pages are covered by pages:projects: a
      // user with this key can access /projects, /groups and /statuses.
      { id: "projects", href: "/projects", icon: FolderKanban, permission: "pages:projects" },
      { id: "projectGroups", href: "/groups", icon: Layers, permission: "pages:projects" },
      { id: "statuses", href: "/statuses", icon: CircleDot, permission: "pages:projects" },
    ],
  },
  {
    type: "group",
    id: "logistics",
    icon: Truck,
    children: [
      { id: "vehicles", href: "/vehicles", icon: Truck, configKey: "MODULE_VEHICLES", permission: "pages:vehicles" },
      { id: "vehicleTypes", href: "/vehicle-types", icon: Tags, configKey: "MODULE_VEHICLES", permission: "pages:vehicle_types" },
      { id: "resources", href: "/resources", icon: Wrench, configKey: "MODULE_RESOURCES", permission: "pages:resources" },
      { id: "resourceTypes", href: "/resource-types", icon: Tags, configKey: "MODULE_RESOURCES", permission: "pages:resource_types" },
    ],
  },
  {
    type: "group",
    id: "analysis",
    icon: BarChart3,
    children: [
      { id: "statsUsers", href: "/stats/users", icon: Users, permission: "pages:stats_users" },
      { id: "statsProjects", href: "/stats/projects", icon: FolderKanban, permission: "pages:stats_projects" },
      // ROI temporarily hidden (code kept in /stats/roi)
      // { id: "statsRoi", href: "/stats/roi", icon: BarChart3, permission: "pages:stats_roi" },
      { id: "audit", href: "/audit", icon: Shield, configKey: "MODULE_AUDIT", permission: "pages:audit" },
      { id: "logs", href: "/logs", icon: Terminal, configKey: "MODULE_AUDIT", permission: "pages:audit" },
      { id: "export", href: "/export", icon: FileText, permission: "export:use" },
    ],
  },
  {
    type: "group",
    id: "administration",
    icon: Settings,
    children: [
      { id: "settings", href: "/settings", icon: Settings, permission: "pages:settings" },
      { id: "roles", href: "/roles", icon: ShieldCheck, permission: "pages:roles" },
      { id: "holidays", href: "/holidays", icon: CalendarOff, permission: "pages:holidays" },
      { id: "files", href: "/files", icon: FileText, permission: "pages:files" },
    ],
  },
];

type NavGroupItem = Extract<NavItem, { type: "group" }>;

/**
 * Groups containing the active page, computed on the FULL list: they do not
 * depend on permissions, which arrive after the first render (otherwise,
 * on a full page load, the active group stayed closed).
 */
function activeGroupIds(pathname: string): string[] {
  return ALL_NAV_ITEMS.filter(
    (item): item is NavGroupItem => "type" in item && item.type === "group" && item.children.some((child) => pathname === child.href),
  ).map((group) => group.id);
}

function useFilteredNavItems(): NavItem[] | null {
  const { data: config } = useConfig();
  const { can, isLoading: permLoading } = usePermissions();
  // Nothing is rendered while loading: the entry only appears if the chat is available
  const { data: aiChat } = useAiChatAvailability();

  // Don't render anything until permissions are loaded to prevent flash
  if (permLoading) return null;

  return ALL_NAV_ITEMS.map((item) => {
    if ("type" in item && item.type === "group") {
      if (item.configKey) {
        const val = config?.[item.configKey];
        if (val !== undefined && val !== null && val !== "true" && val !== "1") return null;
      }
      const filtered = item.children.filter((child) => {
        if (child.configKey) {
          const val = config?.[child.configKey];
          if (val !== undefined && val !== null && val !== "true" && val !== "1") return false;
        }
        if (child.permission) {
          const perms = Array.isArray(child.permission) ? child.permission : [child.permission];
          if (!perms.some((p) => can(p))) return false;
        }
        return true;
      });
      if (filtered.length === 0) return null;
      return { ...item, children: filtered };
    }
    if ("configKey" in item && item.configKey) {
      const val = config?.[item.configKey];
      if (val !== undefined && val !== null && val !== "true" && val !== "1") return null;
    }
    if ("aiChat" in item && item.aiChat && !aiChat?.available) return null;
    if ("permission" in item && item.permission) {
      const perms = Array.isArray(item.permission) ? item.permission : [item.permission];
      if (!perms.some((p) => can(p))) return null;
    }
    return item;
  }).filter(Boolean) as NavItem[];
}

function NavLinkItem({
  item,
  collapsed,
  onNavigate,
  isActive,
}: {
  item: NavLink;
  collapsed: boolean;
  onNavigate?: () => void;
  isActive: boolean;
}) {
  const t = useTranslations("layout");
  const Icon = item.icon;
  // i18n-dynamic: layout.nav.*
  const label = t(`nav.${item.id}`);

  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "flex items-center rounded-md px-3 py-2 text-sm transition-colors",
        collapsed ? "justify-center px-0" : "gap-2",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          : "hover:bg-sidebar-accent/50"
      )}
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return link;
}

function NavGroup({
  item,
  collapsed,
  onNavigate,
  pathname,
}: {
  item: NavGroupItem;
  collapsed: boolean;
  onNavigate?: () => void;
  pathname: string;
}) {
  const t = useTranslations("layout");
  const { openGroups, toggleGroup } = useSidebarStore();
  const isOpen = openGroups.includes(item.id);
  const hasActiveChild = item.children.some((child) => pathname === child.href);

  const Icon = item.icon;

  // Collapsed mode: show all child icons directly
  if (collapsed) {
    return (
      <>
        {item.children.map((child) => (
          <NavLinkItem
            key={child.href}
            item={child}
            collapsed
            onNavigate={onNavigate}
            isActive={pathname === child.href}
          />
        ))}
      </>
    );
  }

  return (
    <div>
      <button
        onClick={() => toggleGroup(item.id)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
          "hover:bg-sidebar-accent/50",
          hasActiveChild && "text-sidebar-accent-foreground"
        )}
      >
        <Icon className="size-4 shrink-0" />
        <span className="flex-1 text-left">{t(`nav.${item.id}`)}</span>
        {isOpen ? (
          <ChevronDown className="size-3.5 shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" />
        )}
      </button>
      <div
        className={cn(
          "overflow-hidden transition-all duration-200",
          isOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <div className="ml-3 border-l border-border/50 pl-2 py-0.5">
          {item.children.map((child) => (
            <NavLinkItem
              key={child.href}
              item={child}
              collapsed={false}
              onNavigate={onNavigate}
              isActive={pathname === child.href}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SidebarContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const navItems = useFilteredNavItems();
  const setOpenGroups = useSidebarStore((s) => s.setOpenGroups);

  // On navigation (and on full page load): open only the group containing the active page, close others
  useEffect(() => {
    setOpenGroups(activeGroupIds(pathname));
  }, [pathname, setOpenGroups]);

  if (!navItems) {
    return (
      <nav className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-8 rounded-md bg-sidebar-accent/30 animate-pulse",
              collapsed ? "mx-auto w-8" : "w-full"
            )}
          />
        ))}
      </nav>
    );
  }

  return (
    <nav className="flex-1 overflow-y-auto p-2">
      {navItems.map((item) => {
        if ("type" in item && item.type === "group") {
          return (
            <NavGroup
              key={item.id}
              item={item}
              collapsed={collapsed}
              onNavigate={onNavigate}
              pathname={pathname}
            />
          );
        }

        if ("href" in item) {
          return (
            <NavLinkItem
              key={item.href}
              item={item as NavLink}
              collapsed={collapsed}
              onNavigate={onNavigate}
              isActive={pathname === item.href}
            />
          );
        }

        return null;
      })}
    </nav>
  );
}

function SidebarLogo({ collapsed }: { collapsed: boolean }) {
  const { data: config, dataUpdatedAt } = useConfig();
  const { resolvedTheme } = useTheme();
  const appTitle = config?.APP_TITLE || "";
  const logoPath = resolveThemedAsset(config, "APP_LOGO", resolvedTheme);

  return (
    <Link href="/planning" className="flex items-center gap-2 flex-1 min-w-0">
      {collapsed ? null : logoPath ? (
        <img
          src={`/api/${logoPath.startsWith("branding/") ? "" : "files/"}${logoPath}?v=${dataUpdatedAt}`}
          alt={appTitle}
          className="h-10 max-w-[180px] object-contain shrink-0"
        />
      ) : (
        <span className="text-lg font-bold truncate">{appTitle}</span>
      )}
    </Link>
  );
}

export function Sidebar() {
  const t = useTranslations("layout.sidebar");
  const tA11y = useTranslations("common.a11y");
  const { collapsed, mobileOpen, toggle, setMobileOpen } = useSidebarStore();

  return (
    <TooltipProvider delayDuration={0}>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-sidebar text-sidebar-foreground transition-transform duration-200 md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <SidebarLogo collapsed={false} />
          <button
            onClick={() => setMobileOpen(false)}
            aria-label={tA11y("close")}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>
        <SidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} />
        <UpdateBanner collapsed={false} onNavigate={() => setMobileOpen(false)} />
        <SidebarFooter collapsed={false} />
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden md:flex h-full flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200",
          collapsed ? "w-14" : "w-56"
        )}
      >
        <div className="flex h-14 items-center border-b px-3">
          <SidebarLogo collapsed={collapsed} />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggle}
                aria-label={collapsed ? t("expand") : t("collapse")}
                className={cn(
                  "flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground transition-colors",
                  collapsed && "mx-auto"
                )}
              >
                {collapsed ? (
                  <PanelLeftOpen className="size-4" />
                ) : (
                  <PanelLeftClose className="size-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{collapsed ? t("expand") : t("collapse")}</TooltipContent>
          </Tooltip>
        </div>
        <SidebarContent collapsed={collapsed} />
        <UpdateBanner collapsed={collapsed} />
        <SidebarFooter collapsed={collapsed} />
      </aside>
    </TooltipProvider>
  );
}
