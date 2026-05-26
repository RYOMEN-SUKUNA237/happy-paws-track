import { MAPBOX_TOKEN, getTrueRoute, generateGreatCircleArc, generateStraightLine } from './mapbox';

// ─── FETCH WITH TIMEOUT ─────────────────────────────────────────────
// Abort any fetch that takes longer than `ms` milliseconds so the
// transport planner never hangs the UI indefinitely.
async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
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

// ─── REALISTIC TRANSPORT SPEEDS ─────────────────────────────────────
const SPEEDS = {
  localTruck: 50,    // km/h — city pickup/delivery
  longHaulTruck: 80, // km/h — highway
  plane: 850,        // km/h — cargo aircraft cruise
  ship: 35,          // km/h — cargo vessel (~19 knots)
  lastMile: 40,      // km/h — final delivery
};

// Fixed transfer/loading times at hubs (hours)
const TRANSFER = {
  airportBoarding: 3,     // security screening, loading, documentation
  airportArrival: 2,      // unloading, customs at arrival airport
  transitBreak: 3,        // transit layover at intermediate airport
  seaportLoading: 8,      // customs, container loading
  seaportUnloading: 6,    // unloading, port customs
  borderCrossing: 1.5,    // land border customs checkpoint
};

// Max continuous flight before mandatory transit (hours)
const MAX_CONTINUOUS_FLIGHT_HOURS = 48;

// Distance threshold for air transport (km) — straight-line distance
const AIR_DISTANCE_THRESHOLD_KM = 1000;

// ─── TYPES ────────────────────────────────────────────────────────────
export interface RouteSegment {
  mode: 'road' | 'air' | 'sea';
  coordinates: [number, number][];
  from: { name: string; coords: [number, number] };
  to: { name: string; coords: [number, number] };
  distanceKm: number;
  durationHours: number;
  speedKmh: number;
  label: string;
  icon: string;
}

export interface TransitStop {
  name: string;
  coords: [number, number];
  type: 'airport' | 'seaport' | 'customs' | 'border' | 'transit_airport';
  waitHours: number;
  label: string;
  icon: string;
}

export interface TransportLeg {
  mode: 'truck' | 'plane' | 'ship' | 'rail';
  icon: string;
  label: string;
  from: string;
  to: string;
  distanceKm: number;
  durationHours: number;
  speedKmh: number;
}

export interface TransportPlan {
  id: 'road' | 'air' | 'sea';
  planName: string;
  icon: string;
  legs: TransportLeg[];
  segments: RouteSegment[];
  transitStops: TransitStop[];
  totalDistanceKm: number;
  totalDurationHours: number;
  estimatedDeliveryDate: string;
  isRecommended?: boolean;
}

// ─── HELPERS ─────────────────────────────────────────────────────────
export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const aa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
}

function hoursToDeliveryDate(hours: number): string {
  // Return a FULL ISO timestamp (not date-only) so the exact ETA is preserved
  // everywhere — admin dashboard, tracking page, live map all read this same value.
  const ms = hours * 3600 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

export function formatPlanDuration(hours: number): string {
  const totalMins = Math.round(hours * 60);
  const days = Math.floor(totalMins / 1440);
  const remHours = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;
  if (days > 0) return `${days}d ${remHours}h`;
  if (remHours > 0) return `${remHours}h ${mins}m`;
  return `${mins}m`;
}

/** Get actual road route coordinates using Mapbox Directions API */
async function getRoadCoordinates(
  from: [number, number],
  to: [number, number]
): Promise<{ coords: [number, number][]; distKm: number; durHours: number }> {
  try {
    const route = await getTrueRoute(from, to, 'driving');
    if (route?.geometry?.coordinates?.length > 2) {
      return {
        coords: route.geometry.coordinates as [number, number][],
        distKm: route.distance / 1000,
        durHours: route.duration / 3600,
      };
    }
  } catch (e) {
    // Road route failed or timed out — use straight-line fallback
  }
  // Fallback to straight line with haversine distance
  const dist = haversineKm(from, to);
  return { coords: [from, to], distKm: dist, durHours: dist / SPEEDS.longHaulTruck };
}

/**
 * Find the nearest REAL airport or seaport using the backend CSV datasets.
 * Falls back to Mapbox geocoding only if the backend is unavailable.
 */
/** Detect the backend API base URL at runtime */
function getBackendUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:5000';
  const { protocol, hostname, port } = window.location;
  // In dev, Vite typically runs on 5173 and the server on 5000.
  // If we're already on port 5000, use same origin; otherwise hardcode 5000.
  const serverPort = port === '5000' ? '' : ':5000';
  return `${protocol}//${hostname}${serverPort}`;
}

export async function findNearestHub(
  coords: [number, number],
  type: 'airport' | 'port'
): Promise<{ name: string; coords: [number, number] } | null> {
  const hubType = type === 'airport' ? 'airport' : 'seaport';
  const [lng, lat] = coords;

  // ── Try local backend API first (uses CSV datasets) ──────────────────────
  try {
    const backendUrl = getBackendUrl();
    const res = await fetchWithTimeout(
      `${backendUrl}/api/routing/nearest-hub?lat=${lat}&lng=${lng}&type=${hubType}&limit=1`,
      6000  // 6 second timeout for backend hub lookup
    );

    if (res.ok) {
      const data = await res.json();
      const hub = data.results?.[0];
      if (hub) {
        const displayName = hub.iata
          ? `${hub.name} (${hub.iata})`
          : hub.name;
        return { name: displayName, coords: [hub.lng, hub.lat] };
      }
    }
  } catch (_e) {
    // Backend unavailable or timed out — fall through to Mapbox geocoding
  }

  // ── Fallback: Mapbox geocoding (legacy behavior) ──────────────────────────
  if (!MAPBOX_TOKEN) return null;
  try {
    const query = type === 'airport'
      ? 'international airport'
      : 'seaport cargo port terminal';

    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
      `?proximity=${lng},${lat}&access_token=${MAPBOX_TOKEN}&limit=5&types=poi`;

    const res = await fetchWithTimeout(url, 8000);
    const data = await res.json();

    if (data.features && data.features.length > 0) {
      const filtered = data.features.filter((f: any) => {
        const name = (f.place_name || '').toLowerCase();
        if (type === 'airport') {
          return name.includes('airport') || name.includes('aeropuerto') ||
            name.includes('aéroport') || name.includes('flughafen') ||
            name.includes('aerodrome') || name.includes('aeroport');
        } else {
          return name.includes('port') || name.includes('terminal') ||
            name.includes('harbour') || name.includes('harbor') ||
            name.includes('dock') || name.includes('maritime');
        }
      });

      const best = filtered.length > 0 ? filtered[0] : data.features[0];
      const shortName = best.place_name.split(',').slice(0, 2).join(',').trim();
      return { name: shortName, coords: best.center as [number, number] };
    }
  } catch (e) {
    // Hub geocoding failed or timed out
  }
  return null;
}


/**
 * Find a transit airport along the great-circle path between two airports.
 * Picks a major hub airport in a country roughly midway on the route.
 */
async function findTransitAirport(
  originAirport: { name: string; coords: [number, number] },
  destAirport: { name: string; coords: [number, number] }
): Promise<{ name: string; coords: [number, number] } | null> {
  if (!MAPBOX_TOKEN) return null;

  // Find midpoint along the great circle
  const midLng = (originAirport.coords[0] + destAirport.coords[0]) / 2;
  const midLat = (originAirport.coords[1] + destAirport.coords[1]) / 2;

  try {
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent('international airport')}.json` +
      `?proximity=${midLng},${midLat}&access_token=${MAPBOX_TOKEN}&limit=5&types=poi`;

    const res = await fetchWithTimeout(url, 8000);
    const data = await res.json();

    if (data.features && data.features.length > 0) {
      const airports = data.features.filter((f: any) => {
        const name = (f.place_name || '').toLowerCase();
        return name.includes('airport') || name.includes('aéroport') ||
          name.includes('aeropuerto') || name.includes('aeroport');
      });

      // Pick an airport NOT the same as origin or destination airports
      for (const f of (airports.length > 0 ? airports : data.features)) {
        const c = f.center as [number, number];
        const distFromOrigin = haversineKm(originAirport.coords, c);
        const distFromDest = haversineKm(destAirport.coords, c);
        // Must be at least 500km from both endpoints to be a valid transit
        if (distFromOrigin > 500 && distFromDest > 500) {
          const shortName = f.place_name.split(',').slice(0, 2).join(',').trim();
          return { name: shortName, coords: c };
        }
      }
    }
  } catch (e) {
    // Transit airport lookup timed out or failed — skip transit stop
  }
  return null;
}

// ─── MAIN PLANNER ────────────────────────────────────────────────────
export async function buildTransportPlans(
  originName: string,
  destName: string,
  originCoords: [number, number],
  destCoords: [number, number],
  routeDistanceKm: number,
  customTransitStops: Array<{ name: string; coords: [number, number] }> = []
): Promise<TransportPlan[]> {
  const plans: TransportPlan[] = [];
  // Use straight-line (haversine) distance as the primary trigger for air/sea
  // because road distance may be unavailable for cross-ocean routes
  const straightKm = haversineKm(originCoords, destCoords);

  // ── PLAN 1: Road Only (always offered but marked slow for long distances) ──
  {
    const segments: RouteSegment[] = [];
    const transitStops: TransitStop[] = [];
    const legs: TransportLeg[] = [];

    const road = await getRoadCoordinates(originCoords, destCoords);
    const distKm = road.distKm;

    let speed = SPEEDS.localTruck;
    let label = 'Local Delivery';
    if (distKm > 600) { speed = SPEEDS.longHaulTruck; label = 'Long-Haul Truck'; }
    else if (distKm > 150) { speed = SPEEDS.longHaulTruck; label = 'Regional Truck'; }

    const dur = distKm / speed;
    const totalHours = dur + (distKm > 600 ? 2 : distKm > 150 ? 1 : 0.5);

    legs.push({ mode: 'truck', icon: '🚛', label, from: originName, to: destName, distanceKm: Math.round(distKm), durationHours: dur, speedKmh: speed });
    segments.push({ mode: 'road', coordinates: road.coords, from: { name: originName, coords: originCoords }, to: { name: destName, coords: destCoords }, distanceKm: Math.round(distKm), durationHours: dur, speedKmh: speed, label, icon: '🚛' });

    plans.push({
      id: 'road', planName: 'Road Only', icon: '🚛', legs, segments, transitStops,
      totalDistanceKm: Math.round(distKm),
      totalDurationHours: totalHours,
      estimatedDeliveryDate: hoursToDeliveryDate(totalHours + 2),
    });
  }

  // ── PLAN 2: Air Freight (straight-line > 1000 km) ─────────────────
  // Uses STRAIGHT-LINE distance so cross-ocean routes always qualify
  if (straightKm > AIR_DISTANCE_THRESHOLD_KM) {
    // Find nearest REAL airports to origin and destination
    const [oAirportRaw, dAirportRaw] = await Promise.all([
      findNearestHub(originCoords, 'airport'),
      findNearestHub(destCoords, 'airport'),
    ]);

    const oAirport = oAirportRaw ?? {
      name: `${originName.split(',')[0]} International Airport`,
      coords: originCoords,
    };
    const dAirport = dAirportRaw ?? {
      name: `${destName.split(',')[0]} International Airport`,
      coords: destCoords,
    };

    // === LEG 1: Truck from origin to nearest airport (road route) ===
    const truckToAirport = await getRoadCoordinates(originCoords, oAirport.coords);
    const d1 = truckToAirport.distKm;
    const t1 = Math.max(0.3, truckToAirport.durHours);

    // === LEG LAST: Truck from destination airport to destination ===
    const truckFromAirport = await getRoadCoordinates(dAirport.coords, destCoords);
    const d3 = truckFromAirport.distKm;
    const t3 = Math.max(0.3, truckFromAirport.durHours);

    // === FLIGHT DISTANCE ===
    const dFlight = haversineKm(oAirport.coords, dAirport.coords);
    const directFlightHours = dFlight / SPEEDS.plane;
    const needsTransit = directFlightHours > MAX_CONTINUOUS_FLIGHT_HOURS;

    const segments: RouteSegment[] = [];
    const transitStops: TransitStop[] = [];
    const legs: TransportLeg[] = [];

    // --- Truck to origin airport ---
    segments.push({
      mode: 'road',
      coordinates: truckToAirport.coords,
      from: { name: originName, coords: originCoords },
      to: { name: oAirport.name, coords: oAirport.coords },
      distanceKm: Math.round(d1),
      durationHours: t1,
      speedKmh: SPEEDS.localTruck,
      label: 'Truck to Airport',
      icon: '🚛',
    });
    legs.push({ mode: 'truck', icon: '🚛', label: 'Truck to Airport', from: originName, to: oAirport.name, distanceKm: Math.round(d1), durationHours: t1, speedKmh: SPEEDS.localTruck });

    // --- Boarding at origin airport ---
    transitStops.push({
      name: oAirport.name,
      coords: oAirport.coords,
      type: 'airport',
      waitHours: TRANSFER.airportBoarding,
      label: 'Boarding & Security Check',
      icon: '🛫',
    });

    let totalFlightHours = 0;

    if (customTransitStops && customTransitStops.length > 0) {
      // Build air segments sequentially through custom transit stops!
      let currentCoords = oAirport.coords;
      let currentName = oAirport.name;

      for (let i = 0; i < customTransitStops.length; i++) {
        const stop = customTransitStops[i];
        const distSeg = haversineKm(currentCoords, stop.coords);
        const tSeg = distSeg / SPEEDS.plane;
        const arc = generateStraightLine(currentCoords, stop.coords, 120);

        segments.push({
          mode: 'air',
          coordinates: arc,
          from: { name: currentName, coords: currentCoords },
          to: { name: stop.name, coords: stop.coords },
          distanceKm: Math.round(distSeg),
          durationHours: tSeg,
          speedKmh: SPEEDS.plane,
          label: `Cargo Flight (Leg ${i + 1})`,
          icon: '✈️',
        });

        legs.push({
          mode: 'plane',
          icon: '✈️',
          label: `Cargo Flight (Leg ${i + 1})`,
          from: currentName,
          to: stop.name,
          distanceKm: Math.round(distSeg),
          durationHours: tSeg,
          speedKmh: SPEEDS.plane,
        });

        transitStops.push({
          name: stop.name,
          coords: stop.coords,
          type: 'transit_airport',
          waitHours: TRANSFER.transitBreak,
          label: `Transit Stop: ${stop.name}`,
          icon: '✈️',
        });

        totalFlightHours += tSeg + TRANSFER.transitBreak;
        currentCoords = stop.coords;
        currentName = stop.name;
      }

      // Final flight segment: last stop to destination airport
      const finalFlightKm = haversineKm(currentCoords, dAirport.coords);
      const finalFlightHours = finalFlightKm / SPEEDS.plane;
      const finalArcCoords = generateStraightLine(currentCoords, dAirport.coords, 120);

      segments.push({
        mode: 'air',
        coordinates: finalArcCoords,
        from: { name: currentName, coords: currentCoords },
        to: { name: dAirport.name, coords: dAirport.coords },
        distanceKm: Math.round(finalFlightKm),
        durationHours: finalFlightHours,
        speedKmh: SPEEDS.plane,
        label: 'Cargo Flight (Final Leg)',
        icon: '✈️',
      });

      legs.push({
        mode: 'plane',
        icon: '✈️',
        label: 'Cargo Flight (Final Leg)',
        from: currentName,
        to: dAirport.name,
        distanceKm: Math.round(finalFlightKm),
        durationHours: finalFlightHours,
        speedKmh: SPEEDS.plane,
      });

      totalFlightHours += finalFlightHours;
    } else if (needsTransit) {
      // Find a transit airport midway
      const transitAirport = await findTransitAirport(oAirport, dAirport);

      if (transitAirport) {
        const dFlight1 = haversineKm(oAirport.coords, transitAirport.coords);
        const dFlight2 = haversineKm(transitAirport.coords, dAirport.coords);
        const tFlight1 = dFlight1 / SPEEDS.plane;
        const tFlight2 = dFlight2 / SPEEDS.plane;

        // Flight leg 1
        const arc1 = generateStraightLine(oAirport.coords, transitAirport.coords, 120);
        segments.push({
          mode: 'air', coordinates: arc1,
          from: { name: oAirport.name, coords: oAirport.coords },
          to: { name: transitAirport.name, coords: transitAirport.coords },
          distanceKm: Math.round(dFlight1), durationHours: tFlight1,
          speedKmh: SPEEDS.plane, label: 'Cargo Flight (Leg 1)', icon: '✈️',
        });
        legs.push({ mode: 'plane', icon: '✈️', label: 'Cargo Flight (Leg 1)', from: oAirport.name, to: transitAirport.name, distanceKm: Math.round(dFlight1), durationHours: tFlight1, speedKmh: SPEEDS.plane });

        // Transit stop
        transitStops.push({
          name: transitAirport.name, coords: transitAirport.coords,
          type: 'transit_airport', waitHours: TRANSFER.transitBreak,
          label: 'Transit Break (Refueling & Crew Rest)', icon: '🔄',
        });

        // Flight leg 2
        const arc2 = generateStraightLine(transitAirport.coords, dAirport.coords, 120);
        segments.push({
          mode: 'air', coordinates: arc2,
          from: { name: transitAirport.name, coords: transitAirport.coords },
          to: { name: dAirport.name, coords: dAirport.coords },
          distanceKm: Math.round(dFlight2), durationHours: tFlight2,
          speedKmh: SPEEDS.plane, label: 'Cargo Flight (Leg 2)', icon: '✈️',
        });
        legs.push({ mode: 'plane', icon: '✈️', label: 'Cargo Flight (Leg 2)', from: transitAirport.name, to: dAirport.name, distanceKm: Math.round(dFlight2), durationHours: tFlight2, speedKmh: SPEEDS.plane });

        totalFlightHours = tFlight1 + TRANSFER.transitBreak + tFlight2;
      } else {
        // No transit found — direct long flight
        const arc = generateStraightLine(oAirport.coords, dAirport.coords, 150);
        const tFlight = dFlight / SPEEDS.plane;
        segments.push({
          mode: 'air', coordinates: arc,
          from: { name: oAirport.name, coords: oAirport.coords },
          to: { name: dAirport.name, coords: dAirport.coords },
          distanceKm: Math.round(dFlight), durationHours: tFlight,
          speedKmh: SPEEDS.plane, label: 'Cargo Flight', icon: '✈️',
        });
        legs.push({ mode: 'plane', icon: '✈️', label: 'Cargo Flight', from: oAirport.name, to: dAirport.name, distanceKm: Math.round(dFlight), durationHours: tFlight, speedKmh: SPEEDS.plane });
        totalFlightHours = tFlight;
      }
    } else {
      // Direct flight (< 48h)
      const arc = generateStraightLine(oAirport.coords, dAirport.coords, 150);
      const tFlight = dFlight / SPEEDS.plane;
      segments.push({
        mode: 'air', coordinates: arc,
        from: { name: oAirport.name, coords: oAirport.coords },
        to: { name: dAirport.name, coords: dAirport.coords },
        distanceKm: Math.round(dFlight), durationHours: tFlight,
        speedKmh: SPEEDS.plane, label: 'Cargo Flight', icon: '✈️',
      });
      legs.push({ mode: 'plane', icon: '✈️', label: 'Cargo Flight', from: oAirport.name, to: dAirport.name, distanceKm: Math.round(dFlight), durationHours: tFlight, speedKmh: SPEEDS.plane });
      totalFlightHours = tFlight;
    }

    // --- Customs at destination airport ---
    transitStops.push({
      name: dAirport.name, coords: dAirport.coords,
      type: 'airport', waitHours: TRANSFER.airportArrival,
      label: 'Customs & Cargo Unloading', icon: '🛬',
    });

    // --- Truck from destination airport ---
    segments.push({
      mode: 'road', coordinates: truckFromAirport.coords,
      from: { name: dAirport.name, coords: dAirport.coords },
      to: { name: destName, coords: destCoords },
      distanceKm: Math.round(d3), durationHours: t3,
      speedKmh: SPEEDS.lastMile, label: 'Last-Mile Delivery', icon: '🚛',
    });
    legs.push({ mode: 'truck', icon: '🚛', label: 'Last-Mile Delivery', from: dAirport.name, to: destName, distanceKm: Math.round(d3), durationHours: t3, speedKmh: SPEEDS.lastMile });

    const totalHours = t1 + TRANSFER.airportBoarding + totalFlightHours + TRANSFER.airportArrival + t3;
    const totalDist = Math.round(d1 + dFlight + d3);

    plans.push({
      id: 'air',
      planName: needsTransit ? 'Air Freight (with Transit)' : 'Air Freight',
      icon: '✈️', legs, segments, transitStops,
      totalDistanceKm: totalDist,
      totalDurationHours: totalHours,
      estimatedDeliveryDate: hoursToDeliveryDate(totalHours + 4),
      isRecommended: straightKm > 2000,
    });
  }

  // ── PLAN 3: Sea Freight (straight-line > 3500 km — intercontinental) ─
  if (straightKm > 3500) {
    const [oPortRaw, dPortRaw] = await Promise.all([
      findNearestHub(originCoords, 'port'),
      findNearestHub(destCoords, 'port'),
    ]);
    const oPort = oPortRaw ?? { name: `${originName.split(',')[0]} Seaport`, coords: originCoords };
    const dPort = dPortRaw ?? { name: `${destName.split(',')[0]} Seaport`, coords: destCoords };

    const truckToPort = await getRoadCoordinates(originCoords, oPort.coords);
    const truckFromPort = await getRoadCoordinates(dPort.coords, destCoords);
    const d1 = truckToPort.distKm;
    const d2 = haversineKm(oPort.coords, dPort.coords);
    const d3 = truckFromPort.distKm;
    const t1 = Math.max(1, truckToPort.durHours);
    const t2 = d2 / SPEEDS.ship;
    const t3 = Math.max(1, truckFromPort.durHours);

    const seaArc = generateGreatCircleArc(oPort.coords, dPort.coords, 200);

    // No transit for sea freight — ships sail continuously
    const segments: RouteSegment[] = [
      { mode: 'road', coordinates: truckToPort.coords, from: { name: originName, coords: originCoords }, to: { name: oPort.name, coords: oPort.coords }, distanceKm: Math.round(d1), durationHours: t1, speedKmh: SPEEDS.longHaulTruck, label: 'Truck to Seaport', icon: '🚛' },
      { mode: 'sea', coordinates: seaArc, from: { name: oPort.name, coords: oPort.coords }, to: { name: dPort.name, coords: dPort.coords }, distanceKm: Math.round(d2), durationHours: t2, speedKmh: SPEEDS.ship, label: 'Cargo Vessel', icon: '🚢' },
      { mode: 'road', coordinates: truckFromPort.coords, from: { name: dPort.name, coords: dPort.coords }, to: { name: destName, coords: destCoords }, distanceKm: Math.round(d3), durationHours: t3, speedKmh: SPEEDS.longHaulTruck, label: 'Last-Mile Delivery', icon: '🚛' },
    ];

    const transitStops: TransitStop[] = [
      { name: oPort.name, coords: oPort.coords, type: 'seaport', waitHours: TRANSFER.seaportLoading, label: 'Port Customs & Container Loading', icon: '🏗️' },
      { name: dPort.name, coords: dPort.coords, type: 'seaport', waitHours: TRANSFER.seaportUnloading, label: 'Port Customs & Unloading', icon: '🏗️' },
    ];

    const totalHours = t1 + TRANSFER.seaportLoading + t2 + TRANSFER.seaportUnloading + t3;

    plans.push({
      id: 'sea', planName: 'Sea Freight', icon: '🚢',
      legs: [
        { mode: 'truck', icon: '🚛', label: 'Truck to Seaport', from: originName, to: oPort.name, distanceKm: Math.round(d1), durationHours: t1, speedKmh: SPEEDS.longHaulTruck },
        { mode: 'ship', icon: '🚢', label: 'Cargo Vessel', from: oPort.name, to: dPort.name, distanceKm: Math.round(d2), durationHours: t2, speedKmh: SPEEDS.ship },
        { mode: 'truck', icon: '🚛', label: 'Last-Mile Delivery', from: dPort.name, to: destName, distanceKm: Math.round(d3), durationHours: t3, speedKmh: SPEEDS.longHaulTruck },
      ],
      segments, transitStops,
      totalDistanceKm: Math.round(d1 + d2 + d3),
      totalDurationHours: totalHours,
      estimatedDeliveryDate: hoursToDeliveryDate(totalHours + 8),
    });
  }

  // Mark recommended plan
  if (plans.length > 1 && !plans.some(p => p.isRecommended)) {
    const rec = straightKm > AIR_DISTANCE_THRESHOLD_KM
      ? plans.find(p => p.id === 'air')
      : plans.find(p => p.id === 'road');
    if (rec) rec.isRecommended = true;
  }

  return plans;
}
