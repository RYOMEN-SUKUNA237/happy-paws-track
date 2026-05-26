import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Package, Search, Plus, Pause, Play, Eye, MapPin, Edit2,
  CheckCircle, Clock, Truck, RotateCcw, X, ArrowRight, Loader2, Navigation
} from 'lucide-react';
import { Shipment, Courier } from './types';
import * as api from '../../services/api';
import { geocodeAddress, geocodeSearch, getRoute, determineTransportModes, formatDistance, MAPBOX_TOKEN, getRouteWithFallback, snapCoordsToRoute, interpolateAlongRoute } from '../../utils/mapbox';
import { buildTransportPlans, formatPlanDuration, TransportPlan, RouteSegment, TransitStop, findNearestHub } from '../../utils/transportPlanner';

interface ShipmentsProps {
  shipments: Shipment[];
  setShipments: React.Dispatch<React.SetStateAction<Shipment[]>>;
  couriers: Courier[];
  onNavigate: (page: string) => void;
  onRefresh: () => void;
}

const statusConfig: Record<string, { color: string; icon: React.ReactNode }> = {
  pending: { color: 'bg-gray-100 text-gray-700', icon: <Clock size={12} /> },
  'picked-up': { color: 'bg-purple-100 text-purple-700', icon: <Package size={12} /> },
  'in-transit': { color: 'bg-blue-100 text-blue-700', icon: <Truck size={12} /> },
  'out-for-delivery': { color: 'bg-cyan-100 text-cyan-700', icon: <MapPin size={12} /> },
  delivered: { color: 'bg-green-100 text-green-700', icon: <CheckCircle size={12} /> },
  returned: { color: 'bg-red-100 text-red-700', icon: <RotateCcw size={12} /> },
  paused: { color: 'bg-amber-100 text-amber-700', icon: <Pause size={12} /> },
};

// City autocomplete component
const CityAutocomplete: React.FC<{
  value: string;
  onChange: (val: string) => void;
  placeholder: string;
  label: string;
}> = ({ value, onChange, placeholder, label }) => {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<Array<{ lng: number; lat: number; place_name: string }>>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>();
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => { setQuery(value); }, [value]);

  React.useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleInput = (val: string) => {
    setQuery(val);
    onChange(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.length < 2) { setSuggestions([]); setOpen(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const results = await geocodeSearch(val);
      setSuggestions(results);
      setOpen(results.length > 0);
      setLoading(false);
    }, 300);
  };

  const handleSelect = (place: { place_name: string }) => {
    setQuery(place.place_name);
    onChange(place.place_name);
    setOpen(false);
    setSuggestions([]);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">{label}</label>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
          placeholder={placeholder}
          className="w-full px-4 py-2.5 pr-8 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] focus:ring-1 focus:ring-[#0a192f] outline-none"
        />
        {loading ? (
          <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
        ) : (
          <MapPin size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
        )}
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(s);
              }}
              className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-blue-50 hover:text-[#0a192f] transition-colors flex items-start gap-2 border-b border-gray-50 last:border-0"
            >
              <MapPin size={14} className="text-blue-500 mt-0.5 flex-shrink-0" />
              <span className="line-clamp-2">{s.place_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const Shipments: React.FC<ShipmentsProps> = ({ shipments, setShipments, couriers, onNavigate, onRefresh }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);

  const [form, setForm] = useState({
    sender: '', senderEmail: '',
    receiver: '', receiverEmail: '',
    origin: '', destination: '',
    weight: '', type: 'General', courierId: '',
    estimatedDelivery: '',
    // Live Animals fields
    petSpecies: '', petBreed: '', petAge: '', petColor: '', petWeight: '',
    petGender: '', petMicrochipId: '', petVaccinationStatus: 'up-to-date',
    petVetName: '', petVetPhone: '', petVetClinic: '',
    petCrateType: 'standard', petTempMin: '', petTempMax: '',
    petFeedingSchedule: '', petMedications: '', petSpecialCare: '',
    petOwnerConsent: false,
  });
  const [creating, setCreating] = useState(false);
  const [routePreview, setRoutePreview] = useState<{ distance: number; duration: number; modes: string[]; summary: string } | null>(null);
  const [transportPlans, setTransportPlans] = useState<TransportPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [routeAnalysed, setRouteAnalysed] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [targetDate, setTargetDate] = useState('');
  const [pauseModal, setPauseModal] = useState<{ open: boolean; shipment: Shipment | null }>({ open: false, shipment: null });
  const [pauseCategory, setPauseCategory] = useState('');
  const [pauseReason, setPauseReason] = useState('');
  const [editModal, setEditModal] = useState<{ open: boolean; shipment: Shipment | null }>({ open: false, shipment: null });
  const [editForm, setEditForm] = useState({ senderName: '', senderEmail: '', receiverName: '', receiverEmail: '', estimatedDelivery: '', description: '', specialInstructions: '' });
  const [saving, setSaving] = useState(false);

  // Transit Stops States
  const [customStops, setCustomStops] = useState<Array<{ name: string; lat: number; lng: number }>>([]);
  const [stopSearchQuery, setStopSearchQuery] = useState('');
  const [stopSuggestions, setStopSuggestions] = useState<Array<{ lng: number; lat: number; place_name: string }>>([]);
  const [isTransitPanelOpen, setIsTransitPanelOpen] = useState(false);
  const [isAddingStop, setIsAddingStop] = useState(false);
  const [isLandingTransit, setIsLandingTransit] = useState(false);
  const [transitLandReason, setTransitLandReason] = useState('');
  const [showTransitLandModal, setShowTransitLandModal] = useState(false);

  const recalculatePlansWithStops = async (stops: Array<{ name: string; lat: number; lng: number }>) => {
    if (!form.origin || !form.destination) return;
    setPlanLoading(true);
    try {
      const [oGeo, dGeo] = await Promise.all([geocodeAddress(form.origin), geocodeAddress(form.destination)]);
      if (oGeo && dGeo) {
        const toRad = (d: number) => (d * Math.PI) / 180;
        const R = 6371;
        const dLat = toRad(dGeo.lat - oGeo.lat);
        const dLon = toRad(dGeo.lng - oGeo.lng);
        const a = Math.sin(dLat/2)**2 + Math.cos(toRad(oGeo.lat)) * Math.cos(toRad(dGeo.lat)) * Math.sin(dLon/2)**2;
        const haversineDist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        const formatStops = stops.map(s => ({ name: s.name, coords: [s.lng, s.lat] as [number, number] }));
        const plans = await buildTransportPlans(form.origin, form.destination, [oGeo.lng, oGeo.lat], [dGeo.lng, dGeo.lat], haversineDist, formatStops);
        setTransportPlans(plans);
        const rec = plans.find(p => p.id === 'air') || plans.find(p => p.isRecommended) || plans[0];
        if (rec) {
          setSelectedPlanId(rec.id);
          setForm(p => ({ ...p, estimatedDelivery: rec.estimatedDeliveryDate }));
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setPlanLoading(false);
    }
  };

  const [isResolvingStop, setIsResolvingStop] = useState(false);

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

  const resolveAndAddStop = async (sug: { lng: number; lat: number; place_name: string }) => {
    if (isResolvingStop) return;
    setIsResolvingStop(true);
    setStopSearchQuery(sug.place_name);
    setStopSuggestions([]);
    try {
      const hub = await findNearestHub([sug.lng, sug.lat], 'airport', sug.place_name);
      if (hub) {
        const newStop = { name: hub.name, lat: hub.coords[1], lng: hub.coords[0] };
        setCustomStops(prev => {
          const next = [...prev, newStop];
          recalculatePlansWithStops(next);
          return next;
        });
        setStopSearchQuery('');
      } else {
        alert('Could not find closest airport for that location.');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsResolvingStop(false);
    }
  };

  const handleAddCreationTransitStop = async (sug: { lng: number; lat: number; place_name: string }) => {
    await resolveAndAddStop(sug);
  };

  /** Auto-resolve: geocode the typed text and pick the closest airport */
  const handleStopSearchKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (isResolvingStop) return;

    // If there are suggestions, use the first one
    if (stopSuggestions.length > 0) {
      await resolveAndAddStop(stopSuggestions[0]);
      return;
    }

    // Otherwise geocode the raw query and use the first result
    const q = stopSearchQuery.trim();
    if (q.length < 2) return;
    setIsResolvingStop(true);
    try {
      const results = await geocodeSearch(q);
      if (results.length > 0) {
        const first = results[0];
        setStopSearchQuery(first.place_name);
        setStopSuggestions([]);
        const hub = await findNearestHub([first.lng, first.lat], 'airport', first.place_name);
        if (hub) {
          const newStop = { name: hub.name, lat: hub.coords[1], lng: hub.coords[0] };
          setCustomStops(prev => {
            const next = [...prev, newStop];
            recalculatePlansWithStops(next);
            return next;
          });
          setStopSearchQuery('');
        } else {
          alert('Could not find closest airport for that location.');
        }
      } else {
        alert('No location found for that search.');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsResolvingStop(false);
    }
  };

  const handleRemoveCreationTransitStop = (idx: number) => {
    setCustomStops(prev => {
      const next = prev.filter((_, i) => i !== idx);
      recalculatePlansWithStops(next);
      return next;
    });
  };

  const handleAddMidflightStop = async (sug: { lng: number; lat: number; place_name: string }) => {
    if (!selectedShipment || isAddingStop) return;
    setIsAddingStop(true);
    setStopSearchQuery(sug.place_name);
    setStopSuggestions([]);
    try {
      const hub = await findNearestHub([sug.lng, sug.lat], 'airport', sug.place_name);
      if (hub) {
        await api.shipments.addTransitStop(selectedShipment.trackingId, {
          airport_name: hub.name,
          lat: hub.coords[1],
          lng: hub.coords[0],
        });
        setAlterToast(`✈️ Added transit stop: ${hub.name}`);
        setTimeout(() => setAlterToast(null), 3000);
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
    if (!selectedShipment || isAddingStop) return;

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
    if (!selectedShipment) return;
    if (!confirm('Are you sure you want to remove this transit stop?')) return;
    try {
      await api.shipments.deleteTransitStop(selectedShipment.trackingId, idx);
      setAlterToast('✈️ Removed transit stop');
      setTimeout(() => setAlterToast(null), 3000);
      onRefresh();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  };

  const handleTransitLand = async () => {
    if (!selectedShipment || isLandingTransit) return;
    setIsLandingTransit(true);
    try {
      const airportName = transitLandReason.trim() || 'Transit Airport';
      await api.shipments.transitLand(selectedShipment.trackingId, {
        airport_name: airportName,
        reason: `Scheduled layover at ${airportName}`,
      });
      setAlterToast(`✈️ Aircraft successfully landed at ${airportName}`);
      setTimeout(() => setAlterToast(null), 3000);
      setShowTransitLandModal(false);
      setTransitLandReason('');
      onRefresh();
      setSelectedShipment(null); // close detail panel on success
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setIsLandingTransit(false);
    }
  };

  // Alter Location States
  const [isAltering, setIsAltering] = useState(false);
  const [alterProgress, setAlterProgress] = useState(0);
  const [alterLocationName, setAlterLocationName] = useState('');
  const [alterLat, setAlterLat] = useState<number | null>(null);
  const [alterLng, setAlterLng] = useState<number | null>(null);
  const [locationQuery, setLocationQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{ lng: number; lat: number; place_name: string }>>([]);
  const [isSubmittingAlter, setIsSubmittingAlter] = useState(false);
  const [alterToast, setAlterToast] = useState<string | null>(null);

  // Sync selected shipment for alteration when selectedShipment changes
  React.useEffect(() => {
    if (selectedShipment) {
      const fullShipment = shipments.find(s => s.id === selectedShipment.id);
      let parse = (v: any) => { if (!v) return null; let p = v; while (typeof p === 'string') { try { p = JSON.parse(p); } catch { break; } } return p; };
      const routeDataParsed = fullShipment ? parse(fullShipment.route_data) : null;
      const transportModesParsed = fullShipment ? parse(fullShipment.transport_modes) : null;
      const scheduledStopsParsed = fullShipment ? parse(fullShipment.scheduled_transit_stops) : null;
      
      (selectedShipment as any).route_data_parsed = routeDataParsed;
      (selectedShipment as any).transport_modes_parsed = transportModesParsed;
      (selectedShipment as any).scheduled_transit_stops_parsed = scheduledStopsParsed || [];

      setAlterProgress(Math.round(selectedShipment.progress || 0));
      setAlterLocationName('');
      setAlterLat(null);
      setAlterLng(null);
      setLocationQuery('');
      setSuggestions([]);
      setIsAltering(false);
      setIsTransitPanelOpen(false);
    }
  }, [selectedShipment, shipments]);

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
    if (!selectedShipment) return;
    const parsedRoute = (selectedShipment as any).route_data_parsed;
    if (!parsedRoute || !parsedRoute.coordinates) return;
    
    const { progress: snappedProgress, snappedCoords } = snapCoordsToRoute(parsedRoute.coordinates, [sug.lng, sug.lat]);
    setAlterProgress(Math.round(snappedProgress));
    setAlterLat(snappedCoords[1]);
    setAlterLng(snappedCoords[0]);
    setAlterLocationName(sug.place_name);
    setLocationQuery(sug.place_name);
    setSuggestions([]);
  };

  const handleSliderChange = (val: number) => {
    setAlterProgress(val);
    if (selectedShipment) {
      const parsedRoute = (selectedShipment as any).route_data_parsed;
      if (parsedRoute && parsedRoute.coordinates?.length > 1) {
        const coords = interpolateAlongRoute(parsedRoute.coordinates, val);
        setAlterLng(coords[0]);
        setAlterLat(coords[1]);
        setAlterLocationName(`Route Point (${val}%)`);
        setLocationQuery(`Route Point (${val}%)`);
      }
    }
  };

  const handleApplyAlter = async () => {
    if (!selectedShipment || isSubmittingAlter) return;
    setIsSubmittingAlter(true);
    try {
      await api.shipments.alterLocation(selectedShipment.trackingId, {
        progress: alterProgress,
        location_name: alterLocationName,
        lat: alterLat || undefined,
        lng: alterLng || undefined,
      });
      setAlterToast(`✅ Location altered to ${alterProgress}%`);
      setTimeout(() => setAlterToast(null), 3000);
      setIsAltering(false);
      
      setShipments(prev => prev.map(s => 
        s.id === selectedShipment.id ? { ...s, progress: alterProgress } : s
      ));
      
      setSelectedShipment(prev => prev ? { ...prev, progress: alterProgress } : null);
      
      if (onRefresh) onRefresh();
    } catch (e: any) {
      setAlterToast(`❌ Alter failed: ${e.message}`);
      setTimeout(() => setAlterToast(null), 4000);
    } finally {
      setIsSubmittingAlter(false);
    }
  };


  const handleCreate = async () => {
    if (!form.sender || !form.receiver || !form.origin || !form.destination || !routeAnalysed) return;
    setCreating(true);
    try {
      let originCoords: { lng: number; lat: number } | null = null;
      let destCoords: { lng: number; lat: number } | null = null;
      let routeData: any = null;
      let transportModes: string[] | null = null;
      let routeDistance: number | undefined;
      let routeDuration: number | undefined;
      let routeSummary: string | undefined;

      const selPlan = transportPlans.find(p => p.id === selectedPlanId);

      if (MAPBOX_TOKEN) {
        const [oGeo, dGeo] = await Promise.all([geocodeAddress(form.origin), geocodeAddress(form.destination)]);
        originCoords = oGeo;
        destCoords = dGeo;
        if (originCoords && destCoords) {
          // Use multi-modal route data if a plan with segments is selected
          if (selPlan && selPlan.segments && selPlan.segments.length > 0) {
            // Concatenate all segment coordinates into one route for legacy compatibility
            const allCoords: [number, number][] = [];
            for (const seg of selPlan.segments) {
              allCoords.push(...seg.coordinates);
            }
            routeData = { type: 'LineString', coordinates: allCoords };
            routeDistance = selPlan.totalDistanceKm * 1000;
            routeDuration = selPlan.totalDurationHours * 3600;
            routeSummary = selPlan.planName;
            transportModes = selPlan.legs.map(l => l.icon + ' ' + l.label);
          } else {
            const route = await getRouteWithFallback([originCoords.lng, originCoords.lat], [destCoords.lng, destCoords.lat]);
            if (route) {
              routeData = route.geometry;
              routeDistance = route.distance;
              routeDuration = route.duration;
              transportModes = determineTransportModes(route.distance, form.type);
            }
          }
        }
      }

      await api.shipments.create({
        sender_name: form.sender,
        sender_email: form.senderEmail || undefined,
        receiver_name: form.receiver,
        receiver_email: form.receiverEmail || undefined,
        origin: form.origin,
        destination: form.destination,
        origin_lat: originCoords?.lat,
        origin_lng: originCoords?.lng,
        dest_lat: destCoords?.lat,
        dest_lng: destCoords?.lng,
        weight: form.weight ? `${form.weight} kg` : undefined,
        cargo_type: form.type,
        courier_id: form.courierId || undefined,
        estimated_delivery: form.estimatedDelivery
          ? new Date(form.estimatedDelivery).toISOString()
          : undefined,
        route_data: routeData,
        transport_modes: transportModes,
        route_distance: routeDistance,
        route_duration: routeDuration,
        route_summary: routeSummary,
        multi_modal_segments: selPlan?.segments ? JSON.stringify(selPlan.segments) : undefined,
        multi_modal_stops: selPlan?.transitStops ? JSON.stringify(selPlan.transitStops) : undefined,
        scheduled_transit_stops: customStops,
      } as any);
      setForm({ sender: '', senderEmail: '', receiver: '', receiverEmail: '', origin: '', destination: '', weight: '', type: 'General', courierId: '', estimatedDelivery: '', petSpecies: '', petBreed: '', petAge: '', petColor: '', petWeight: '', petGender: '', petMicrochipId: '', petVaccinationStatus: 'up-to-date', petVetName: '', petVetPhone: '', petVetClinic: '', petCrateType: 'standard', petTempMin: '', petTempMax: '', petFeedingSchedule: '', petMedications: '', petSpecialCare: '', petOwnerConsent: false });
      setCustomStops([]);
      setRoutePreview(null);
      setTransportPlans([]);
      setSelectedPlanId(null);
      setRouteAnalysed(false);
      setShowCreate(false);
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to create shipment.');
    } finally {
      setCreating(false);
    }
  };

  const previewRoute = async () => {
    if (!form.origin || !form.destination) return;
    setRoutePreview(null);
    setTransportPlans([]);
    setSelectedPlanId(null);
    setPlanLoading(true);
    try {
      const [oGeo, dGeo] = await Promise.all([geocodeAddress(form.origin), geocodeAddress(form.destination)]);
      if (!oGeo || !dGeo) {
        console.warn('Could not geocode addresses');
        setAlterToast('⚠️ Could not locate one or both addresses. Please check and try again.');
        setTimeout(() => setAlterToast(null), 4000);
        setPlanLoading(false);
        return;
      }

      // Haversine straight-line distance (always works, even cross-ocean)
      const toRad = (d: number) => (d * Math.PI) / 180;
      const R = 6371;
      const dLat = toRad(dGeo.lat - oGeo.lat);
      const dLon = toRad(dGeo.lng - oGeo.lng);
      const a = Math.sin(dLat/2)**2 + Math.cos(toRad(oGeo.lat)) * Math.cos(toRad(dGeo.lat)) * Math.sin(dLon/2)**2;
      const haversineDist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

      // Try road route for duration estimate (has its own 10s timeout in mapbox.ts)
      const route = await getRoute([oGeo.lng, oGeo.lat], [dGeo.lng, dGeo.lat]);

      setRoutePreview({
        distance: haversineDist * 1000,
        duration: route ? route.duration : (haversineDist / 80) * 3600,
        modes: [],
        summary: route?.summary || '',
      });

      // Pass haversine as routeDistanceKm — the planner uses it to decide air/sea eligibility.
      // Each individual fetch inside buildTransportPlans has its own 6-10s timeout.
      // As a last-resort safety net, wrap the whole call in a 45s Promise.race so the
      // spinner can NEVER get permanently stuck.
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Route planning timed out. Please try again.')), 45000)
      );
      const plans = await Promise.race([
        buildTransportPlans(form.origin, form.destination, [oGeo.lng, oGeo.lat], [dGeo.lng, dGeo.lat], haversineDist),
        timeoutPromise,
      ]);
      setTransportPlans(plans);
      const rec = plans.find(p => p.isRecommended) || plans[0];
      if (rec) {
        setSelectedPlanId(rec.id);
        setForm(p => ({ ...p, estimatedDelivery: rec.estimatedDeliveryDate }));
      }
      setRouteAnalysed(true);
    } catch (err: any) {
      console.error('Preview route error:', err);
      if (err?.message) {
        setAlterToast('⚠️ ' + err.message);
        setTimeout(() => setAlterToast(null), 5000);
      }
    } finally {
      setPlanLoading(false);
    }
  };


  const handlePauseResume = (shipment: Shipment) => {
    setPauseCategory('');
    setPauseReason('');
    setPauseModal({ open: true, shipment });
  };

  const handleConfirmPause = async () => {
    if (!pauseModal.shipment) return;
    try {
      await api.shipments.togglePause(pauseModal.shipment.trackingId, {
        pause_category: pauseCategory || undefined,
        pause_reason: pauseReason || undefined,
      });
      setPauseModal({ open: false, shipment: null });
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to pause/resume shipment.');
    }
  };

  const handleOpenEdit = (shipment: Shipment) => {
    setEditForm({
      senderName: shipment.sender || '',
      senderEmail: (shipment as any).senderEmail || '',
      receiverName: shipment.receiver || '',
      receiverEmail: (shipment as any).receiverEmail || '',
      // Convert ISO timestamp to datetime-local format (YYYY-MM-DDTHH:mm)
      estimatedDelivery: shipment.estimatedDelivery
        ? (() => {
            const d = new Date(String(shipment.estimatedDelivery));
            if (isNaN(d.getTime())) return shipment.estimatedDelivery || '';
            // datetime-local needs local time format
            const pad = (n: number) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
          })()
        : '',
      description: (shipment as any).description || '',
      specialInstructions: (shipment as any).specialInstructions || '',
    });
    setEditModal({ open: true, shipment });
  };

  const handleSaveEdit = async () => {
    if (!editModal.shipment) return;
    setSaving(true);
    try {
      await api.shipments.update(editModal.shipment.trackingId, {
        sender_name: editForm.senderName || undefined,
        sender_email: editForm.senderEmail || undefined,
        receiver_name: editForm.receiverName || undefined,
        receiver_email: editForm.receiverEmail || undefined,
        // Convert datetime-local value (YYYY-MM-DDTHH:mm) to full ISO string
        estimated_delivery: editForm.estimatedDelivery
          ? new Date(editForm.estimatedDelivery).toISOString()
          : undefined,
        description: editForm.description || undefined,
        special_instructions: editForm.specialInstructions || undefined,
      });
      setEditModal({ open: false, shipment: null });
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to update shipment.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateStatus = async (shipment: Shipment, newStatus: Shipment['status']) => {
    try {
      await api.shipments.updateStatus(shipment.trackingId, { status: newStatus });
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to update status.');
    }
  };

  const filtered = shipments.filter(s => {
    const matchesSearch = s.trackingId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.sender.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.receiver.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-[#0a192f]">Shipment Management</h2>
          <p className="text-sm text-gray-500">{shipments.length} total shipments</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-500 transition-colors flex items-center gap-2 self-start sm:self-auto">
          <Plus size={16} /> Create Shipment
        </button>
      </div>

      {/* Status Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {(['pending', 'picked-up', 'in-transit', 'out-for-delivery', 'delivered', 'paused'] as Shipment['status'][]).map(status => {
          const count = shipments.filter(s => s.status === status).length;
          const conf = statusConfig[status];
          return (
            <button
              key={status}
              onClick={() => setStatusFilter(statusFilter === status ? 'all' : status)}
              className={`p-3 rounded-lg border text-left transition-all ${
                statusFilter === status ? 'border-[#0a192f] bg-[#0a192f]/5 shadow-sm' : 'border-gray-100 bg-white hover:border-gray-200'
              }`}
            >
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${conf.color}`}>
                {conf.icon} {status.replace('-', ' ')}
              </span>
              <p className="text-xl font-bold text-[#0a192f] mt-2">{count}</p>
            </button>
          );
        })}
      </div>

      {/* Create Shipment Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-[#0a192f]">Create New Shipment</h3>
              <button onClick={() => setShowCreate(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} className="text-gray-500" /></button>
            </div>
            <div className="p-6 pb-24 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Sender Name *</label>
                  <input type="text" value={form.sender} onChange={(e) => setForm(p => ({ ...p, sender: e.target.value }))}
                    placeholder="Company or full name" className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] focus:ring-1 focus:ring-[#0a192f] outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Receiver Name *</label>
                  <input type="text" value={form.receiver} onChange={(e) => setForm(p => ({ ...p, receiver: e.target.value }))}
                    placeholder="Company or full name" className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] focus:ring-1 focus:ring-[#0a192f] outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Sender Email</label>
                  <input type="email" value={form.senderEmail} onChange={(e) => setForm(p => ({ ...p, senderEmail: e.target.value }))}
                    placeholder="sender@company.com" className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] focus:ring-1 focus:ring-[#0a192f] outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Receiver Email</label>
                  <input type="email" value={form.receiverEmail} onChange={(e) => setForm(p => ({ ...p, receiverEmail: e.target.value }))}
                    placeholder="receiver@company.com" className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] focus:ring-1 focus:ring-[#0a192f] outline-none" />
                </div>
                <CityAutocomplete value={form.origin} onChange={(val) => setForm(p => ({ ...p, origin: val }))} placeholder="Search city, e.g. New York" label="Origin *" />
                <CityAutocomplete value={form.destination} onChange={(val) => setForm(p => ({ ...p, destination: val }))} placeholder="Search city, e.g. Los Angeles" label="Destination *" />
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Weight (kg)</label>
                  <input type="number" value={form.weight} onChange={(e) => setForm(p => ({ ...p, weight: e.target.value }))}
                    placeholder="0.0" className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] focus:ring-1 focus:ring-[#0a192f] outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Cargo Type</label>
                  <select value={form.type} onChange={(e) => setForm(p => ({ ...p, type: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] outline-none bg-white">
                    <option>General</option><option>Electronics</option><option>Pharmaceuticals</option>
                    <option>Perishables</option><option>Auto Parts</option><option>Documents</option>
                    <option>Fragile</option><option>Hazardous</option><option>Live Animals</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Assign Courier (Optional)</label>
                  <select value={form.courierId} onChange={(e) => setForm(p => ({ ...p, courierId: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] outline-none bg-white">
                    <option value="">Unassigned — Assign Later</option>
                    {couriers.filter(c => c.status === 'active').map(c => (
                      <option key={c.courierId} value={c.courierId}>{c.name} ({c.courierId}) — {c.zone}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* ── Live Animals Detail Panel ────────────────── */}
              {form.type === 'Live Animals' && (
                <div className="bg-amber-50/50 border border-amber-200 rounded-lg p-5 space-y-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">🐾</span>
                    <h4 className="text-sm font-bold text-[#0a192f] uppercase tracking-wide">Live Animal Details</h4>
                  </div>

                  {/* Animal Info */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Species *</label>
                      <select value={form.petSpecies} onChange={e => setForm(p => ({ ...p, petSpecies: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-amber-500 outline-none bg-white">
                        <option value="">Select...</option>
                        <option>Dog</option><option>Cat</option><option>Bird</option><option>Rabbit</option>
                        <option>Reptile</option><option>Fish</option><option>Horse</option><option>Livestock</option>
                        <option>Exotic</option><option>Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Breed</label>
                      <input type="text" value={form.petBreed} onChange={e => setForm(p => ({ ...p, petBreed: e.target.value }))}
                        placeholder="e.g. Golden Retriever" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-amber-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Gender</label>
                      <select value={form.petGender} onChange={e => setForm(p => ({ ...p, petGender: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-amber-500 outline-none bg-white">
                        <option value="">Select...</option>
                        <option>Male</option><option>Female</option><option>Unknown</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Age</label>
                      <input type="text" value={form.petAge} onChange={e => setForm(p => ({ ...p, petAge: e.target.value }))}
                        placeholder="e.g. 3 years" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-amber-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Color / Markings</label>
                      <input type="text" value={form.petColor} onChange={e => setForm(p => ({ ...p, petColor: e.target.value }))}
                        placeholder="e.g. Brown/White" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-amber-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Animal Weight (kg)</label>
                      <input type="number" value={form.petWeight} onChange={e => setForm(p => ({ ...p, petWeight: e.target.value }))}
                        placeholder="0.0" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-amber-500 outline-none" />
                    </div>
                  </div>

                  {/* Health & Vaccination */}
                  <div className="border-t border-amber-200 pt-3">
                    <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wide mb-2">🏥 Health & Vaccination</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Vaccination Status</label>
                        <select value={form.petVaccinationStatus} onChange={e => setForm(p => ({ ...p, petVaccinationStatus: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-amber-500 outline-none bg-white">
                          <option value="up-to-date">✅ Up to Date</option>
                          <option value="partial">⚠️ Partially Vaccinated</option>
                          <option value="not-vaccinated">❌ Not Vaccinated</option>
                          <option value="unknown">❓ Unknown</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Microchip ID</label>
                        <input type="text" value={form.petMicrochipId} onChange={e => setForm(p => ({ ...p, petMicrochipId: e.target.value }))}
                          placeholder="e.g. 900123456789012" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-amber-500 outline-none" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Medications</label>
                        <input type="text" value={form.petMedications} onChange={e => setForm(p => ({ ...p, petMedications: e.target.value }))}
                          placeholder="Current meds..." className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-amber-500 outline-none" />
                      </div>
                    </div>
                  </div>

                  {/* Veterinarian */}
                  <div className="border-t border-amber-200 pt-3">
                    <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wide mb-2">🩺 Veterinarian Contact</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Vet Name</label>
                        <input type="text" value={form.petVetName} onChange={e => setForm(p => ({ ...p, petVetName: e.target.value }))}
                          placeholder="Dr. Smith" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-amber-500 outline-none" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Vet Phone</label>
                        <input type="tel" value={form.petVetPhone} onChange={e => setForm(p => ({ ...p, petVetPhone: e.target.value }))}
                          placeholder="+1 555-0000" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-amber-500 outline-none" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Clinic Name</label>
                        <input type="text" value={form.petVetClinic} onChange={e => setForm(p => ({ ...p, petVetClinic: e.target.value }))}
                          placeholder="Happy Paws Clinic" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-amber-500 outline-none" />
                      </div>
                    </div>
                  </div>

                  {/* Transport & Comfort */}
                  <div className="border-t border-amber-200 pt-3">
                    <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wide mb-2">🏠 Transport & Comfort Settings</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Crate Type</label>
                        <select value={form.petCrateType} onChange={e => setForm(p => ({ ...p, petCrateType: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-amber-500 outline-none bg-white">
                          <option value="standard">Standard Crate</option>
                          <option value="airline-approved">Airline Approved</option>
                          <option value="soft-sided">Soft-Sided Carrier</option>
                          <option value="heavy-duty">Heavy Duty</option>
                          <option value="custom">Custom Enclosure</option>
                          <option value="open-transport">Open Transport (Livestock)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Min Temp (°C)</label>
                        <input type="number" value={form.petTempMin} onChange={e => setForm(p => ({ ...p, petTempMin: e.target.value }))}
                          placeholder="15" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-amber-500 outline-none" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Max Temp (°C)</label>
                        <input type="number" value={form.petTempMax} onChange={e => setForm(p => ({ ...p, petTempMax: e.target.value }))}
                          placeholder="25" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-amber-500 outline-none" />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Feeding Schedule</label>
                        <input type="text" value={form.petFeedingSchedule} onChange={e => setForm(p => ({ ...p, petFeedingSchedule: e.target.value }))}
                          placeholder="e.g. Every 6 hours, dry food only" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-amber-500 outline-none" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Special Care Notes</label>
                        <input type="text" value={form.petSpecialCare} onChange={e => setForm(p => ({ ...p, petSpecialCare: e.target.value }))}
                          placeholder="e.g. Anxiety meds before flight" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-amber-500 outline-none" />
                      </div>
                    </div>
                  </div>

                  {/* Owner Consent */}
                  <div className="border-t border-amber-200 pt-3">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" checked={form.petOwnerConsent} onChange={e => setForm(p => ({ ...p, petOwnerConsent: e.target.checked }))}
                        className="mt-0.5 w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
                      <span className="text-xs text-gray-600 leading-relaxed">
                        I confirm the animal owner has provided written consent for transport, all required health certificates are on file, and the animal has been cleared for travel by a licensed veterinarian within the last 10 days.
                      </span>
                    </label>
                  </div>
                </div>
              )}

              {/* Transport Planner */}
              {MAPBOX_TOKEN && form.origin && form.destination && (
                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium text-[#0a192f]">
                      <Navigation size={14} className="text-blue-600" /> Transport Planner
                    </div>
                    <button onClick={previewRoute} type="button" disabled={planLoading}
                      className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-500 transition-colors flex items-center gap-1 disabled:opacity-50">
                      {planLoading ? <Loader2 size={12} className="animate-spin" /> : <MapPin size={12} />}
                      {planLoading ? 'Calculating...' : 'Preview Route'}
                    </button>
                  </div>

                  {routePreview && (
                    <p className="text-xs text-gray-500">
                      📏 {formatDistance(routePreview.distance)}
                      {routePreview.summary && <span className="text-gray-400"> · via {routePreview.summary}</span>}
                    </p>
                  )}

                  {transportPlans.length > 0 && (
                    <div className="space-y-2">
                      <div>
                        <label className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">🎯 Target delivery date (filters plans)</label>
                        <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}
                          className="mt-1 w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:border-blue-500 outline-none" />
                      </div>

                      <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Select transport plan</p>
                      {transportPlans.map(plan => {
                        const canMeet = !targetDate || plan.estimatedDeliveryDate <= targetDate;
                        const isSelected = selectedPlanId === plan.id;
                        return (
                          <button key={plan.id} type="button"
                            onClick={() => { setSelectedPlanId(plan.id); setForm(p => ({ ...p, estimatedDelivery: plan.estimatedDeliveryDate })); }}
                            className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                              isSelected ? 'border-blue-600 bg-blue-50' :
                              !canMeet && targetDate ? 'border-gray-100 opacity-50' :
                              'border-gray-200 hover:border-blue-300 bg-white'
                            }`}>
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-2">
                                <span className="text-base">{plan.icon}</span>
                                <span className="text-sm font-semibold text-[#0a192f]">{plan.planName}</span>
                                {plan.isRecommended && <span className="text-[9px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full font-bold uppercase tracking-wide">★ Recommended</span>}
                                {!canMeet && targetDate && <span className="text-[9px] px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full font-bold">Too slow</span>}
                              </div>
                              <div className="text-right">
                                <p className="text-xs font-bold text-[#0a192f]">{formatPlanDuration(plan.totalDurationHours)}</p>
                                <p className="text-[10px] text-gray-400">Est: {plan.estimatedDeliveryDate}</p>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-1">
                              {plan.legs.map((leg, i) => (
                                <React.Fragment key={i}>
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{leg.icon} {leg.label}</span>
                                  {i < plan.legs.length - 1 && <span className="text-[10px] text-gray-300">→</span>}
                                </React.Fragment>
                              ))}
                            </div>
                          </button>
                        );
                      })}

                      {selectedPlanId === 'air' && (
                        <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2 mt-2">
                          <p className="text-[10px] font-bold text-[#0a192f] uppercase tracking-wide flex items-center gap-1">
                            ✈️ Scheduled Transit Stops (Optional)
                          </p>
                          
                          {customStops.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pb-1">
                              {customStops.map((stop, idx) => (
                                <span key={idx} className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full border border-blue-100">
                                  ✈️ {stop.name}
                                  <button type="button" onClick={() => handleRemoveCreationTransitStop(idx)} className="hover:bg-blue-200/50 p-0.5 rounded-full">
                                    <X size={10} />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}

                          <div className="relative">
                            <input
                              type="text"
                              value={stopSearchQuery}
                              onChange={(e) => handleStopSearch(e.target.value)}
                              onKeyDown={handleStopSearchKeyDown}
                              placeholder={isResolvingStop ? "Resolving closest airport..." : "Search city/country to add transit stop..."}
                              disabled={isResolvingStop}
                              className="w-full px-3 py-1.5 pr-8 border border-gray-200 rounded-lg text-xs outline-none focus:border-blue-500 disabled:bg-gray-50"
                            />
                            {isResolvingStop && (
                              <div className="absolute right-3 top-1.5">
                                <Loader2 size={12} className="animate-spin text-blue-500" />
                              </div>
                            )}
                            {stopSuggestions.length > 0 && (
                              <div className="relative z-20 mt-1 max-h-32 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-inner">
                                {stopSuggestions.map((sug, idx) => (
                                  <button
                                    key={idx}
                                    type="button"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      handleAddCreationTransitStop(sug);
                                    }}
                                    className="w-full text-left px-2.5 py-1.5 text-xs text-gray-700 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-b-0"
                                  >
                                    📍 {sug.place_name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div>
                        <label className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Override arrival date &amp; time (optional)</label>
                        <input type="datetime-local" value={form.estimatedDelivery} onChange={e => setForm(p => ({ ...p, estimatedDelivery: e.target.value }))}
                          className="mt-1 w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:border-blue-500 outline-none" />
                        <p className="text-[10px] text-gray-400 mt-0.5">Leave blank to use the route-calculated arrival time</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={() => { setShowCreate(false); setRoutePreview(null); setTransportPlans([]); setSelectedPlanId(null); setTargetDate(''); setRouteAnalysed(false); }} className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
                <button onClick={handleCreate} disabled={!form.sender || !form.receiver || !form.origin || !form.destination || creating || !routeAnalysed}
                  className="flex-1 px-4 py-2.5 bg-[#0a192f] text-white text-sm font-medium rounded-lg hover:bg-[#112d57] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {creating ? <><Loader2 size={14} className="animate-spin" /> Creating...</> : !routeAnalysed ? '⚠️ Run Route Analysis First' : 'Create Shipment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedShipment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelectedShipment(null)}>
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-[#0a192f]">Shipment Details</h3>
              <button onClick={() => setSelectedShipment(null)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} className="text-gray-500" /></button>
            </div>
            <div className="p-6 pb-24 space-y-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Tracking ID</p>
                <p className="text-xl font-mono font-bold text-[#0a192f]">{selectedShipment.trackingId}</p>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-xs text-gray-500">Sender</p><p className="font-medium text-[#0a192f]">{selectedShipment.sender}</p></div>
                <div><p className="text-xs text-gray-500">Receiver</p><p className="font-medium text-[#0a192f]">{selectedShipment.receiver}</p></div>
                <div><p className="text-xs text-gray-500">Origin</p><p className="font-medium text-[#0a192f]">{selectedShipment.origin}</p></div>
                <div><p className="text-xs text-gray-500">Destination</p><p className="font-medium text-[#0a192f]">{selectedShipment.destination}</p></div>
                <div><p className="text-xs text-gray-500">Courier</p><p className="font-medium text-[#0a192f]">{selectedShipment.courierName}</p></div>
                <div><p className="text-xs text-gray-500">Weight</p><p className="font-medium text-[#0a192f]">{selectedShipment.weight}</p></div>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-2">Progress</p>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div className={`h-2.5 rounded-full transition-all ${selectedShipment.isPaused ? 'bg-amber-500' : 'bg-blue-600'}`}
                    style={{ width: `${selectedShipment.progress}%` }} />
                </div>
                <p className="text-xs text-gray-400 mt-1">{selectedShipment.progress}% complete {selectedShipment.isPaused && '(PAUSED)'}</p>
                {selectedShipment.estimatedDelivery && (
                  <p className="text-xs text-blue-600 font-medium mt-1">
                    ⏱ Est. arrival: {(() => {
                      let est = selectedShipment.estimatedDelivery;
                      if (selectedShipment.isPaused && selectedShipment.paused_at && est) {
                        const elapsedPause = Date.now() - new Date(selectedShipment.paused_at).getTime();
                        if (elapsedPause > 0) {
                          const baseTime = new Date(String(est)).getTime();
                          if (!isNaN(baseTime)) {
                            est = new Date(baseTime + elapsedPause).toISOString();
                          }
                        }
                      }
                      const d = new Date(String(est));
                      return isNaN(d.getTime()) ? est : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
                    })()}
                  </p>
                )}
              </div>

              {/* Collapsible Alter Location Card for detail modal */}
              {['in-transit', 'out-for-delivery', 'paused', 'picked-up'].includes(selectedShipment.status) && (
                <div className="border-t border-gray-100 pt-3">
                  <button
                    onClick={() => setIsAltering(!isAltering)}
                    className="flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors"
                  >
                    <Edit2 size={13} />
                    {isAltering ? "Hide Position Alter Options" : "Alter Shipment Position (Admin)"}
                  </button>

                  {alterToast && (
                    <div className="mt-2 p-2 bg-blue-50 border border-blue-200 text-xs font-semibold text-blue-800 rounded-lg text-center animate-fade-in">
                      {alterToast}
                    </div>
                  )}

                  <AnimatePresence>
                    {isAltering && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden mt-3 space-y-3 bg-gray-50 p-3 rounded-xl border border-gray-200 text-xs"
                      >
                        <p className="text-[11px] text-gray-500">
                          Adjust the delivery position along the track using one of the two synchronized methods below. Click **"Apply"** to save changes.
                        </p>

                        <div className="space-y-3">
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
                              <div className="relative z-20 mt-1 max-h-32 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-inner">
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

                        {/* Action Buttons */}
                        <div className="flex justify-end gap-2 pt-1 border-t border-gray-200/60">
                          <button
                            onClick={() => {
                              setIsAltering(false);
                              setAlterProgress(Math.round(selectedShipment.progress || 0));
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
                  {/* ✈️ Transit Stops Card */}
                  {(() => {
                    const isAirFlight = selectedShipment.type === 'Live Animals' ||
                      (selectedShipment as any).transport_modes_parsed?.some((m: string) => m.toLowerCase().includes('flight') || m.toLowerCase().includes('air') || m.toLowerCase().includes('plane')) ||
                      (selectedShipment as any).route_summary?.toLowerCase().includes('air') ||
                      selectedShipment.trackingId.includes('AIR');

                    return isAirFlight ? (
                      <div className="border-t border-gray-100 pt-3 mt-3">
                        <button
                          onClick={() => setIsTransitPanelOpen(!isTransitPanelOpen)}
                          className="flex items-center gap-1.5 text-xs font-bold text-sky-600 hover:text-sky-800 transition-colors"
                        >
                          ✈️ {isTransitPanelOpen ? "Hide Transit Stop Options" : "Scheduled Transit Stops (Admin)"}
                        </button>

                        <AnimatePresence>
                          {isTransitPanelOpen && (
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
                                {((selectedShipment as any).scheduled_transit_stops_parsed || []).length === 0 ? (
                                  <p className="text-gray-500 italic text-[11px]">No transit stops scheduled.</p>
                                ) : (
                                  <div className="space-y-1">
                                    {((selectedShipment as any).scheduled_transit_stops_parsed || []).map((stop: any, idx: number) => (
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
                                <p className="text-[10px] font-bold text-gray-400 uppercase">Add Mid-Flight Stop &amp; Reroute</p>
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
                                    <div className="relative z-20 mt-1 max-h-32 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-inner">
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
                </div>
              )}

              <div className="flex gap-2 pt-2">
                {selectedShipment.type === 'Live Animals' ? (
                  <div className="w-full space-y-3">
                    <p className="text-xs text-blue-600 font-bold uppercase tracking-wide border-b border-gray-100 pb-1">🐾 Pet Tracking Controls</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => { handleUpdateStatus(selectedShipment, 'picked-up'); setSelectedShipment(null); }} className="px-3 py-2 bg-purple-100 text-purple-700 text-xs font-semibold rounded-lg hover:bg-purple-200 transition-colors">Set: Pickup</button>
                      <button onClick={() => { handleUpdateStatus(selectedShipment, 'in-transit'); setSelectedShipment(null); }} className="px-3 py-2 bg-blue-100 text-blue-700 text-xs font-semibold rounded-lg hover:bg-blue-200 transition-colors">Set: Transit</button>
                      <button onClick={() => { handleUpdateStatus(selectedShipment, 'out-for-delivery'); setSelectedShipment(null); }} className="px-3 py-2 bg-cyan-100 text-cyan-700 text-xs font-semibold rounded-lg hover:bg-cyan-200 transition-colors">Set: Out for Delivery</button>
                      <button onClick={() => { handleUpdateStatus(selectedShipment, 'delivered'); setSelectedShipment(null); }} className="px-3 py-2 bg-green-100 text-green-700 text-xs font-semibold rounded-lg hover:bg-green-200 transition-colors">Set: Arrived / Delivered</button>
                    </div>
                    <button onClick={() => { handlePauseResume(selectedShipment); setSelectedShipment(null); }}
                      className={`w-full px-4 py-2.5 text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-colors ${
                        selectedShipment.isPaused ? 'bg-green-600 text-white hover:bg-green-500' : 'bg-amber-500 text-white hover:bg-amber-400'
                      }`}>
                      {selectedShipment.isPaused ? <><Play size={14} /> Resume Transport</> : <><Pause size={14} /> Pause for Comfort/Care</>}
                    </button>
                  </div>
                ) : (
                  <>
                    {selectedShipment.status !== 'delivered' && (
                      <button onClick={() => { handlePauseResume(selectedShipment); setSelectedShipment(null); }}
                        className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-colors ${
                          selectedShipment.isPaused ? 'bg-green-600 text-white hover:bg-green-500' : 'bg-amber-500 text-white hover:bg-amber-400'
                        }`}>
                        {selectedShipment.isPaused ? <><Play size={14} /> Resume</> : <><Pause size={14} /> Pause</>}
                      </button>
                    )}
                    {selectedShipment.status !== 'delivered' && (
                      <button onClick={() => { handleUpdateStatus(selectedShipment, 'delivered'); setSelectedShipment(null); }}
                        className="flex-1 px-4 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-500 transition-colors flex items-center justify-center gap-2">
                        <CheckCircle size={14} /> Mark Delivered
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by tracking ID, sender, or receiver..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] focus:ring-1 focus:ring-[#0a192f] outline-none" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50/80 border-b border-gray-100">
                <th className="text-left px-4 sm:px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Tracking ID</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">Route</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Courier</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell">Progress</th>
                <th className="text-right px-4 sm:px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((shipment) => {
                const conf = statusConfig[shipment.status];
                return (
                  <tr key={shipment.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 sm:px-6 py-4">
                      <p className="text-sm font-mono font-medium text-[#0a192f]">{shipment.trackingId}</p>
                      <p className="text-xs text-gray-400">{shipment.type} · {shipment.weight}</p>
                    </td>
                    <td className="px-4 py-4 hidden md:table-cell">
                      <div className="flex items-center gap-1.5 text-sm text-gray-600">
                        <span className="truncate max-w-[100px]">{shipment.origin}</span>
                        <ArrowRight size={12} className="text-gray-400 flex-shrink-0" />
                        <span className="truncate max-w-[100px]">{shipment.destination}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 hidden lg:table-cell">
                      <p className="text-sm text-gray-600">{shipment.courierName}</p>
                    </td>
                    <td className="px-4 py-4">
                      <select
                        value={shipment.status}
                        onChange={(e) => handleUpdateStatus(shipment, e.target.value as Shipment['status'])}
                        className={`px-2.5 py-1 text-xs font-medium rounded-full capitalize border-0 cursor-pointer outline-none appearance-none pr-6 ${conf.color}`}
                        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center' }}
                      >
                        <option value="pending">⏳ Pending</option>
                        <option value="picked-up">📦 Picked Up</option>
                        <option value="in-transit">🚚 In Transit</option>
                        <option value="out-for-delivery">📍 Out for Delivery</option>
                        <option value="delivered">✅ Delivered</option>
                        <option value="returned">↩️ Returned</option>
                        <option value="paused">⏸ Paused</option>
                      </select>
                    </td>
                    <td className="px-4 py-4 hidden sm:table-cell">
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                          <div className={`h-1.5 rounded-full ${shipment.isPaused ? 'bg-amber-500' : 'bg-blue-600'}`}
                            style={{ width: `${shipment.progress}%` }} />
                        </div>
                        <span className="text-xs text-gray-500 w-8">{shipment.progress}%</span>
                      </div>
                    </td>
                    <td className="px-4 sm:px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setSelectedShipment(shipment)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-[#0a192f]" title="View Details">
                          <Eye size={16} />
                        </button>
                        <button onClick={() => handleOpenEdit(shipment)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-blue-600" title="Edit Shipment">
                          <Edit2 size={16} />
                        </button>
                        {shipment.status !== 'delivered' && (
                          <button onClick={() => handlePauseResume(shipment)}
                            className={`p-2 hover:bg-gray-100 rounded-lg transition-colors ${shipment.isPaused ? 'text-green-600' : 'text-amber-500'}`}
                            title={shipment.isPaused ? 'Resume' : 'Pause'}>
                            {shipment.isPaused ? <Play size={16} /> : <Pause size={16} />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-gray-400">No shipments found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Edit Shipment Modal ──────────────────────────────────── */}
      {editModal.open && editModal.shipment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditModal({ open: false, shipment: null })}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h3 className="text-lg font-bold text-[#0a192f]">Edit Shipment</h3>
                <p className="text-xs text-gray-400 font-mono">{editModal.shipment.trackingId}</p>
              </div>
              <button onClick={() => setEditModal({ open: false, shipment: null })} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} className="text-gray-500" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Sender Name</label>
                  <input type="text" value={editForm.senderName} onChange={e => setEditForm(p => ({ ...p, senderName: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Sender Email</label>
                  <input type="email" value={editForm.senderEmail} onChange={e => setEditForm(p => ({ ...p, senderEmail: e.target.value }))}
                    placeholder="sender@example.com" className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Receiver Name</label>
                  <input type="text" value={editForm.receiverName} onChange={e => setEditForm(p => ({ ...p, receiverName: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Receiver Email</label>
                  <input type="email" value={editForm.receiverEmail} onChange={e => setEditForm(p => ({ ...p, receiverEmail: e.target.value }))}
                    placeholder="receiver@example.com" className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Estimated Arrival Date &amp; Time</label>
                <input type="datetime-local" value={editForm.estimatedDelivery} onChange={e => setEditForm(p => ({ ...p, estimatedDelivery: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] outline-none" />
                <p className="text-xs text-gray-400 mt-1">Setting this updates the ETA shown on all dashboards simultaneously.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Description</label>
                <input type="text" value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="Cargo description..." className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Special Instructions</label>
                <textarea value={editForm.specialInstructions} onChange={e => setEditForm(p => ({ ...p, specialInstructions: e.target.value }))}
                  rows={2} placeholder="Handle with care, temperature-sensitive, etc..."
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] outline-none resize-none" />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditModal({ open: false, shipment: null })}
                  className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
                <button onClick={handleSaveEdit} disabled={saving}
                  className="flex-1 px-4 py-2.5 bg-[#0a192f] text-white text-sm font-medium rounded-lg hover:bg-[#112d57] transition-colors disabled:opacity-40 flex items-center justify-center gap-2">
                  {saving ? <><Loader2 size={14} className="animate-spin" /> Saving...</> : '💾 Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Pause / Resume Modal ─────────────────────────────────── */}
      {pauseModal.open && pauseModal.shipment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setPauseModal({ open: false, shipment: null })}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-[#0a192f]">
                {pauseModal.shipment.isPaused ? '▶ Resume Shipment' : '⏸ Pause Shipment'}
              </h3>
              <button onClick={() => setPauseModal({ open: false, shipment: null })} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} className="text-gray-500" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-gray-50 px-4 py-3 rounded-lg flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide">Shipment</p>
                  <p className="font-mono font-bold text-[#0a192f]">{pauseModal.shipment.trackingId}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400">{pauseModal.shipment.origin}</p>
                  <p className="text-xs text-gray-400">→ {pauseModal.shipment.destination}</p>
                </div>
              </div>

              {!pauseModal.shipment.isPaused && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Hold Category *</label>
                    <select value={pauseCategory} onChange={e => setPauseCategory(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] outline-none bg-white">
                      <option value="">Select a category...</option>
                      {pauseModal.shipment.type === 'Live Animals' ? (
                        ['Veterinary Check', 'Emergency Vet Visit', 'Feeding & Hydration', 'Walking / Exercise', 'Rest Period (Mandatory)', 'Temperature Out of Range', 'Quarantine Required', 'Anxiety / Stress Management', 'Grooming & Hygiene', 'Crate Maintenance', 'Weather — Unsafe for Animal', 'Vaccination Document Issue', 'Import/Export Permit Hold', 'Other'].map(c => (
                          <option key={c}>{c}</option>
                        ))
                      ) : (
                        ['Customs Hold', 'Weather Delay', 'Port Congestion', 'Document Issue', 'Transit Change', 'Recipient Unavailable', 'Security Check', 'Other'].map(c => (
                          <option key={c}>{c}</option>
                        ))
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Reason / Details</label>
                    <textarea value={pauseReason} onChange={e => setPauseReason(e.target.value)} rows={3}
                      placeholder="Brief explanation — this will be included in the customer email..."
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-[#0a192f] focus:ring-1 focus:ring-[#0a192f] outline-none resize-none" />
                  </div>
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 px-3 py-2.5 rounded-lg">
                    <span className="text-amber-500 mt-0.5">⚡</span>
                    <p className="text-xs text-amber-700">An email notification will be sent <strong>directly to the customer</strong> with the hold reason as soon as you confirm.</p>
                  </div>
                </>
              )}

              {pauseModal.shipment.isPaused && (
                <div className="flex items-start gap-2 bg-green-50 border border-green-200 px-3 py-2.5 rounded-lg">
                  <span className="text-green-500 mt-0.5">✅</span>
                  <p className="text-xs text-green-700">Resuming will <strong>automatically email the customer</strong> that their shipment is back in transit.</p>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={() => setPauseModal({ open: false, shipment: null })}
                  className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button onClick={handleConfirmPause}
                  disabled={!pauseModal.shipment.isPaused && !pauseCategory}
                  className={`flex-1 px-4 py-2.5 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    pauseModal.shipment.isPaused ? 'bg-green-600 hover:bg-green-500' : 'bg-amber-500 hover:bg-amber-400'
                  }`}>
                  {pauseModal.shipment.isPaused
                    ? <><Play size={14} /> Resume & Notify Customer</>
                    : <><Pause size={14} /> Pause & Notify Customer</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transit Landing Modal */}
      {showTransitLandModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowTransitLandModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 bg-sky-900 text-white">
              <h4 className="text-sm font-bold flex items-center gap-1.5">✈️ Aircraft Transit Landing</h4>
              <button onClick={() => setShowTransitLandModal(false)} className="hover:bg-sky-850 p-1 rounded text-white/80 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-gray-500 leading-relaxed">
                Immediately trigger an aircraft landing at an intermediate transit layover. This will pause the shipment, calculate paused hours, and send automated transit notification emails.
              </p>
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1.5">Transit Airport Name *</label>
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
    </div>
  );
};

export default Shipments;
