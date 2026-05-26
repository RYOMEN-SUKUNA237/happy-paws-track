import mapboxgl from 'mapbox-gl';
import along from '@turf/along';
import length from '@turf/length';
import { lineString } from '@turf/helpers';

// ─── SHARED FETCH TIMEOUT HELPER ────────────────────────────────────────
// Ensures all Mapbox API calls time out after ms milliseconds so the
// UI never hangs with an infinite loading spinner.
async function fetchWithTimeout(url: string, ms = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

declare const __MAPBOX_TOKEN__: string;
export const MAPBOX_TOKEN =
  (typeof __MAPBOX_TOKEN__ !== 'undefined' && __MAPBOX_TOKEN__)
    ? __MAPBOX_TOKEN__
    : ((import.meta as any).env?.VITE_MAPBOX_TOKEN ?? '');

export function initMapbox() {
  if (MAPBOX_TOKEN) {
    (mapboxgl as any).accessToken = MAPBOX_TOKEN;
  }
}

export async function geocodeAddress(query: string): Promise<{ lng: number; lat: number; place_name: string } | null> {
  if (!MAPBOX_TOKEN) return null;
  try {
    const res = await fetchWithTimeout(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&limit=1`
    );
    const data = await res.json();
    if (data.features && data.features.length > 0) {
      const [lng, lat] = data.features[0].center;
      return { lng, lat, place_name: data.features[0].place_name };
    }
  } catch (e) {
    console.error('Geocode error:', e);
  }
  return null;
}

export async function geocodeSearch(query: string): Promise<Array<{ lng: number; lat: number; place_name: string }>> {
  if (!MAPBOX_TOKEN) return [];
  try {
    const res = await fetchWithTimeout(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&limit=5`
    );
    const data = await res.json();
    return (data.features || []).map((f: any) => ({
      lng: f.center[0],
      lat: f.center[1],
      place_name: f.place_name,
    }));
  } catch (e) {
    console.error('Geocode search error:', e);
    return [];
  }
}

// ─── ROUTE STYLE CONSTANTS (Aura Track Theme) ──────────────────────
export const ROUTE_STYLE = {
  color: '#0a192f',          // Navy blue
  width: 5,
  glowColor: '#0a192f',
  glowWidth: 14,
  glowOpacity: 0.08,
  opacity: 0.85,
  lineJoin: 'round' as const,
  lineCap: 'round' as const,
  pausedDash: [2, 2] as number[],
  activeDash: [1] as number[],
};

// ─── TRUE ROUTE (Mapbox Directions API) ─────────────────────────────
export interface TrueRouteResult {
  geometry: { type: string; coordinates: [number, number][] };
  distance: number;   // meters
  duration: number;   // seconds
  legs: any[];
  steps: any[];
  summary: string;
}

export async function getTrueRoute(
  startCoords: [number, number],
  endCoords: [number, number],
  profile: 'driving' | 'driving-traffic' | 'walking' | 'cycling' = 'driving'
): Promise<TrueRouteResult | null> {
  if (!MAPBOX_TOKEN) return null;
  try {
    const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/` +
      `${startCoords[0]},${startCoords[1]};${endCoords[0]},${endCoords[1]}` +
      `?geometries=geojson&overview=full&steps=true&access_token=${MAPBOX_TOKEN}`;

    const res = await fetchWithTimeout(url, 10000);
    const data = await res.json();

    if (data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      // Keep up to 1000 points for accurate road rendering
      const coords: [number, number][] = route.geometry?.coordinates || [];
      if (coords.length > 1000) {
        const step = Math.ceil(coords.length / 1000);
        route.geometry.coordinates = coords.filter((_: any, i: number) => i % step === 0 || i === coords.length - 1);
      }

      // Collect all steps from all legs
      const allSteps: any[] = [];
      for (const leg of (route.legs || [])) {
        allSteps.push(...(leg.steps || []));
      }

      return {
        geometry: route.geometry,
        distance: route.distance,
        duration: route.duration,
        legs: route.legs || [],
        steps: allSteps,
        summary: route.legs?.[0]?.summary || '',
      };
    }
  } catch (e) {
    console.error('getTrueRoute error:', e);
  }
  return null;
}

// Legacy alias — keep backward compat for any older callers
export const getRoute = getTrueRoute;

export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}d ${remHours}h`;
  }
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function determineTransportModes(distance: number, cargoType: string): string[] {
  const modes: string[] = [];
  const distKm = distance / 1000;

  if (distKm > 5000) {
    modes.push('Air Freight', 'Ground Transport');
  } else if (distKm > 1000) {
    modes.push('Long-Haul Trucking', 'Regional Distribution');
  } else if (distKm > 200) {
    modes.push('Interstate Trucking');
  } else if (distKm > 50) {
    modes.push('Regional Delivery Van');
  } else {
    modes.push('Local Courier');
  }

  if (cargoType === 'Fragile') modes.push('Climate-Controlled');
  if (cargoType === 'Hazardous') modes.push('HazMat Certified');
  if (cargoType === 'Perishable') modes.push('Refrigerated');
  if (cargoType === 'Express') modes.push('Priority Express');

  modes.push('Last-Mile Delivery');
  return modes;
}

export function generateStraightLine(
  origin: [number, number],
  destination: [number, number],
  numPoints: number = 100
): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i <= numPoints; i++) {
    const f = i / numPoints;
    points.push([
      origin[0] + (destination[0] - origin[0]) * f,
      origin[1] + (destination[1] - origin[1]) * f
    ]);
  }
  return points;
}

// ─── GREAT CIRCLE ARC ────────────────────────────────────────────────
// For air/sea routes where road directions aren't available
export function generateGreatCircleArc(
  origin: [number, number],
  destination: [number, number],
  numPoints: number = 100
): [number, number][] {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;

  const lat1 = toRad(origin[1]);
  const lon1 = toRad(origin[0]);
  const lat2 = toRad(destination[1]);
  const lon2 = toRad(destination[0]);

  const d = 2 * Math.asin(
    Math.sqrt(
      Math.pow(Math.sin((lat2 - lat1) / 2), 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin((lon2 - lon1) / 2), 2)
    )
  );

  if (d < 1e-10) return [origin, destination];

  const points: [number, number][] = [];
  for (let i = 0; i <= numPoints; i++) {
    const f = i / numPoints;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lon = Math.atan2(y, x);
    points.push([toDeg(lon), toDeg(lat)]);
  }
  return points;
}

// Try road route first, fall back to great circle arc for air/sea
export async function getRouteWithFallback(
  origin: [number, number],
  destination: [number, number],
  profile: 'driving' | 'driving-traffic' | 'walking' | 'cycling' = 'driving'
): Promise<{
  geometry: { type: string; coordinates: [number, number][] };
  distance: number;
  duration: number;
  steps: any[];
  isArc: boolean;
}> {
  // Try true road route
  const route = await getTrueRoute(origin, destination, profile);
  if (route?.geometry?.coordinates?.length > 2) {
    return {
      geometry: route.geometry,
      distance: route.distance,
      duration: route.duration,
      steps: route.steps,
      isArc: false,
    };
  }

  // Fallback: great circle arc (air/sea route)
  const coords = generateGreatCircleArc(origin, destination);
  // Approximate distance using Haversine
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(destination[1] - origin[1]);
  const dLon = toRad(destination[0] - origin[0]);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(origin[1])) * Math.cos(toRad(destination[1])) * Math.sin(dLon / 2) ** 2;
  const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  // Rough estimate: 800 km/h for air, ~30 km/h for sea
  const speedMs = dist > 2000000 ? 222 : 8.3; // m/s
  const dur = dist / speedMs;

  return {
    geometry: { type: 'LineString', coordinates: coords },
    distance: dist,
    duration: dur,
    steps: [],
    isArc: true,
  };
}

// ─── TURF.JS POSITION CALCULATION ───────────────────────────────────
// Uses @turf/along for geodesic-accurate position along real road geometry

export function interpolateAlongRoute(
  coordinates: [number, number][],
  progress: number
): [number, number] {
  if (!coordinates || coordinates.length < 2) return coordinates?.[0] || [0, 0];
  if (progress <= 0) return coordinates[0];
  if (progress >= 100) return coordinates[coordinates.length - 1];

  try {
    const line = lineString(coordinates);
    const totalKm = length(line, { units: 'kilometers' });
    const targetKm = (progress / 100) * totalKm;
    const point = along(line, targetKm, { units: 'kilometers' });
    return point.geometry.coordinates as [number, number];
  } catch {
    // Fallback to simple linear interpolation if Turf fails
    const idx = Math.floor((progress / 100) * (coordinates.length - 1));
    return coordinates[Math.min(idx, coordinates.length - 1)];
  }
}

/**
 * Calculate position at a given time along a route.
 * Uses Turf.js turf.along for geodesic-accurate snapping to real road geometry.
 *
 * @param startTime  - ISO string or Date when transit began
 * @param duration   - total expected travel duration in seconds
 * @param routeCoordinates - GeoJSON coordinates array from the route geometry
 * @returns { position, progress } — [lng, lat] and 0-100 progress
 */
export function calculatePositionAtTime(
  startTime: string | Date,
  duration: number,
  routeCoordinates: [number, number][]
): { position: [number, number]; progress: number } {
  if (!routeCoordinates || routeCoordinates.length < 2 || duration <= 0) {
    return { position: routeCoordinates?.[0] || [0, 0], progress: 0 };
  }

  const startMs = new Date(startTime).getTime();
  const elapsedMs = Date.now() - startMs;
  const elapsedSec = elapsedMs / 1000;
  const progress = Math.max(0, Math.min(100, (elapsedSec / duration) * 100));

  const position = interpolateAlongRoute(routeCoordinates, progress);
  return { position, progress };
}

// ─── TIME-BASED PROGRESS ─────────────────────────────────────────────────────
// Single canonical formula — mirrors server/routes/shipments.js computeProgress():
//   progress = (now - departed_at) / (estimated_delivery - departed_at)
//
// estimated_delivery is ALWAYS a full ISO timestamp stored at creation time as:
//   departed_at + route_duration_seconds
//
// This guarantees ONE consistent number across Admin Dashboard, Live Map,
// and Tracking Page — no more two different ETAs for the same shipment.
export interface ShipmentTimeData {
  status: string;
  departed_at?: string | null;
  estimated_delivery?: string | null;
  route_duration?: number | string | null; // kept for display purposes only
  is_paused?: number | boolean;
  paused_at?: string | null;
  total_paused_ms?: number;
  progress?: number;
  computed_progress?: number;
}

export function computeTimeBasedProgress(s: ShipmentTimeData): number {
  if (s.status === 'delivered' || s.status === 'returned') return 100;
  if (s.status === 'pending') return 0;
  // Paused: frozen snapshot — never let it tick forward
  if (s.is_paused || (s as any).isPaused) return s.computed_progress ?? s.progress ?? 0;
  if (!s.departed_at || !s.estimated_delivery) return s.computed_progress ?? s.progress ?? 0;

  const departedMs  = new Date(s.departed_at).getTime();
  const estStr      = s.estimated_delivery.includes('T')
    ? s.estimated_delivery
    : s.estimated_delivery + 'T00:00:00.000Z';
  const estimatedMs = new Date(estStr).getTime();
  const totalPausedMs = Number(s.total_paused_ms) || 0;
  let totalDur    = estimatedMs - departedMs - totalPausedMs;
  if (totalDur <= 0 && s.route_duration) {
    totalDur = Number(s.route_duration) * 1000;
  }
  if (totalDur <= 0) return 100;

  const nowMs         = Date.now();
  const elapsedActive = (nowMs - departedMs) - totalPausedMs;
  const pct           = Math.max(0, Math.min(100, (elapsedActive / totalDur) * 100));

  // Never let the live ticker fall behind the server-computed value
  const floored = s.computed_progress != null && pct < s.computed_progress
    ? s.computed_progress
    : pct;

  return Math.round(floored * 100) / 100;
}

export function computeTimeRemaining(s: ShipmentTimeData): string {
  if (s.status === 'delivered' || s.status === 'returned') return 'Delivered';
  if (s.status === 'pending') return 'Awaiting pickup';
  if (s.is_paused) return 'On Hold';
  if (!s.departed_at || !s.estimated_delivery) return 'Calculating...';

  const estStr      = s.estimated_delivery.includes('T')
    ? s.estimated_delivery
    : s.estimated_delivery + 'T00:00:00.000Z';
  const estimatedMs = new Date(estStr).getTime();

  const nowMs       = Date.now();
  // Remaining time is simply the duration from now to the estimated delivery date
  const remainingMs = Math.max(0, estimatedMs - nowMs);

  if (remainingMs <= 0) return 'Arriving now';

  const totalMins = Math.floor(remainingMs / 60000);
  const days      = Math.floor(totalMins / 1440);
  const hours     = Math.floor((totalMins % 1440) / 60);
  const mins      = totalMins % 60;

  if (days > 0)  return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${mins}m remaining`;
  return `${mins}m remaining`;
}

// ─── MULTI-MODAL ROUTE HELPERS ──────────────────────────────────────

import type { RouteSegment, TransitStop } from './transportPlanner';

export interface MultiModalPosition {
  position: [number, number];
  progress: number;           // 0-100 overall
  currentSegmentIndex: number;
  currentMode: 'road' | 'air' | 'sea' | 'transit';
  currentLabel: string;
  segmentProgress: number;    // 0-100 within segment
  speedKmh: number;
  transitStopName?: string;
}

/**
 * Interpolate position along a multi-modal route.
 * Takes segments + transit stops and an overall progress (0-100).
 * Accounts for transit stop wait times proportionally.
 */
export function interpolateMultiModal(
  segments: RouteSegment[],
  transitStops: TransitStop[],
  totalDurationHours: number,
  progress: number
): MultiModalPosition {
  if (!segments || segments.length === 0) {
    return { position: [0, 0], progress: 0, currentSegmentIndex: 0, currentMode: 'road', currentLabel: '', segmentProgress: 0, speedKmh: 0 };
  }

  const clampedProgress = Math.max(0, Math.min(100, progress));

  // Build timeline: segment durations + transit stop waits interleaved
  // Pattern: [segment0] [stop0] [segment1] [stop1] [segment2] ...
  interface TimeSlice {
    type: 'segment' | 'transit';
    index: number;       // index into segments or transitStops
    durationHours: number;
    startFraction: number;
    endFraction: number;
  }

  const slices: TimeSlice[] = [];
  let totalH = 0;

  for (let i = 0; i < segments.length; i++) {
    slices.push({ type: 'segment', index: i, durationHours: segments[i].durationHours, startFraction: 0, endFraction: 0 });
    totalH += segments[i].durationHours;

    // Add transit stop after this segment if one exists at the segment's destination
    const stop = transitStops.find(ts =>
      Math.abs(ts.coords[0] - segments[i].to.coords[0]) < 0.1 &&
      Math.abs(ts.coords[1] - segments[i].to.coords[1]) < 0.1
    );
    if (stop) {
      slices.push({ type: 'transit', index: transitStops.indexOf(stop), durationHours: stop.waitHours, startFraction: 0, endFraction: 0 });
      totalH += stop.waitHours;
    }
  }

  // Calculate fraction ranges
  let cursor = 0;
  for (const slice of slices) {
    slice.startFraction = cursor / totalH;
    cursor += slice.durationHours;
    slice.endFraction = cursor / totalH;
  }

  const progressFraction = clampedProgress / 100;

  // Find which slice we're in
  let activeSlice = slices[slices.length - 1];
  for (const slice of slices) {
    if (progressFraction >= slice.startFraction && progressFraction <= slice.endFraction) {
      activeSlice = slice;
      break;
    }
  }

  if (activeSlice.type === 'transit') {
    const stop = transitStops[activeSlice.index];
    return {
      position: stop.coords,
      progress: clampedProgress,
      currentSegmentIndex: activeSlice.index,
      currentMode: 'transit',
      currentLabel: `${stop.icon} ${stop.label}`,
      segmentProgress: 0,
      speedKmh: 0,
      transitStopName: stop.name,
    };
  }

  // We're in a segment — interpolate within it
  const seg = segments[activeSlice.index];
  const sliceRange = activeSlice.endFraction - activeSlice.startFraction;
  const segProgress = sliceRange > 0
    ? ((progressFraction - activeSlice.startFraction) / sliceRange) * 100
    : 0;

  const pos = interpolateAlongRoute(seg.coordinates, segProgress);

  return {
    position: pos,
    progress: clampedProgress,
    currentSegmentIndex: activeSlice.index,
    currentMode: seg.mode,
    currentLabel: `${seg.icon} ${seg.label}`,
    segmentProgress: Math.round(segProgress * 10) / 10,
    speedKmh: seg.speedKmh,
  };
}

export interface TransitThreshold {
  stopIndex: number;
  progressPercent: number;
  name: string;
  coords: [number, number];
}

export function computeTransitStopThresholds(
  segments: RouteSegment[],
  transitStops: TransitStop[]
): TransitThreshold[] {
  if (!segments || segments.length === 0 || !transitStops || transitStops.length === 0) {
    return [];
  }

  interface TimeSlice {
    type: 'segment' | 'transit';
    index: number;       // index into segments or transitStops
    durationHours: number;
    startFraction: number;
    endFraction: number;
  }

  const slices: TimeSlice[] = [];
  let totalH = 0;

  for (let i = 0; i < segments.length; i++) {
    slices.push({ type: 'segment', index: i, durationHours: segments[i].durationHours, startFraction: 0, endFraction: 0 });
    totalH += segments[i].durationHours;

    // Add transit stop after this segment if one exists at the segment's destination
    const stop = transitStops.find(ts =>
      Math.abs(ts.coords[0] - segments[i].to.coords[0]) < 0.1 &&
      Math.abs(ts.coords[1] - segments[i].to.coords[1]) < 0.1
    );
    if (stop) {
      slices.push({ type: 'transit', index: transitStops.indexOf(stop), durationHours: stop.waitHours, startFraction: 0, endFraction: 0 });
      totalH += stop.waitHours;
    }
  }

  // Calculate fraction ranges
  let cursor = 0;
  for (const slice of slices) {
    slice.startFraction = cursor / totalH;
    cursor += slice.durationHours;
    slice.endFraction = cursor / totalH;
  }

  const thresholds: TransitThreshold[] = [];
  for (const slice of slices) {
    if (slice.type === 'transit') {
      const stop = transitStops[slice.index];
      thresholds.push({
        stopIndex: slice.index,
        progressPercent: Math.round(slice.startFraction * 10000) / 100, // round to 2 decimal places e.g. 45.32
        name: stop.name,
        coords: stop.coords
      });
    }
  }

  return thresholds;
}

// ─── WEATHER (Open-Meteo — free, no API key) ────────────────────────

export interface WeatherData {
  temperature: number;      // °C
  windSpeed: number;        // km/h
  weatherCode: number;
  description: string;
  icon: string;
}

const weatherDescriptions: Record<number, { desc: string; icon: string }> = {
  0: { desc: 'Clear Sky', icon: '☀️' },
  1: { desc: 'Mainly Clear', icon: '🌤️' },
  2: { desc: 'Partly Cloudy', icon: '⛅' },
  3: { desc: 'Overcast', icon: '☁️' },
  45: { desc: 'Fog', icon: '🌫️' },
  48: { desc: 'Rime Fog', icon: '🌫️' },
  51: { desc: 'Light Drizzle', icon: '🌦️' },
  53: { desc: 'Moderate Drizzle', icon: '🌦️' },
  55: { desc: 'Dense Drizzle', icon: '🌧️' },
  61: { desc: 'Light Rain', icon: '🌧️' },
  63: { desc: 'Moderate Rain', icon: '🌧️' },
  65: { desc: 'Heavy Rain', icon: '🌧️' },
  71: { desc: 'Light Snow', icon: '🌨️' },
  73: { desc: 'Moderate Snow', icon: '🌨️' },
  75: { desc: 'Heavy Snow', icon: '❄️' },
  80: { desc: 'Rain Showers', icon: '🌧️' },
  81: { desc: 'Moderate Showers', icon: '🌧️' },
  82: { desc: 'Violent Showers', icon: '⛈️' },
  95: { desc: 'Thunderstorm', icon: '⛈️' },
  96: { desc: 'Thunderstorm + Hail', icon: '⛈️' },
  99: { desc: 'Thunderstorm + Heavy Hail', icon: '⛈️' },
};

export async function fetchWeather(lat: number, lng: number): Promise<WeatherData | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,wind_speed_10m,weather_code`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.current) {
      const code = data.current.weather_code ?? 0;
      const info = weatherDescriptions[code] || { desc: 'Unknown', icon: '🌡️' };
      return {
        temperature: Math.round(data.current.temperature_2m),
        windSpeed: Math.round(data.current.wind_speed_10m),
        weatherCode: code,
        description: info.desc,
        icon: info.icon,
      };
    }
  } catch (e) {
    console.error('Weather fetch error:', e);
  }
  return null;
}

// ─── ROUTE STYLE CONSTANTS FOR MULTI-MODAL ──────────────────────────

export interface RouteStyle {
  color: string;
  width: number;
  opacity: number;
  dasharray?: number[];
}

export const ROUTE_STYLES: Record<string, RouteStyle> = {
  road: { color: '#0a192f', width: 5, dasharray: [1], opacity: 0.85 },
  air:  { color: '#ec4899', width: 5, opacity: 0.95 },
  sea:  { color: '#3b82f6', width: 4, dasharray: [4, 4], opacity: 0.85 },
};

export function haversineDistance(p1: [number, number], p2: [number, number]): number {
  const R = 6371; // km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(p2[1] - p1[1]);
  const dLon = toRad(p2[0] - p1[0]);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(p1[1])) * Math.cos(toRad(p2[1])) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function snapCoordsToRoute(
  routeCoords: [number, number][],
  clickCoords: [number, number]
): { progress: number; snappedCoords: [number, number] } {
  if (!routeCoords || routeCoords.length < 2) {
    return { progress: 0, snappedCoords: routeCoords?.[0] || clickCoords };
  }

  const P_x = clickCoords[0];
  const P_y = clickCoords[1];

  let minDistanceSq = Infinity;
  let bestSegIndex = 0;
  let bestSnapped: [number, number] = routeCoords[0];

  for (let i = 0; i < routeCoords.length - 1; i++) {
    const A = routeCoords[i];
    const B = routeCoords[i + 1];

    const A_x = A[0];
    const A_y = A[1];
    const B_x = B[0];
    const B_y = B[1];

    const dx = B_x - A_x;
    const dy = B_y - A_y;

    let t = 0;
    if (dx !== 0 || dy !== 0) {
      t = ((P_x - A_x) * dx + (P_y - A_y) * dy) / (dx * dx + dy * dy);
      t = Math.max(0, Math.min(1, t));
    }

    const C_x = A_x + t * dx;
    const C_y = A_y + t * dy;

    const distSq = (P_x - C_x) ** 2 + (P_y - C_y) ** 2;

    if (distSq < minDistanceSq) {
      minDistanceSq = distSq;
      bestSegIndex = i;
      bestSnapped = [C_x, C_y];
    }
  }

  // Calculate cumulative distance to bestSnapped
  let totalDistance = 0;
  let distanceToSnapped = 0;

  for (let i = 0; i < routeCoords.length - 1; i++) {
    const segDist = haversineDistance(routeCoords[i], routeCoords[i + 1]);
    totalDistance += segDist;

    if (i < bestSegIndex) {
      distanceToSnapped += segDist;
    } else if (i === bestSegIndex) {
      distanceToSnapped += haversineDistance(routeCoords[i], bestSnapped);
    }
  }

  const progress = totalDistance > 0 ? Math.max(0, Math.min(100, (distanceToSnapped / totalDistance) * 100)) : 0;

  return {
    progress,
    snappedCoords: bestSnapped,
  };
}

