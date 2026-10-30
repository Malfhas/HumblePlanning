"use client";

import { useState } from "react";
import { MapPin, AlertTriangle, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AddressMapPicker } from "@/components/shared/address-map-picker";
import { cn } from "@/lib/utils";
import type { ProjectWithRelations } from "@/types";

interface TaskLocationSectionProps {
  projectId: string;
  projects: ProjectWithRelations[] | undefined;
  placeText: string;
  placeTextLat: number | null;
  placeTextLng: number | null;
  onPlaceTextChange: (address: string) => void;
  onPlaceLocationChange: (lat: number, lng: number) => void;
}

export function TaskLocationSection({
  projectId,
  projects,
  placeText,
  placeTextLat,
  placeTextLng,
  onPlaceTextChange,
  onPlaceLocationChange,
}: TaskLocationSectionProps) {
  const t = useTranslations("taskForm.location");
  const [open, setOpen] = useState(false);

  const project = projects?.find((p) => p.id === projectId) as any;
  const hasProjectAddress = !!(project?.address && project?.addressLat && project?.addressLng);

  if (!projectId) return null;

  // Summary for collapsed state
  const summary = hasProjectAddress ? project.address : placeText;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-md border border-border/50 bg-muted/20">
        <div className="flex items-center justify-between px-3 h-9">
          <CollapsibleTrigger asChild>
            <button type="button" className="flex items-center gap-1.5 text-sm font-medium hover:text-foreground/80 flex-1 min-w-0">
              <MapPin className="h-4 w-4 shrink-0" />
              {t("title")}
              {!open && summary && (
                <span className="text-xs text-muted-foreground font-normal ml-2 truncate flex-1 min-w-0">
                  {summary}
                </span>
              )}
              <span className="ml-auto rounded-sm p-1 text-muted-foreground/70 transition-all duration-200 hover:bg-muted hover:text-foreground">
                <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
              </span>
            </button>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent className="px-3 pb-3 space-y-3">
          {/* Case 1: Project has address */}
          {hasProjectAddress && (
            <div className="flex items-start gap-2 text-sm">
              <MapPin className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
              <div>
                <span className="font-medium">{project.address}</span>
                <span className="block text-xs text-muted-foreground">
                  {t("projectSite", { name: project.name })}
                </span>
              </div>
            </div>
          )}

          {/* Case 2: No project address → show AddressMapPicker */}
          {!hasProjectAddress && (
            <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>{t("noProjectAddress")}</span>
              </div>
              <AddressMapPicker
                address={placeText}
                latitude={placeTextLat}
                longitude={placeTextLng}
                onAddressChange={onPlaceTextChange}
                onLocationChange={onPlaceLocationChange}
                height="220px"
                pinVariant="construction"
              />
            </>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
