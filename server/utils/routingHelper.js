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

function greatCircleArc(from, to, numPoints = 120) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;

  const lat1 = toRad(from.lat); const lon1 = toRad(from.lng);
  const lat2 = toRad(to.lat);   const lon2 = toRad(to.lng);

  const d = 2 * Math.asin(
    Math.sqrt(
      Math.sin((lat2 - lat1) / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2
    )
  );

  if (d < 1e-10) return [[from.lng, from.lat], [to.lng, to.lat]];

  const pts = [];
  for (let i = 0; i <= numPoints; i++) {
    const f = i / numPoints;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    pts.push([toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
  }
  return pts;
}

async function getMapboxRoute(fromLng, fromLat, toLng, toLat, token) {
  if (!token) {
    const dist = haversineKm(fromLat, fromLng, toLat, toLng);
    return {
      coordinates: [[fromLng, fromLat], [toLng, toLat]],
      distanceKm: dist,
      durationHours: dist / 80,
    };
  }
  try {
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${fromLng},${fromLat};${toLng},${toLat}?geometries=geojson&overview=full&access_token=${token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    const data = await res.json();
    if (data.routes && data.routes.length > 0) {
      const r = data.routes[0];
      return {
        coordinates: r.geometry.coordinates,
        distanceKm: r.distance / 1000,
        durationHours: r.duration / 3600,
      };
    }
  } catch (e) {
    console.error('[routingHelper] Mapbox route error:', e.message);
  }
  const dist = haversineKm(fromLat, fromLng, toLat, toLng);
  return {
    coordinates: [[fromLng, fromLat], [toLng, toLat]],
    distanceKm: dist,
    durationHours: dist / 80,
  };
}

function straightLine(from, to, numPoints = 120) {
  const pts = [];
  for (let i = 0; i <= numPoints; i++) {
    const f = i / numPoints;
    pts.push([
      from.lng + (to.lng - from.lng) * f,
      from.lat + (to.lat - from.lat) * f
    ]);
  }
  return pts;
}

module.exports = { haversineKm, greatCircleArc, straightLine, getMapboxRoute };
