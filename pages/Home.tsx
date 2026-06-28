import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Layout from '../components/Layout';
import Reveal from '../components/ui/Reveal';
import {
  Search, MapPin, Truck, ShieldCheck, Clock, CheckCircle, ArrowRight,
  ChevronDown, ChevronUp, Star, Phone, Mail, Send, Heart, Zap, Shield,
  PawPrint, Stethoscope, Globe, AlertCircle, Activity, Tag
} from 'lucide-react';
import mapboxgl from 'mapbox-gl';
import { MAPBOX_TOKEN, getRouteWithFallback, interpolateAlongRoute } from '../utils/mapbox';

/* ──────────────────────────── HERO ──────────────────────────── */
const HeroSection: React.FC = () => {
  const navigate = useNavigate();
  const [trackId, setTrackId] = useState('');
  return (
    <section id="home" className="relative w-full min-h-[90vh] lg:min-h-screen overflow-hidden flex items-center">
      <div className="absolute inset-0">
        <img
          src="https://images.unsplash.com/photo-1587300003388-59208cc962cb?fm=jpg&fit=crop&w=2000&q=80"
          alt="Happy dog"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0a192f]/95 via-[#0a192f]/80 to-[#0a192f]/40" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-20 lg:py-0 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <Reveal direction="left" delay={0.2} width="100%">
            <div className="space-y-6 sm:space-y-8">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-500/20 text-blue-300 text-xs font-semibold tracking-wider uppercase rounded-full border border-blue-500/30">
                <PawPrint className="w-3.5 h-3.5" /> Trusted by 2,000+ Pet Owners
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold text-white leading-tight tracking-tight">
                Your Pet's Journey,{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300">
                  Tracked with Love.
                </span>
              </h1>
              <p className="text-base sm:text-lg text-gray-300 leading-relaxed max-w-xl">
                Safe, stress-free, and real-time tracking for your beloved pets. Whether across town
                or across borders — we make sure your furry family members arrive happy and healthy.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 pt-2">
                <a
                  href="#track"
                  onClick={(e) => { e.preventDefault(); document.getElementById('track')?.scrollIntoView({ behavior: 'smooth' }); }}
                  className="px-8 py-4 bg-blue-600 text-white font-medium hover:bg-blue-500 transition-all shadow-lg hover:shadow-blue-600/25 rounded-sm text-center"
                >
                  Track Your Pet
                </a>
                <a
                  href="#services"
                  onClick={(e) => { e.preventDefault(); document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' }); }}
                  className="px-8 py-4 border-2 border-white/30 text-white font-medium hover:bg-white/10 transition-all rounded-sm text-center"
                >
                  Our Services
                </a>
              </div>

              {/* Inline quick track */}
              <div className="pt-2">
                <form
                  onSubmit={(e) => { e.preventDefault(); if (trackId.trim()) navigate(`/track/${trackId.trim()}`); }}
                  className="flex gap-2 max-w-md"
                >
                  <input
                    type="text"
                    value={trackId}
                    onChange={(e) => setTrackId(e.target.value)}
                    placeholder="Enter tracking ID (e.g. HPT-2001-P5)"
                    className="flex-1 h-12 px-4 bg-white/10 backdrop-blur border border-white/20 text-white placeholder-gray-400 rounded-sm text-sm focus:outline-none focus:border-blue-400"
                  />
                  <button type="submit" className="h-12 px-5 bg-blue-600 hover:bg-blue-500 text-white rounded-sm flex items-center gap-2 font-medium text-sm transition-colors">
                    <Search className="w-4 h-4" />
                  </button>
                </form>
              </div>

              {/* Stats Row */}
              <div className="grid grid-cols-3 gap-4 sm:gap-8 pt-6 border-t border-white/10">
                <div>
                  <p className="text-2xl sm:text-3xl font-bold text-white">15+</p>
                  <p className="text-xs sm:text-sm text-gray-400">Dog Breeds Supported</p>
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-bold text-white">2K+</p>
                  <p className="text-xs sm:text-sm text-gray-400">Pets Tracked</p>
                </div>
                <div>
                  <p className="text-2xl sm:text-3xl font-bold text-white">99.9%</p>
                  <p className="text-xs sm:text-sm text-gray-400">Safe Arrivals</p>
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal direction="right" delay={0.5} className="hidden lg:block">
            <div className="relative">
              <img
                src="https://images.unsplash.com/photo-1548199973-03cce0bbc87b?fm=jpg&fit=crop&w=800&q=80"
                alt="Dog in carrier"
                className="w-full h-[500px] object-cover rounded-sm shadow-2xl"
              />
              <div className="absolute -bottom-6 -left-6 bg-white p-5 rounded-sm shadow-xl">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                    <CheckCircle className="w-6 h-6 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[#0a192f]">Live Tracking Active</p>
                    <p className="text-xs text-gray-500">847 pets being tracked now</p>
                  </div>
                </div>
              </div>
              <div className="absolute -top-4 -right-4 bg-blue-600 text-white p-4 rounded-sm shadow-xl">
                <PawPrint className="w-8 h-8" />
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
};

/* ──────────────────────────── ABOUT ──────────────────────────── */
const AboutSection: React.FC = () => (
  <section id="about" className="py-16 sm:py-24 bg-white overflow-hidden">
    <div className="max-w-7xl mx-auto px-4 sm:px-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
        <Reveal direction="left" delay={0.1}>
          <div className="relative">
            <img
              src="https://images.unsplash.com/photo-1535930891776-0c2dfb7fda1a?fm=jpg&fit=crop&w=800&q=80"
              alt="Dog with owner"
              className="w-full h-[350px] sm:h-[450px] object-cover rounded-sm shadow-xl"
            />
            <div className="absolute -bottom-4 -right-4 sm:-bottom-6 sm:-right-6 bg-[#0a192f] text-white p-4 sm:p-6 rounded-sm shadow-xl">
              <p className="text-3xl sm:text-4xl font-bold">5+</p>
              <p className="text-xs sm:text-sm text-gray-300">Years of Pet Care</p>
            </div>
            <div className="absolute top-4 left-4 bg-white/90 backdrop-blur px-4 py-2 rounded-full shadow-lg flex items-center gap-2">
              <Heart className="w-4 h-4 text-red-500 fill-red-500" />
              <span className="text-xs font-semibold text-[#0a192f]">Pet-First Always</span>
            </div>
          </div>
        </Reveal>

        <Reveal direction="right" delay={0.2}>
          <div className="space-y-6">
            <div className="inline-block px-3 py-1 bg-blue-50 text-blue-700 text-xs font-semibold tracking-wider uppercase rounded-full">
              About Happy Paw Trace
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-[#0a192f] leading-tight">
              Your Pet's Safety Is Our Only Priority
            </h2>
            <p className="text-gray-600 leading-relaxed">
              Happy Paw Trace was founded by pet lovers for pet lovers. We understand that your dog,
              cat, or exotic companion is family — and we treat them that way. Our real-time tracking
              platform gives you complete visibility from pickup to delivery.
            </p>
            <p className="text-gray-600 leading-relaxed">
              From domestic pet relocations to complex international pet travel with customs clearance,
              veterinary coordination, and breed-specific care protocols — we handle every detail so
              you can focus on the reunion.
            </p>

            <div className="grid grid-cols-2 gap-6 pt-4">
              {[
                { icon: Heart, title: 'Our Mission', desc: 'Make every pet journey safe, comfortable, and stress-free.' },
                { icon: Shield, title: 'Our Promise', desc: 'Real-time updates at every step — no surprises.' },
                { icon: Stethoscope, title: 'Vet-Verified', desc: 'All handlers are certified in animal welfare and care.' },
                { icon: Zap, title: 'Live Tracking', desc: 'GPS-powered tracking updated every 2 minutes.' },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-blue-50 rounded-sm flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-[#0a192f] text-sm">{title}</h4>
                    <p className="text-xs text-gray-500 mt-1">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  </section>
);

/* ──────────────────────────── SERVICES ──────────────────────────── */
const services = [
  {
    slug: 'pet-relocation',
    icon: <Truck className="w-8 h-8" />,
    title: 'Pet Relocation & Transport',
    image: 'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?fm=jpg&fit=crop&w=600&q=80',
    description: 'Door-to-door pet transport with climate-controlled vehicles, certified handlers, and real-time GPS tracking for domestic moves.',
    features: ['Door-to-Door Pickup', 'Climate-Controlled Vehicles', 'Certified Pet Handlers', 'Live GPS Tracking'],
  },
  {
    slug: 'live-tracking',
    icon: <MapPin className="w-8 h-8" />,
    title: 'Real-Time Pet Tracking',
    image: 'https://images.unsplash.com/photo-1587300003388-59208cc962cb?fm=jpg&fit=crop&w=600&q=80',
    description: 'GPS-powered live location tracking updated every 2 minutes. Get instant alerts and share tracking links with family.',
    features: ['2-Min GPS Updates', 'Mobile Tracking Link', 'Instant Status Alerts', 'Full Journey History'],
  },
  {
    slug: 'vet-care',
    icon: <Stethoscope className="w-8 h-8" />,
    title: 'Veterinary Coordination',
    image: 'https://images.unsplash.com/photo-1532938911079-1b06ac7ceec7?fm=jpg&fit=crop&w=600&q=80',
    description: 'We coordinate with your vet and destination clinics to ensure health certificates, vaccinations, and medical records are ready.',
    features: ['Health Certificate Prep', 'Vaccination Verification', 'Vet-to-Vet Communication', 'Medical Record Transfer'],
  },
  {
    slug: 'international-travel',
    icon: <Globe className="w-8 h-8" />,
    title: 'International Pet Travel',
    image: 'https://images.unsplash.com/photo-1544568100-847a948585b9?fm=jpg&fit=crop&w=600&q=80',
    description: 'Full end-to-end international pet relocation including IATA-compliant crates, customs clearance, and airport handling.',
    features: ['IATA-Compliant Crates', 'Customs Clearance', 'Airport Escort Service', '50+ Countries Covered'],
  },
  {
    slug: 'emergency-rescue',
    icon: <AlertCircle className="w-8 h-8" />,
    title: 'Emergency Pet Rescue',
    image: 'https://images.unsplash.com/photo-1601758174493-bbcd43b8e0c8?fm=jpg&fit=crop&w=600&q=80',
    description: '24/7 emergency pet evacuation and rescue coordination for natural disasters, medical emergencies, or urgent relocation needs.',
    features: ['24/7 Emergency Line', 'Rapid Response (<2 hrs)', 'Crisis Coordination', 'Temporary Foster Network'],
  },
  {
    slug: 'health-monitoring',
    icon: <Activity className="w-8 h-8" />,
    title: 'Breed Health Monitoring',
    image: 'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?fm=jpg&fit=crop&w=600&q=80',
    description: 'Breed-specific health and vaccination monitoring with automated alerts for upcoming boosters, checkups, and vet visits.',
    features: ['Breed-Specific Protocols', 'Vaccination Schedule Alerts', 'Health Report Dashboard', 'Vet Appointment Reminders'],
  },
  {
    slug: 'microchip-registration',
    icon: <Tag className="w-8 h-8" />,
    title: 'Microchip & Registration',
    image: 'https://images.unsplash.com/photo-1518717758536-85ae29035b6d?fm=jpg&fit=crop&w=600&q=80',
    description: 'Complete pet registration, microchip activation, and linking your pet\'s ID to our live tracking system for instant identification.',
    features: ['Microchip Activation', 'Lost Pet Alert Network', 'Digital ID Card', 'Owner Info Sync'],
  },
];

const ServicesSection: React.FC = () => (
  <section id="services" className="py-16 sm:py-24 bg-[#f8f9fb] overflow-hidden">
    <div className="max-w-7xl mx-auto px-4 sm:px-6">
      <Reveal direction="bottom">
        <div className="text-center mb-12 sm:mb-16 max-w-3xl mx-auto">
          <div className="inline-block px-3 py-1 bg-blue-50 text-blue-700 text-xs font-semibold tracking-wider uppercase rounded-full mb-4">
            What We Offer
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-[#0a192f] mb-4">Complete Pet Care & Tracking Services</h2>
          <p className="text-gray-600">
            From real-time GPS tracking to international pet travel — every service built around your pet's wellbeing.
          </p>
        </div>
      </Reveal>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
        {services.map((service, i) => (
          <Reveal key={service.title} direction="bottom" delay={i * 0.1}>
            <Link to={`/services/${service.slug}`} className="block h-full">
              <div className="bg-white rounded-sm overflow-hidden border border-gray-100 hover:shadow-xl transition-all duration-500 group h-full flex flex-col cursor-pointer">
                <div className="relative h-48 overflow-hidden">
                  <img
                    src={service.image}
                    alt={service.title}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0a192f]/60 to-transparent" />
                  <div className="absolute bottom-4 left-4 w-12 h-12 bg-white rounded-sm flex items-center justify-center text-[#0a192f] shadow-lg">
                    {service.icon}
                  </div>
                </div>
                <div className="p-6 flex-1 flex flex-col">
                  <h3 className="text-xl font-bold text-[#0a192f] mb-2 group-hover:text-blue-600 transition-colors">{service.title}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed mb-4 flex-1">{service.description}</p>
                  <ul className="space-y-2 mb-4">
                    {service.features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-xs text-gray-600">
                        <CheckCircle className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-blue-600 group-hover:gap-3 transition-all">
                    Learn More <ArrowRight className="w-4 h-4" />
                  </div>
                </div>
              </div>
            </Link>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
);

/* ──────────────────────────── TRACK MAP MINI ──────────────────────────── */
const TrackMiniMap: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const animRef = useRef<number>(0);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!containerRef.current || mapRef.current) return;
      const token = MAPBOX_TOKEN || (import.meta as any).env?.VITE_MAPBOX_TOKEN || '';
      if (!token) return;
      (mapboxgl as any).accessToken = token;

      try {
        const origin: [number, number] = [-74.006, 40.7128]; // New York
        const dest: [number, number] = [-87.6298, 41.8781];  // Chicago

        const m = new mapboxgl.Map({
          container: containerRef.current,
          style: 'mapbox://styles/mapbox/dark-v11',
          center: [-80.8, 41.2],
          zoom: 4.5,
          interactive: false,
          attributionControl: false,
        });

        m.on('load', async () => {
          setMapReady(true);
          m.resize();

          const result = await getRouteWithFallback(origin, dest);
          const geometry = result?.geometry || { type: 'LineString', coordinates: [origin, dest] };
          const coords = geometry.coordinates as [number, number][];

          m.addSource('pet-route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry } as any });
          m.addLayer({ id: 'pet-route-glow', type: 'line', source: 'pet-route', paint: { 'line-color': '#3b82f6', 'line-width': 8, 'line-opacity': 0.2 } });
          m.addLayer({ id: 'pet-route-line', type: 'line', source: 'pet-route', paint: { 'line-color': '#60a5fa', 'line-width': 3 } });

          // Origin marker (paw print style)
          const originEl = document.createElement('div');
          originEl.className = 'w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow-lg';
          new mapboxgl.Marker({ element: originEl }).setLngLat(origin).addTo(m);

          // Destination marker
          const destEl = document.createElement('div');
          destEl.className = 'w-4 h-4 bg-cyan-400 rounded-full border-2 border-white shadow-lg';
          new mapboxgl.Marker({ element: destEl }).setLngLat(dest).addTo(m);

          // Animated pet marker
          const petEl = document.createElement('div');
          petEl.innerHTML = '🐾';
          petEl.style.fontSize = '20px';
          petEl.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))';
          markerRef.current = new mapboxgl.Marker({ element: petEl }).setLngLat(origin).addTo(m);

          let progress = 0;
          const animate = () => {
            progress = (progress + 0.0008) % 1;
            const pos = interpolateAlongRoute(coords, progress * 100);
            markerRef.current?.setLngLat(pos);
            animRef.current = requestAnimationFrame(animate);
          };
          animRef.current = requestAnimationFrame(animate);
        });

        mapRef.current = m;
      } catch (e) {
        console.error('Map init error:', e);
      }
    }, 600);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(animRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full min-h-[280px]">
      {!mapReady && (
        <div className="w-full h-full flex items-center justify-center bg-[#112240]">
          <div className="text-center space-y-3">
            <div className="text-4xl animate-bounce">🐾</div>
            <p className="text-gray-400 text-sm">Loading live map…</p>
          </div>
        </div>
      )}
    </div>
  );
};

/* ──────────────────────────── TRACK & TRACE ──────────────────────────── */
const TrackSection: React.FC = () => {
  const [trackId, setTrackId] = useState('');
  const navigate = useNavigate();

  const handleTrack = () => {
    if (!trackId.trim()) return;
    navigate(`/track/${trackId.trim()}`);
  };

  return (
    <section id="track" className="py-16 sm:py-24 bg-[#0a192f] text-white overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <Reveal direction="left" delay={0.1}>
            <div className="space-y-6">
              <div className="inline-block px-3 py-1 bg-blue-500/20 text-blue-300 text-xs font-semibold tracking-wider uppercase rounded-full border border-blue-500/30">
                Real-Time Visibility
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold leading-tight">Track Your Pet Anywhere, Anytime.</h2>
              <p className="text-gray-300 text-base sm:text-lg leading-relaxed">
                Enter your Pet Tracking ID to get live location updates, estimated arrival time,
                health check logs, and your courier's contact details.
              </p>

              <div className="pt-4">
                <label className="block text-sm font-medium text-gray-400 mb-2 uppercase tracking-wide">
                  Pet Tracking ID
                </label>
                <form onSubmit={(e) => { e.preventDefault(); handleTrack(); }} className="relative">
                  <input
                    type="text"
                    value={trackId}
                    onChange={(e) => setTrackId(e.target.value)}
                    placeholder="e.g., HPT-2001-P5"
                    className="w-full h-14 sm:h-16 pl-5 sm:pl-6 pr-14 sm:pr-16 bg-[#112240] border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors text-base sm:text-lg font-mono rounded-sm"
                  />
                  <button type="submit" className="absolute right-2 top-2 bottom-2 aspect-square bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center rounded-sm transition-colors">
                    <Search className="w-5 h-5 sm:w-6 sm:h-6" />
                  </button>
                </form>
                <p className="text-xs text-gray-500 mt-3">You'll see a detailed map, live status, and your pet's full journey history.</p>
              </div>

              {/* Demo Status Steps */}
              <div className="space-y-4 pt-4">
                {[
                  { label: 'Pet Registered & Checked In', time: 'Pickup confirmed by handler', done: true },
                  { label: 'Departed — Health Check Passed', time: 'Vet-verified, all clear', done: true },
                  { label: 'In Transit — GPS Active', time: 'Currently on route, updated 2 min ago', done: true },
                  { label: 'Rest Stop & Feeding Break', time: 'Scheduled — estimated 2 hrs', done: false },
                  { label: 'Delivered — Reunion Time! 🐾', time: 'Estimated arrival', done: false },
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-4">
                    <div className="flex flex-col items-center">
                      <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${step.done ? 'bg-blue-500 border-blue-500' : 'border-gray-600'}`} />
                      {i < 4 && <div className={`w-0.5 h-8 ${step.done ? 'bg-blue-500/50' : 'bg-gray-700'}`} />}
                    </div>
                    <div className="-mt-0.5">
                      <p className={`text-sm font-medium ${step.done ? 'text-white' : 'text-gray-500'}`}>{step.label}</p>
                      <p className="text-xs text-gray-500">{step.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          <Reveal direction="right" delay={0.3}>
            <div className="relative w-full aspect-square sm:aspect-video lg:aspect-square bg-[#112240] border border-gray-700 rounded-sm shadow-2xl overflow-hidden">
              <TrackMiniMap />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
};

/* ──────────────────────────── BREEDS SHOWCASE ──────────────────────────── */
const breeds = [
  { name: 'Cane Corso', origin: 'Italy', image: 'https://images.unsplash.com/photo-1568572933382-74d440642117?fm=jpg&fit=crop&w=400&q=80', tag: 'Guardian' },
  { name: 'German Shepherd', origin: 'Germany', image: 'https://images.unsplash.com/photo-1589941013453-ec89f33b5e95?fm=jpg&fit=crop&w=400&q=80', tag: 'Working' },
  { name: 'Golden Retriever', origin: 'Scotland', image: 'https://images.unsplash.com/photo-1587300003388-59208cc962cb?fm=jpg&fit=crop&w=400&q=80', tag: 'Family' },
  { name: 'Labrador Retriever', origin: 'Canada', image: 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?fm=jpg&fit=crop&w=400&q=80', tag: 'Friendly' },
  { name: 'French Bulldog', origin: 'France', image: 'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?fm=jpg&fit=crop&w=400&q=80', tag: 'Companion' },
  { name: 'Rottweiler', origin: 'Germany', image: 'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?fm=jpg&fit=crop&w=400&q=80', tag: 'Protector' },
  { name: 'Doberman Pinscher', origin: 'Germany', image: 'https://images.unsplash.com/photo-1561037404-61cd46aa615b?fm=jpg&fit=crop&w=400&q=80', tag: 'Alert' },
  { name: 'Border Collie', origin: 'Scotland', image: 'https://images.unsplash.com/photo-1503256207526-0d5d80fa2f47?fm=jpg&fit=crop&w=400&q=80', tag: 'Herding' },
  { name: 'Siberian Husky', origin: 'Russia', image: 'https://images.unsplash.com/photo-1512436991641-6745cdb1723f?fm=jpg&fit=crop&w=400&q=80', tag: 'Arctic' },
  { name: 'Belgian Malinois', origin: 'Belgium', image: 'https://images.unsplash.com/photo-1574144611937-0df059b5ef3e?fm=jpg&fit=crop&w=400&q=80', tag: 'Military' },
  { name: 'Bullmastiff', origin: 'England', image: 'https://images.unsplash.com/photo-1605897472359-85e4b94d685d?fm=jpg&fit=crop&w=400&q=80', tag: 'Guardian' },
  { name: 'Great Dane', origin: 'Germany', image: 'https://images.unsplash.com/photo-1558929996-da64ba858215?fm=jpg&fit=crop&w=400&q=80', tag: 'Gentle Giant' },
  { name: 'Boxer', origin: 'Germany', image: 'https://images.unsplash.com/photo-1546527868-ccb7ee7dfa6a?fm=jpg&fit=crop&w=400&q=80', tag: 'Playful' },
  { name: 'Dachshund', origin: 'Germany', image: 'https://images.unsplash.com/photo-1612195583950-b8fd34c87093?fm=jpg&fit=crop&w=400&q=80', tag: 'Curious' },
  { name: 'Standard Poodle', origin: 'France', image: 'https://images.unsplash.com/photo-1591160690555-5debfba71588?fm=jpg&fit=crop&w=400&q=80', tag: 'Intelligent' },
];

const BreedsSection: React.FC = () => {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? breeds : breeds.slice(0, 9);

  return (
    <section id="breeds" className="py-16 sm:py-24 bg-white overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <Reveal direction="bottom">
          <div className="text-center mb-12 sm:mb-16 max-w-3xl mx-auto">
            <div className="inline-block px-3 py-1 bg-blue-50 text-blue-700 text-xs font-semibold tracking-wider uppercase rounded-full mb-4">
              Breed Support
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-[#0a192f] mb-4">15 Breeds. All Expertly Handled.</h2>
            <p className="text-gray-600">
              Every breed has unique needs. Our handlers are trained in breed-specific care, temperament, and travel requirements.
            </p>
          </div>
        </Reveal>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
          {visible.map((breed, i) => (
            <Reveal key={breed.name} direction="bottom" delay={i * 0.05}>
              <div className="relative group overflow-hidden rounded-sm h-52 cursor-pointer">
                <img
                  src={breed.image}
                  alt={breed.name}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0a192f]/80 via-transparent to-transparent" />
                <div className="absolute top-3 right-3">
                  <span className="px-2 py-1 bg-blue-600/80 backdrop-blur text-white text-xs font-medium rounded-full">
                    {breed.tag}
                  </span>
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <h3 className="text-white font-bold text-base">{breed.name}</h3>
                  <p className="text-gray-300 text-xs flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3" /> Origin: {breed.origin}
                  </p>
                </div>
                <div className="absolute inset-0 border-2 border-blue-500/0 group-hover:border-blue-500/60 transition-all rounded-sm" />
              </div>
            </Reveal>
          ))}
        </div>

        {!showAll && (
          <Reveal direction="bottom" delay={0.3}>
            <div className="text-center mt-10">
              <button
                onClick={() => setShowAll(true)}
                className="inline-flex items-center gap-2 px-8 py-3.5 bg-[#0a192f] text-white font-semibold rounded-sm hover:bg-blue-700 transition-all shadow-lg"
              >
                Show All 15 Breeds <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </Reveal>
        )}
      </div>
    </section>
  );
};

/* ──────────────────────────── TESTIMONIALS ──────────────────────────── */
const previewReviews = [
  {
    name: 'Sarah Mitchell',
    role: 'Golden Retriever Owner',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?fm=jpg&fit=crop&w=100&q=80',
    text: 'Happy Paw Trace made our cross-country move so smooth. I could track Buddy the whole way and got updates every step. He arrived happy and healthy!',
    rating: 5,
  },
  {
    name: 'James Okonkwo',
    role: 'German Shepherd Owner',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?fm=jpg&fit=crop&w=100&q=80',
    text: 'The vet coordination service saved us so much stress during our international move. All paperwork was handled perfectly and Rex cleared customs without any issues.',
    rating: 5,
  },
  {
    name: 'Elena Vasquez',
    role: 'Cat & Dachshund Owner',
    avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?fm=jpg&fit=crop&w=100&q=80',
    text: 'I relocated with two pets internationally and Happy Paw handled everything — microchip registration, health certs, airport escorts. Absolutely remarkable service.',
    rating: 5,
  },
];

const TestimonialsSection: React.FC = () => (
  <section id="testimonials" className="py-16 sm:py-24 bg-[#f8f9fb] overflow-hidden">
    <div className="max-w-7xl mx-auto px-4 sm:px-6">
      <Reveal direction="bottom">
        <div className="text-center mb-12 sm:mb-16 max-w-3xl mx-auto">
          <div className="inline-block px-3 py-1 bg-blue-50 text-blue-700 text-xs font-semibold tracking-wider uppercase rounded-full mb-4">
            Pet Owner Stories
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-[#0a192f] mb-4">Happy Pets. Happy Owners.</h2>
          <p className="text-gray-600">
            Trusted by 2,000+ pet families. Real stories from real pet owners.
          </p>
        </div>
      </Reveal>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
        {previewReviews.map((t, i) => (
          <Reveal key={t.name} direction="bottom" delay={i * 0.15}>
            <div className="bg-white p-6 sm:p-8 rounded-sm border border-gray-100 shadow-sm hover:shadow-lg transition-shadow h-full flex flex-col">
              <div className="flex gap-1 mb-4">
                {Array.from({ length: t.rating }).map((_, j) => (
                  <Star key={j} className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                ))}
              </div>
              <p className="text-gray-600 text-sm leading-relaxed flex-1 italic">"{t.text}"</p>
              <div className="flex items-center gap-3 mt-6 pt-6 border-t border-gray-100">
                <img src={t.avatar} alt={t.name} className="w-11 h-11 rounded-full object-cover" />
                <div>
                  <p className="font-semibold text-[#0a192f] text-sm">{t.name}</p>
                  <p className="text-xs text-gray-500 flex items-center gap-1"><PawPrint className="w-3 h-3 text-blue-500" />{t.role}</p>
                </div>
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal direction="bottom" delay={0.3}>
        <div className="text-center mt-12">
          <div className="inline-flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-6 py-4 shadow-sm mb-6">
            <div className="flex gap-0.5">
              {[1,2,3,4,5].map(s => <Star key={s} className="w-4 h-4 text-yellow-400 fill-yellow-400" />)}
            </div>
            <span className="text-sm text-gray-600">4.9 / 5 · <strong className="text-[#0a192f]">30+ reviews</strong></span>
          </div>
          <div>
            <Link
              to="/reviews"
              className="inline-flex items-center gap-2 px-8 py-3.5 bg-[#0a192f] text-white font-semibold rounded-sm hover:bg-blue-700 transition-all shadow-lg hover:shadow-blue-700/25 group"
            >
              See All Reviews
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </Reveal>
    </div>
  </section>
);

/* ──────────────────────────── FAQ ──────────────────────────── */
const faqs = [
  {
    q: 'How do I track my pet?',
    a: 'Enter your Pet Tracking ID (format: HPT-XXXX-XX) in the Track Your Pet section on this page. You\'ll get a live map, estimated arrival, status updates, and your handler\'s contact info in real time.',
  },
  {
    q: 'What dog breeds do you support?',
    a: 'We currently support 15 breeds including Cane Corso, German Shepherd, Golden Retriever, Labrador, French Bulldog, Rottweiler, Doberman Pinscher, Border Collie, Siberian Husky, Belgian Malinois, Bullmastiff, Great Dane, Boxer, Dachshund, and Standard Poodle. More breeds are added regularly.',
  },
  {
    q: 'Do you handle international pet transport?',
    a: 'Yes. We handle end-to-end international pet relocation including IATA-compliant travel crates, health certificates, vaccinations, customs documentation, and airport escort services to 50+ countries.',
  },
  {
    q: 'How do I prepare my pet for transport?',
    a: 'We\'ll send you a full checklist once you register. Generally: ensure vaccinations are up to date, provide a vet health certificate (we can coordinate this), have your microchip registered, and pack your pet\'s favorite blanket or toy for comfort.',
  },
  {
    q: 'What happens during the journey?',
    a: 'Your pet is monitored by certified handlers throughout the journey. GPS updates are sent every 2 minutes, rest and feeding stops are scheduled according to your breed\'s needs, and our team is reachable 24/7 via your tracking dashboard.',
  },
  {
    q: 'Is my pet insured during transport?',
    a: 'Yes. All pets transported through Happy Paw Trace are covered by our transport insurance policy. You can opt for additional premium coverage for high-value or medically sensitive animals. Contact us for details.',
  },
];

const FAQSection: React.FC = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="py-16 sm:py-24 bg-white overflow-hidden">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <Reveal direction="bottom">
          <div className="text-center mb-12 sm:mb-16">
            <div className="inline-block px-3 py-1 bg-blue-50 text-blue-700 text-xs font-semibold tracking-wider uppercase rounded-full mb-4">
              Common Questions
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-[#0a192f] mb-4">Frequently Asked Questions</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Everything you need to know about tracking and transporting your pet. Can't find an answer? Contact us directly.
            </p>
          </div>
        </Reveal>

        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <Reveal key={i} direction="bottom" delay={i * 0.05}>
              <div className="border border-gray-200 rounded-sm overflow-hidden">
                <button
                  onClick={() => setOpenIndex(openIndex === i ? null : i)}
                  className="w-full flex items-center justify-between px-5 sm:px-6 py-4 sm:py-5 text-left hover:bg-gray-50 transition-colors"
                >
                  <span className="font-medium text-[#0a192f] text-sm sm:text-base pr-4">{faq.q}</span>
                  {openIndex === i
                    ? <ChevronUp className="w-5 h-5 text-blue-600 flex-shrink-0" />
                    : <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
                  }
                </button>
                {openIndex === i && (
                  <div className="px-5 sm:px-6 pb-5 text-gray-600 text-sm leading-relaxed border-t border-gray-100 pt-4">
                    {faq.a}
                  </div>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
};

/* ──────────────────────────── CONTACT ──────────────────────────── */
const ContactSection: React.FC = () => (
  <section id="contact" className="py-16 sm:py-24 bg-[#0a192f] text-white overflow-hidden">
    <div className="max-w-7xl mx-auto px-4 sm:px-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16">
        <Reveal direction="left" delay={0.1}>
          <div className="space-y-6">
            <div className="inline-block px-3 py-1 bg-blue-500/20 text-blue-300 text-xs font-semibold tracking-wider uppercase rounded-full border border-blue-500/30">
              Get in Touch
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold leading-tight">Let's Get Your Pet Moving Safely.</h2>
            <p className="text-gray-300 leading-relaxed">
              Whether it's a local move or international relocation — our pet care specialists will
              design a transport plan tailored to your pet's breed, size, and health needs.
            </p>

            <div className="space-y-5 pt-4">
              {[
                { icon: MapPin, title: 'Headquarters', info: 'Wyoming, USA' },
                { icon: Phone, title: 'Phone', info: '+1 (412) 227-3484' },
                { icon: Mail, title: 'Email', info: 'support@happypawstrace.com' },
                { icon: Clock, title: 'Working Hours', info: 'Mon–Fri: 8AM–8PM EST | 24/7 Emergency Line' },
              ].map(({ icon: Icon, title, info }) => (
                <div key={title} className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-blue-600/20 rounded-sm flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-white text-sm">{title}</h4>
                    <p className="text-sm text-gray-400 mt-1">{info}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-4">
              <img
                src="https://images.unsplash.com/photo-1601758174493-bbcd43b8e0c8?fm=jpg&fit=crop&w=600&q=80"
                alt="Pet care team"
                className="w-full h-48 object-cover rounded-sm opacity-70"
              />
            </div>
          </div>
        </Reveal>

        <Reveal direction="right" delay={0.2}>
          <div className="bg-white rounded-sm p-6 sm:p-8 shadow-2xl">
            <h3 className="text-xl font-bold text-[#0a192f] mb-2">Book a Pet Transport</h3>
            <p className="text-sm text-gray-500 mb-6">Tell us about your pet and we'll create a custom care plan.</p>
            <form className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Your Name</label>
                  <input type="text" placeholder="Jane Smith" className="w-full px-4 py-3 border border-gray-200 rounded-sm text-sm text-gray-800 focus:border-[#0a192f] focus:ring-1 focus:ring-[#0a192f] outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Pet Name</label>
                  <input type="text" placeholder="e.g. Buddy" className="w-full px-4 py-3 border border-gray-200 rounded-sm text-sm text-gray-800 focus:border-[#0a192f] focus:ring-1 focus:ring-[#0a192f] outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Email</label>
                  <input type="email" placeholder="jane@email.com" className="w-full px-4 py-3 border border-gray-200 rounded-sm text-sm text-gray-800 focus:border-[#0a192f] focus:ring-1 focus:ring-[#0a192f] outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Phone</label>
                  <input type="tel" placeholder="+1 (555) 000-0000" className="w-full px-4 py-3 border border-gray-200 rounded-sm text-sm text-gray-800 focus:border-[#0a192f] focus:ring-1 focus:ring-[#0a192f] outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Service Needed</label>
                <select className="w-full px-4 py-3 border border-gray-200 rounded-sm text-sm text-gray-800 focus:border-[#0a192f] focus:ring-1 focus:ring-[#0a192f] outline-none bg-white">
                  <option value="">Select a service...</option>
                  <option>Pet Relocation & Transport</option>
                  <option>International Pet Travel</option>
                  <option>Veterinary Coordination</option>
                  <option>Emergency Pet Rescue</option>
                  <option>Breed Health Monitoring</option>
                  <option>Microchip & Registration</option>
                  <option>Custom Solution</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Pet Breed & Details</label>
                <textarea rows={4} placeholder="Tell us about your pet — breed, age, any health considerations, origin & destination..." className="w-full px-4 py-3 border border-gray-200 rounded-sm text-sm text-gray-800 focus:border-[#0a192f] focus:ring-1 focus:ring-[#0a192f] outline-none resize-none" />
              </div>
              <button type="button" className="w-full px-6 py-3.5 bg-[#0a192f] text-white font-medium hover:bg-[#112d57] transition-all rounded-sm flex items-center justify-center gap-2">
                <Send className="w-4 h-4" />
                Send Pet Transport Request
              </button>
            </form>
          </div>
        </Reveal>
      </div>
    </div>
  </section>
);

/* ──────────────────────────── MAIN HOME ──────────────────────────── */
const Home: React.FC = () => (
  <Layout>
    <HeroSection />
    <AboutSection />
    <ServicesSection />
    <TrackSection />
    <BreedsSection />
    <TestimonialsSection />
    <FAQSection />
    <ContactSection />
  </Layout>
);

export default Home;
