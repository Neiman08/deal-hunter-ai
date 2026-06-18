/**
 * PRO HUNTER MODE — Top 100 National Opportunities
 * Full-screen immersive deal hunting experience.
 * Sortable by ROI, Profit, Score, Discount.
 * Real-time auto-refresh every 60 seconds.
 */
import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Crosshair, RefreshCw, TrendingUp, DollarSign,
  Star, ArrowUpDown, Filter, Zap, Clock, AlertTriangle,
  ChevronUp, ChevronDown, Package
} from 'lucide-react';
import api from '../utils/api';


const SORT_OPTIONS = [
  { key: 'opportunity_score', label: 'Score', icon: <Star size={13} /> },
  { key: 'roi_percent', label: 'ROI %', icon: <TrendingUp size={13} /> },
  { key: 'estimated_profit', label: 'Profit $', icon: <DollarSign size={13} /> },
  { key: 'discount_percent', label: 'Discount %', icon: <Zap size={13} /> },
];

function scoreColor(s) {
  return s >= 91 ? '#00ff88' : s >= 71 ? '#00d4ff' : s >= 41 ? '#fbbf24' : '#ef4444';
}

function RankBadge({ rank }) {
  if (rank === 1) return <span className="text-yellow-400 text-lg font-black w-8 text-center">🥇</span>;
  if (rank === 2) return <span className="text-gray-300 text-lg font-black w-8 text-center">🥈</span>;
  if (rank === 3) return <span className="text-amber-600 text-lg font-black w-8 text-center">🥉</span>;
  return <span className="text-gray-400 text-sm font-bold w-8 text-center tabular-nums">#{rank}</span>;
}

export default function ProHunter() {
  const [deals, setDeals] = useState([]);
  const [sort, setSort] = useState('opportunity_score');
  const [sortDir, setSortDir] = useState('desc');
  const [filters, setFilters] = useState({ store: '', category: '', min_roi: 0, only_clearance: false });
  const [showFilters, setShowFilters] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    fetchDeals();
    startCountdown();
    return () => clearInterval(timerRef.current);
  }, [sort, sortDir]);

  function startCountdown() {
    clearInterval(timerRef.current);
    setCountdown(60);
    timerRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { fetchDeals(); return 60; }
        return c - 1;
      });
    }, 1000);
  }

  async function fetchDeals() {
    setLoading(true);
    try {
      const r = await api.get('/deals', {
        params: { sort, limit: 100, min_discount: 20, min_score: 60 }
      });
      if (r.data.deals?.length) setDeals(r.data.deals.map((d, i) => ({ ...d, rank: i + 1 })));
    } catch {}
    setLoading(false);
  }

  function handleSort(key) {
    if (sort === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSort(key); setSortDir('desc'); }
  }

  const sorted = [...deals]
    .filter(d => {
      if (filters.store && d.store_slug !== filters.store) return false;
      if (filters.category && d.category_name !== filters.category) return false;
      if (filters.min_roi && d.roi_percent < filters.min_roi) return false;
      if (filters.only_clearance && !d.liquidation_type) return false;
      return true;
    })
    .sort((a, b) => {
      const mult = sortDir === 'desc' ? -1 : 1;
      return mult * ((a[sort] || 0) - (b[sort] || 0));
    })
    .map((d, i) => ({ ...d, rank: i + 1 }));

  const totalProfit = sorted.reduce((s, d) => s + (d.estimated_profit || 0), 0);
  const avgROI = sorted.length ? Math.round(sorted.reduce((s, d) => s + (d.roi_percent || 0), 0) / sorted.length) : 0;

  return (
    <div className="flex flex-col h-screen bg-dark-900 overflow-hidden">
      {/* ── Header Bar ── */}
      <div className="flex-shrink-0 border-b border-dark-700 bg-dark-800 px-4 py-3">
        <div className="flex items-center gap-4 max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-neon-green/15 flex items-center justify-center">
              <Crosshair size={18} className="text-neon-green" />
            </div>
            <div>
              <h1 className="text-white font-black text-base leading-none">Pro Hunter</h1>
              <p className="text-gray-400 text-xs">Top {sorted.length} national opportunities</p>
            </div>
          </div>

          {/* Stats */}
          <div className="hidden md:flex items-center gap-6 ml-6">
            <div className="text-center">
              <p className="text-neon-green font-bold text-sm">${Math.round(totalProfit / 1000 * 10) / 10}k</p>
              <p className="text-gray-400 text-xs">Combined profit</p>
            </div>
            <div className="text-center">
              <p className="text-neon-blue font-bold text-sm">{avgROI}%</p>
              <p className="text-gray-400 text-xs">Avg ROI</p>
            </div>
            <div className="text-center">
              <p className="text-yellow-400 font-bold text-sm">{sorted.filter(d => d.is_error_price).length}</p>
              <p className="text-gray-400 text-xs">Price errors</p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* Countdown */}
            <div className="flex items-center gap-1.5 text-xs text-gray-400 bg-dark-900 px-3 py-1.5 rounded-xl border border-dark-700">
              <Clock size={12} className="text-neon-green" />
              <span className="text-gray-400">Refresh in <span className="text-white font-mono">{countdown}s</span></span>
            </div>
            <button onClick={() => { fetchDeals(); startCountdown(); }} disabled={loading}
              className="btn-ghost p-2 text-neon-green border-neon-green/30">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={() => setShowFilters(!showFilters)}
              className={`btn-ghost p-2 ${showFilters ? 'text-neon-green border-neon-green/40' : ''}`}>
              <Filter size={15} />
            </button>
          </div>
        </div>

        {/* Filter bar */}
        {showFilters && (
          <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-dark-700 max-w-7xl mx-auto">
            <select value={filters.store} onChange={e => setFilters({ ...filters, store: e.target.value })}
              className="bg-dark-900 border border-dark-700 text-white text-xs rounded-xl px-3 py-1.5">
              <option value="">All Stores</option>
              <option value="walmart">Walmart</option>
              <option value="home-depot">Home Depot</option>
              <option value="target">Target</option>
              <option value="best-buy">Best Buy</option>
            </select>
            <select value={filters.category} onChange={e => setFilters({ ...filters, category: e.target.value })}
              className="bg-dark-900 border border-dark-700 text-white text-xs rounded-xl px-3 py-1.5">
              <option value="">All Categories</option>
              <option value="Power Tools">Power Tools</option>
              <option value="Electronics">Electronics</option>
              <option value="Appliances">Appliances</option>
              <option value="Kitchen">Kitchen</option>
            </select>
            <div className="flex items-center gap-2">
              <label className="text-gray-400 text-xs">Min ROI: {filters.min_roi}%</label>
              <input type="range" min="0" max="200" value={filters.min_roi}
                onChange={e => setFilters({ ...filters, min_roi: parseInt(e.target.value) })}
                className="w-24 accent-neon-green" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={filters.only_clearance}
                onChange={e => setFilters({ ...filters, only_clearance: e.target.checked })}
                className="accent-neon-green" />
              <span className="text-gray-400 text-xs">Clearance only</span>
            </label>
            <button onClick={() => setFilters({ store: '', category: '', min_roi: 0, only_clearance: false })}
              className="text-xs text-gray-500 hover:text-neon-green">Reset</button>
          </div>
        )}

        {/* Sort tabs */}
        <div className="flex gap-1 mt-3 max-w-7xl mx-auto">
          {SORT_OPTIONS.map(opt => (
            <button key={opt.key} onClick={() => handleSort(opt.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                sort === opt.key ? 'bg-neon-green/15 text-neon-green border border-neon-green/30' : 'text-gray-400 hover:text-white'
              }`}>
              {opt.icon} {opt.label}
              {sort === opt.key && (
                sortDir === 'desc' ? <ChevronDown size={11} /> : <ChevronUp size={11} />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Deal List ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto">
          {loading && sorted.length === 0 && (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-neon-green/30 border-t-neon-green rounded-full animate-spin" />
            </div>
          )}
          {!loading && sorted.length === 0 && (
            <div className="text-center py-20 text-gray-400">
              <Crosshair size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-white font-semibold">No deals found</p>
              <p className="text-sm mt-1">No hay deals activos con los filtros actuales.</p>
            </div>
          )}
          {sorted.map((deal) => {
            const sc = scoreColor(deal.opportunity_score);
            const stC = deal.store_color;
            const savings = (parseFloat(deal.regular_price || 0) - parseFloat(deal.deal_price || 0)).toFixed(0);

            return (
              <Link key={deal.id} to={`/deal/${deal.id}`}
                className="flex items-center gap-3 px-4 py-3 border-b border-dark-800 hover:bg-dark-800/60 transition-colors group">
                {/* Rank */}
                <RankBadge rank={deal.rank} />

                {/* Score ring */}
                <div className="w-10 h-10 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
                  style={{ borderColor: sc }}>
                  <span className="text-xs font-black" style={{ color: sc }}>{deal.opportunity_score}</span>
                </div>

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                      style={{ background: `${stC}25`, color: stC }}>
                      {deal.store_name}
                    </span>
                    {deal.liquidation_badge && (
                      <span className="text-xs font-bold">{deal.liquidation_badge}</span>
                    )}
                    {deal.is_error_price && <span className="text-yellow-400 text-xs">⚠️ Err</span>}
                  </div>
                  <p className="text-white text-sm font-semibold truncate group-hover:text-neon-green transition-colors">
                    {deal.name}
                  </p>
                  <p className="text-gray-400 text-xs">{deal.brand} · {deal.category_name} · {deal.city}, {deal.state}</p>
                </div>

                {/* Price */}
                <div className="flex-shrink-0 text-right hidden sm:block">
                  <p className="text-white font-black text-base">${deal.deal_price}</p>
                  <p className="text-gray-500 text-xs line-through">${deal.regular_price}</p>
                </div>

                {/* Discount */}
                <div className="w-14 flex-shrink-0 text-center">
                  <span className="text-red-400 font-black text-sm">-{Math.round(deal.discount_percent)}%</span>
                  <p className="text-gray-500 text-xs">save ${savings}</p>
                </div>

                {/* Profit */}
                <div className="w-20 flex-shrink-0 text-center hidden md:block">
                  <p className="text-neon-green font-black text-sm">+${Math.round(deal.estimated_profit || 0)}</p>
                  <p className="text-gray-500 text-xs">profit</p>
                </div>

                {/* ROI */}
                <div className="w-16 flex-shrink-0 text-center hidden lg:block">
                  <p className="text-neon-blue font-black text-sm">{Math.round(deal.roi_percent || 0)}%</p>
                  <p className="text-gray-500 text-xs">ROI</p>
                </div>

                {/* Stock */}
                <div className="w-14 flex-shrink-0 text-center hidden lg:block">
                  {deal.stock_quantity !== null && (
                    <p className={`text-xs font-semibold ${deal.stock_quantity <= 3 ? 'text-yellow-400' : 'text-gray-400'}`}>
                      {deal.stock_quantity <= 3 ? `⚡ ${deal.stock_quantity}` : deal.stock_quantity}
                    </p>
                  )}
                  <p className="text-gray-500 text-xs">units</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
