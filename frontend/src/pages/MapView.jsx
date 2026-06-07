/**
 * MapView v3 — Mapbox GL JS with real geolocation, radius filter,
 * score-colored pins, cluster support, sidebar with live deals.
 * Falls back to Leaflet dark tiles if no Mapbox token.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MapPin, SlidersHorizontal, X, Navigation, Search,
  Layers, Filter, TrendingUp, Package, ZoomIn
} from 'lucide-react';
import api from '../utils/api';

// ── Score helpers ──────────────────────────────────────────────────────────────
const scoreColor = (s) => s >= 91 ? '#00ff88' : s >= 71 ? '#00d4ff' : s >= 41 ? '#fbbf24' : '#ef4444';
const scoreLabel = (s) => s >= 91 ? 'Excellent' : s >= 71 ? 'Good' : s >= 41 ? 'Average' : 'Skip';
const storeColor = { walmart: '#0071CE', 'home-depot': '#F96302', target: '#CC0000', 'best-buy': '#003087', lowes: '#004990' };

const CHICAGO_CENTER = { lat: 41.8781, lng: -87.6298 };

// ── Leaflet fallback map (no Mapbox token needed) ─────────────────────────────
function LeafletMap({ locations, selected, onSelect, userPos, radius }) {
  const mapRef = useRef(null);
  const leafletMap = useRef(null);
  const markersRef = useRef([]);

  // Re-center map when userPos updates after geolocation grant
  useEffect(() => {
    if (leafletMap.current && userPos) {
      leafletMap.current.setView([userPos.lat, userPos.lng], 12);
    }
  }, [userPos]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    import('leaflet').then(L => {
      if (leafletMap.current) return;
      delete L.default.Icon.Default.prototype._getIconUrl;

      const center = userPos ? [userPos.lat, userPos.lng] : [CHICAGO_CENTER.lat, CHICAGO_CENTER.lng];
      leafletMap.current = L.default.map(mapRef.current, { center, zoom: 11 });

      // Dark CartoDB tiles
      L.default.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CARTO',
        maxZoom: 19,
      }).addTo(leafletMap.current);

      // User location circle
      if (userPos) {
        L.default.circle([userPos.lat, userPos.lng], {
          radius: radius * 1609.34,
          color: '#00d4ff',
          fillColor: '#00d4ff',
          fillOpacity: 0.05,
          weight: 1,
          dashArray: '6 4',
        }).addTo(leafletMap.current);

        L.default.circleMarker([userPos.lat, userPos.lng], {
          radius: 8, color: '#00d4ff', fillColor: '#00d4ff', fillOpacity: 1, weight: 2,
        }).addTo(leafletMap.current).bindPopup('<b style="color:#000">📍 Your location</b>');
      }

      // Store markers
      locations.forEach(loc => {
        const sc = scoreColor(loc.top_score);
        const sc2 = storeColor[loc.store_slug] || '#6b7280';
        const icon = L.default.divIcon({
          html: `<div style="position:relative;cursor:pointer">
            <div style="background:${sc2};width:36px;height:36px;border-radius:50%;border:3px solid ${sc};
              display:flex;align-items:center;justify-content:center;
              font-size:11px;font-weight:900;color:white;
              box-shadow:0 0 12px ${sc}60,0 2px 8px rgba(0,0,0,0.5)">
              ${Math.round(loc.top_score)}
            </div>
            <div style="position:absolute;bottom:-4px;right:-4px;background:${sc};border-radius:50%;width:14px;height:14px;
              display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;color:#000">
              ${loc.deal_count}
            </div>
          </div>`,
          className: '',
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        });
        const marker = L.default.marker([loc.latitude, loc.longitude], { icon })
          .addTo(leafletMap.current)
          .on('click', () => onSelect(loc));

        const sc3 = scoreColor(loc.top_score);
        marker.bindPopup(`
          <div style="font-family:system-ui;min-width:200px;color:#F8FAFC">
            <div style="font-weight:800;font-size:14px;color:${sc2}">${loc.store_name}</div>
            <div style="font-size:12px;color:#CBD5E1;margin:2px 0">${loc.address}</div>
            <hr style="border-color:#273449;margin:6px 0">
            <div style="display:flex;justify-content:space-between">
              <span><b style="color:${sc3}">${loc.deal_count} deals</b></span>
              <span>Score <b style="color:${sc3}">${loc.top_score}</b></span>
            </div>
            <div style="font-size:12px;margin-top:4px;color:#F8FAFC">🔥 ${loc.top_deal}</div>
            <div style="color:#4ADE80;font-weight:700;margin-top:4px">+$${loc.top_profit} best profit</div>
          </div>
        `);
        markersRef.current.push(marker);
      });
    });
  }, [locations, userPos, radius]);

  return <div ref={mapRef} className="w-full h-full" style={{ background: '#0a0a12' }} />;
}

// ── Main Map Page ─────────────────────────────────────────────────────────────
export default function MapView() {
  const [locations, setLocations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [userPos, setUserPos] = useState(null);
  const [locating, setLocating] = useState(false);
  const [loadingMap, setLoadingMap] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [zip, setZip] = useState('');
  const [filters, setFilters] = useState({
    min_score: 0,
    min_discount: 20,
    min_profit: 0,
    radius: 25,
    store: '',
  });

  useEffect(() => {
    // Auto-request geolocation on mount, then fetch real nearby stores
    function fetchNearby(lat, lng) {
      const radiusMeters = filters.radius * 1609.34;
      api.get(`/stores/nearby?lat=${lat}&lng=${lng}&radius=${Math.round(radiusMeters)}`)
        .then(r => {
          if (r.data?.stores?.length) {
            const mapped = r.data.stores.map((s, i) => ({
              id: s.place_id || String(i),
              store_name: s.name,
              store_slug: s.brand?.toLowerCase().replace(/[^a-z]/g, '-').replace(/-+/g, '-') || 'store',
              address: s.address || '',
              city: '',
              state: '',
              latitude: s.lat,
              longitude: s.lng,
              deal_count: 0,
              top_score: 0,
              top_profit: 0,
              top_discount: 0,
              top_deal: '',
              distance_miles: Math.round(
                Math.sqrt(Math.pow((s.lat - lat) * 69, 2) + Math.pow((s.lng - lng) * 69, 2)) * 10
              ) / 10,
              rating: s.rating,
              open_now: s.open_now,
            }));
            setLocations(mapped);
            setLoadingMap(false);
          } else {
            // No Google Places key or no results — fall back to DB store_locations
            api.get('/stores/map').then(r2 => {
              if (r2.data?.locations?.length) setLocations(r2.data.locations);
            }).catch(() => {}).finally(() => setLoadingMap(false));
          }
        })
        .catch(() => {
          api.get('/stores/map').then(r2 => {
            if (r2.data?.locations?.length) setLocations(r2.data.locations);
          }).catch(() => {}).finally(() => setLoadingMap(false));
        });
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          const { latitude: lat, longitude: lng } = pos.coords;
          setUserPos({ lat, lng });
          fetchNearby(lat, lng);
        },
        () => {
          // Permission denied — show empty state; don't display unrelated city stores
          setLocations([]);
          setLoadingMap(false);
        }
      );
    } else {
      // Geolocation not supported — empty state
      setLocations([]);
      setLoadingMap(false);
    }
  }, []);

  function getUserLocation() {
    setLocating(true);
    navigator.geolocation?.getCurrentPosition(
      pos => {
        setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => { setLocating(false); alert('Could not get location. Try entering a ZIP code.'); }
    );
  }

  const filtered = locations.filter(l => {
    if (filters.min_score > 0 && l.top_score < filters.min_score) return false;
    if (filters.min_discount > 0 && l.top_discount < filters.min_discount) return false;
    if (filters.min_profit > 0 && l.top_profit < filters.min_profit) return false;
    if (filters.store && l.store_slug !== filters.store) return false;
    return true;
  }).sort((a, b) => b.top_score - a.top_score);

  return (
    <div className="flex h-[calc(100vh-4rem)] lg:h-screen overflow-hidden">
      {/* ── Sidebar ── */}
      <div className="hidden lg:flex w-80 flex-shrink-0 flex-col border-r border-dark-700" style={{ background: '#141A26' }}>
        {/* Header */}
        <div className="p-4 border-b border-dark-700 space-y-3">
          <h1 className="text-white font-bold text-base flex items-center gap-2">
            <MapPin size={16} className="text-neon-green" /> Deal Map
          </h1>

          {/* ZIP / locate */}
          <div className="flex gap-2">
            <input value={zip} onChange={e => setZip(e.target.value)}
              placeholder="ZIP code..." onKeyDown={e => e.key === 'Enter' && setZip(zip)}
              className="flex-1 bg-dark-900 border border-dark-700 text-white text-xs rounded-xl px-3 py-2 placeholder-dark-500" />
            <button onClick={getUserLocation} disabled={locating}
              className="btn-ghost px-3 py-2 text-neon-blue border-neon-blue/30 text-xs flex items-center gap-1">
              <Navigation size={13} className={locating ? 'animate-spin' : ''} />
              {locating ? '...' : 'Me'}
            </button>
          </div>

          {/* Filters toggle */}
          <button onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 text-gray-300 hover:text-white text-xs transition-colors">
            <SlidersHorizontal size={13} />
            Filters {showFilters ? '▲' : '▼'}
          </button>

          {showFilters && (
            <div className="space-y-3 pt-1 border-t border-dark-700">
              {[
                { key: 'min_score', label: 'Min Score', min: 0, max: 100, suffix: '' },
                { key: 'min_discount', label: 'Min Discount', min: 0, max: 80, suffix: '%' },
                { key: 'min_profit', label: 'Min Profit', min: 0, max: 200, suffix: '$', prefix: '$' },
                { key: 'radius', label: 'Radius', min: 1, max: 50, suffix: ' mi' },
              ].map(f => (
                <div key={f.key}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-400">{f.label}</span>
                    <span className="text-white font-medium">{f.prefix || ''}{filters[f.key]}{f.suffix}</span>
                  </div>
                  <input type="range" min={f.min} max={f.max} value={filters[f.key]}
                    onChange={e => setFilters({ ...filters, [f.key]: parseInt(e.target.value) })}
                    className="w-full accent-neon-green h-1.5" />
                </div>
              ))}
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Store</label>
                <select value={filters.store} onChange={e => setFilters({ ...filters, store: e.target.value })}
                  className="w-full bg-dark-900 border border-dark-700 text-white text-xs rounded-xl px-3 py-2">
                  <option value="">All stores</option>
                  <option value="walmart">Walmart</option>
                  <option value="home-depot">Home Depot</option>
                  <option value="target">Target</option>
                  <option value="best-buy">Best Buy</option>
                  <option value="lowes">Lowe's</option>
                </select>
              </div>
              <button onClick={() => setFilters({ min_score: 0, min_discount: 20, min_profit: 0, radius: 25, store: '' })}
                className="text-xs text-gray-400 hover:text-neon-green">Reset filters</button>
            </div>
          )}
        </div>

        {/* Store list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          <p className="text-gray-400 text-xs px-2 py-1">
            {filtered.length > 0 ? `${filtered.length} stores with deals` : 'Enable location to see nearby stores'}
          </p>
          {filtered.length === 0 && !loadingMap && (
            <div className="p-4 text-center">
              <p className="text-3xl mb-2">📍</p>
              <p className="text-gray-400 text-xs">Click "Me" to enable location and find stores near you with live deals.</p>
            </div>
          )}
          {filtered.map(loc => {
            const sc = scoreColor(loc.top_score);
            const stC = storeColor[loc.store_slug] || '#6b7280';
            const isSelected = selected?.id === loc.id;
            return (
              <button key={loc.id} onClick={() => setSelected(isSelected ? null : loc)}
                className={`w-full text-left p-3 rounded-xl border transition-all ${isSelected ? 'border-neon-green/50 bg-neon-green/5' : 'border-dark-700 bg-dark-900 hover:border-dark-600'}`}>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                    style={{ background: `${stC}25`, color: stC, border: `2px solid ${stC}` }}>
                    {loc.deal_count}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                      <p className="text-white text-xs font-semibold">{loc.store_name}</p>
                      <span className="text-xs font-bold ml-2 flex-shrink-0" style={{ color: sc }}>{loc.top_score}</span>
                    </div>
                    <p className="text-xs font-semibold truncate" style={{ color: 'white' }}>{loc.address}</p>
                    {loc.distance_miles && (
                      <p className="text-xs" style={{ color: '#CBD5E1' }}>{loc.distance_miles} mi away</p>
                    )}
                    <p className="text-xs mt-1 truncate" style={{ color: sc }}>
                      🔥 {loc.top_deal}
                    </p>
                    <div className="flex gap-3 mt-1">
                      <span className="text-xs font-bold" style={{ color: '#4ADE80' }}>+${loc.top_profit}</span>
                      <span className="text-xs font-bold" style={{ color: '#F87171' }}>-{loc.top_discount}%</span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="p-3 border-t border-dark-700">
          <p className="text-gray-400 text-xs mb-2">Score Legend</p>
          <div className="grid grid-cols-2 gap-1 text-xs">
            {[['#00ff88', '91–100 Excellent'], ['#00d4ff', '71–90 Good'], ['#fbbf24', '41–70 Average'], ['#ef4444', '0–40 Skip']].map(([c, l]) => (
              <div key={l} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c }} />
                <span style={{ color: '#CBD5E1' }}>{l}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Map ── */}
      <div className="flex-1 relative overflow-hidden">
        <LeafletMap
          locations={filtered}
          selected={selected}
          onSelect={setSelected}
          userPos={userPos}
          radius={filters.radius}
        />

        {loadingMap && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-dark-900/80 gap-3">
            <div className="w-8 h-8 border-2 border-neon-green border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400 text-sm">Locating nearby stores…</p>
          </div>
        )}
        {!loadingMap && filtered.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none gap-3">
            <div className="glass rounded-2xl px-6 py-5 text-center border border-dark-600 pointer-events-auto">
              <p className="text-3xl mb-2">📍</p>
              <p className="text-white font-semibold text-sm">No nearby stores with live deals yet</p>
              <p className="text-gray-400 text-xs mt-1">Enable location permissions and click "Me" to find stores near you.</p>
            </div>
          </div>
        )}

        {/* Mobile filter bar (top) */}
        <div className="lg:hidden absolute top-3 left-3 right-3 flex gap-2 z-10">
          <button onClick={() => setShowFilters(!showFilters)}
            className="glass px-3 py-2 rounded-xl flex items-center gap-2 text-white text-xs border border-dark-700">
            <Filter size={13} /> Filters
          </button>
          <button onClick={getUserLocation} disabled={locating}
            className="glass px-3 py-2 rounded-xl flex items-center gap-2 text-neon-blue text-xs border border-neon-blue/30">
            <Navigation size={13} className={locating ? 'animate-spin' : ''} />
            My Location
          </button>
        </div>

        {/* Selected store panel */}
        {selected && (
          <div className="absolute bottom-4 left-4 right-4 lg:left-auto lg:right-4 lg:w-80 animate-slide-up">
            <div className="glass rounded-2xl border border-dark-600 overflow-hidden" style={{ backdropFilter: 'blur(12px)', background: 'rgba(10,10,19,0.92)' }}>
              <div className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-white font-bold">{selected.store_name}</p>
                    <p className="text-gray-300 text-xs">{selected.address}, {selected.city}</p>
                    {selected.distance_miles && (
                      <p className="text-gray-400 text-xs">{selected.distance_miles} miles from you</p>
                    )}
                  </div>
                  <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-white ml-2">
                    <X size={16} />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  {[
                    { label: 'Top Score', val: selected.top_score, color: scoreColor(selected.top_score) },
                    { label: 'Active Deals', val: selected.deal_count, color: '#fff' },
                    { label: 'Best Profit', val: `$${selected.top_profit}`, color: '#00ff88' },
                  ].map(m => (
                    <div key={m.label} className="bg-dark-800/80 rounded-xl p-2.5 text-center">
                      <p className="text-lg font-bold" style={{ color: m.color }}>{m.val}</p>
                      <p className="text-gray-400 text-xs mt-0.5">{m.label}</p>
                    </div>
                  ))}
                </div>

                <div className="bg-dark-800/50 rounded-xl p-3 mb-3">
                  <p className="text-gray-400 text-xs mb-1">Top Deal Right Now</p>
                  <p className="text-white text-sm font-medium">{selected.top_deal}</p>
                  <p className="text-neon-green text-xs font-semibold mt-1">+${selected.top_profit} estimated profit · -{selected.top_discount}% off</p>
                </div>

                <div className="flex gap-2">
                  <button className="flex-1 btn-primary text-xs py-2.5">View All Deals</button>
                  <button className="btn-ghost text-xs py-2.5 px-3 flex items-center gap-1">
                    <Navigation size={12} /> Directions
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Deal count chip */}
        <div className="absolute top-3 right-3 hidden lg:flex glass rounded-xl px-3 py-2 border border-dark-700 items-center gap-2 text-xs text-gray-300">
          <div className="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
          {filtered.reduce((sum, l) => sum + l.deal_count, 0)} live deals
        </div>
      </div>
    </div>
  );
}
