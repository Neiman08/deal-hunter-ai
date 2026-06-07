import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Flame, TrendingUp, DollarSign, Zap, RefreshCw,
  AlertTriangle, ArrowRight, Star, Brain
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LineChart, Line, CartesianGrid } from 'recharts';
import api from '../utils/api';
import StatCard from '../components/StatCard';
import DealCard from '../components/DealCard';
import FilterBar from '../components/FilterBar';


export default function Dashboard() {
  const [stats, setStats] = useState({
    total_deals: 0, new_today: 0, new_this_hour: 0, error_prices: 0,
    total_potential_profit: 0, excellent_deals: 0, good_deals: 0,
    top_stores: [], top_categories: [],
  });
  const [deals, setDeals] = useState([]);
  const [trends, setTrends] = useState([]);
  const [filters, setFilters] = useState({ store: '', min_discount: '20', sort: 'score' });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => { fetchData(); }, []);
  useEffect(() => { fetchDeals(); }, [filters, activeTab]);

  async function fetchData() {
    setLoading(true);
    try {
      const [statsRes, dealsRes, trendsRes] = await Promise.all([
        api.get('/deals/stats'),
        api.get('/deals', { params: { ...filters, limit: 12 } }),
        api.get('/deals/stats/trends'),
      ]);
      setStats(statsRes.data);
      setDeals(dealsRes.data.deals || []);
      setTrends(trendsRes.data.trends || []);
    } catch (err) {
      console.error('Dashboard API error:', err);
      setDeals([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchDeals() {
    try {
      const params = { ...filters, limit: 12 };
      if (activeTab === 'error') params.is_error_price = 'true';
      if (activeTab === 'top') params.min_score = 90;
      const r = await api.get('/deals', { params });
      setDeals(r.data.deals || []);
    } catch (err) {
      console.error('Deals API error:', err);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }

  const fmt = (n) => isNaN(n) || n == null ? '—' : n;

  return (
    <div className="p-4 lg:p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Deal Dashboard</h1>
          <p style={{ color: '#CBD5E1' }} className="text-sm mt-0.5">
            {stats.total_deals} active deals · {stats.new_today} new today
          </p>
        </div>
        <button onClick={handleRefresh} disabled={refreshing} className="btn-ghost flex items-center gap-2 text-sm">
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={<Flame size={18} />} title="Active Deals" value={fmt(stats.total_deals)} sub={`+${fmt(stats.new_this_hour)} this hour`} color="green" />
        <StatCard icon={<AlertTriangle size={18} />} title="Error Prices" value={fmt(stats.error_prices)} sub="Pricing mistakes" color="red" />
        <StatCard icon={<DollarSign size={18} />} title="Potential Profit" value={`$${((parseFloat(stats.total_potential_profit) || 0) / 1000).toFixed(1)}k`} sub="Combined deals" color="blue" />
        <StatCard icon={<Star size={18} />} title="Excellent Deals" value={fmt(stats.excellent_deals)} sub="Score 91+" color="yellow" />
      </div>

      {/* Score Distribution */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Excellent', range: '91–100', count: stats.excellent_deals, color: '#00ff88' },
          { label: 'Good', range: '71–90', count: Math.max(0, (stats.good_deals || 0) - (stats.excellent_deals || 0)), color: '#00d4ff' },
          { label: 'Average', range: '41–70', count: Math.max(0, (stats.total_deals || 0) - (stats.good_deals || 0)), color: '#fbbf24' },
          { label: 'Skip', range: '0–40', count: 0, color: '#ef4444' },
        ].map(s => (
          <div key={s.label} className="card py-3 text-center">
            <div className="text-xl font-bold" style={{ color: s.color }}>{s.count || '—'}</div>
            <div style={{ color: '#CBD5E1' }} className="text-xs mt-0.5">{s.label}</div>
            <div style={{ color: '#94A3B8' }} className="text-xs">{s.range}</div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Deals by store */}
        <div className="card">
          <h3 className="text-white font-bold mb-4">Deals by Store</h3>
          {stats.top_stores?.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={stats.top_stores} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fill: '#FFFFFF', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#FFFFFF', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#111119', border: '1px solid #2a2a3a', borderRadius: 8, color: '#fff' }} />
                <Bar dataKey="deal_count" radius={[4, 4, 0, 0]}>
                  {stats.top_stores.map((s, i) => <Cell key={i} fill={s.color || '#4ADE80'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-40 flex items-center justify-center">
              <p className="text-sm" style={{ color: '#64748B' }}>No store data yet</p>
            </div>
          )}
        </div>

        {/* 7-day trend */}
        <div className="card">
          <h3 className="text-white font-bold mb-4">7-Day Deal Trend</h3>
          {trends.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={trends} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#1a1a2e" strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fill: '#FFFFFF', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#FFFFFF', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#111119', border: '1px solid #2a2a3a', borderRadius: 8, color: '#fff' }} />
                <Line type="monotone" dataKey="deals" stroke="#00ff88" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-40 flex items-center justify-center">
              <p className="text-sm" style={{ color: '#64748B' }}>No trend data yet</p>
            </div>
          )}
        </div>
      </div>

      {/* Top categories */}
      {stats.top_categories?.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {stats.top_categories.map(cat => (
            <div key={cat.slug || cat.name} className="card hover:border-neon-green/30 transition-colors cursor-pointer">
              <p className="text-white font-medium text-sm">{cat.name}</p>
              <p style={{ color: '#94A3B8' }} className="text-xs mt-1">{cat.deal_count} deals</p>
              <p className="text-neon-green text-sm font-semibold mt-2">~${Math.round(parseFloat(cat.avg_profit || 0))} avg profit</p>
            </div>
          ))}
        </div>
      )}

      {/* Deals feed */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-2">
            {[['all', 'All Deals'], ['top', '🔥 Score 91+'], ['error', '⚠️ Price Errors']].map(([id, label]) => (
              <button key={id} onClick={() => setActiveTab(id)}
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${activeTab === id ? 'bg-neon-green text-dark-900 font-semibold' : 'text-dark-300 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>
          <Link to="/search" className="text-neon-green text-sm flex items-center gap-1 hover:underline">
            View all <ArrowRight size={14} />
          </Link>
        </div>

        <FilterBar filters={filters} onChange={setFilters} />

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-7 h-7 border-2 border-neon-green border-t-transparent rounded-full animate-spin" />
          </div>
        ) : deals.length === 0 ? (
          <div className="card p-10 text-center mt-4">
            <p className="text-3xl mb-3">🔍</p>
            <p className="text-white font-semibold">No live deals found yet</p>
            <p style={{ color: '#94A3B8' }} className="text-sm mt-1">Run scanner to discover deals.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
            {deals.map(deal => <DealCard key={deal.id} deal={deal} />)}
          </div>
        )}
      </div>

      {/* AI insight */}
      <div className="card border-neon-blue/30 bg-neon-blue/5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-neon-blue/20 flex items-center justify-center flex-shrink-0">
          <Brain size={20} className="text-neon-blue" />
        </div>
        <div className="flex-1">
          <p className="text-white font-medium text-sm">AI Insight</p>
          <p style={{ color: '#94A3B8' }} className="text-xs">
            {stats.excellent_deals > 0
              ? `${stats.excellent_deals} excellent deals (91+ score) available now. Check Pro Hunter for ranked opportunities.`
              : 'Run the scanner to find deals. Pro Hunter will rank them automatically.'}
          </p>
        </div>
        <Link to="/recommendations" className="text-neon-blue text-xs hover:underline flex-shrink-0">View →</Link>
      </div>
    </div>
  );
}
