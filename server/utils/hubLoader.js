/**
 * hubLoader.js — Loads airports & seaports from local CSV files at startup
 * and exposes fast nearest-hub lookup via Haversine distance.
 *
 * Airports  : public/world-airports.csv  (OurAirports dataset)
 * Seaports  : public/UpdatedPub150.csv   (NGA World Port Index)
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// ─── Haversine Distance (km) ──────────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Data arrays (populated at module load) ───────────────────────────────────
let airports = [];   // { name, iata, icao, lat, lng, type, country }
let seaports = [];   // { name, lat, lng, country, harborSize }

function loadAirports() {
  const csvPath = path.join(__dirname, '../../public/world-airports.csv');
  if (!fs.existsSync(csvPath)) {
    console.warn('[hubLoader] world-airports.csv not found at', csvPath);
    return [];
  }

  const raw = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true, relax_quotes: true });

  return records
    .filter(r => {
      // Only include airports with scheduled service and major types
      const isLarge = r.type === 'large_airport' || r.type === 'medium_airport';
      const hasService = r.scheduled_service === '1' || r.scheduled_service === 'yes';
      const lat = parseFloat(r.latitude_deg);
      const lng = parseFloat(r.longitude_deg);
      return isLarge && hasService && !isNaN(lat) && !isNaN(lng);
    })
    .map(r => ({
      name: r.name,
      iata: r.iata_code || '',
      icao: r.icao_code || r.ident || '',
      lat: parseFloat(r.latitude_deg),
      lng: parseFloat(r.longitude_deg),
      type: r.type,
      country: r.country_name || r.iso_country || '',
    }));
}

function loadSeaports() {
  const csvPath = path.join(__dirname, '../../public/UpdatedPub150.csv');
  if (!fs.existsSync(csvPath)) {
    console.warn('[hubLoader] UpdatedPub150.csv not found at', csvPath);
    return [];
  }

  const raw = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true, relax_quotes: true });

  return records
    .filter(r => {
      const lat = parseFloat(r['Latitude']);
      const lng = parseFloat(r['Longitude']);
      // Only include medium/large ports with container or cargo capability
      const harborSize = (r['Harbor Size'] || '').toLowerCase();
      const isUsable = harborSize === 'large' || harborSize === 'medium';
      return isUsable && !isNaN(lat) && !isNaN(lng);
    })
    .map(r => ({
      name: r['Main Port Name'] || r['Alternate Port Name'] || 'Unknown Port',
      lat: parseFloat(r['Latitude']),
      lng: parseFloat(r['Longitude']),
      country: r['Country Code'] || '',
      harborSize: r['Harbor Size'] || 'Unknown',
      locode: r['UN/LOCODE'] || '',
      waterBody: r['World Water Body'] || '',
    }));
}

// ─── Module initialization ────────────────────────────────────────────────────
try {
  airports = loadAirports();
  console.log(`✅ [hubLoader] Loaded ${airports.length} airports`);
} catch (e) {
  console.error('[hubLoader] Failed to load airports:', e.message);
}

try {
  seaports = loadSeaports();
  console.log(`✅ [hubLoader] Loaded ${seaports.length} seaports`);
} catch (e) {
  console.error('[hubLoader] Failed to load seaports:', e.message);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Find the nearest airport to given coords.
 * @param {number} lat
 * @param {number} lng
 * @param {number} [limit=1] — how many results to return
 * @returns Array of { name, iata, lat, lng, distanceKm }
 */
function findNearestAirports(lat, lng, limit = 1) {
  if (airports.length === 0) return [];
  const scored = airports.map(a => ({
    ...a,
    distanceKm: haversineKm(lat, lng, a.lat, a.lng),
  }));
  scored.sort((a, b) => a.distanceKm - b.distanceKm);
  return scored.slice(0, limit);
}

/**
 * Find the nearest seaport to given coords.
 * @param {number} lat
 * @param {number} lng
 * @param {number} [limit=1]
 * @returns Array of { name, lat, lng, distanceKm }
 */
function findNearestSeaports(lat, lng, limit = 1) {
  if (seaports.length === 0) return [];
  const scored = seaports.map(p => ({
    ...p,
    distanceKm: haversineKm(lat, lng, p.lat, p.lng),
  }));
  scored.sort((a, b) => a.distanceKm - b.distanceKm);
  return scored.slice(0, limit);
}

/**
 * Generic hub finder used by the routing engine.
 * @param {number} lat
 * @param {number} lng
 * @param {'airport'|'seaport'} type
 * @returns {{ name, lat, lng, distanceKm } | null}
 */
function findNearestHub(lat, lng, type) {
  if (type === 'airport') {
    const results = findNearestAirports(lat, lng, 1);
    return results[0] || null;
  }
  if (type === 'seaport') {
    const results = findNearestSeaports(lat, lng, 1);
    return results[0] || null;
  }
  return null;
}

/**
 * Expose full dataset counts (for health checks / admin API).
 */
function getStats() {
  return { airportCount: airports.length, seaportCount: seaports.length };
}

module.exports = { findNearestAirports, findNearestSeaports, findNearestHub, getStats };
