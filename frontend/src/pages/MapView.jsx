import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MapPin, SlidersHorizontal, X, Navigation, Search, Filter, RefreshCw
} from 'lucide-react';
import api from '../utils/api';

const scoreColor = (s) => s >= 91 ? '#00ff88' : s >= 71 ? '#00d4ff' : s >= 41 ? '#fbbf24' : '#ef4444';

function normalizeLocation(loc) {
  return {
    ...loc,
    store_name: loc.store_chain || loc.store_name || 'Unknown Store',
    top_score: parseInt(loc.best_score) || 0,
    top_discount: parseFloat(loc.max_discount) || 0,
    top_profit: parseFloat(loc.best_profit) || 0,
    deal_count: parseInt(loc.deal_count) || 0,
    latitude: parseFloat(loc.latitude),
    longitude: parseFloat(loc.longitude),
    distance_miles: loc.distance_miles != null ? parseFloat(loc.distance_miles) : null,
  };
}

// ── Leaflet map — remounts via key when data changes ──────────────────────────
function LeafletMap({ locations, onSelect, userPos, radius }) {
  const mapRef = useRef(null);
  const leafletMap = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !mapRef.current) return;
    import('leaflet').then(L => {
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
      delete L.default.Icon.Default.prototype._getIconUrl;

      const center = userPos
        ? [userPos.lat, userPos.lng]
        : locations.length > 0
          ? [locations[0].latitude, locations[0].longitude]
          : [39.8283, -98.5795];

      const zoom = userPos || locations.length > 0 ? 11 : 4;
      leafletMap.current = L.default.map(mapRef.current, { center, zoom });

      L.default.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CARTO',
        maxZoom: 19,
      }).addTo(leafletMap.current);

      if (userPos) {
        L.default.circle([userPos.lat, userPos.lng], {
          radius: radius * 1609.34,
          color: '#00d4ff', fillColor: '#00d4ff',
          fillOpacity: 0.05, weight: 1, dashArray: '6 4',
        }).addTo(leafletMap.current);

        L.default.circleMarker([userPos.lat, userPos.lng], {
          radius: 8, color: '#00d4ff', fillColor: '#00d4ff', fillOpacity: 1, weight: 2,
        }).addTo(leafletMap.current).bindPopup('<b style="color:#000">📍 Your location</b>');
      }

      locations.forEach(loc => {
        const sc = scoreColor(loc.top_score);
        const stC = loc.store_color || '#6b7280';
        const icon = L.default.divIcon({
          html: `<div style="position:relative;cursor:pointer">
            <div style="background:${stC};width:36px;height:36px;border-radius:50%;border:3px solid ${sc};
              display:flex;align-items:center;justify-content:center;
              font-size:11px;font-weight:900;color:white;
              box-shadow:0 0 12px ${sc}60,0 2px 8px rgba(0,0,0,0.5)">
              ${loc.top_score || '?'}
            </div>
            ${loc.deal_count > 0 ? `
              <div style="position:absolute;bottom:-4px;right:-4px;background:${sc};border-radius:50%;
                width:14px;height:14px;display:flex;align-items:center;justify-content:center;
                font-size:8px;font-weight:800;color:#000">${loc.deal_count}</div>
            ` : ''}
          </div>`,
          className: '',
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        });

        L.default.marker([loc.latitude, loc.longitude], { icon })
          .addTo(leafletMap.current)
          .on('click', () => onSelect(loc))
          .bindPopup(`
            <div style="font-family:system-ui;min-width:180px;color:#111">
              <div style="font-weight:800;font-size:14px;color:${stC}">${loc.store_name}</div>
              <div style="font-size:12px;color:#555;margin:2px 0">${loc.address || ''}</div>
              <hr style="border-color:#eee;margin:6px 0">
              <div style="display:flex;justify-content:space-between">
                <span><b style="color:${sc}">${loc.deal_count} deal${loc.deal_count !== 1 ? 's' : ''}</b></span>
                ${loc.top_score > 0 ? `<span>Score <b style="color:${sc}">${loc.top_score}</b></span>` : ''}
              </div>
              ${loc.top_profit > 0 ? `<div style="color:#16a34a;font-weight:700;margin-top:4px">+$${loc.top_profit.toFixed(2)} best profit</div>` : ''}
              ${loc.distance_miles != null ? `<div style="color:#6b7280;font-size:11px;margin-top:2px">${loc.distance_miles} mi away</div>` : ''}
            </div>
          `);
      });
    });

    return () => {
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
    };
  }, [locations, userPos, radius]);

  return <div ref={mapRef} className="w-full h-full" style={{ background: '#0a0a12' }} />;
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function MapView() {
  const [locations, setLocations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [userPos, setUserPos] = useState(null);
  const [locating, setLocating] = useState(false);
  const [geoMsg, setGeoMsg] = useState('');
  const [geoError, setGeoError] = useState(false);
  const [loadingMap, setLoadingMap] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [zip, setZip] = useState('');
  const [activeSearch, setActiveSearch] = useState(null);
  const [filters, setFilters] = useState({
    min_score: 0,
    min_discount: 0,
    min_profit: 0,
    radius: 25,
    store: '',
  });

  // Use a ref so the radius-change effect always reads the latest radius
  const filtersRef = useRef(filters);
  useEffect(() => { filtersRef.current = filters; }, [filters]);

  // Fetch stores. Accepts pos {lat,lng} for geo search or z (string) for ZIP.
  const fetchLocations = useCallback(async (pos, z) => {
    setLoadingMap(true);
    try {
      const params = {};
      if (pos) {
        params.lat = pos.lat;
        params.lng = pos.lng;
        params.radius = filtersRef.current.radius;
      } else if (z) {
        params.zip = z;
      }
      console.log('[Map] fetching nearby stores', params);
      const r = await api.get('/stores/map', { params });
      const locs = (r.data.locations || []).map(normalizeLocation);
      setLocations(locs);
      if (pos) {
        if (r.data.no_deals_yet && r.data.discovered?.length > 0) {
          setGeoMsg(`Found ${r.data.discovered.length} stores near you — no deals scanned yet. Check back soon!`);
          setGeoError(false);
        } else if (locs.length === 0) {
          setGeoMsg('No stores found near your location. Try a larger radius or ZIP code.');
        } else {
          setGeoMsg(`${locs.length} store${locs.length !== 1 ? 's' : ''} near you`);
          setGeoError(false);
        }
      }
    } catch (err) {
      console.error('[Map] fetchLocations error:', err);
      setLocations([]);
    } finally {
      setLoadingMap(false);
    }
  }, []); // stable — uses filtersRef for radius

  // Refetch when radius changes and we already have a position
  const userPosRef = useRef(null);
  useEffect(() => { userPosRef.current = userPos; }, [userPos]);

  useEffect(() => {
    if (userPosRef.current) fetchLocations(userPosRef.current, null);
  }, [filters.radius, fetchLocations]);

  function getUserLocation() {
    if (!navigator.geolocation) {
      setGeoMsg('Geolocation is not supported by this browser.');
      setGeoError(true);
      return;
    }
    setLocating(true);
    setGeoError(false);
    setGeoMsg('Requesting location…');
    console.log('[Map] requesting geolocation');

    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        console.log('[Map] geolocation success', lat, lng);
        const p = { lat, lng };
        setUserPos(p);
        userPosRef.current = p;
        setActiveSearch({ type: 'geo' });
        setLocating(false);
        // Call directly — do not rely solely on the radius-change effect
        fetchLocations(p, null);
      },
      err => {
        console.log('[Map] geolocation error', err.code, err.message);
        let msg;
        switch (err.code) {
          case 1:
            msg = 'Location permission denied. Enter ZIP code instead.';
            break;
          case 2:
            msg = 'Your Mac could not determine your current location. Try ZIP code or check Wi-Fi / Location Services.';
            break;
          case 3:
            msg = 'Location request timed out. Enter ZIP code instead.';
            break;
          default:
            msg = 'Could not get your location. Enter ZIP code instead.';
        }
        setGeoMsg(msg);
        setGeoError(true);
        setLocating(false);
      },
      { timeout: 10000 }
    );
  }

  function handleZipSearch() {
    const z = zip.trim();
    if (!z) return;
    setActiveSearch({ type: 'zip', value: z });
    setGeoMsg('');
    setGeoError(false);
    fetchLocations(null, z);
  }

  const filtered = locations.filter(l => {
    if (filters.min_score > 0 && l.top_score < filters.min_score) return false;
    if (filters.min_discount > 0 && l.top_discount < filters.min_discount) return false;
    if (filters.min_profit > 0 && l.top_profit < filters.min_profit) return false;
    if (filters.store && l.store_slug !== filters.store) return false;
    return true;
  }).sort((a, b) => {
    if (a.distance_miles != null && b.distance_miles != null) return a.distance_miles - b.distance_miles;
    return b.top_score - a.top_score;
  });

  const uniqueStores = [
    ...new Map(locations.map(l => [l.store_slug, { slug: l.store_slug, name: l.store_name }])).values(),
  ];

  const hasSearch = !!activeSearch;
  const totalLiveDeals = filtered.reduce((sum, l) => sum + l.deal_count, 0);

  // Sidebar background for contrast
  const sidebarBg = { background: '#0d1120' };
  const inputStyle = { background: '#151929', border: '1px solid rgba(255,255,255,0.18)' };

  return (
    <div className="flex h-[calc(100vh-4rem)] lg:h-screen overflow-hidden">

      {/* ── Sidebar ── */}
      <div className="hidden lg:flex w-80 flex-shrink-0 flex-col border-r border-white/10" style={sidebarBg}>

        {/* Header + search */}
        <div className="p-4 border-b border-white/10 space-y-3">
          <h1 className="text-white font-bold text-base flex items-center gap-2">
            <MapPin size={16} className="text-neon-green" /> Deal Map
          </h1>

          <div className="flex gap-2">
            <input
              value={zip}
              onChange={e => setZip(e.target.value)}
              placeholder="ZIP code..."
              onKeyDown={e => e.key === 'Enter' && handleZipSearch()}
              className="flex-1 text-white text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-neon-green/40 placeholder-gray-400"
              style={inputStyle}
            />
            <button
              type="button"
              onClick={handleZipSearch}
              className="px-2.5 py-2 text-xs rounded-xl text-gray-200 hover:text-white hover:bg-white/10 transition-colors border border-white/15"
              title="Search ZIP"
            >
              <Search size={13} />
            </button>
            <button
              type="button"
              onClick={getUserLocation}
              disabled={locating}
              className="px-3 py-2 text-neon-blue text-xs flex items-center gap-1 rounded-xl border border-neon-blue/40 hover:bg-neon-blue/10 transition-colors disabled:opacity-50"
              title="Use my location"
            >
              <Navigation size={13} className={locating ? 'animate-spin' : ''} />
              {locating ? '…' : 'Me'}
            </button>
          </div>

          {/* Geo status message */}
          {geoMsg && (
            <p className={`text-xs leading-snug ${
              geoMsg === 'Using your location'
                ? 'text-neon-green'
                : geoMsg === 'Requesting location…'
                  ? 'text-gray-400'
                  : 'text-yellow-300'
            }`}>
              {geoMsg}
            </p>
          )}

          {/* Try again button when geo fails */}
          {geoError && (
            <button
              type="button"
              onClick={getUserLocation}
              disabled={locating}
              className="flex items-center gap-1.5 text-xs text-neon-blue hover:text-neon-blue/80 underline underline-offset-2 disabled:opacity-50"
            >
              <RefreshCw size={11} /> Try again
            </button>
          )}

          <p className="text-xs text-gray-500 leading-snug">
            If location does not load, allow access in browser / System Settings → Privacy → Location Services, or enter a ZIP code.
          </p>

          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 text-gray-300 hover:text-white text-xs transition-colors"
          >
            <SlidersHorizontal size={13} />
            Filters {showFilters ? '▲' : '▼'}
          </button>

          {showFilters && (
            <div className="space-y-3 pt-1 border-t border-white/10">
              {[
                { key: 'min_score', label: 'Min Score', min: 0, max: 100, suffix: '' },
                { key: 'min_discount', label: 'Min Discount', min: 0, max: 80, suffix: '%' },
                { key: 'min_profit', label: 'Min Profit', min: 0, max: 500, suffix: '', prefix: '$' },
                { key: 'radius', label: 'Radius', min: 1, max: 100, suffix: ' mi' },
              ].map(f => (
                <div key={f.key}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-300">{f.label}</span>
                    <span className="text-white font-medium">{f.prefix || ''}{filters[f.key]}{f.suffix}</span>
                  </div>
                  <input
                    type="range" min={f.min} max={f.max} value={filters[f.key]}
                    onChange={e => setFilters({ ...filters, [f.key]: parseInt(e.target.value) })}
                    className="w-full accent-neon-green h-1.5"
                  />
                </div>
              ))}
              <div>
                <label className="text-gray-300 text-xs mb-1 block">Store</label>
                <select
                  value={filters.store}
                  onChange={e => setFilters({ ...filters, store: e.target.value })}
                  className="w-full text-white text-xs rounded-xl px-3 py-2 focus:outline-none"
                  style={inputStyle}
                >
                  <option value="">All stores</option>
                  {uniqueStores.map(s => <option key={s.slug} value={s.slug}>{s.name}</option>)}
                </select>
              </div>
              <button
                type="button"
                onClick={() => setFilters({ min_score: 0, min_discount: 0, min_profit: 0, radius: 25, store: '' })}
                className="text-xs text-gray-400 hover:text-neon-green"
              >
                Reset filters
              </button>
            </div>
          )}
        </div>

        {/* Store list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {!hasSearch ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4 pb-8">
              <MapPin size={32} className="text-gray-400 mb-3" />
              <p className="text-gray-200 text-sm font-medium">Enter ZIP or allow location</p>
              <p className="text-gray-400 text-xs mt-1">to see nearby stores with deals</p>
              <button
                type="button"
                onClick={getUserLocation}
                disabled={locating}
                className="btn-primary text-xs mt-4 px-4 py-2 flex items-center gap-2"
              >
                <Navigation size={13} /> Use my location
              </button>
            </div>
          ) : loadingMap ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-5 h-5 border-2 border-neon-green border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center px-4">
              <p className="text-gray-300 text-sm">No stores found</p>
              <p className="text-gray-400 text-xs mt-1">Try a larger radius or different ZIP</p>
            </div>
          ) : (
            <>
              <p className="text-gray-300 text-xs px-2 py-1">{filtered.length} stores found</p>
              {filtered.map(loc => {
                const sc = scoreColor(loc.top_score);
                const stC = loc.store_color || '#6b7280';
                const isSelected = selected?.id === loc.id;
                return (
                  <button
                    type="button"
                    key={loc.id}
                    onClick={() => setSelected(isSelected ? null : loc)}
                    className={`w-full text-left p-3 rounded-xl transition-all ${
                      isSelected
                        ? 'border border-neon-green/50 bg-neon-green/5'
                        : 'border border-white/10 hover:border-white/25'
                    }`}
                    style={!isSelected ? { background: '#111624' } : {}}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                        style={{ background: `${stC}25`, color: stC, border: `2px solid ${stC}` }}
                      >
                        {loc.deal_count}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start">
                          <p className="text-white text-xs font-semibold">{loc.store_name}</p>
                          {loc.top_score > 0 && (
                            <span className="text-xs font-bold ml-2 flex-shrink-0" style={{ color: sc }}>
                              {loc.top_score}
                            </span>
                          )}
                        </div>
                        <p className="text-gray-300 text-xs truncate">
                          {loc.address}{loc.city ? `, ${loc.city}` : ''}{loc.state ? `, ${loc.state}` : ''}
                        </p>
                        {loc.distance_miles != null && (
                          <p className="text-gray-400 text-xs">{loc.distance_miles} mi away</p>
                        )}
                        <div className="flex gap-3 mt-1">
                          {loc.top_profit > 0 && (
                            <span className="text-neon-green text-xs font-bold">+${loc.top_profit.toFixed(2)}</span>
                          )}
                          {loc.top_discount > 0 && (
                            <span className="text-red-400 text-xs font-bold">-{loc.top_discount.toFixed(0)}%</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </>
          )}
        </div>

        {/* Score legend */}
        <div className="p-3 border-t border-white/10" style={sidebarBg}>
          <p className="text-gray-200 text-xs font-semibold mb-2">Score Legend</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              ['#00ff88', '91–100 Excellent'],
              ['#00d4ff', '71–90 Good'],
              ['#fbbf24', '41–70 Average'],
              ['#ef4444', '0–40 Skip'],
            ].map(([c, l]) => (
              <div key={l} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full flex-shrink-0 shadow-sm" style={{ background: c }} />
                <span className="text-gray-300">{l}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Map ── */}
      <div className="flex-1 relative overflow-hidden">
        <LeafletMap
          key={`${filtered.length}-${userPos?.lat ?? 0}-${userPos?.lng ?? 0}-${activeSearch?.value ?? ''}`}
          locations={filtered}
          onSelect={setSelected}
          userPos={userPos}
          radius={filters.radius}
        />

        {/* Mobile controls */}
        <div className="lg:hidden absolute top-3 left-3 right-3 flex gap-2 z-10">
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className="px-3 py-2 rounded-xl flex items-center gap-2 text-white text-xs border border-white/20"
            style={{ background: 'rgba(13,17,32,0.88)', backdropFilter: 'blur(12px)' }}
          >
            <Filter size={13} /> Filters
          </button>
          <button
            type="button"
            onClick={getUserLocation}
            disabled={locating}
            className="px-3 py-2 rounded-xl flex items-center gap-2 text-neon-blue text-xs border border-neon-blue/30 disabled:opacity-50"
            style={{ background: 'rgba(13,17,32,0.88)', backdropFilter: 'blur(12px)' }}
          >
            <Navigation size={13} className={locating ? 'animate-spin' : ''} />
            My Location
          </button>
        </div>

        {/* Empty state overlay — before any search */}
        {!hasSearch && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div
              className="rounded-2xl p-6 text-center max-w-xs pointer-events-auto"
              style={{
                backdropFilter: 'blur(16px)',
                background: 'rgba(13,17,32,0.93)',
                border: '1px solid rgba(255,255,255,0.18)',
              }}
            >
              <MapPin size={28} className="text-neon-green mx-auto mb-2" />
              <p className="text-white font-semibold text-sm">Enter ZIP or allow location</p>
              <p className="text-gray-300 text-xs mt-1">to find nearby stores with active deals</p>
              {geoError && geoMsg && (
                <p className="text-yellow-300 text-xs mt-2 leading-snug">{geoMsg}</p>
              )}
              <button
                type="button"
                onClick={getUserLocation}
                disabled={locating}
                className="btn-primary text-xs mt-3 px-4 py-2 flex items-center gap-2 mx-auto disabled:opacity-60"
              >
                <Navigation size={13} className={locating ? 'animate-spin' : ''} />
                {locating ? 'Requesting…' : 'Use my location'}
              </button>
            </div>
          </div>
        )}

        {/* Selected store panel */}
        {selected && (
          <div className="absolute bottom-4 left-4 right-4 lg:left-auto lg:right-4 lg:w-80">
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                backdropFilter: 'blur(16px)',
                background: 'rgba(13,17,32,0.95)',
                border: '1px solid rgba(255,255,255,0.18)',
              }}
            >
              <div className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-white font-bold">{selected.store_name}</p>
                    <p className="text-gray-300 text-xs">
                      {selected.address}{selected.city ? `, ${selected.city}` : ''}{selected.state ? `, ${selected.state}` : ''}
                    </p>
                    {selected.distance_miles != null && (
                      <p className="text-gray-400 text-xs">{selected.distance_miles} mi from you</p>
                    )}
                  </div>
                  <button type="button" onClick={() => setSelected(null)} className="text-gray-400 hover:text-white ml-2">
                    <X size={16} />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  {[
                    {
                      label: 'Top Score',
                      val: selected.top_score > 0 ? selected.top_score : '—',
                      color: selected.top_score > 0 ? scoreColor(selected.top_score) : '#9ca3af',
                    },
                    { label: 'Active Deals', val: selected.deal_count, color: '#fff' },
                    {
                      label: 'Best Profit',
                      val: selected.top_profit > 0 ? `$${selected.top_profit.toFixed(2)}` : '—',
                      color: '#00ff88',
                    },
                  ].map(m => (
                    <div key={m.label} className="rounded-xl p-2.5 text-center" style={{ background: 'rgba(255,255,255,0.07)' }}>
                      <p className="text-lg font-bold" style={{ color: m.color }}>{m.val}</p>
                      <p className="text-gray-300 text-xs mt-0.5">{m.label}</p>
                    </div>
                  ))}
                </div>

                {selected.top_discount > 0 && (
                  <div className="rounded-xl p-3 mb-3" style={{ background: 'rgba(255,255,255,0.05)' }}>
                    <p className="text-gray-300 text-xs mb-1">Best discount at this location</p>
                    <p className="text-neon-green text-sm font-semibold">-{selected.top_discount.toFixed(0)}% off</p>
                  </div>
                )}

                {selected.zip_code && (
                  <p className="text-gray-400 text-xs mb-3">ZIP: {selected.zip_code}</p>
                )}

                <button type="button" className="w-full btn-primary text-xs py-2.5">View All Deals</button>
              </div>
            </div>
          </div>
        )}

        {/* Live deal count chip */}
        {hasSearch && !loadingMap && filtered.length > 0 && (
          <div
            className="absolute top-3 right-3 hidden lg:flex rounded-xl px-3 py-2 border border-white/15 items-center gap-2 text-xs text-gray-200"
            style={{ background: 'rgba(13,17,32,0.88)', backdropFilter: 'blur(12px)' }}
          >
            <div className="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
            {totalLiveDeals} live deal{totalLiveDeals !== 1 ? 's' : ''} · {filtered.length} stores
          </div>
        )}
      </div>
    </div>
  );
}
