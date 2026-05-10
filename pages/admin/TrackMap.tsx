import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Pause, Play, Navigation, Clock, Package, Truck, RefreshCw, LocateFixed, Maximize2, Minimize2, Map, List, Loader2, X } from 'lucide-react';
import { Shipment } from './types';
import * as api from '../../services/api';
import mapboxgl from 'mapbox-gl';
import { MAPBOX_TOKEN, initMapbox, interpolateAlongRoute, interpolateMultiModal, formatDistance, formatDuration, computeTimeBasedProgress, computeTimeRemaining, getRouteWithFallback, ROUTE_STYLES, ROUTE_STYLE } from '../../utils/mapbox';
import type { RouteSegment, TransitStop } from '../../utils/transportPlanner';

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

  const activeShipments = shipments.filter(s => ['in-transit','out-for-delivery','paused','picked-up'].includes(s.status));
  const selected = selectedId ? activeShipments.find(s => s.trackingId === selectedId) : null;
  const selectedFull = selectedId ? fullData[selectedId] : null;

  // Load full data for all shipments
  useEffect(() => {
    api.shipments.list({ limit: 100 }).then(res => {
      const map: Record<string, any> = {};
      for (const s of res.shipments) {
        const parse = (v: any) => { if (!v) return null; let p = v; while (typeof p === 'string') { try { p = JSON.parse(p); } catch { break; } } return p; };
        map[s.tracking_id] = { ...s, route_data: parse(s.route_data), multi_modal_segments: parse(s.multi_modal_segments), multi_modal_stops: parse(s.multi_modal_stops) };
      }
      setFullData(map);
    }).catch(() => {});
  }, [shipments]);

  // Auto-select first shipment
  useEffect(() => {
    if (!selectedId && activeShipments.length > 0) setSelectedId(activeShipments[0].trackingId);
  }, [activeShipments.length]);

  // Live progress ticker
  useEffect(() => {
    if (!selectedFull) return;
    const tick = () => { setProgress(computeTimeBasedProgress(selectedFull)); setEta(computeTimeRemaining(selectedFull)); };
    tick();
    const t = setInterval(tick, 2000);
    return () => clearInterval(t);
  }, [selectedFull]);

  // ResizeObserver for map visibility
  useEffect(() => {
    const el = mapContainer.current;
    if (!el) return;
    const obs = new ResizeObserver(() => { if (map.current && el.offsetWidth > 0) map.current.resize(); });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Init map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    initMapbox();
    if (!MAPBOX_TOKEN) return;
    const m = new mapboxgl.Map({ container: mapContainer.current, style: 'mapbox://styles/mapbox/dark-v11', center: [10, 6], zoom: 3, pitch: 40, antialias: true, projection: 'globe', failIfMajorPerformanceCaveat: false });
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('style.load', () => { try { m.setFog({ color:'rgb(10,25,47)','high-color':'rgb(20,40,80)','horizon-blend':0.08,'space-color':'rgb(5,10,20)','star-intensity':0.6 }); } catch {} });
    m.on('load', () => setMapReady(true));
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  // Draw route for selected shipment
  useEffect(() => {
    if (!map.current || !mapReady) return;
    const m = map.current;
    // Clear previous
    markersRef.current.forEach(mk => mk.remove());
    markersRef.current = [];
    ['route-air','route-sea','route-road','route-glow','route-single'].forEach(id => { try { m.removeLayer(id); } catch {} });
    ['src-air','src-sea','src-road','src-single'].forEach(id => { try { m.removeSource(id); } catch {} });

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
        try { m.addLayer({ id: layerId, type:'line', source: srcId, layout:{'line-join':'round','line-cap':'round'}, paint:{'line-color': style.color,'line-width': style.width,'line-opacity': style.opacity,'line-dasharray': style.dasharray } }); } catch {}
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

    // Live position marker
    const stops: TransitStop[] | null = s.multi_modal_stops;
    let pos: [number, number] | null = null;
    if (segments && segments.length > 0 && stops) {
      const totalDur = s.route_duration ? s.route_duration / 3600 : segments.reduce((a: number, sg: RouteSegment) => a + sg.durationHours, 0);
      pos = interpolateMultiModal(segments, stops, totalDur, progress).position;
    } else if (s.route_data?.coordinates?.length > 0) {
      pos = interpolateAlongRoute(s.route_data.coordinates, progress);
    } else if (s.origin_lat && s.dest_lat) {
      const p = progress / 100;
      pos = [Number(s.origin_lng) + (Number(s.dest_lng) - Number(s.origin_lng)) * p, Number(s.origin_lat) + (Number(s.dest_lat) - Number(s.origin_lat)) * p];
    }
    if (pos) {
      const el = document.createElement('div');
      el.innerHTML = `<div style="position:relative"><div style="width:22px;height:22px;border-radius:50%;background:${color};opacity:.25;position:absolute;top:-3px;left:-3px;animation:ping 1.5s infinite"></div><div style="width:16px;height:16px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.3);position:relative;z-index:1"></div></div>`;
      markersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat(pos).addTo(m));
    }
  }, [selectedId, mapReady, selectedFull, progress]);

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

  const selectShipment = (s: Shipment) => {
    setSelectedId(s.trackingId);
    setMobileTab('map');
  };

  const mapHeight = expanded ? 'calc(100vh - 130px)' : '420px';

  const ShipmentCard = ({ s }: { s: Shipment }) => {
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
              {selected && selectedFull && (
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
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-150 disabled:opacity-60 ${
                          selectedIsPaused
                            ? 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'
                            : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
                        }`}
                      >
                        {pausing
                          ? <Loader2 size={12} className="animate-spin"/>
                          : selectedIsPaused
                            ? <><Play size={12}/>Resume Shipment</>
                            : <><Pause size={12}/>Pause Shipment</>}
                      </button>
                    </div>
                  </div>
                  {/* On-Hold Banner */}
                  {selectedIsPaused && (
                    <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0"/>
                      <p className="text-xs text-amber-700 font-semibold">⏸ This shipment is currently on hold</p>
                    </div>
                  )}
                  <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div><p className="text-gray-400 uppercase text-[10px]">Status</p><p className={`font-semibold capitalize ${selectedIsPaused ? 'text-amber-600' : 'text-[#0a192f]'}`}>{selectedIsPaused ? '⏸ On Hold' : selected.status.replace('-',' ')}</p></div>
                    <div><p className="text-gray-400 uppercase text-[10px]">Progress</p><p className="font-semibold text-[#0a192f]">{Math.round(progress)}%</p></div>
                    {eta && <div><p className="text-gray-400 uppercase text-[10px]">ETA</p><p className="font-semibold text-blue-600">{eta}</p></div>}
                    {selectedFull.route_distance && <div><p className="text-gray-400 uppercase text-[10px]">Distance</p><p className="font-semibold text-[#0a192f]">{formatDistance(selectedFull.route_distance)}</p></div>}
                    <div><p className="text-gray-400 uppercase text-[10px]">Cargo</p><p className="font-semibold text-[#0a192f]">{selected.type}</p></div>
                    <div><p className="text-gray-400 uppercase text-[10px]">Weight</p><p className="font-semibold text-[#0a192f]">{selected.weight || 'N/A'}</p></div>
                    <div><p className="text-gray-400 uppercase text-[10px]">Courier</p><p className="font-semibold text-[#0a192f]">{selected.courierName}</p></div>
                    {selectedFull.route_duration && <div><p className="text-gray-400 uppercase text-[10px]">Est. Time</p><p className="font-semibold text-[#0a192f]">{formatDuration(selectedFull.route_duration)}</p></div>}
                  </div>
                  <div className="px-4 pb-3">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="h-2 rounded-full transition-all" style={{ width:`${Math.round(progress)}%`, background: STATUS_COLORS[selected.status]||'#3b82f6' }}/>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      <style>{`@keyframes ping{75%,100%{transform:scale(2.5);opacity:0}}`}</style>
    </div>
  );
};

export default TrackMap;
