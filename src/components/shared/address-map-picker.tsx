"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

/**
 * Loader shown while `AddressMapInner` loads asynchronously.
 *
 * The `address-map-inner.tsx` component holds both the address
 * autocomplete field AND the Leaflet map (tightly coupled via
 * local state + refs). Until the dynamic chunk is loaded,
 * NEITHER is available → a fallback must be shown.
 *
 * The text is neutral ("Initializing…") because on creation the user
 * does not specifically expect a map: they just opened the dialog.
 * On edit, it stays consistent (the map does appear afterwards).
 *
 * Reuses the same visual pattern as `PlanningSkeleton`: Lucide
 * spinner + pulsing label, muted background, centered.
 */
function AddressMapLoading() {
  const t = useTranslations("ui.addressMap");
  return (
    <div
      className="flex items-center justify-center rounded-md border bg-muted/30"
      style={{ height: "var(--map-height, 300px)" }}
    >
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-xs font-medium animate-pulse">{t("loading")}</p>
      </div>
    </div>
  );
}

export interface AddressMapPickerProps {
  address: string;
  latitude: number | null;
  longitude: number | null;
  onAddressChange: (address: string) => void;
  onLocationChange: (lat: number, lng: number) => void;
  required?: boolean;
  height?: string;
  pinVariant?: "business" | "construction";
}

// A single dynamic import with a visible loader: the inner component holds
// both the address autocomplete field (always needed) and the
// Leaflet map (heavy, ~150 KB). Everything is loaded at once, with
// a loader while Next downloads the chunk + initializes Leaflet.
const AddressMapInner = dynamic(() => import("./address-map-inner"), {
  ssr: false,
  loading: () => <AddressMapLoading />,
});

export function AddressMapPicker(props: AddressMapPickerProps) {
  // Expose `props.height` as a CSS variable so that `AddressMapLoading`
  // (rendered by `dynamic({ loading })`) can take up the same area
  // as the final map: no layout shift when it loads.
  return (
    <div style={{ "--map-height": props.height ?? "300px" } as React.CSSProperties}>
      <AddressMapInner {...props} />
    </div>
  );
}
