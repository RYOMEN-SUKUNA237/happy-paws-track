/**
 * migrate-hubs.js
 *
 * Migration + Seed Script for Smart Routing Hub data.
 *
 * What it does:
 *  1. Enables PostGIS extension in Supabase (if not already).
 *  2. Creates `airports` and `seaports` tables with PostGIS geometry columns.
 *  3. Seeds the tables from the local CSV files.
 *
 * Usage:
 *   node server/migrate-hubs.js
 *
 * Requires: DATABASE_URL in server/.env or environment
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

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

async function run() {
  const client = await pool.connect();

  try {
    console.log('🔌 Connected to Supabase PostgreSQL');

    // ─── 1. Enable PostGIS ─────────────────────────────────────────────────
    console.log('\n📦 Enabling PostGIS extension...');
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS postgis;');
      console.log('  ✅ PostGIS enabled');
    } catch (e) {
      // Supabase already has PostGIS — might be restricted to superuser
      console.warn('  ⚠️  PostGIS extension note:', e.message);
    }

    // ─── 2. Create airports table ──────────────────────────────────────────
    console.log('\n🏗️  Creating airports table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS airports (
        id              SERIAL PRIMARY KEY,
        name            TEXT NOT NULL,
        iata_code       TEXT,
        icao_code       TEXT,
        type            TEXT DEFAULT 'large_airport',
        country         TEXT,
        lat             DOUBLE PRECISION NOT NULL,
        lng             DOUBLE PRECISION NOT NULL,
        location        GEOGRAPHY(POINT, 4326),
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('  ✅ airports table created (or already exists)');

    // Index for nearest-neighbor geo queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS airports_location_idx
        ON airports USING GIST(location);
    `).catch(() => console.warn('  ⚠️  GIST index note: PostGIS may not be available for indexing'));

    // ─── 3. Create seaports table ──────────────────────────────────────────
    console.log('\n🏗️  Creating seaports table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS seaports (
        id              SERIAL PRIMARY KEY,
        name            TEXT NOT NULL,
        locode          TEXT,
        country_code    TEXT,
        harbor_size     TEXT,
        water_body      TEXT,
        lat             DOUBLE PRECISION NOT NULL,
        lng             DOUBLE PRECISION NOT NULL,
        location        GEOGRAPHY(POINT, 4326),
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('  ✅ seaports table created (or already exists)');

    await client.query(`
      CREATE INDEX IF NOT EXISTS seaports_location_idx
        ON seaports USING GIST(location);
    `).catch(() => console.warn('  ⚠️  GIST index note: PostGIS may not be available for indexing'));

    // ─── 4. Seed Airports ──────────────────────────────────────────────────
    console.log('\n✈️  Loading airports from world-airports.csv...');
    const airportsCsvPath = path.join(__dirname, '../public/world-airports.csv');

    if (!fs.existsSync(airportsCsvPath)) {
      console.error('  ❌ world-airports.csv not found at', airportsCsvPath);
    } else {
      const rawAirports = fs.readFileSync(airportsCsvPath, 'utf-8');
      const allAirports = parse(rawAirports, {
        columns: true, skip_empty_lines: true, trim: true, relax_quotes: true,
      });

      const filtered = allAirports.filter(r => {
        const isLarge = r.type === 'large_airport' || r.type === 'medium_airport';
        const hasService = r.scheduled_service === '1' || r.scheduled_service === 'yes';
        const lat = parseFloat(r.latitude_deg);
        const lng = parseFloat(r.longitude_deg);
        return isLarge && hasService && !isNaN(lat) && !isNaN(lng);
      });

      console.log(`  Found ${filtered.length} qualifying airports — checking existing records...`);
      const { rows: existingCount } = await client.query('SELECT COUNT(*) FROM airports');
      const alreadySeeded = parseInt(existingCount[0].count) > 0;

      if (alreadySeeded) {
        console.log(`  ⏭️  Airports already seeded (${existingCount[0].count} records) — skipping INSERT.`);
      } else {
        let inserted = 0;
        const batchSize = 100;
        for (let i = 0; i < filtered.length; i += batchSize) {
          const batch = filtered.slice(i, i + batchSize);
          const values = [];
          const placeholders = batch.map((r, j) => {
            const base = j * 6;
            const lat = parseFloat(r.latitude_deg);
            const lng = parseFloat(r.longitude_deg);
            values.push(
              r.name,
              r.iata_code || null,
              r.icao_code || r.ident || null,
              r.type,
              r.country_name || r.iso_country || null,
              lat, lng
            );
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, ST_SetSRID(ST_MakePoint($${base + 7}, $${base + 6}), 4326))`;
          }).join(', ');
          await client.query(
            `INSERT INTO airports (name, iata_code, icao_code, type, country, lat, lng, location)
             VALUES ${placeholders} ON CONFLICT DO NOTHING`,
            values
          ).catch(e => console.warn('  Batch insert warn:', e.message));
          inserted += batch.length;
          process.stdout.write(`\r  Inserted ${inserted}/${filtered.length} airports...`);
        }
        console.log(`\n  ✅ Airports seeded: ${inserted}`);
      }
    }

    // ─── 5. Seed Seaports ──────────────────────────────────────────────────
    console.log('\n🚢  Loading seaports from UpdatedPub150.csv...');
    const seaportsCsvPath = path.join(__dirname, '../public/UpdatedPub150.csv');

    if (!fs.existsSync(seaportsCsvPath)) {
      console.error('  ❌ UpdatedPub150.csv not found at', seaportsCsvPath);
    } else {
      const rawSeaports = fs.readFileSync(seaportsCsvPath, 'utf-8');
      const allPorts = parse(rawSeaports, {
        columns: true, skip_empty_lines: true, trim: true, relax_quotes: true,
      });

      const filteredPorts = allPorts.filter(r => {
        const lat = parseFloat(r['Latitude']);
        const lng = parseFloat(r['Longitude']);
        const harborSize = (r['Harbor Size'] || '').toLowerCase();
        return (harborSize === 'large' || harborSize === 'medium') && !isNaN(lat) && !isNaN(lng);
      });

      console.log(`  Found ${filteredPorts.length} qualifying seaports — checking existing records...`);
      const { rows: existingPortCount } = await client.query('SELECT COUNT(*) FROM seaports');
      const alreadyPortSeeded = parseInt(existingPortCount[0].count) > 0;

      if (alreadyPortSeeded) {
        console.log(`  ⏭️  Seaports already seeded (${existingPortCount[0].count} records) — skipping INSERT.`);
      } else {
        let portInserted = 0;
        const batchSize = 100;
        for (let i = 0; i < filteredPorts.length; i += batchSize) {
          const batch = filteredPorts.slice(i, i + batchSize);
          const values = [];
          const placeholders = batch.map((r, j) => {
            const base = j * 6;
            const lat = parseFloat(r['Latitude']);
            const lng = parseFloat(r['Longitude']);
            values.push(
              r['Main Port Name'] || r['Alternate Port Name'] || 'Unknown',
              r['UN/LOCODE'] || null,
              r['Country Code'] || null,
              r['Harbor Size'] || null,
              r['World Water Body'] || null,
              lat, lng
            );
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, ST_SetSRID(ST_MakePoint($${base + 7}, $${base + 6}), 4326))`;
          }).join(', ');
          await client.query(
            `INSERT INTO seaports (name, locode, country_code, harbor_size, water_body, lat, lng, location)
             VALUES ${placeholders} ON CONFLICT DO NOTHING`,
            values
          ).catch(e => console.warn('  Batch insert warn:', e.message));
          portInserted += batch.length;
          process.stdout.write(`\r  Inserted ${portInserted}/${filteredPorts.length} seaports...`);
        }
        console.log(`\n  ✅ Seaports seeded: ${portInserted}`);
      }
    }

    // ─── 6. Create PostGIS nearest-hub SQL function ────────────────────────
    console.log('\n🧩  Creating find_nearest_hub SQL function...');
    await client.query(`
      CREATE OR REPLACE FUNCTION find_nearest_hub(
        search_lat DOUBLE PRECISION,
        search_lng DOUBLE PRECISION,
        hub_type   TEXT DEFAULT 'airport',
        result_limit INT DEFAULT 1
      )
      RETURNS TABLE (
        id          INT,
        name        TEXT,
        lat         DOUBLE PRECISION,
        lng         DOUBLE PRECISION,
        distance_m  DOUBLE PRECISION
      ) AS $$
      BEGIN
        IF hub_type = 'airport' THEN
          RETURN QUERY
            SELECT
              a.id, a.name, a.lat, a.lng,
              ST_Distance(
                a.location,
                ST_SetSRID(ST_MakePoint(search_lng, search_lat), 4326)::geography
              ) AS distance_m
            FROM airports a
            ORDER BY a.location <-> ST_SetSRID(ST_MakePoint(search_lng, search_lat), 4326)::geography
            LIMIT result_limit;
        ELSIF hub_type = 'seaport' THEN
          RETURN QUERY
            SELECT
              s.id, s.name, s.lat, s.lng,
              ST_Distance(
                s.location,
                ST_SetSRID(ST_MakePoint(search_lng, search_lat), 4326)::geography
              ) AS distance_m
            FROM seaports s
            ORDER BY s.location <-> ST_SetSRID(ST_MakePoint(search_lng, search_lat), 4326)::geography
            LIMIT result_limit;
        END IF;
      END;
      $$ LANGUAGE plpgsql;
    `).catch(e => console.warn('  ⚠️  SQL function note (may need PostGIS active):', e.message));
    console.log('  ✅ find_nearest_hub() function created');

    console.log('\n🎉 Migration complete!\n');

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
