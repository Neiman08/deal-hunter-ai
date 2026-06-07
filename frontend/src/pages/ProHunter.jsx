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

const DEMO_TOP100 = Array.from({ length: 24 }, (_, i) => ({
  rank: i + 1,
  id: String(i + 1),
  name: [
    'DeWalt 20V Max Drill Kit', 'Milwaukee M18 FUEL Combo', 'Dyson V11 Cordless Vacuum',
    'LG 65" OLED TV C3', 'KitchenAid 5Qt Stand Mixer', 'Makita 18V Circular Saw',
    'iRobot Roomba i3+ Self-Empty', 'Apple AirPods Pro 2nd Gen', 'Sony WH-1000XM5',
    'DeWalt 60V FlexVolt Chainsaw', 'Milwaukee M18 Sawzall', 'Dyson Airwrap Complete',
    'Samsung 75" QLED TV', 'Ninja Professional Blender', 'Ryobi 18V Drill Driver',
    'Cuisinart 14-Cup Food Processor', 'Black+Decker 20V Trimmer', 'Dewalt Tool Chest',
    'Milwaukee Work Light', 'Bosch 12V Drill Kit', 'Makita Air Compressor',
    'Rigid 18V Oscillating Tool', 'Porter-Cable Jig Saw', 'Skil 20V Reciprocating Saw',
  ][i],
  brand: ['DeWalt','Milwaukee','Dyson','LG','KitchenAid','Makita','iRobot','Apple','Sony','DeWalt','Milwaukee','Dyson','Samsung','Ninja','Ryobi','Cuisinart','B+D','DeWalt','Milwaukee','Bosch','Makita','Rigid','Porter-Cable','Skil'][i],
  store_name: ['Home Depot','Home Depot','Walmart','Best Buy','Target','Home Depot','Walmart','Target','Best Buy','Home Depot','Home Depot','Target','Best Buy','Walmart','Home Depot','Target','Walmart','Home Depot','Home Depot','Home Depot','Home Depot','Home Depot','Home Depot','Walmart'][i],
  store_slug: ['home-depot','home-depot','walmart','best-buy','target','home-depot','walmart','target','best-buy','home-depot','home-depot','target','best-buy','walmart','home-depot','target','walmart','home-depot','home-depot','home-depot','home-depot','home-depot','home-depot','walmart'][i],
  store_color: ['#F96302','#F96302','#0071CE','#003087','#CC0000','#F96302','#0071CE','#CC0000','#003087','#F96302','#F96302','#CC0000','#003087','#0071CE','#F96302','#CC0000','#0071CE','#F96302','#F96302','#F96302','#F96302','#F96302','#F96302','#0071CE'][i],
  regular_price: [199,349,599,1299,449,189,499,249,399,429,229,599,1799,99,129,179,89,599,179,169,399,129,89,129][i],
  deal_price: [49,119,149,499,179,79,149,149,129,89,59,149,449,29,39,49,19,149,39,49,99,29,19,29][i],
  discount_percent: [75,66,75,62,60,58,70,40,68,79,74,75,75,71,70,73,79,75,78,71,75,78,79,78][i],
  estimated_profit: [81,174,248,487,148,62,168,34,142,224,118,248,847,34,52,91,34,291,98,74,168,62,38,62][i],
  roi_percent: [165,146,166,97,82,78,113,23,110,252,200,166,189,117,133,186,179,195,251,151,170,214,200,214][i],
  opportunity_score: [98,93,96,88,84,79,91,72,87,97,95,94,92,85,83,88,90,96,95,86,91,93,92,91][i],
  opportunity_label: ['🔥 Excelente','🔥 Excelente','🔥 Excelente','💎 Muy Buena','💎 Muy Buena','💎 Muy Buena','🔥 Excelente','✅ Regular','💎 Muy Buena','🔥 Excelente','🔥 Excelente','🔥 Excelente','🔥 Excelente','💎 Muy Buena','💎 Muy Buena','💎 Muy Buena','🔥 Excelente','🔥 Excelente','🔥 Excelente','💎 Muy Buena','🔥 Excelente','🔥 Excelente','🔥 Excelente','🔥 Excelente'][i],
  is_error_price: [true,false,true,false,false,false,false,false,false,true,true,true,true,false,false,false,true,true,true,false,false,true,true,true][i],
  liquidation_type: ['CLEARANCE','MARKDOWN','CLEARANCE',null,null,'MARKDOWN','CLEARANCE',null,'MARKDOWN','CLEARANCE','CLEARANCE','CLEARANCE','CLEARANCE','MARKDOWN',null,'MARKDOWN','ROLLBACK','CLEARANCE','CLEARANCE','MARKDOWN','MARKDOWN','CLEARANCE','CLEARANCE','ROLLBACK'][i],
  liquidation_badge: ['🔴 CLEARANCE','🟡 MARKDOWN','🔴 CLEARANCE',null,null,'🟡 MARKDOWN','🔴 CLEARANCE',null,'🟡 MARKDOWN','🔴 DEEP CLEARANCE','🔴 CLEARANCE','🔴 CLEARANCE','🔴 CLEARANCE','🟡 MARKDOWN',null,'🟡 MARKDOWN','🔵 ROLLBACK','🔴 CLEARANCE','🔴 CLEARANCE','🟡 MARKDOWN','🟡 MARKDOWN','🔴 CLEARANCE','🔴 CLEARANCE','🔵 ROLLBACK'][i],
  stock_quantity: [3,2,1,4,6,8,2,12,5,1,2,1,2,15,9,7,22,3,2,11,4,2,3,8][i],
  category_name: ['Power Tools','Power Tools','Appliances','Electronics','Kitchen','Power Tools','Appliances','Electronics','Electronics','Power Tools','Power Tools','Appliances','Electronics','Kitchen','Power Tools','Kitchen','Outdoor','Power Tools','Power Tools','Power Tools','Power Tools','Power Tools','Power Tools','Power Tools'][i],
  state: 'TX',
  city: ['Houston','Houston','Dallas','Austin','Houston','Dallas','San Antonio','Austin','Houston','Houston','Dallas','Austin','Houston','Dallas','San Antonio','Austin','Houston','Houston','Dallas','Austin','San Antonio','Houston','Dallas','Austin'][i],
}));

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
  const [deals, setDeals] = useState(DEMO_TOP100);
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
    } catch { /* use demo */ }
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
              <span>Refresh in <span className="text-white font-mono">{countdown}s</span></span>
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
              <span className="text-gray-300 text-xs">Clearance only</span>
            </label>
            <button onClick={() => setFilters({ store: '', category: '', min_roi: 0, only_clearance: false })}
              className="text-xs text-gray-400 hover:text-neon-green">Reset</button>
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
          {sorted.map((deal) => {
            const sc = scoreColor(deal.opportunity_score);
            const stC = deal.store_color;
            const savings = (deal.regular_price - deal.deal_price).toFixed(0);

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
                  <p className="text-gray-400 text-xs line-through">${deal.regular_price}</p>
                </div>

                {/* Discount */}
                <div className="w-14 flex-shrink-0 text-center">
                  <span className="text-red-400 font-black text-sm">-{Math.round(deal.discount_percent)}%</span>
                  <p className="text-gray-400 text-xs">save ${savings}</p>
                </div>

                {/* Profit */}
                <div className="w-20 flex-shrink-0 text-center hidden md:block">
                  <p className="text-neon-green font-black text-sm">+${Math.round(deal.estimated_profit)}</p>
                  <p className="text-gray-400 text-xs">profit</p>
                </div>

                {/* ROI */}
                <div className="w-16 flex-shrink-0 text-center hidden lg:block">
                  <p className="text-neon-blue font-black text-sm">{Math.round(deal.roi_percent)}%</p>
                  <p className="text-gray-400 text-xs">ROI</p>
                </div>

                {/* Stock */}
                <div className="w-14 flex-shrink-0 text-center hidden lg:block">
                  {deal.stock_quantity !== null && (
                    <p className={`text-xs font-semibold ${deal.stock_quantity <= 3 ? 'text-yellow-400' : 'text-gray-400'}`}>
                      {deal.stock_quantity <= 3 ? `⚡ ${deal.stock_quantity}` : deal.stock_quantity}
                    </p>
                  )}
                  <p className="text-gray-400 text-xs">units</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
