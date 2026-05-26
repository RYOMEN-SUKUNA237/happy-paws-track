import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Pause, Play, Navigation, Clock, Package, Truck, RefreshCw, LocateFixed, Maximize2, Minimize2, Map, List, Loader2, X, Edit, Search } from 'lucide-react';
import { Shipment } from './types';
import * as api from '../../services/api';
import mapboxgl from 'mapbox-gl';
import { MAPBOX_TOKEN, initMapbox, interpolateAlongRoute, interpolateMultiModal, formatDistance, formatDuration, computeTimeBasedProgress, computeTimeRemaining, getRouteWithFallback, ROUTE_STYLES, ROUTE_STYLE, snapCoordsToRoute, haversineDistance, geocodeSearch } from '../../utils/mapbox';
import { RouteSegment, TransitStop, findNearestHub } from '../../utils/transportPlanner';

interface TrackMapProps { shipments: Shipment[]; setShipments: React.Dispatch<React.SetStateAction<Shipment[]>>; onRefresh: () => void; }

const STATUS_COLORS: Record<string, string> = { 'in-transit':'#3b82f6','out-for-delivery':'#06b6d4','paused':'#f59e0b','picked-up':'#8b5cf6','pending':'#6b7280','delivered':'#10b981' };

const TrackMap: React.FC<TrackMapProps> = ({ shipments, setShipments, onRefresh }) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullData, setFullData] = useState<Record<string, any>>({});
  const [progress, setProgress] = useState(0);
  const [eta, setEta] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [mobileTab, setMobileTab] = useState<'list'|'map'>('list');
  const [pausing, setPausing] = useState(false);
  // Optimistic pause state: key = trackingId, value = optimistic isPaused
  const [optimisticPause, setOptimisticPause] = useState<Record<string, boolean>>({});
  const [pauseToast, setPauseToast] = useState<string | null>(null);

  // Alter Position State
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [alterProgress, setAlterProgress] = useState(0);
  const [alterLocationName, setAlterLocationName] = useState('');
  const [alterLat, setAlterLat] = useState<number | null>(null);
  const [alterLng, setAlterLng] = useState<number | null>(null);
  const [locationQuery, setLocationQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{ lng: number; lat: number; place_name: string }>>([]);
  const [isSubmittingAlter, setIsSubmittingAlter] = useState(false);

  // Transit Stops States
  const [isTransitOpen, setIsTransitOpen] = useState(false);
  const [stopSearchQuery, setStopSearchQuery] = useState('');
  const [stopSuggestions, setStopSuggestions] = useState<Array<{ lng: number; lat: number; place_name: string }>>([]);
  const [isAddingStop, setIsAddingStop] = useState(false);
  const [isMapClickStopActive, setIsMapClickStopActive] = useState(false);
  const [isLandingTransit, setIsLandingTransit] = useState(false);
  const [transitLandReason, setTransitLandReason] = useState('');
  const [showTransitLandModal, setShowTransitLandModal] = useState(false);

  const isMapClickStopActiveRef = useRef(isMapClickStopActive);
  useEffect(() => {
    isMapClickStopActiveRef.current = isMapClickStopActive;
  }, [isMapClickStopActive]);

  const activeShipments = shipments.filter(s => ['in-transit','out-for-delivery','paused','picked-up'].includes(s.status));
  const selected = selectedId ? activeShipments.find(s => s.trackingId === selectedId) : null;
  const selectedFull = selectedId ? fullData[selectedId] : null;

  // Selected ref for Mapbox events
  const selectedFullRef = useRef<any>(null);
  
  // Sync select ref and reset alter states when selected shipment changes
  useEffect(() => {
    selectedFullRef.current = selectedFull;
    if (selectedFull) {
      const initialProg = Math.round(computeTimeBasedProgress(selectedFull));
      setAlterProgress(initialProg);
      setAlterLocationName('');
      setAlterLat(null);
      setAlterLng(null);
      setLocationQuery('');
      setSuggestions([]);
    }
  }, [selectedFull]);

  // Load full data for all shipments — only refetch when the set of tracking IDs changes,
  // NOT on every prop reference update (which caused the blank-screen feedback loop).
  const shipmentIds = shipments.map(s => s.trackingId).join(',');
  useEffect(() => {
    api.shipments.list({ limit: 100 }).then(res => {
      const dict: Record<string, any> = {};
      const parse = (v: any) => { if (!v) return null; let p = v; while (typeof p === 'string') { try { p = JSON.parse(p); } catch { break; } } return p; };
      for (const s of res.shipments) {
        const segments = parse(s.multi_modal_segments);
        // Ensure numeric fields are numbers (DB may return strings)
        if (Array.isArray(segments)) {
          segments.forEach((seg: any) => {
            if (seg) seg.durationHours = Number(seg.durationHours) || 0;
          });
        }
        dict[s.tracking_id] = {
          ...s,
          trackingId: s.tracking_id,
          route_data: parse(s.route_data),
          multi_modal_segments: segments,
          multi_modal_stops: parse(s.multi_modal_stops),
          scheduled_transit_stops: parse(s.scheduled_transit_stops)
        };
      }
      setFullData(dict);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipmentIds]);

  // Auto-select first shipment
  useEffect(() => {
    if (!selectedId && activeShipments.length > 0) setSelectedId(activeShipments[0].trackingId);
  }, [activeShipments.length]);

  // Auto-transit-landing is temporarily disabled.
  // Transit stops UI remains available but auto-landing logic is removed
  // to prevent crashes from malformed segment coordinate data.

  // Live progress ticker
  useEffect(() => {
    if (!selectedFull) return;
    const tick = () => {
      const currentProg = computeTimeBasedProgress(selectedFull);
      setProgress(currentProg);
      setEta(computeTimeRemaining(selectedFull));
      // Auto-transit-landing removed — see comment above.
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => clearInterval(t);
  }, [selectedFull, onRefresh]);

  // ResizeObserver for map visibility
  useEffect(() => {
    const el = mapContainer.current;
    if (!el) return;
    const obs = new ResizeObserver(() => { if (map.current && el.offsetWidth > 0) map.current.resize(); });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const handleMapClickSnap = useCallback((snappedProgress: number, snappedCoords: [number, number]) => {
    setAlterProgress(Math.round(snappedProgress));
    setAlterLat(snappedCoords[1]);
    setAlterLng(snappedCoords[0]);
    const name = `Snapped Route Point (${snappedProgress.toFixed(0)}%)`;
    setAlterLocationName(name);
    setLocationQuery(name);
    setIsPanelOpen(true);
  }, []);

  const handleMapClickSnapRef = useRef(handleMapClickSnap);
  useEffect(() => {
    handleMapClickSnapRef.current = handleMapClickSnap;
  }, [handleMapClickSnap]);

  const handleMapClickAddStop = async (coords: [number, number]) => {
    if (!selectedFull || isAddingStop) return;
    setIsAddingStop(true);
    setStopSearchQuery(`${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}`);
    try {
      let placeName = 'Map Coordinates';
      try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${coords[0]},${coords[1]}.json?access_token=${MAPBOX_TOKEN}&types=place,address&limit=1`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.features && data.features[0]) {
          placeName = data.features[0].place_name.split(',')[0];
        }
      } catch (err) {
        console.error("Reverse geocoding failed:", err);
      }

      setStopSearchQuery(placeName);
      const hub = await findNearestHub(coords, 'airport', placeName);
      if (hub) {
        await api.shipments.addTransitStop(selectedFull.tracking_id || selectedFull.trackingId, {
          airport_name: hub.name,
          lat: hub.coords[1],
          lng: hub.coords[0],
        });
        setPauseToast(`✈️ Added transit stop: ${hub.name}`);
        setTimeout(() => setPauseToast(null), 3000);
        setStopSearchQuery('');
        setIsMapClickStopActive(false);
        onRefresh();
      } else {
        alert('Could not find closest airport.');
      }
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsAddingStop(false);
    }
  };

  const handleMapClickAddStopRef = useRef(handleMapClickAddStop);
  useEffect(() => {
    handleMapClickAddStopRef.current = handleMapClickAddStop;
  }, [handleMapClickAddStop]);

  // Init map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    initMapbox();
    if (!MAPBOX_TOKEN) return;
    const m = new mapboxgl.Map({ container: mapContainer.current, style: 'mapbox://styles/mapbox/dark-v11', center: [10, 6], zoom: 3, pitch: 40, antialias: true, projection: 'globe', failIfMajorPerformanceCaveat: false });
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('style.load', () => { try { m.setFog({ color:'rgb(10,25,47)','high-color':'rgb(20,40,80)','horizon-blend':0.08,'space-color':'rgb(5,10,20)','star-intensity':0.6 }); } catch {} });
    m.on('load', () => setMapReady(true));
    
    m.on('click', (e) => {
      if (isMapClickStopActiveRef.current) {
        const clickCoords: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        handleMapClickAddStopRef.current(clickCoords);
        return;
      }

      if (selectedFullRef.current && selectedFullRef.current.route_data?.coordinates?.length > 1) {
        const routeCoords = selectedFullRef.current.route_data.coordinates;
        const clickCoords: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        const { progress: snappedProgress, snappedCoords } = snapCoordsToRoute(routeCoords, clickCoords);
        const distance = haversineDistance(clickCoords, snappedCoords);
        
        // If click is within 150 km of the route, snap it!
        if (distance < 150) {
          handleMapClickSnapRef.current(snappedProgress, snappedCoords);
        }
      }
    });

    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  // Change map cursor when in stop-pick mode
  useEffect(() => {
    if (!map.current) return;
    const canvas = map.current.getCanvas();
    if (canvas) {
      canvas.style.cursor = isMapClickStopActive ? 'crosshair' : '';
    }
  }, [isMapClickStopActive]);

  // Draw route for selected shipment
  useEffect(() => {
    if (!map.current || !mapReady) return;
    const m = map.current;
    // Clear previous
    markersRef.current.forEach(mk => mk.remove());
    markersRef.current = [];
    ['route-air','route-sea','route-road','route-glow','route-single'].forEach(id => { try { m.removeLayer(id); } catch {} });
    ['src-air','src-sea','src-road','src-single'].forEach(id => { try { m.removeSource(id); } catch {} });

    // Clean up dynamic multimodal segment layers and sources
    try {
      const style = m.getStyle();
      if (style) {
        if (style.layers) {
          style.layers.forEach(ly => {
            if (ly.id.startsWith('route-seg-')) {
              try { m.removeLayer(ly.id); } catch {}
            }
          });
        }
        if (style.sources) {
          Object.keys(style.sources).forEach(srcId => {
            if (srcId.startsWith('src-seg-')) {
              try { m.removeSource(srcId); } catch {}
            }
          });
        }
      }
    } catch (err) {
      console.error('Error clearing dynamic segments:', err);
    }

    if (!selectedFull) return;
    const s = selectedFull;
    const segments: RouteSegment[] | null = s.multi_modal_segments;
    const color = STATUS_COLORS[selected?.status || ''] || '#3b82f6';

    const addMarker = (lng: number, lat: number, bg: string, label: string) => {
      const el = document.createElement('div');
      el.innerHTML = `<div title="${label}" style="width:12px;height:12px;border-radius:50%;background:${bg};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>`;
      markersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat([lng, lat]).addTo(m));
    };

    if (segments && segments.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      segments.forEach((seg, i) => {
        if (!seg.coordinates || seg.coordinates.length < 2) return;
        const style = ROUTE_STYLES[seg.mode] || ROUTE_STYLES.road;
        const srcId = `src-seg-${i}`; const layerId = `route-seg-${i}`;
        try { m.addSource(srcId, { type:'geojson', data:{ type:'Feature', properties:{}, geometry:{ type:'LineString', coordinates: seg.coordinates } } }); } catch {}
        const paintObj: any = {
          'line-color': style.color,
          'line-width': style.width,
          'line-opacity': style.opacity,
        };
        if (style.dasharray) {
          paintObj['line-dasharray'] = style.dasharray;
        }
        try { m.addLayer({ id: layerId, type:'line', source: srcId, layout:{'line-join':'round','line-cap':'round'}, paint: paintObj }); } catch {}
        seg.coordinates.forEach(c => bounds.extend(c as [number,number]));
      });
      if (s.origin_lat) { addMarker(Number(s.origin_lng), Number(s.origin_lat), '#10b981', 'Origin'); bounds.extend([Number(s.origin_lng), Number(s.origin_lat)]); }
      if (s.dest_lat) { addMarker(Number(s.dest_lng), Number(s.dest_lat), '#ef4444', 'Destination'); bounds.extend([Number(s.dest_lng), Number(s.dest_lat)]); }
      try { m.fitBounds(bounds, { padding: 60, duration: 1000 }); } catch {}
    } else if (s.route_data?.coordinates?.length > 0) {
      try { m.addSource('src-single', { type:'geojson', data:{ type:'Feature', properties:{}, geometry: s.route_data } }); } catch {}
      try { m.addLayer({ id:'route-glow', type:'line', source:'src-single', layout:{'line-join':'round','line-cap':'round'}, paint:{'line-color': ROUTE_STYLE.glowColor,'line-width': ROUTE_STYLE.glowWidth,'line-opacity': ROUTE_STYLE.glowOpacity} }); } catch {}
      try { m.addLayer({ id:'route-single', type:'line', source:'src-single', layout:{'line-join':'round','line-cap':'round'}, paint:{'line-color': color,'line-width': ROUTE_STYLE.width,'line-opacity': ROUTE_STYLE.opacity} }); } catch {}
      if (s.origin_lat) addMarker(Number(s.origin_lng), Number(s.origin_lat), '#10b981', 'Origin');
      if (s.dest_lat) addMarker(Number(s.dest_lng), Number(s.dest_lat), '#ef4444', 'Destination');
      const bounds = new mapboxgl.LngLatBounds();
      if (s.origin_lat) bounds.extend([Number(s.origin_lng), Number(s.origin_lat)]);
      if (s.dest_lat) bounds.extend([Number(s.dest_lng), Number(s.dest_lat)]);
      try { m.fitBounds(bounds, { padding: 80, duration: 1000 }); } catch {}
    } else if (s.origin_lat && s.dest_lat) {
      addMarker(Number(s.origin_lng), Number(s.origin_lat), '#10b981', 'Origin');
      addMarker(Number(s.dest_lng), Number(s.dest_lat), '#ef4444', 'Destination');
      const bounds = new mapboxgl.LngLatBounds();
      bounds.extend([Number(s.origin_lng), Number(s.origin_lat)]);
      bounds.extend([Number(s.dest_lng), Number(s.dest_lat)]);
      try { m.fitBounds(bounds, { padding: 80, duration: 1000 }); } catch {}
      // Fetch road route async
      getRouteWithFallback([Number(s.origin_lng), Number(s.origin_lat)], [Number(s.dest_lng), Number(s.dest_lat)]).then(r => {
        if (!r?.geometry?.coordinates?.length || !map.current) return;
        try { map.current.addSource('src-single', { type:'geojson', data:{ type:'Feature', properties:{}, geometry: r.geometry } }); } catch {}
        try { map.current.addLayer({ id:'route-single', type:'line', source:'src-single', layout:{'line-join':'round','line-cap':'round'}, paint:{'line-color': color,'line-width': ROUTE_STYLE.width,'line-opacity': ROUTE_STYLE.opacity} }); } catch {}
      }).catch(() => {});
    }

    // Draw scheduled transit stops as airplane icon markers
    const scheduledStops = s.scheduled_transit_stops || [];
    if (Array.isArray(scheduledStops)) {
      scheduledStops.forEach((stop: any) => {
        if (stop.lat && stop.lng) {
          const el = document.createElement('div');
          el.innerHTML = `<div title="Transit Stop: ${stop.name}" style="width:24px;height:24px;border-radius:50%;background:#0284c7;color:white;display:flex;align-items:center;justify-content:center;font-size:12px;box-shadow:0 2px 6px rgba(0,0,0,.3);cursor:pointer;border:2px solid white;transform:rotate(-45deg)">✈️</div>`;
          markersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat([stop.lng, stop.lat]).addTo(m));
        }
      });
    }

    // Live position marker
    const stops: TransitStop[] | null = s.multi_modal_stops;
    let pos: [number, number] | null = null;
    const effectiveProgress = isPanelOpen ? alterProgress : progress;
    if (segments && segments.length > 0 && stops) {
      const totalDur = s.route_duration ? s.route_duration / 3600 : segments.reduce((a: number, sg: RouteSegment) => a + sg.durationHours, 0);
      pos = interpolateMultiModal(segments, stops, totalDur, effectiveProgress).position;
    } else if (s.route_data?.coordinates?.length > 0) {
      pos = interpolateAlongRoute(s.route_data.coordinates, effectiveProgress);
    } else if (s.origin_lat && s.dest_lat) {
      const p = effectiveProgress / 100;
      pos = [Number(s.origin_lng) + (Number(s.dest_lng) - Number(s.origin_lng)) * p, Number(s.origin_lat) + (Number(s.dest_lat) - Number(s.origin_lat)) * p];
    }
    if (pos) {
      const el = document.createElement('div');
      const isTransitLanded = s.is_paused && s.pause_category === 'Transit Stop';
      if (isTransitLanded) {
        const displayText = s.pause_reason || 'Transit Stop';
        el.innerHTML = `
          <div style="position:relative; display:flex; flex-direction:column; align-items:center;">
            <div style="width:24px;height:24px;border-radius:50%;background:#f59e0b;opacity:.4;position:absolute;top:-4px;left:-4px;animation:ping 1.5s infinite"></div>
            <div style="width:16px;height:16px;border-radius:50%;background:#f59e0b;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.3);position:relative;z-index:2"></div>
            <div style="position:absolute; bottom:22px; white-space:nowrap; background:rgba(15, 23, 42, 0.95); border:1px solid rgba(245, 158, 11, 0.6); color:#fbbf24; font-size:10px; font-weight:bold; padding:4px 8px; border-radius:6px; box-shadow:0 4px 12px rgba(0,0,0,0.4); z-index:10; pointer-events:none; display:flex; align-items:center; gap:4px;">
              <span>✈️ Landed: ${displayText}</span>
            </div>
          </div>
        `;
      } else {
        el.innerHTML = `<div style="position:relative"><div style="width:22px;height:22px;border-radius:50%;background:${color};opacity:.25;position:absolute;top:-3px;left:-3px;animation:ping 1.5s infinite"></div><div style="width:16px;height:16px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.3);position:relative;z-index:1"></div></div>`;
      }
      markersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat(pos).addTo(m));
    }
  }, [selectedId, mapReady, selectedFull, progress, isPanelOpen, alterProgress]);

  const handlePauseResume = async () => {
    if (!selected || pausing) return;
    const waspaused = optimisticPause[selected.trackingId] ?? selected.isPaused;
    const nowPaused = !waspaused;

    // ── Optimistic update: flip UI immediately ──
    setOptimisticPause(prev => ({ ...prev, [selected.trackingId]: nowPaused }));
    setShipments(prev => prev.map(s =>
      s.trackingId === selected.trackingId ? { ...s, isPaused: nowPaused, status: nowPaused ? 'paused' : 'in-transit' } : s
    ));
    setPauseToast(nowPaused ? `⏸ ${selected.trackingId} paused` : `▶️ ${selected.trackingId} resumed`);
    setTimeout(() => setPauseToast(null), 3000);
    setPausing(true);

    try {
      await api.shipments.togglePause(selected.trackingId);
      // Background sync — refresh full data silently
      onRefresh();
    } catch (e: any) {
      // Rollback optimistic update on error
      setOptimisticPause(prev => ({ ...prev, [selected.trackingId]: waspaused }));
      setShipments(prev => prev.map(s =>
        s.trackingId === selected.trackingId ? { ...s, isPaused: waspaused, status: waspaused ? 'paused' : 'in-transit' } : s
      ));
      setPauseToast(`❌ Failed: ${(e as any).message}`);
      setTimeout(() => setPauseToast(null), 4000);
    } finally {
      setPausing(false);
    }
  };

  const handleLocationSearch = async (val: string) => {
    setLocationQuery(val);
    if (val.trim().length > 2) {
      try {
        const results = await geocodeSearch(val);
        setSuggestions(results);
      } catch (e) {
        console.error(e);
      }
    } else {
      setSuggestions([]);
    }
  };

  const handleSelectSuggestion = (sug: { lng: number; lat: number; place_name: string }) => {
    if (!selectedFull || !selectedFull.route_data?.coordinates) return;
    const { progress: snappedProgress, snappedCoords } = snapCoordsToRoute(selectedFull.route_data.coordinates, [sug.lng, sug.lat]);
    setAlterProgress(Math.round(snappedProgress));
    setAlterLat(snappedCoords[1]);
    setAlterLng(snappedCoords[0]);
    setAlterLocationName(sug.place_name);
    setLocationQuery(sug.place_name);
    setSuggestions([]);
  };

  const handleSliderChange = (val: number) => {
    setAlterProgress(val);
    if (selectedFull && selectedFull.route_data?.coordinates?.length > 1) {
      const coords = interpolateAlongRoute(selectedFull.route_data.coordinates, val);
      setAlterLng(coords[0]);
      setAlterLat(coords[1]);
      setAlterLocationName(`Route Point (${val}%)`);
      setLocationQuery(`Route Point (${val}%)`);
    }
  };

  const handleApplyAlter = async () => {
    if (!selected || isSubmittingAlter) return;
    setIsSubmittingAlter(true);
    try {
      await api.shipments.alterLocation(selected.trackingId, {
        progress: alterProgress,
        location_name: alterLocationName,
        lat: alterLat || undefined,
        lng: alterLng || undefined,
      });
      setPauseToast(`✅ Location altered to ${alterProgress}%`);
      setTimeout(() => setPauseToast(null), 3000);
      setIsPanelOpen(false);
      onRefresh();
    } catch (e: any) {
      setPauseToast(`❌ Alter failed: ${e.message}`);
      setTimeout(() => setPauseToast(null), 4000);
    } finally {
      setIsSubmittingAlter(false);
    }
  };

  const handleStopSearch = async (val: string) => {
    setStopSearchQuery(val);
    if (val.trim().length > 2) {
      try {
        const results = await geocodeSearch(val);
        setStopSuggestions(results);
      } catch (e) {
        console.error(e);
      }
    } else {
      setStopSuggestions([]);
    }
  };

  const handleAddMidflightStop = async (sug: { lng: number; lat: number; place_name: string }) => {
    if (!selectedFull || isAddingStop) return;
    setIsAddingStop(true);
    setStopSearchQuery(sug.place_name);
    setStopSuggestions([]);
    try {
      const hub = await findNearestHub([sug.lng, sug.lat], 'airport', sug.place_name);
      if (hub) {
        await api.shipments.addTransitStop(selectedFull.tracking_id || selectedFull.trackingId, {
          airport_name: hub.name,
          lat: hub.coords[1],
          lng: hub.coords[0],
        });
        setPauseToast(`✈️ Added transit stop: ${hub.name}`);
        setTimeout(() => setPauseToast(null), 3000);
        setStopSearchQuery('');
        onRefresh();
      } else {
        alert('Could not find closest airport.');
      }
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsAddingStop(false);
    }
  };

  /** Enter key handler for mid-flight stop search */
  const handleMidflightStopKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!selectedFull || isAddingStop) return;

    let target: { lng: number; lat: number; place_name: string } | null = null;

    if (stopSuggestions.length > 0) {
      target = stopSuggestions[0];
    } else {
      const q = stopSearchQuery.trim();
      if (q.length < 2) return;
      setIsAddingStop(true);
      try {
        const results = await geocodeSearch(q);
        if (results.length > 0) {
          target = results[0];
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsAddingStop(false);
      }
    }

    if (target) {
      await handleAddMidflightStop(target);
    }
  };

  const handleRemoveMidflightStop = async (idx: number) => {
    if (!selectedFull) return;
    if (!confirm('Are you sure you want to remove this transit stop?')) return;
    try {
      await api.shipments.deleteTransitStop(selectedFull.tracking_id || selectedFull.trackingId, idx);
      setPauseToast('✈️ Removed transit stop');
      setTimeout(() => setPauseToast(null), 3000);
      onRefresh();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  };

  const handleTransitLand = async () => {
    if (!selectedFull || isLandingTransit) return;
    setIsLandingTransit(true);
    try {
      const airportName = transitLandReason.trim() || 'Transit Airport';
      await api.shipments.transitLand(selectedFull.tracking_id || selectedFull.trackingId, {
        airport_name: airportName,
        reason: `Scheduled layover at ${airportName}`,
      });
      setPauseToast(`✈️ Aircraft successfully landed at ${airportName}`);
      setTimeout(() => setPauseToast(null), 3000);
      setShowTransitLandModal(false);
      setTransitLandReason('');
      onRefresh();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsLandingTransit(false);
    }
  };

  const selectShipment = (s: Shipment) => {
    setSelectedId(s.trackingId);
    setMobileTab('map');
  };

  const mapHeight = expanded ? 'calc(100vh - 130px)' : '420px';

  const ShipmentCard: React.FC<{ s: Shipment }> = ({ s }) => {
    const f = fullData[s.trackingId];
    const prog = f ? computeTimeBasedProgress(f) : s.progress;
    const isSelected = selectedId === s.trackingId;
    // Use optimistic state if available
    const isPaused = optimisticPause[s.trackingId] ?? s.isPaused;
    const displayStatus = isPaused ? 'paused' : s.status;
    const color = STATUS_COLORS[displayStatus] || '#6b7280';
    return (
      <div onClick={() => selectShipment(s)} className={`p-4 border-b border-gray-100 cursor-pointer transition-all ${isSelected ? 'bg-blue-50 border-l-4 border-l-blue-500' : 'hover:bg-gray-50'}`}>
        <div className="flex items-start justify-between mb-1">
          <p className="text-xs font-mono font-bold text-[#0a192f] truncate max-w-[140px]">{s.trackingId}</p>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors ${
            isPaused ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
          }`}>{isPaused ? '⏸ Paused' : displayStatus.replace('-',' ')}</span>
        </div>
        <p className="text-[11px] text-gray-500 truncate mb-2">{s.origin} → {s.destination}</p>
        <div className="w-full bg-gray-200 rounded-full h-1"><div className="h-1 rounded-full transition-all duration-500" style={{ width: `${Math.round(prog)}%`, background: color }} /></div>
        <p className="text-[10px] text-gray-400 mt-0.5">{Math.round(prog)}%</p>
      </div>
    );
  };

  // Derive selected's optimistic pause state
  const selectedIsPaused = selected ? (optimisticPause[selected.trackingId] ?? selected.isPaused) : false;

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
      {/* Toast notification */}
      <AnimatePresence>
        {pauseToast && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-semibold border ${
              pauseToast.startsWith('❌') ? 'bg-red-50 text-red-700 border-red-200' :
              pauseToast.startsWith('⏸') ? 'bg-amber-50 text-amber-800 border-amber-200' :
              'bg-green-50 text-green-700 border-green-200'
            }`}
          >
            {pauseToast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div><h2 className="text-lg sm:text-xl font-bold text-[#0a192f]">Live Tracking Map</h2><p className="text-xs text-gray-400">{activeShipments.length} active · click a shipment to focus</p></div>
        <div className="flex gap-2">
          <button onClick={onRefresh} className="flex items-center gap-1 text-xs bg-white px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"><RefreshCw size={13} /> Refresh</button>
          <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200"><span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />Live</span>
        </div>
      </div>

      {/* Mobile Tabs */}
      <div className="flex sm:hidden gap-1 mb-3 bg-gray-100 p-1 rounded-lg flex-shrink-0">
        <button onClick={() => setMobileTab('list')} className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-all ${mobileTab==='list'?'bg-white shadow text-[#0a192f]':'text-gray-500'}`}><List size={13}/> Shipments</button>
        <button onClick={() => setMobileTab('map')} className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-all ${mobileTab==='map'?'bg-white shadow text-[#0a192f]':'text-gray-500'}`}><Map size={13}/> Map{selected && <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"/>}</button>
      </div>

      {!MAPBOX_TOKEN ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center"><p className="text-amber-800 font-medium mb-1">Mapbox Token Required</p><p className="text-amber-600 text-sm">Add VITE_MAPBOX_TOKEN to .env.local</p></div>
      ) : (
        <div className="flex gap-4 flex-1 min-h-0">
          {/* Sidebar */}
          <div className={`${mobileTab==='map'?'hidden':'flex'} sm:flex flex-col w-full sm:w-72 flex-shrink-0 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden`}>
            <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0">
              <p className="text-xs font-bold text-[#0a192f]">Active Shipments</p>
              <p className="text-[11px] text-gray-400">{activeShipments.length} being tracked</p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {activeShipments.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400">No active shipments</div>
              ) : activeShipments.map(s => <ShipmentCard key={s.trackingId} s={s} />)}
            </div>
          </div>

          {/* Map + Info */}
          <div className={`${mobileTab==='list'?'hidden':'flex'} sm:flex flex-col flex-1 min-w-0 gap-3`}>
            {/* Map */}
            <div className="relative rounded-xl overflow-hidden border border-gray-200 shadow-sm bg-[#0a192f] flex-shrink-0 transition-all duration-300" style={{ height: mapHeight }}>
              <div ref={mapContainer} style={{ position:'absolute', inset:0, width:'100%', height:'100%' }} />
              {!mapReady && <div className="absolute inset-0 flex items-center justify-center bg-[#0a192f]/90 z-20"><Loader2 size={28} className="animate-spin text-blue-400"/></div>}
              {/* Expand button */}
              <button onClick={() => setExpanded(e => !e)} className="absolute top-3 right-3 z-10 w-8 h-8 bg-white rounded-lg shadow-lg flex items-center justify-center text-gray-600 hover:text-[#0a192f]">
                {expanded ? <Minimize2 size={15}/> : <Maximize2 size={15}/>}
              </button>
              {/* Legend */}
              <div className="absolute bottom-3 left-3 z-10 bg-white/90 backdrop-blur px-3 py-1.5 rounded-lg shadow text-[10px] text-gray-600 flex gap-3 flex-wrap">
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#0a192f] rounded"/>Road</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-cyan-500 rounded"/>Air</span>
                <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 rounded"/>Sea</span>
              </div>
              {!selected && <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none"><div className="bg-white/90 px-6 py-3 rounded-xl shadow text-sm font-medium text-gray-500">← Select a shipment</div></div>}
            </div>

            {/* Selected Shipment Info */}
            <AnimatePresence>
              {selected && selectedFull && (() => {
                const isTransitStopPaused = selectedFull && selectedIsPaused && selectedFull.pause_category === 'Transit Stop';
                return (
                  <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:10}} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex-shrink-0">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                      <div>
                        <p className="font-mono font-bold text-sm text-[#0a192f]">{selected.trackingId}</p>
                        <p className="text-[11px] text-gray-400">{selected.origin} → {selected.destination}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handlePauseResume}
                          disabled={pausing}
                          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-150 disabled:opacity-60 border ${
                            selectedIsPaused
                              ? isTransitStopPaused
                                ? 'bg-sky-50 text-sky-700 hover:bg-sky-100 border-sky-200'
                                : 'bg-green-50 text-green-700 hover:bg-green-100 border-green-200'
                              : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200'
                          }`}
                        >
                          {pausing
                            ? <Loader2 size={12} className="animate-spin"/>
                            : selectedIsPaused
                              ? isTransitStopPaused
                                ? <><Play size={12}/>Resume Flight</>
                                : <><Play size={12}/>Resume Shipment</>
                              : <><Pause size={12}/>Pause Shipment</>}
                        </button>
                      </div>
                    </div>
                    {/* On-Hold / Transit Stop Banner */}
                    {selectedIsPaused && (
                      isTransitStopPaused ? (
                        <div className="px-4 py-2 bg-sky-50 border-b border-sky-100 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-sky-500 animate-pulse flex-shrink-0"/>
                          <p className="text-xs text-sky-700 font-semibold">✈️ Aircraft landed at transit stop: {selectedFull.pause_reason || 'Layover'}</p>
                        </div>
                      ) : (
                        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0"/>
                          <p className="text-xs text-amber-700 font-semibold">⏸ This shipment is currently on hold</p>
                        </div>
                      )
                    )}
                    <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div>
                        <p className="text-gray-400 uppercase text-[10px]">Status</p>
                        <p className={`font-semibold capitalize ${selectedIsPaused ? (isTransitStopPaused ? 'text-sky-600' : 'text-amber-600') : 'text-[#0a192f]'}`}>
                          {selectedIsPaused ? (isTransitStopPaused ? '✈️ Landed (Transit)' : '⏸ On Hold') : selected.status.replace('-',' ')}
                        </p>
                      </div>
                      <div><p className="text-gray-400 uppercase text-[10px]">Progress</p><p className="font-semibold text-[#0a192f]">{Math.round(progress)}%</p></div>
                      {eta && <div><p className="text-gray-400 uppercase text-[10px]">ETA</p><p className="font-semibold text-blue-600">{eta}</p></div>}
                    {selectedFull.route_distance && <div><p className="text-gray-400 uppercase text-[10px]">Distance</p><p className="font-semibold text-[#0a192f]">{formatDistance(selectedFull.route_distance)}</p></div>}
                    <div><p className="text-gray-400 uppercase text-[10px]">Cargo</p><p className="font-semibold text-[#0a192f]">{selected.type}</p></div>
                    <div><p className="text-gray-400 uppercase text-[10px]">Weight</p><p className="font-semibold text-[#0a192f]">{selected.weight || 'N/A'}</p></div>
                    <div><p className="text-gray-400 uppercase text-[10px]">Courier</p><p className="font-semibold text-[#0a192f]">{selected.courierName}</p></div>
                    {selectedFull.route_duration && <div><p className="text-gray-400 uppercase text-[10px]">Est. Time</p><p className="font-semibold text-[#0a192f]">{formatDuration(selectedFull.route_duration)}</p></div>}
                  </div>

                  {/* Collapsible Alter Location Card */}
                  <div className="px-4 pb-3 border-t border-gray-100 pt-3">
                    <button
                      onClick={() => setIsPanelOpen(!isPanelOpen)}
                      className="flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors"
                    >
                      <Edit size={13} />
                      {isPanelOpen ? "Hide Position Alter Options" : "Alter Shipment Position (Admin)"}
                    </button>

                    <AnimatePresence>
                      {isPanelOpen && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden mt-3 space-y-3 bg-gray-50 p-3 rounded-xl border border-gray-200"
                        >
                          <p className="text-[11px] text-gray-500">
                            Adjust the delivery position along the track using one of the three synchronized methods below. Click **"Apply"** to save changes.
                          </p>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {/* Method 1 & 3: Slider + Input */}
                            <div className="space-y-2">
                              <label className="block text-[10px] font-bold text-gray-400 uppercase">
                                Methods 1 & 3: Progress Slider & Percent
                              </label>
                              <div className="flex items-center gap-3">
                                <input
                                  type="range"
                                  min="0"
                                  max="100"
                                  value={alterProgress}
                                  onChange={(e) => handleSliderChange(Number(e.target.value))}
                                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                                />
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={alterProgress}
                                    onChange={(e) => handleSliderChange(Math.max(0, Math.min(100, Number(e.target.value))))}
                                    className="w-12 px-1.5 py-1 text-xs text-center border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono font-bold"
                                  />
                                  <span className="text-xs text-gray-500">%</span>
                                </div>
                              </div>
                            </div>

                            {/* Method 2: Location Search Snapping */}
                            <div className="space-y-2 relative">
                              <label className="block text-[10px] font-bold text-gray-400 uppercase">
                                Method 2: Snap to Location on Route
                              </label>
                              <div className="relative">
                                <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-gray-400 pointer-events-none">
                                  <Search size={12} />
                                </span>
                                <input
                                  type="text"
                                  placeholder="Type city or point along route..."
                                  value={locationQuery}
                                  onChange={(e) => handleLocationSearch(e.target.value)}
                                  className="w-full pl-7 pr-3 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              </div>

                              {suggestions.length > 0 && (
                                <div className="absolute left-0 right-0 z-30 mt-1 max-h-32 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                                  {suggestions.map((sug, idx) => (
                                    <div
                                      key={idx}
                                      onClick={() => handleSelectSuggestion(sug)}
                                      className="px-2.5 py-1.5 text-[11px] text-gray-700 hover:bg-blue-50 cursor-pointer truncate border-b border-gray-50 last:border-b-0"
                                    >
                                      {sug.place_name}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Quick Map Snapping Tip */}
                          <div className="flex items-center gap-1.5 bg-blue-50/50 border border-blue-100 rounded-lg p-2 text-[10px] text-blue-700">
                            <span className="flex-shrink-0">📍</span>
                            <span>
                              <strong>Interactive Tip:</strong> You can also click directly on the route line on the map. The marker will immediately snap to the clicked point!
                            </span>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex justify-end gap-2 pt-1 border-t border-gray-200/60">
                            <button
                              onClick={() => {
                                setIsPanelOpen(false);
                                setAlterProgress(Math.round(computeTimeBasedProgress(selectedFull)));
                                setAlterLocationName('');
                                setAlterLat(null);
                                setAlterLng(null);
                                setLocationQuery('');
                              }}
                              className="px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleApplyAlter}
                              disabled={isSubmittingAlter}
                              className="flex items-center gap-1 px-3.5 py-1 text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 rounded-lg shadow transition-colors disabled:opacity-60"
                            >
                              {isSubmittingAlter ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                "Apply Position Alter"
                              )}
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Collapsible Transit Stops Card */}
                  {(() => {
                    const transportModes = selectedFull.transport_modes;
                    let parsedModes = [];
                    try {
                      parsedModes = typeof transportModes === 'string' ? JSON.parse(transportModes) : (transportModes || []);
                    } catch (e) {}
                    const isAirFlight = selected.type === 'Live Animals' ||
                      (Array.isArray(parsedModes) && parsedModes.some((m: string) => m.toLowerCase().includes('flight') || m.toLowerCase().includes('air') || m.toLowerCase().includes('plane'))) ||
                      selectedFull.route_summary?.toLowerCase().includes('air') ||
                      selected.trackingId.includes('AIR');

                    return isAirFlight ? (
                      <div className="px-4 pb-3 border-t border-gray-100 pt-3">
                        <button
                          onClick={() => setIsTransitOpen(!isTransitOpen)}
                          className="flex items-center gap-1.5 text-xs font-bold text-sky-600 hover:text-sky-800 transition-colors"
                        >
                          ✈️ {isTransitOpen ? "Hide Transit Stop Options" : "Scheduled Transit Stops (Admin)"}
                        </button>

                        <AnimatePresence>
                          {isTransitOpen && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              className="overflow-hidden mt-3 space-y-3 bg-sky-50/30 p-3 rounded-xl border border-sky-100 text-xs"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-sky-800 uppercase tracking-wide">
                                  Transit Stop Control Panel
                                </span>
                                <button
                                  onClick={() => setShowTransitLandModal(true)}
                                  className="px-2.5 py-1 bg-sky-600 hover:bg-sky-700 text-white rounded text-[10px] font-semibold transition-colors"
                                >
                                  Land Aircraft Now
                                </button>
                              </div>

                              {/* Scheduled Stops list */}
                              <div className="space-y-1.5">
                                <p className="text-[10px] font-bold text-gray-400 uppercase">Current Scheduled Stops</p>
                                {(selectedFull.scheduled_transit_stops || []).length === 0 ? (
                                  <p className="text-gray-500 italic text-[11px]">No transit stops scheduled.</p>
                                ) : (
                                  <div className="space-y-1">
                                    {(selectedFull.scheduled_transit_stops || []).map((stop: any, idx: number) => (
                                      <div key={idx} className="flex items-center justify-between p-1.5 bg-white border border-gray-150 rounded-lg">
                                        <span className="font-semibold text-gray-700">✈️ {stop.name}</span>
                                        <button
                                          onClick={() => handleRemoveMidflightStop(idx)}
                                          className="text-red-500 hover:text-red-700 text-[10px] font-semibold"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Add stop form */}
                              <div className="space-y-1.5 relative pt-1 border-t border-sky-100/50">
                                <div className="flex items-center justify-between">
                                  <p className="text-[10px] font-bold text-gray-400 uppercase">Add Mid-Flight Stop &amp; Reroute</p>
                                  <button
                                    type="button"
                                    onClick={() => setIsMapClickStopActive(!isMapClickStopActive)}
                                    className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border transition-all flex items-center gap-1 ${
                                      isMapClickStopActive
                                        ? 'bg-sky-600 border-sky-600 text-white animate-pulse'
                                        : 'bg-white hover:bg-sky-50 border-gray-200 text-sky-600'
                                    }`}
                                  >
                                    🎯 {isMapClickStopActive ? 'Click Map Now' : 'Select on Map'}
                                  </button>
                                </div>
                                {isMapClickStopActive && (
                                  <p className="text-[10px] text-sky-600 font-semibold italic">
                                    📍 Click anywhere on the map above to select that coordinate as a transit stop.
                                  </p>
                                )}
                                <div className="relative">
                                  <input
                                    type="text"
                                    placeholder={isAddingStop ? "Resolving closest airport..." : "Search city/country to add stop..."}
                                    value={stopSearchQuery}
                                    onChange={(e) => handleStopSearch(e.target.value)}
                                    onKeyDown={handleMidflightStopKeyDown}
                                    disabled={isAddingStop}
                                    className="w-full px-2.5 py-1 pr-8 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-gray-50"
                                  />
                                  {isAddingStop && (
                                    <div className="absolute right-2 top-1.5">
                                      <Loader2 size={12} className="animate-spin text-sky-500" />
                                    </div>
                                  )}
                                  {stopSuggestions.length > 0 && (
                                    <div className="relative z-20 mt-1 max-h-32 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-inner font-normal">
                                      {stopSuggestions.map((sug, idx) => (
                                        <button
                                          key={idx}
                                          type="button"
                                          onMouseDown={(e) => {
                                            e.preventDefault();
                                            handleAddMidflightStop(sug);
                                          }}
                                          className="w-full text-left px-2.5 py-1.5 text-[11px] text-gray-700 hover:bg-sky-50 transition-colors border-b border-gray-50 last:border-b-0"
                                        >
                                          📍 {sug.place_name}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ) : null;
                  })()}

                  <div className="px-4 pb-3">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="h-2 rounded-full transition-all" style={{ width:`${Math.round(progress)}%`, background: STATUS_COLORS[selected.status]||'#3b82f6' }}/>
                    </div>
                  </div>
                </motion.div>
              )})()}
            </AnimatePresence>
          </div>
        </div>
      )}

      {showTransitLandModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowTransitLandModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 bg-sky-900 text-white">
              <h4 className="text-sm font-bold flex items-center gap-1.5">✈️ Aircraft Transit Landing</h4>
              <button onClick={() => setShowTransitLandModal(false)} className="hover:bg-sky-850 p-1 rounded text-white/80 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="p-6 space-y-4 font-sans">
              <p className="text-xs text-gray-500 leading-relaxed">
                Immediately trigger an aircraft landing at an intermediate transit layover. This will pause the shipment, calculate paused hours, and send automated transit notification emails.
              </p>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5 font-sans">Transit Airport Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Dubai Intl Airport (DXB)"
                  value={transitLandReason}
                  onChange={(e) => setTransitLandReason(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg text-xs outline-none focus:border-sky-500"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowTransitLandModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 text-xs font-semibold rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleTransitLand}
                  disabled={!transitLandReason.trim() || isLandingTransit}
                  className="flex-1 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1 transition-colors disabled:opacity-50"
                >
                  {isLandingTransit ? <Loader2 size={12} className="animate-spin" /> : 'Confirm Landing'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes ping{75%,100%{transform:scale(2.5);opacity:0}}`}</style>
    </div>
  );
};

export default TrackMap;
