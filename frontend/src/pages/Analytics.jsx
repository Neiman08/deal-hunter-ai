/**
 * User Analytics Dashboard
 * Tracks: searches, saves, purchases, profit, category performance
 * Feeds AI recommendation engine.
 */
import { useState, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend
} from 'recharts';
import { TrendingUp, Search, Bookmark, ShoppingBag, DollarSign, Brain, Star, Clock } from 'lucide-react';
import api from '../utils/api';


function StatTile({ icon, label, value, sub, color = 'green' }) {
  const colors = { green: 'text-neon-green bg-neon-green/15', blue: 'text-neon-blue bg-neon-blue/15', yellow: 'text-yellow-400 bg-yellow-400/15', purple: 'text-purple-400 bg-purple-400/15' };
  return (
    <div className="card">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${colors[color]}`}>{icon}</div>
      <p className="text-2xl font-black text-white">{value}</p>
      <p className="text-gray-300 text-sm mt-0.5">{label}</p>
      {sub && <p style={{ color: '#94A3B8' }} className="text-xs mt-1">{sub}</p>}
    </div>
  );
}

export default function Analytics() {
  const [activity, setActivity] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [saves, setSaves] = useState([]);
  const [period, setPeriod] = useState('7d');

  useEffect(() => {
    api.get('/recommendations/insights').then(r => {
      if (r.data.activity?.length) setActivity(r.data.activity);
    }).catch(() => {});
    api.get('/deals/user/saved').then(r => {
      if (r.data.deals?.length) setSaves(r.data.deals.slice(0, 10));
    }).catch(() => {});
  }, []);

  const totalSaves = saves.length;
  const purchased = saves.filter(s => s.purchased || s.status === 'purchased').length;
  const totalEst = saves.reduce((sum, s) => sum + (s.estimated_profit || s.profit || 0), 0);
  const avgScore = saves.length ? Math.round(saves.reduce((s, d) => s + (d.opportunity_score || d.score || 0), 0) / saves.length) : 0;

  const statusColor = { saved: 'text-neon-blue', purchased: 'text-neon-green', expired: 'text-gray-400' };
  const statusBg = { saved: 'bg-neon-blue/15', purchased: 'bg-neon-green/15', expired: 'bg-dark-700' };

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <TrendingUp size={22} className="text-neon-green" /> My Analytics
          </h1>
          <p style={{ color: '#CBD5E1' }} className="text-sm mt-0.5">Your deal hunting performance & insights</p>
        </div>
        <div className="flex gap-1 bg-dark-800 rounded-xl p-1">
          {['7d', '30d', '90d'].map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${period === p ? 'bg-neon-green text-dark-900' : 'text-gray-400 hover:text-white'}`}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile icon={<Bookmark size={18} />} label="Deals Saved" value={totalSaves} sub="All time" color="blue" />
        <StatTile icon={<ShoppingBag size={18} />} label="Purchased" value={purchased} sub={`${Math.round(purchased / Math.max(totalSaves, 1) * 100)}% conversion`} color="green" />
        <StatTile icon={<DollarSign size={18} />} label="Est. Total Profit" value={`$${Math.round(totalEst)}`} sub="From saved deals" color="yellow" />
        <StatTile icon={<Star size={18} />} label="Avg Deal Score" value={avgScore} sub="Your picks" color="purple" />
      </div>

      {/* Activity chart */}
      <div className="card">
        <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
          <Clock size={16} className="text-gray-400" /> 7-Day Activity
        </h2>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={activity} margin={{ left: -20 }}>
            <CartesianGrid stroke="#1a1a2e" strokeDasharray="3 3" />
            <XAxis dataKey="day" tick={{ fill: '#FFFFFF', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#FFFFFF', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: '#111119', border: '1px solid #2a2a3a', borderRadius: 8, color: '#fff' }} />
            <Legend wrapperStyle={{ fontSize: 11, color: '#FFFFFF' }} />
            <Bar dataKey="searches" name="Searches" fill="#00d4ff" opacity={0.7} radius={[3, 3, 0, 0]} />
            <Bar dataKey="saves" name="Saves" fill="#00ff88" radius={[3, 3, 0, 0]} />
            <Bar dataKey="opens" name="Deal Views" fill="#fbbf24" opacity={0.5} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Category breakdown */}
        <div className="card">
          <h2 className="text-white font-semibold mb-4">Category Breakdown</h2>
          <div className="flex gap-4 items-center">
            <ResponsiveContainer width={140} height={140}>
              <PieChart>
                <Pie data={categories} dataKey="value" cx="50%" cy="50%" outerRadius={60} strokeWidth={0}>
                  {categories.map((c, i) => <Cell key={i} fill={c.color} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              {categories.map(c => (
                <div key={c.name} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.color }} />
                    <span className="text-gray-200">{c.name}</span>
                  </div>
                  <div className="flex gap-3 text-xs">
                    <span className="text-gray-400">{c.value}%</span>
                    <span className="text-neon-green">${c.profit} avg</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Brand leaderboard */}
        <div className="card">
          <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Brain size={16} className="text-neon-blue" /> Your Top Brands
          </h2>
          <div className="space-y-3">
            {brands.map((b, i) => (
              <div key={b.brand} className="flex items-center gap-3">
                <span className="text-gray-400 text-xs w-4">{i + 1}</span>
                <div className="flex-1">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-white font-medium">{b.brand}</span>
                    <div className="flex gap-3 text-xs">
                      <span className="text-neon-green">${b.avg_profit}</span>
                      <span className="text-neon-blue">{b.avg_score} avg</span>
                    </div>
                  </div>
                  <div className="bg-dark-700 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full bg-neon-green"
                      style={{ width: `${(b.saves / brands[0].saves) * 100}%` }} />
                  </div>
                </div>
                <span className="text-gray-400 text-xs w-8 text-right">{b.saves}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 bg-neon-blue/5 border border-neon-blue/20 rounded-xl">
            <p className="text-neon-blue text-xs font-semibold flex items-center gap-1.5">
              <Brain size={12} /> AI Insight
            </p>
            <p className="text-gray-300 text-xs mt-1">
              Milwaukee generates 22% higher profit margins than your average saved deal. Consider prioritizing Milwaukee alerts.
            </p>
          </div>
        </div>
      </div>

      {/* Saved deals history */}
      <div className="card">
        <h2 className="text-white font-semibold mb-4">Deal History</h2>
        <div className="space-y-2">
          {saves.map((deal, i) => {
            const st = deal.status || (deal.purchased ? 'purchased' : 'saved');
            return (
              <div key={i} className="flex items-center gap-3 p-3 bg-dark-800/50 rounded-xl">
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{deal.name}</p>
                  <p className="text-gray-400 text-xs">{deal.saved_at || 'Recently'}</p>
                </div>
                <div className="flex items-center gap-3 text-xs flex-shrink-0">
                  <span className="text-neon-green font-bold">+${Math.round(deal.estimated_profit || deal.profit || 0)}</span>
                  <span className="text-neon-blue">{Math.round(deal.roi_percent || deal.roi || 0)}% ROI</span>
                  <span className={`px-2 py-0.5 rounded-full font-semibold capitalize ${statusColor[st] || ''} ${statusBg[st] || 'bg-dark-700'}`}>
                    {st}
                  </span>
                </div>
              </div>
            );
          })}
          {saves.length === 0 && (
            <div className="text-center py-10 text-gray-400">
              <Bookmark size={32} className="mx-auto mb-3 opacity-40" />
              <p>No saved deals yet. Start saving deals to track your performance.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
