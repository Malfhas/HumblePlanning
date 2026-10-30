"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MapPin, Building2, Landmark, TreePine, Search, Loader2 } from "lucide-react";
import type { AddressMapPickerProps } from "./address-map-picker";

// --- Unified search result ---
interface SearchResult {
  lat: number;
  lng: number;
  title: string;
  subtitle: string;
  fullAddress: string;
  source: "ban" | "photon";
  icon: "address" | "business" | "landmark" | "nature" | "city";
}

// --- BAN (Base Adresse Nationale) ---
interface BANFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    label: string;
    name: string;
    postcode?: string;
    city?: string;
    context?: string;
    type: string;
    score: number;
  };
}

function banToResult(f: BANFeature): SearchResult {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  return {
    lat,
    lng,
    title: p.name,
    subtitle: [p.postcode, p.city, p.context?.split(",").pop()?.trim()].filter(Boolean).join(", "),
    fullAddress: p.label,
    source: "ban",
    icon: p.type === "municipality" ? "city" : "address",
  };
}

// --- Photon (Komoot) ---
interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    housenumber?: string;
    street?: string;
    postcode?: string;
    city?: string;
    state?: string;
    country?: string;
    osm_key?: string;
    osm_value?: string;
    type?: string;
  };
}

function photonToResult(f: PhotonFeature): SearchResult {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;

  // Determine icon
  const key = p.osm_key ?? "";
  const value = p.osm_value ?? "";
  let icon: SearchResult["icon"] = "address";
  if (["company", "office", "shop", "craft", "industrial"].some((k) => key.includes(k) || value.includes(k))) icon = "business";
  else if (["tourism", "historic", "amenity", "public_building"].some((k) => key.includes(k) || value.includes(k))) icon = "landmark";
  else if (["park", "forest", "garden", "nature"].some((k) => key.includes(k) || value.includes(k))) icon = "nature";
  else if (p.type === "city" || p.type === "district" || p.type === "locality") icon = "city";

  // Format title/subtitle
  let title: string;
  let subtitle: string;
  if (p.name && p.street) {
    title = p.name;
    subtitle = [p.housenumber, p.street, p.postcode, p.city].filter(Boolean).join(", ");
  } else if (p.name) {
    title = p.name;
    subtitle = [p.postcode, p.city, p.state].filter(Boolean).join(", ");
  } else {
    const parts: string[] = [];
    if (p.housenumber && p.street) parts.push(`${p.housenumber} ${p.street}`);
    else if (p.street) parts.push(p.street);
    title = parts.join(", ") || p.city || p.state || "—";
    subtitle = [p.postcode, p.city, p.state, p.country].filter((v) => v && v !== title).join(", ");
  }

  // Full address
  const addrParts: string[] = [];
  if (p.name) addrParts.push(p.name);
  if (p.housenumber && p.street) addrParts.push(`${p.housenumber} ${p.street}`);
  else if (p.street) addrParts.push(p.street);
  if (p.postcode || p.city) addrParts.push([p.postcode, p.city].filter(Boolean).join(" "));
  if (p.state) addrParts.push(p.state);
  if (p.country) addrParts.push(p.country);

  return { lat, lng, title, subtitle, fullAddress: addrParts.join(", "), source: "photon", icon };
}

function ResultIcon({ type }: { type: SearchResult["icon"] }) {
  switch (type) {
    case "business": return <Building2 className="h-4 w-4 shrink-0 text-blue-500" />;
    case "landmark": return <Landmark className="h-4 w-4 shrink-0 text-amber-500" />;
    case "nature": return <TreePine className="h-4 w-4 shrink-0 text-green-500" />;
    case "city": return <MapPin className="h-4 w-4 shrink-0 text-red-500" />;
    default: return <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />;
  }
}

// --- Tile layers ---
const TILE_SATELLITE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const TILE_LABELS_PLACES = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const TILE_LABELS_ROADS = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}";
const TILE_STREET = "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}";

const SatelliteIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 7L9 3 5 7l4 4" /><path d="m17 11 4 4-4 4-4-4" />
    <path d="m8 12 4 4 6-6-4-4Z" /><path d="m16 8 3-3" /><path d="M9 21a6 6 0 0 0-6-6" />
  </svg>
);

const MapIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3 7 6-3 6 3 6-3v13l-6 3-6-3-6 3Z" /><path d="M9 4v13" /><path d="M15 7v13" />
  </svg>
);

function LayerToggle({ satellite, onToggle }: { satellite: boolean; onToggle: () => void }) {
  const t = useTranslations("ui.addressMap");
  return (
    <div className="leaflet-top leaflet-right" style={{ pointerEvents: "auto" }}>
      <div className="leaflet-control leaflet-bar" style={{ marginTop: 10, marginRight: 10 }}>
        <button
          type="button"
          onClick={onToggle}
          title={satellite ? t("mapView") : t("satelliteView")}
          aria-label={satellite ? t("mapView") : t("satelliteView")}
          style={{
            width: 34,
            height: 34,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "white",
            border: "none",
            cursor: "pointer",
          }}
        >
          {satellite ? <MapIcon /> : <SatelliteIcon />}
        </button>
      </div>
    </div>
  );
}

function MapUpdater({ lat, lng, zoom, seq }: { lat: number; lng: number; zoom?: number; seq: number }) {
  const map = useMap();
  const appliedSeqRef = useRef(-1);
  const initializedRef = useRef(false);

  // Initial centering when coordinates are loaded (edit mode)
  useEffect(() => {
    if (!initializedRef.current && lat && lng) {
      map.setView([lat, lng], 18);
      initializedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  // Zoom on address selection
  useEffect(() => {
    if (zoom != null && seq !== appliedSeqRef.current) {
      map.setView([lat, lng], zoom);
      appliedSeqRef.current = seq;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);
  return null;
}

function CenterTracker({ onMove }: { onMove: (lat: number, lng: number) => void }) {
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  useMapEvents({
    moveend(e) {
      const center = e.target.getCenter();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onMove(center.lat, center.lng);
      }, 300);
    },
  });

  return null;
}

function PinBusiness() {
  return (
    <svg width="32" height="42" viewBox="0 0 32 42" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="ps" x="-2" y="-1" width="36" height="48">
          <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#000" floodOpacity="0.25" />
        </filter>
        <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ef4444" />
          <stop offset="100%" stopColor="#dc2626" />
        </linearGradient>
      </defs>
      <path d="M4 0h24a4 4 0 014 4v22a4 4 0 01-4 4H19.5l-3.5 7-3.5-7H4a4 4 0 01-4-4V4a4 4 0 014-4z" fill="url(#pg)" filter="url(#ps)" />
      <rect x="9" y="8" width="8" height="14" rx="0.5" fill="white" opacity="0.95" />
      <rect x="18" y="12" width="5.5" height="10" rx="0.5" fill="white" opacity="0.75" />
      <rect x="11" y="10.5" width="2" height="2" rx="0.4" fill="#ef4444" />
      <rect x="14" y="10.5" width="2" height="2" rx="0.4" fill="#ef4444" />
      <rect x="11" y="14" width="2" height="2" rx="0.4" fill="#ef4444" />
      <rect x="14" y="14" width="2" height="2" rx="0.4" fill="#ef4444" />
      <rect x="12.5" y="18" width="3" height="4" rx="0.5" fill="#dc2626" />
      <rect x="20" y="14.5" width="1.8" height="1.8" rx="0.3" fill="#ef4444" />
      <rect x="20" y="17.5" width="1.8" height="1.8" rx="0.3" fill="#ef4444" />
    </svg>
  );
}

function PinConstruction() {
  return (
    <svg width="32" height="42" viewBox="0 0 32 42" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="ps2" x="-2" y="-1" width="36" height="48">
          <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#000" floodOpacity="0.25" />
        </filter>
        <linearGradient id="pg2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#eab308" />
          <stop offset="100%" stopColor="#ca8a04" />
        </linearGradient>
      </defs>
      <path d="M4 0h24a4 4 0 014 4v22a4 4 0 01-4 4H19.5l-3.5 7-3.5-7H4a4 4 0 01-4-4V4a4 4 0 014-4z" fill="url(#pg2)" filter="url(#ps2)" />
      {/* Traffic cone */}
      <polygon points="16,7 21.5,21 10.5,21" fill="white" opacity="0.95" />
      <rect x="12" y="12" width="8" height="2" rx="0.3" fill="#ca8a04" opacity="0.8" />
      <rect x="11" y="16" width="10" height="2" rx="0.3" fill="#ca8a04" opacity="0.8" />
      {/* Cone base */}
      <rect x="8.5" y="21" width="15" height="2.5" rx="0.8" fill="white" opacity="0.85" />
    </svg>
  );
}

export default function AddressMapInner({
  address,
  latitude,
  longitude,
  onAddressChange,
  onLocationChange,
  required = false,
  height = "300px",
  pinVariant = "business",
}: AddressMapPickerProps) {
  const t = useTranslations("ui.addressMap");
  const [query, setQuery] = useState(address);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const [targetZoom, setTargetZoom] = useState<number | undefined>(undefined);
  const [zoomSeq, setZoomSeq] = useState(0);
  const [satellite, setSatellite] = useState(true);
  const programmaticMoveRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputWrapperRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setQuery(address);
  }, [address]);

  const geocode = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setSearching(true);
    try {
      // Search BAN + Photon in parallel
      const [banRes, photonRes] = await Promise.allSettled([
        fetch(
          `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5`,
          { signal: controller.signal }
        ).then((r) => r.json()),
        fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=fr&limit=5&lat=46.6&lon=2.0`,
          { signal: controller.signal }
        ).then((r) => r.json()),
      ]);

      const banResults: SearchResult[] =
        banRes.status === "fulfilled"
          ? (banRes.value.features ?? []).map(banToResult)
          : [];

      const photonResults: SearchResult[] =
        photonRes.status === "fulfilled"
          ? (photonRes.value.features ?? [])
              .map(photonToResult)
              // Filter out Photon results that duplicate BAN results (same coords ±0.001)
              .filter((pr: SearchResult) =>
                !banResults.some(
                  (br) => Math.abs(br.lat - pr.lat) < 0.001 && Math.abs(br.lng - pr.lng) < 0.001
                )
              )
          : [];

      // BAN first (precise French addresses), then Photon (POIs/businesses)
      const merged = [...banResults, ...photonResults].slice(0, 8);
      setResults(merged);
      setShowDropdown(merged.length > 0);
    } catch (e: any) {
      if (e.name !== "AbortError") setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleInputChange = (value: string) => {
    setQuery(value);
    onAddressChange(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => geocode(value), 250);
  };

  const handleSelect = (result: SearchResult) => {
    setQuery(result.fullAddress);
    onAddressChange(result.fullAddress);
    programmaticMoveRef.current = true;
    onLocationChange(result.lat, result.lng);
    setTargetZoom(18);
    setZoomSeq((s) => s + 1);
    setShowDropdown(false);
  };

  const handleMapMove = useCallback(
    async (lat: number, lng: number) => {
      if (programmaticMoveRef.current) {
        programmaticMoveRef.current = false;
        return;
      }
      onLocationChange(lat, lng);
      try {
        // Use BAN reverse for French addresses (more precise)
        const res = await fetch(
          `https://api-adresse.data.gouv.fr/reverse/?lat=${lat}&lon=${lng}`
        );
        const data = await res.json();
        const feature = data.features?.[0];
        if (feature?.properties?.label) {
          setQuery(feature.properties.label);
          onAddressChange(feature.properties.label);
          return;
        }
        // Fallback to Photon for non-French locations
        const res2 = await fetch(
          `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=fr`
        );
        const data2 = await res2.json();
        const pFeature: PhotonFeature | undefined = data2.features?.[0];
        if (pFeature) {
          const r = photonToResult(pFeature);
          setQuery(r.fullAddress);
          onAddressChange(r.fullAddress);
        }
      } catch {
        // Silent
      }
    },
    [onAddressChange, onLocationChange]
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        dropdownRef.current && !dropdownRef.current.contains(target) &&
        inputWrapperRef.current && !inputWrapperRef.current.contains(target)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const hasLocation = latitude !== null && longitude !== null;
  const center: [number, number] = hasLocation
    ? [latitude!, longitude!]
    : [46.603354, 1.888334];

  return (
    <div className={`space-y-3 ${showDropdown ? "address-dropdown-open" : ""}`}>
      {/* Force overflow visible on parent dialog when dropdown is open */}
      {showDropdown && (
        <style>{`[data-slot="dialog-content"]:has(.address-dropdown-open) { overflow: visible !important; }`}</style>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="address-map-search">{t("label")} {required && "*"}</Label>
        <div className="relative" ref={inputWrapperRef}>
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="address-map-search"
            name="address-search"
            autoComplete="off"
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder={t("searchPlaceholder")}
            required={required}
            className="pl-9 pr-9"
          />
          {searching && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
          {showDropdown && results.length > 0 && (
            <div
              ref={dropdownRef}
              className="absolute left-0 right-0 top-full mt-1 z-[9999] rounded-md border bg-popover shadow-lg overflow-y-auto"
              style={{ maxHeight: 280 }}
            >
              {results.map((result, i) => (
                <button
                  key={`${result.source}-${i}`}
                  type="button"
                  className="w-full text-left px-3 py-2.5 hover:bg-accent flex items-start gap-2.5 border-b border-border/30 last:border-0"
                  onClick={() => handleSelect(result)}
                >
                  <ResultIcon type={result.icon} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{result.title}</div>
                    {result.subtitle && (
                      <div className="text-xs text-muted-foreground truncate">{result.subtitle}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {/* Map container with hidden attribution */}
      <style>{`.leaflet-control-attribution { display: none !important; }`}</style>
      {hasLocation && <div className="relative rounded-md overflow-hidden border" style={{ height }}>
        {hasLocation && (
          <>
            {/* Ground shadow */}
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, 2px)",
                zIndex: 999,
                pointerEvents: "none",
                width: 16,
                height: 5,
                borderRadius: "50%",
                background: "rgba(0,0,0,0.2)",
                filter: "blur(2px)",
              }}
            />
            {/* Map pin */}
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -100%)",
                zIndex: 1000,
                pointerEvents: "none",
              }}
            >
              {pinVariant === "construction" ? <PinConstruction /> : <PinBusiness />}
            </div>
          </>
        )}
        <MapContainer
          center={center}
          zoom={hasLocation ? 18 : 6}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom
          attributionControl={false}
        >
          <TileLayer
            key={satellite ? "sat" : "street"}
            url={satellite ? TILE_SATELLITE : TILE_STREET}
          />
          {satellite && (
            <>
              <TileLayer key="labels-roads" url={TILE_LABELS_ROADS} pane="overlayPane" />
              <TileLayer key="labels-places" url={TILE_LABELS_PLACES} pane="overlayPane" />
            </>
          )}
          <LayerToggle satellite={satellite} onToggle={() => setSatellite((s) => !s)} />
          {hasLocation && (
            <>
              <MapUpdater lat={latitude!} lng={longitude!} zoom={targetZoom} seq={zoomSeq} />
              <CenterTracker onMove={handleMapMove} />
            </>
          )}
        </MapContainer>
      </div>}
      {hasLocation && (
        <p className="text-xs text-muted-foreground">
          {t("coordinates", { lat: latitude?.toFixed(5) ?? "", lng: longitude?.toFixed(5) ?? "" })}
        </p>
      )}
    </div>
  );
}
