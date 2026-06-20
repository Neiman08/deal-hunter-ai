import { useState, useEffect } from 'react';
import {
  BarChart2, Users, CheckCircle, TrendingUp, Gift,
  Wallet, Zap, Target, GraduationCap, RefreshCw, Shield,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import api from '../utils/api';

const TRUST_COLOR = {
  'Excelente':      '#4ADE80',
  'Bueno':          '#60A5FA',
  'Normal':         '#9CA3AF',
  'En observación': '#FBBF24',
  'Suspendido':     '#F43F5E',
};

const KPI_CONFIG = [
  { key: 'active_hunters',     label: 'Active Hunters',     icon: Users,          color: '#4ADE80', fmt: v => v.toLocaleString() },
  { key: 'deals_submitted',    label: 'Deals Submitted',    icon: TrendingUp,     color: '#60A5FA', fmt: v => v.toLocaleString() },
  { key: 'deals_verified',     label: 'Deals Verified',     icon: CheckCircle,    color: '#4ADE80', fmt: v => v.toLocaleString() },
  { key: 'avg_roi',            label: 'Avg ROI',            icon: BarChart2,      color: '#FBBF24', fmt: v => `${v || 0}%` },
  { key: 'new_referrals',      label: 'New Referrals',      icon: Gift,           color: '#C084FC', fmt: v => v.toLocaleString() },
  { key: 'wallet_points',      label: 'Wallet Points',      icon: Wallet,         color: '#F97316', fmt: v => v.toLocaleString() },
  { key: 'xp_generated',       label: 'XP Generated',       icon: Zap,            color: '#4ADE80', fmt: v => v.toLocaleString() },
  { key: 'missions_completed', label: 'Missions Done',      icon: Target,         color: '#60A5FA', fmt: v => v.toLocaleString() },
  { key: 'courses_completed',  label: 'Courses Done',       icon: GraduationCap,  color: '#C084FC', fmt: v => v.toLocaleString() },
];

function KpiCard({ cfg, value }) {
  const Icon = cfg.icon;
  return (
    <div className="bg-dark-800/60 rounded-2xl p-4 border border-dark-700">
      <div className="flex items-center justify-between mb-2">
        <p className="text-gray-400 text-xs">{cfg.label}</p>
        <Icon size={15} style={{ color: cfg.color }} className="opacity-70" />
      </div>
      <p className="text-white font-black text-2xl leading-none">{cfg.fmt(value || 0)}</p>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-dark-800 border border-dark-600 rounded-xl px-3 py-2">
      <p className="text-gray-400 text-xs">{label}</p>
      <p className="text-neon-green font-bold text-sm">{payload[0]?.value} deals</p>
    </div>
  );
};

export default function BusinessStats() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('week');

  async function load(p) {
    setLoading(true);
    try {
      const r = await api.get(`/business/stats?period=${p || period}`);
      setData(r.data);
    } catch (_) {}
    setLoading(false);
  }

  useEffect(() => { load(period); }, [period]);

  const PERIODS = [
    { val: 'day',   label: 'Today' },
    { val: 'week',  label: 'This Week' },
    { val: 'month', label: 'This Month' },
  ];

  const chartData = (data?.chart_deals || []).map(row => ({
    day: new Date(row.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    deals: parseInt(row.deals),
  }));

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-3">
            <BarChart2 size={22} className="text-neon-green" /> Business Stats
          </h1>
          {data?.profile && (
            <div className="flex items-center gap-2 mt-1">
              <p className="text-gray-400 text-sm">{data.profile.level}</p>
              <span className="text-gray-600">·</span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                style={{ background: `${TRUST_COLOR[data.profile.trust_level] || '#9CA3AF'}18`, color: TRUST_COLOR[data.profile.trust_level] || '#9CA3AF' }}>
                <Shield size={9} /> {data.profile.trust_level || 'Normal'}
              </span>
            </div>
          )}
        </div>
        <button onClick={() => load(period)}
          className={`p-2 rounded-lg border border-dark-700 text-gray-400 hover:text-white transition-colors ${loading ? 'animate-spin' : ''}`}>
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Period selector */}
      <div className="flex gap-2 p-1 bg-dark-800 rounded-xl w-fit">
        {PERIODS.map(p => (
          <button key={p.val} onClick={() => setPeriod(p.val)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              period === p.val ? 'bg-neon-green text-dark-900' : 'text-gray-400 hover:text-white'
            }`}>
            {p.label}
          </button>
        ))}
      </div>

      {/* KPI grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[1,2,3,4,5,6,7,8,9].map(i => (
            <div key={i} className="h-24 rounded-2xl bg-dark-800 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {KPI_CONFIG.map(cfg => (
            <KpiCard key={cfg.key} cfg={cfg} value={data?.kpis?.[cfg.key] || 0} />
          ))}
        </div>
      )}

      {/* Team summary */}
      {data?.team && (
        <div className="card border border-dark-700 bg-dark-800/60 rounded-2xl p-4">
          <p className="text-gray-400 text-xs uppercase tracking-wider mb-3 font-semibold">My Team</p>
          <div className="flex items-center gap-4">
            <div>
              <p className="text-white font-bold">{data.team.name}</p>
              <p className="text-gray-500 text-xs">{data.team.member_count} members</p>
            </div>
            <div className="ml-auto grid grid-cols-2 gap-4 text-right">
              <div>
                <p className="text-neon-green font-black">{(data.team.total_xp || 0).toLocaleString()}</p>
                <p className="text-gray-500 text-[10px]">Team XP</p>
              </div>
              <div>
                <p className="text-neon-blue font-black">{data.team.total_deals || 0}</p>
                <p className="text-gray-500 text-[10px]">Deals</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="bg-dark-800/60 rounded-2xl border border-dark-700 p-4">
          <p className="text-gray-400 text-xs uppercase tracking-wider mb-4 font-semibold">Deals Submitted — Last 14 Days</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
              <XAxis dataKey="day" tick={{ fill: '#6B7280', fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#6B7280', fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(74,222,128,0.05)' }} />
              <Bar dataKey="deals" fill="#4ADE80" radius={[4,4,0,0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {!loading && chartData.length === 0 && (
        <div className="bg-dark-800/60 rounded-2xl border border-dark-700 p-8 text-center">
          <BarChart2 size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400 font-semibold">No deal activity yet</p>
          <p className="text-gray-600 text-sm mt-1">Submit deals via Scanner to see your stats here.</p>
        </div>
      )}
    </div>
  );
}
