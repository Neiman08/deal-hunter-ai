import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Flame, DollarSign, RefreshCw,
  AlertTriangle, ArrowRight, Star, Brain, TrendingUp, Clock, CheckCircle, AlertCircle,
  Search, X, Shield, Package,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LineChart, Line, CartesianGrid } from 'recharts';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import StatCard from '../components/StatCard';
import DealCard from '../components/DealCard';
import FilterBar from '../components/FilterBar';

const LIMIT = 24;

function parseStats(raw) {
  return {
    ...raw,
    total_deals:                  parseInt(raw.total_deals)                  || 0,
    total_db_deals:               parseInt(raw.total_deals)                  || 0,
    total_products:               parseInt(raw.total_products)               || 0,
    searchable_deals_default:     parseInt(raw.searchable_deals_default)     || 0,
    low_discount_deals:           parseInt(raw.low_discount_deals)           || 0,
    new_today:                    parseInt(raw.new_today)                    || 0,
    new_this_hour:                parseInt(raw.new_this_hour)                || 0,
    error_prices:                 parseInt(raw.error_prices)                 || 0,
    excellent_deals:              parseInt(raw.excellent_deals)              || 0,
    good_deals:                   parseInt(raw.good_deals)                   || 0,
    total_potential_profit:       parseFloat(raw.total_potential_profit)     || 0,
    potential_profit_searchable:  parseFloat(raw.potential_profit_searchable)|| 0,
    avg_discount:                 parseFloat(raw.avg_discount)               || 0,
    avg_score:                    parseFloat(raw.avg_score)                  || 0,
    fresh_24h:                    parseInt(raw.fresh_24h)                    || 0,
    recent_7d:                    parseInt(raw.recent_7d)                    || 0,
    aging_30d:                    parseInt(raw.aging_30d)                    || 0,
    historical_45d:               parseInt(raw.historical_45d)               || 0,
    stores_with_fresh_deals:      parseInt(raw.stores_with_fresh_deals)      || 0,
  };
}

const SCORE_BANDS = (stats) => [
  { label: 'Excellent', range: '91–100', count: stats.excellent_deals,                                     color: '#00ff88' },
  { label: 'Good',      range: '71–90',  count: Math.max(0, stats.good_deals - stats.excellent_deals),    color: '#00d4ff' },
  { label: 'Fair',      range: '41–70',  count: Math.max(0, stats.total_deals - stats.good_deals),        color: '#fbbf24' },
  { label: 'Skip',      range: '0–40',   count: 0,                                                        color: '#6b7280' },
];

export default function Dashboard() {
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;

  const [stats, setStats] = useState(null);
  const [deals, setDeals] = useState([]);
  const [totalDeals, setTotalDeals] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filters, setFilters] = useState({ store: '', min_discount: '20', sort: 'freshness', category: '', freshness: '' });
  const [searchQ, setSearchQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchQ), 300);
    return () => clearTimeout(t);
  }, [searchQ]);

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    setOffset(0);
    setDeals([]);
    fetchDeals(0, debouncedQ);
  }, [filters, activeTab, debouncedQ]); // eslint-disable-line

  async function fetchData() {
    try {
      const [sr, dr] = await Promise.all([
        api.get('/deals/stats'),
        api.get('/deals', { params: { ...filters, limit: LIMIT, offset: 0 } }),
      ]);
      setStats(parseStats(sr.data));
      setDeals(dr.data.deals || []);
      setTotalDeals(dr.data.total || 0);
    } catch (err) {
      console.error('Dashboard fetchData error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchDeals(startOffset, q = '') {
    try {
      const params = { ...filters, limit: LIMIT, offset: startOffset };
      if (q) params.q = q;
      if (activeTab === 'error') params.is_error_price = 'true';
      if (activeTab === 'top')   params.min_score = 91;
      const r = await api.get('/deals', { params });
      const newDeals = r.data.deals || [];
      if (startOffset === 0) {
        setDeals(newDeals);
      } else {
        setDeals(prev => [...prev, ...newDeals]);
      }
      setTotalDeals(r.data.total || 0);
    } catch {
      if (startOffset === 0) setDeals([]);
    }
  }

  async function handleLoadMore() {
    const nextOffset = offset + LIMIT;
    setLoadingMore(true);
    await fetchDeals(nextOffset, debouncedQ);
    setOffset(nextOffset);
    setLoadingMore(false);
  }

  async function handleRefresh() {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-6 h-6 border-2 border-neon-green border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!stats) return (
    <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
      Could not load dashboard data.
    </div>
  );

  const activeStores = (stats.top_stores || []).filter(s => parseInt(s.deal_count) > 0);
  const allCategories = (stats.top_categories || []).filter(c => parseInt(c.deal_count) > 0);

  const storeData = activeStores.map(s => ({
    name: s.name,
    deals: parseInt(s.deal_count) || 0,
    color: s.color || '#6b7280',
  }));

  const trendData = (stats.daily_trend || []).map(row => ({
    day:    new Date(row.day).toLocaleDateString('en-US', { weekday: 'short' }),
    deals:  parseInt(row.deals)         || 0,
    profit: parseFloat(row.profit || 0),
  }));
  const hasTrend = trendData.some(r => r.deals > 0);

  const topCat    = (stats.top_categories || [])[0];
  const highScore = stats.good_deals || 0;
  const insightText = topCat
    ? `${highScore} high-score deals active. Top category: ${topCat.name} (${parseInt(topCat.deal_count)} deals, ~$${parseFloat(topCat.avg_profit || 0).toFixed(0)} avg profit).`
    : `${highScore} high-score deals (score ≥ 71) available right now. Check AI Recommendations for personalized picks.`;

  const searchableCount = stats.searchable_deals_default || stats.total_deals;
  const hasMore = deals.length < totalDeals;

  return (
    <div className="p-4 lg:p-6 space-y-5 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Deal Dashboard</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            <span className="text-neon-green font-semibold">{searchableCount.toLocaleString()}</span>
            {' '}deals available
            {stats.new_today > 0 && <> · <span className="text-neon-green">+{stats.new_today} today</span></>}
            {isAdmin && <span className="text-gray-600"> · {stats.total_db_deals.toLocaleString()} cataloged</span>}
          </p>
        </div>
        <button onClick={handleRefresh} disabled={refreshing}
          className="btn-ghost flex items-center gap-2 text-sm">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Admin internal metrics banner */}
      {isAdmin && (
        <div className="bg-dark-800 rounded-xl p-3 border border-yellow-500/20 flex flex-wrap gap-x-5 gap-y-1.5 items-center">
          <div className="flex items-center gap-1.5 text-yellow-400 text-xs font-semibold">
            <Shield size={12} /> Admin
          </div>
          {[
            { label: 'Cataloged', value: stats.total_db_deals.toLocaleString() },
            { label: 'Products',  value: stats.total_products.toLocaleString() },
            { label: 'Searchable ≥20%', value: searchableCount.toLocaleString() },
            { label: 'Low Discount <20%', value: stats.low_discount_deals.toLocaleString() },
            { label: 'Error Prices', value: stats.error_prices },
            { label: 'Stores Active', value: activeStores.length },
          ].map(m => (
            <span key={m.label} className="text-xs text-gray-500">
              {m.label}: <span className="text-white font-mono">{m.value}</span>
            </span>
          ))}
        </div>
      )}

      {/* Stat Cards — user-facing (searchable metrics) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<Flame size={18} />}
          title="Searchable Deals"
          value={searchableCount.toLocaleString()}
          sub={`+${stats.new_this_hour} this hour`}
          color="green"
        />
        <StatCard icon={<Star size={18} />}        title="High-Score Deals" value={stats.good_deals}  sub="Score 71+"  color="yellow" />
        <StatCard
          icon={<DollarSign size={18} />}
          title="Potential Profit"
          value={`$${(stats.potential_profit_searchable / 1000).toFixed(1)}k`}
          sub="From searchable deals"
          color="blue"
        />
        <StatCard icon={<AlertTriangle size={18} />} title="Error Prices" value={stats.error_prices} sub="Pricing mistakes" color="red" />
      </div>

      {/* Freshness Breakdown */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Verified Today', count: stats.fresh_24h,      color: '#00ff88', icon: <CheckCircle size={12} />, title: 'Seen in last 24h' },
          { label: 'This Week',      count: stats.recent_7d,      color: '#00d4ff', icon: <Clock size={12} />,       title: 'Seen 1–7 days ago' },
          { label: 'Needs Recheck', count: stats.aging_30d,      color: '#fbbf24', icon: <AlertCircle size={12} />, title: 'Seen 7–30 days ago' },
          { label: 'Historical',    count: stats.historical_45d, color: '#ef4444', icon: <AlertTriangle size={12} />, title: '30+ days — verify before buying' },
        ].map(f => (
          <div key={f.label} title={f.title}
            className="bg-dark-700 rounded-xl p-3 flex flex-col gap-1"
            style={{ border: `1px solid rgba(255,255,255,0.06)`, borderLeft: `3px solid ${f.color}` }}>
            <div className="flex items-center gap-1.5" style={{ color: f.color }}>
              {f.icon}
              <span className="text-xs font-medium">{f.label}</span>
            </div>
            <div className="text-lg font-black font-mono" style={{ color: f.count > 0 ? '#fff' : '#6b7280' }}>
              {f.count > 0 ? f.count.toLocaleString() : <span className="text-base">—</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Score Distribution */}
      <div className="grid grid-cols-4 gap-2">
        {SCORE_BANDS(stats).map(s => (
          <div key={s.label}
            className="bg-dark-700 rounded-xl p-3 text-center"
            style={{ border: `1px solid rgba(255,255,255,0.08)`, borderTopWidth: '2px', borderTopColor: s.color }}>
            <div className="text-xl font-black font-mono" style={{ color: s.color }}>
              {s.count > 0 ? s.count : <span className="text-gray-500 text-base">—</span>}
            </div>
            <div className="text-gray-300 text-xs font-medium mt-0.5">{s.label}</div>
            <div className="text-gray-500 text-xs">{s.range}</div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-dark-700 rounded-2xl p-5" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
          <h3 className="text-white font-semibold text-sm mb-4">Deals by Store</h3>
          {storeData.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-gray-400 text-sm">No store data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={storeData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#0f0f1a', border: '1px solid #22223a', borderRadius: 8, color: '#fff', fontSize: 12 }} formatter={(v) => [v, 'Deals']} />
                <Bar dataKey="deals" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {storeData.map((s, i) => <Cell key={i} fill={s.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-dark-700 rounded-2xl p-5" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
          <h3 className="text-white font-semibold text-sm mb-4">7-Day Deal Trend</h3>
          {!hasTrend ? (
            <div className="h-40 flex items-center justify-center text-gray-400 text-sm">No trend data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={trendData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#0f0f1a" strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#0f0f1a', border: '1px solid #22223a', borderRadius: 8, color: '#fff', fontSize: 12 }} formatter={(v, name) => [name === 'profit' ? `$${parseFloat(v).toFixed(0)}` : v, name === 'profit' ? 'Profit' : 'Deals']} />
                <Line type="monotone" dataKey="deals"  stroke="#00ff88" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="profit" stroke="#00d4ff" strokeWidth={1.5} dot={false} strokeDasharray="4 2" isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Top Categories */}
      {(() => {
        const cats = allCategories
          .map(cat => ({
            name:       cat.name,
            slug:       cat.slug,
            deal_count: parseInt(cat.deal_count) || 0,
            avg_profit: cat.avg_profit != null ? parseFloat(cat.avg_profit) : null,
          }))
          .filter(c => c.deal_count > 0)
          .slice(0, 8);

        if (!cats.length) return null;

        return (
          <div>
            <h3 className="text-white font-semibold text-sm mb-3">Top Categories</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {cats.map(cat => (
                <button key={cat.slug}
                  onClick={() => setFilters(f => ({ ...f, category: f.category === cat.slug ? '' : cat.slug }))}
                  className={`bg-dark-700 rounded-xl border p-4 transition-all text-left group ${
                    filters.category === cat.slug
                      ? 'border-neon-green/60 bg-neon-green/5'
                      : 'border-dark-400 hover:border-neon-green/30'
                  }`}>
                  <p className={`font-semibold text-sm transition-colors ${filters.category === cat.slug ? 'text-neon-green' : 'text-white group-hover:text-neon-green'}`}>{cat.name}</p>
                  <p className="text-gray-500 text-xs mt-1">{cat.deal_count} deals</p>
                  {cat.avg_profit != null && (
                    <p className="text-neon-green text-sm font-bold mt-2">~${cat.avg_profit.toFixed(0)} profit</p>
                  )}
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Deals Feed */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex gap-1.5">
            {[
              ['all',   'All Deals'],
              ['top',   '🔥 Score 91+'],
              ['error', '⚠️ Price Errors'],
            ].map(([id, label]) => (
              <button key={id} onClick={() => setActiveTab(id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                  activeTab === id
                    ? 'bg-neon-green text-dark-900 border-neon-green'
                    : 'bg-dark-700 border-dark-400 text-gray-300 hover:text-white hover:border-dark-300'
                }`}>
                {label}
              </button>
            ))}
          </div>
          <Link to="/search" className="text-neon-green text-xs flex items-center gap-1 hover:underline">
            View all <ArrowRight size={13} />
          </Link>
        </div>

        {/* Search input */}
        <div className="relative mb-2">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input
            type="text"
            placeholder="Search deals… laptop, Sony, Milwaukee, DeWalt"
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            className="w-full bg-dark-700 border border-dark-400 rounded-xl pl-9 pr-10 py-2.5 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-neon-green transition-colors"
          />
          {searchQ && (
            <button onClick={() => setSearchQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors">
              <X size={14} />
            </button>
          )}
        </div>

        {/* FilterBar */}
        <div className="bg-dark-800/60 rounded-xl border border-dark-500 px-4">
          <FilterBar
            filters={filters}
            onChange={setFilters}
            stores={activeStores}
            categories={allCategories}
          />
        </div>

        {/* Results count */}
        <p className="text-gray-600 text-xs mt-3 mb-1">
          Showing deals that match your current filters.{' '}
          <span className="text-gray-500">{deals.length} of {totalDeals.toLocaleString()}</span>
          {debouncedQ ? <> for <span className="text-gray-400">"{debouncedQ}"</span></> : ''}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-2">
          {deals.length === 0
            ? <div className="col-span-3 text-center py-12 text-gray-600 text-sm">No deals match these filters</div>
            : deals.map(deal => <DealCard key={deal.id} deal={deal} />)
          }
        </div>

        {/* Load More */}
        {hasMore && (
          <div className="flex flex-col items-center gap-2 pt-6">
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="btn-ghost flex items-center gap-2 text-sm px-8 py-2.5 disabled:opacity-50">
              {loadingMore ? <div className="w-4 h-4 border-2 border-neon-green border-t-transparent rounded-full animate-spin" /> : null}
              {loadingMore ? 'Loading…' : `Load More (${totalDeals - deals.length} remaining)`}
            </button>
          </div>
        )}
      </div>

      {/* AI Insight */}
      <div className="bg-neon-blue/5 rounded-2xl border border-neon-blue/20 flex items-center gap-4 p-4">
        <div className="w-10 h-10 rounded-xl bg-neon-blue/15 flex items-center justify-center flex-shrink-0">
          <Brain size={20} className="text-neon-blue" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-sm flex items-center gap-2">
            <TrendingUp size={13} className="text-neon-blue" /> AI Insight
          </p>
          <p className="text-gray-400 text-xs mt-0.5 leading-relaxed">{insightText}</p>
        </div>
        <Link to="/recommendations" className="text-neon-blue text-xs font-semibold hover:underline flex-shrink-0">
          View →
        </Link>
      </div>

    </div>
  );
}
