/**
 * smartRouting.ts
 *
 * Frontend utility that calls the Smart Routing backend API.
 * Used by the shipment creation form to generate multi-modal plans.
 *
 * Routing logic:
 *  - Land:  Direct Mapbox driving route (Origin → Destination)
 *  - Air:   Truck → NearestAirport_A → GreatCircle → NearestAirport_B → Truck
 *  - Sea:   Truck → NearestSeaport_A → GreatCircle → NearestSeaport_B → Truck
 *
 * Hub data comes from local CSV datasets (world-airports.csv, UpdatedPub150.csv)
 * loaded by the server at startup — no Mapbox geocoding needed for hubs.
 */

import { MAPBOX_TOKEN } from './mapbox';
import type { RouteSegment, TransitStop } from './transportPlanner';

const API_BASE =
  (import.meta as any).env?.VITE_API_URL ||
  (typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:5000`
    : 'http://localhost:5000');

export interface SmartRoutePlan {
  mode: 'land' | 'air' | 'sea';
  segments: RouteSegment[];
  transitStops: TransitStop[];
  hubs?: {
    origin: { name: string; lat: number; lng: number; iata?: string };
    destination: { name: string; lat: number; lng: number; iata?: string };
  };
  totalDistanceKm: number;
  totalDurationHours: number;
  straightLineKm: number;
}

export interface NearestHubResult {
  name: string;
  lat: number;
  lng: number;
  distanceKm: number;
  iata?: string;
  icao?: string;
  country?: string;
  locode?: string;
}

/**
 * Find nearest airport or seaport to given coordinates.
 */
export async function findNearestHubFromServer(
  lat: number,
  lng: number,
  type: 'airport' | 'seaport',
  limit = 1
): Promise<NearestHubResult[]> {
  try {
    const res = await fetch(
      `${API_BASE}/api/routing/nearest-hub?lat=${lat}&lng=${lng}&type=${type}&limit=${limit}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.results || [];
  } catch (e) {
    console.error('[smartRouting] findNearestHub error:', e);
    return [];
  }
}

/**
 * Get a full smart route plan from the backend.
 *
 * @param originLat - Origin latitude
 * @param originLng - Origin longitude
 * @param destLat   - Destination latitude
 * @param destLng   - Destination longitude
 * @param mode      - 'land' | 'air' | 'sea'
 * @returns SmartRoutePlan or null on error
 */
export async function getSmartRoutePlan(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  mode: 'land' | 'air' | 'sea'
): Promise<SmartRoutePlan | null> {
  try {
    const res = await fetch(`${API_BASE}/api/routing/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originLat, originLng,
        destLat, destLng,
        mode,
        mapboxToken: MAPBOX_TOKEN,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const plan = data.plan;

    // Normalize segments to match frontend RouteSegment type
    const segments: RouteSegment[] = (plan.segments || []).map((seg: any) => ({
      mode: seg.mode as 'road' | 'air' | 'sea',
      coordinates: seg.coordinates as [number, number][],
      from: { name: seg.from?.name || 'Origin', coords: [seg.from?.lng ?? seg.from?.coords?.[0], seg.from?.lat ?? seg.from?.coords?.[1]] as [number, number] },
      to: { name: seg.to?.name || 'Destination', coords: [seg.to?.lng ?? seg.to?.coords?.[0], seg.to?.lat ?? seg.to?.coords?.[1]] as [number, number] },
      distanceKm: seg.distanceKm,
      durationHours: seg.durationHours,
      speedKmh: seg.speedKmh,
      label: seg.label,
      icon: seg.icon,
    }));

    // Normalize transit stops to match frontend TransitStop type
    const transitStops: TransitStop[] = (plan.transitStops || []).map((stop: any) => ({
      name: stop.name,
      coords: stop.coords as [number, number],
      type: stop.type as 'airport' | 'seaport' | 'customs' | 'border' | 'transit_airport',
      waitHours: stop.waitHours,
      label: stop.label,
      icon: stop.icon,
    }));

    return {
      mode: plan.mode,
      segments,
      transitStops,
      hubs: plan.hubs,
      totalDistanceKm: plan.totalDistanceKm,
      totalDurationHours: plan.totalDurationHours,
      straightLineKm: plan.straightLineKm,
    };
  } catch (e) {
    console.error('[smartRouting] getSmartRoutePlan error:', e);
    return null;
  }
}

/**
 * Get routing server statistics (loaded hub counts).
 */
export async function getRoutingStats(): Promise<{ airportCount: number; seaportCount: number } | null> {
  try {
    const res = await fetch(`${API_BASE}/api/routing/stats`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
