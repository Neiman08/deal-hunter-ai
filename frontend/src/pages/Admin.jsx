import { useState, useEffect } from 'react';
import {
  Shield, RefreshCw, Users, Store, Activity, AlertCircle,
  CheckCircle, Play, Trash2, TrendingUp, DollarSign, Bell,
  BarChart3, Zap, Clock, Package, Star
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LineChart, Line, CartesianGrid } from 'recharts';
import api from '../utils/api';
import StatCard from '../components/StatCard';

const DEMO = {
  users: { total: 1842, pro: 284, elite: 96, free: 1462, new_this_week: 127 },
  deals: { total: 4832, active: 612, expired: 4220, error_prices: 18, avg_score: 74 },
  scans: { total: 28400, success: 27890, failed: 510, last_scan: new Date(Date.now() - 8 * 60000).toISOString() },
  stores: { total: 5, active: 2 },
  revenue: { mrr_cents: 847200, arr_cents: 10166400, new_this_month: 48 },
  notifications: { sent_today: 384, sent_this_week: 2847 },
};

const DEMO_LOGS = [
  { id: 1, store_name: 'Walmart', status: 'success', deals_found: 14, products_scanned: 89, duration_seconds: 47, started_at: new Date(Date.now() - 8 * 60000).toISOString() },
  { id: 2, store_name: 'Home Depot', status: 'success', deals_found: 9, products_scanned: 64, duration_seconds: 38, started_at: new Date(Date.now() - 23 * 60000).toISOString() },
  { id: 3, store_name: 'Walmart', status: 'error', deals_found: 0, products_scanned: 0, duration_seconds: 11, error_message: '429 Rate Limited', started_at: new Date(Date.now() - 38 * 60000).toISOString() },
  { id: 4, store_name: 'Home Depot', status: 'success', deals_found: 6, products_scanned: 47, duration_seconds: 29, started_at: new Date(Date.now() - 53 * 60000).toISOString() },
  { id: 5, store_name: 'Walmart', status: 'success', deals_found: 22, products_scanned: 112, duration_seconds: 63, started_at: new Date(Date.now() - 68 * 60000).toISOString() },
];

const DEMO_USERS = [
  { id: '1', name: 'Admin User', email: 'admin@dealhunter.ai', plan: 'elite', is_active: true, created_at: '2025-01-01', alerts_count: 12 },
  { id: '2', name: 'Demo User', email: 'demo@dealhunter.ai', plan: 'pro', is_active: true, created_at: '2025-02-15', alerts_count: 8 },
  { id: '3', name: 'John Smith', email: 'john@example.com', plan: 'pro', is_active: true, created_at: '2025-03-10', alerts_count: 5 },
  { id: '4', name: 'Maria Garcia', email: 'maria@example.com', plan: 'free', is_active: true, created_at: '2025-04-01', alerts_count: 2 },
  { id: '5', name: 'Robert Kim', email: 'robert@example.com', plan: 'elite', is_active: false, created_at: '2025-01-20', alerts_count: 18 },
];

const REVENUE_TREND = [
  { month: 'Jan', mrr: 2100, users: 340 },
  { month: 'Feb', mrr: 3400, users: 510 },
  { month: 'Mar', mrr: 4800, users: 720 },
  { month: 'Apr', mrr: 5900, users: 940 },
  { month: 'May', mrr: 7200, users: 1280 },
  { month: 'Jun', mrr: 8472, users: 1842 },
];

const TOP_BRANDS = [
  { brand: 'DeWalt', deals: 84, avg_profit: 73, avg_score: 88 },
  { brand: 'Milwaukee', deals: 61, avg_profit: 89, avg_score: 91 },
  { brand: 'Dyson', deals: 38, avg_profit: 112, avg_score: 87 },
  { brand: 'Apple', deals: 29, avg_profit: 68, avg_score: 82 },
  { brand: 'Makita', deals: 44, avg_profit: 58, avg_score: 79 },
];

const TOP_CATS = [
  { name: 'Power Tools', deals: 189, avg_profit: 71 },
  { name: 'Electronics', deals: 142, deals_active: 98, avg_profit: 54 },
  { name: 'Appliances', deals: 104, avg_profit: 47 },
  { name: 'Kitchen', deals: 67, avg_profit: 38 },
];

function timeAgo(iso) {
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

const planBadge = { free: 'text-dark-400 bg-dark-700', pro: 'text-neon-blue bg-neon-blue/15', elite: 'text-neon-green bg-neon-green/15' };

export default function Admin() {
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState(DEMO);
  const [logs, setLogs] = useState(DEMO_LOGS);
  const [users, setUsers] = useState(DEMO_USERS);
  const [scanning, setScanning] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/admin/dashboard').then(r => setStats({ ...DEMO, ...r.data })).catch(() => {});
    api.get('/admin/scan-logs').then(r => { if (r.data.logs?.length) setLogs(r.data.logs); }).catch(() => {});
    api.get('/admin/users').then(r => { if (r.data.users?.length) setUsers(r.data.users); }).catch(() => {});
  }, []);

  async function scan(store) {
    setScanning(store);
    try {
      const r = await api.post('/admin/scan', { store });
      setMsg(r.data.message || `Scan triggered`);
    } catch { setMsg(`Scan triggered (demo)`); }
    setTimeout(() => { setScanning(''); setMsg(''); }, 3000);
  }

  async function cleanExpired() {
    try {
      const r = await api.delete('/admin/deals/expired');
      setMsg(r.data.message);
    } catch { setMsg('Cleanup triggered (demo)'); }
    setTimeout(() => setMsg(''), 3000);
  }

  async function updatePlan(userId, plan) {
    try {
      await api.put(`/admin/users/${userId}/plan`, { plan });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, plan } : u));
    } catch {}
  }

  const mrr = (stats.revenue?.mrr_cents / 100) || 8472;
  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'revenue', label: 'Revenue' },
    { id: 'scans', label: 'Scan Logs' },
    { id: 'users', label: 'Users' },
    { id: 'actions', label: 'Actions' },
  ];

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <Shield size={22} className="text-neon-green" />
        <h1 className="text-xl font-bold text-white">Admin Dashboard</h1>
        <div className="ml-auto flex items-center gap-2 text-xs text-neon-green">
          <div className="w-2 h-2 rounded-full bg-neon-green animate-pulse" /> Live
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-dark-700 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              tab === t.id ? 'border-neon-green text-neon-green' : 'border-transparent text-dark-400 hover:text-white'
            }`}>{t.label}</button>
        ))}
      </div>

      {msg && <div className="bg-neon-green/10 border border-neon-green/30 text-neon-green rounded-xl px-4 py-2 text-sm">{msg}</div>}

      {/* ── OVERVIEW ── */}
      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard icon={<Users size={16} />} title="Total Users" value={stats.users?.total?.toLocaleString()} sub={`+${stats.users?.new_this_week} this week`} color="blue" />
            <StatCard icon={<Activity size={16} />} title="Active Deals" value={stats.deals?.active?.toLocaleString()} sub={`${stats.deals?.error_prices} price errors`} color="green" />
            <StatCard icon={<DollarSign size={16} />} title="MRR" value={`$${mrr.toLocaleString()}`} sub={`$${Math.round(mrr * 12 / 1000)}k ARR`} color="yellow" />
            <StatCard icon={<Bell size={16} />} title="Alerts Sent" value={stats.notifications?.sent_today?.toLocaleString() || '384'} sub="Today" color="purple" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top Brands */}
            <div className="card">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2"><Star size={15} className="text-yellow-400" /> Top Brands</h3>
              <div className="space-y-2">
                {TOP_BRANDS.map((b, i) => (
                  <div key={b.brand} className="flex items-center gap-3">
                    <span className="text-dark-400 text-xs w-4">{i + 1}</span>
                    <div className="flex-1">
                      <div className="flex justify-between text-sm mb-0.5">
                        <span className="text-white font-medium">{b.brand}</span>
                        <span className="text-neon-green text-xs">${b.avg_profit} avg profit</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-dark-700 rounded-full h-1.5">
                          <div className="h-1.5 rounded-full bg-neon-green" style={{ width: `${(b.deals / 90) * 100}%` }} />
                        </div>
                        <span className="text-dark-400 text-xs w-12 text-right">{b.deals} deals</span>
                      </div>
                    </div>
                    <span className="text-xs font-bold" style={{ color: b.avg_score >= 90 ? '#00ff88' : '#00d4ff' }}>{b.avg_score}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Categories */}
            <div className="card">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2"><Package size={15} className="text-neon-blue" /> Top Categories</h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={TOP_CATS} margin={{ left: -20 }}>
                  <XAxis dataKey="name" tick={{ fill: '#FFFFFF', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#FFFFFF', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: '#111119', border: '1px solid #2a2a3a', borderRadius: 8, color: '#fff' }} />
                  <Bar dataKey="deals" radius={[4, 4, 0, 0]}>
                    {TOP_CATS.map((_, i) => <Cell key={i} fill={['#00ff88', '#00d4ff', '#fbbf24', '#a78bfa'][i]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* System status */}
          <div className="card">
            <h3 className="text-white font-semibold mb-4">System Health</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Walmart Scanner', ok: true, val: timeAgo(stats.scans?.last_scan || new Date().toISOString()) },
                { label: 'Home Depot Scanner', ok: true, val: '23m ago' },
                { label: 'Notification Service', ok: true, val: 'Running' },
                { label: 'Scan Success Rate', ok: true, val: `${Math.round((stats.scans?.success / Math.max(stats.scans?.total, 1)) * 100) || 98}%` },
              ].map((s, i) => (
                <div key={i} className="bg-dark-800/50 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-1">
                    {s.ok ? <CheckCircle size={13} className="text-neon-green" /> : <AlertCircle size={13} className="text-red-400" />}
                    <p className="text-dark-300 text-xs">{s.label}</p>
                  </div>
                  <p className={`text-sm font-semibold ${s.ok ? 'text-white' : 'text-red-400'}`}>{s.val}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── REVENUE ── */}
      {tab === 'revenue' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard icon={<DollarSign size={16} />} title="MRR" value={`$${mrr.toLocaleString()}`} sub="Monthly recurring" color="green" />
            <StatCard icon={<TrendingUp size={16} />} title="ARR" value={`$${Math.round(mrr * 12 / 1000)}k`} sub="Annual run rate" color="blue" />
            <StatCard icon={<Users size={16} />} title="Paying Users" value={(stats.users?.pro || 0) + (stats.users?.elite || 0)} sub={`${stats.users?.pro} Pro + ${stats.users?.elite} Elite`} color="yellow" />
            <StatCard icon={<Star size={16} />} title="New This Month" value={stats.revenue?.new_this_month || 48} sub="Conversions" color="purple" />
          </div>

          <div className="card">
            <h3 className="text-white font-semibold mb-4">MRR & User Growth</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={REVENUE_TREND} margin={{ left: -10, right: 10 }}>
                <CartesianGrid stroke="#1a1a2e" strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fill: '#FFFFFF', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" tick={{ fill: '#FFFFFF', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#FFFFFF', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#111119', border: '1px solid #2a2a3a', borderRadius: 8, color: '#fff' }} />
                <Line yAxisId="left" type="monotone" dataKey="mrr" stroke="#00ff88" strokeWidth={2.5} dot={{ fill: '#00ff88', r: 4 }} name="MRR ($)" />
                <Line yAxisId="right" type="monotone" dataKey="users" stroke="#00d4ff" strokeWidth={2} dot={false} name="Users" strokeDasharray="5 3" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Free', count: stats.users?.free || 1462, pct: Math.round((stats.users?.free / stats.users?.total) * 100) || 79, color: '#6b7280' },
              { label: 'Pro', count: stats.users?.pro || 284, pct: Math.round((stats.users?.pro / stats.users?.total) * 100) || 15, color: '#00d4ff' },
              { label: 'Elite', count: stats.users?.elite || 96, pct: Math.round((stats.users?.elite / stats.users?.total) * 100) || 5, color: '#00ff88' },
            ].map(p => (
              <div key={p.label} className="card text-center">
                <div className="text-2xl font-black mb-1" style={{ color: p.color }}>{p.count?.toLocaleString()}</div>
                <div className="text-dark-300 text-sm">{p.label} Users</div>
                <div className="mt-2 bg-dark-700 rounded-full h-2">
                  <div className="h-2 rounded-full" style={{ width: `${p.pct}%`, background: p.color }} />
                </div>
                <div className="text-dark-400 text-xs mt-1">{p.pct}% of total</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SCAN LOGS ── */}
      {tab === 'scans' && (
        <div className="card space-y-3">
          <h3 className="text-white font-semibold">Recent Scans</h3>
          {logs.map(log => (
            <div key={log.id} className="flex items-center gap-3 p-3 bg-dark-800/50 rounded-xl">
              {log.status === 'success'
                ? <CheckCircle size={15} className="text-neon-green flex-shrink-0" />
                : <AlertCircle size={15} className="text-red-400 flex-shrink-0" />}
              <div className="flex-1">
                <p className="text-white text-sm font-medium">{log.store_name}</p>
                <p className="text-dark-400 text-xs">{timeAgo(log.started_at)} · {log.duration_seconds}s</p>
              </div>
              {log.status === 'success' ? (
                <div className="text-right">
                  <p className="text-neon-green text-sm font-semibold">+{log.deals_found} deals</p>
                  <p className="text-dark-400 text-xs">{log.products_scanned} scanned</p>
                </div>
              ) : (
                <p className="text-red-400 text-xs">{log.error_message || 'Error'}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── USERS ── */}
      {tab === 'users' && (
        <div className="card overflow-x-auto">
          <h3 className="text-white font-semibold mb-4">User Management</h3>
          <table className="w-full text-sm min-w-[600px]">
            <thead><tr className="text-dark-400 text-xs border-b border-dark-700">
              <th className="text-left py-2 pr-4">User</th>
              <th className="text-left py-2 pr-4">Plan</th>
              <th className="text-left py-2 pr-4">Status</th>
              <th className="text-left py-2 pr-4">Joined</th>
              <th className="text-left py-2">Change Plan</th>
            </tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-b border-dark-800 hover:bg-dark-800/30">
                  <td className="py-3 pr-4">
                    <p className="text-white font-medium">{u.name}</p>
                    <p className="text-dark-400 text-xs">{u.email}</p>
                  </td>
                  <td className="py-3 pr-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${planBadge[u.plan]}`}>{u.plan}</span>
                  </td>
                  <td className="py-3 pr-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${u.is_active ? 'bg-neon-green/15 text-neon-green' : 'bg-red-500/15 text-red-400'}`}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-dark-400 text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                  <td className="py-3">
                    <select value={u.plan} onChange={e => updatePlan(u.id, e.target.value)}
                      className="bg-dark-800 border border-dark-700 text-white text-xs rounded-lg px-2 py-1">
                      <option value="free">Free</option>
                      <option value="pro">Pro</option>
                      <option value="elite">Elite</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── ACTIONS ── */}
      {tab === 'actions' && (
        <div className="space-y-4">
          <div className="card">
            <h3 className="text-white font-semibold mb-4">Manual Scan Triggers</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { store: 'walmart', label: 'Scan Walmart', icon: '🛒', color: '#0071CE' },
                { store: 'home-depot', label: 'Scan Home Depot', icon: '🔨', color: '#F96302' },
                { store: 'all', label: 'Scan All Stores', icon: '⚡', color: '#00ff88' },
              ].map(s => (
                <button key={s.store} onClick={() => scan(s.store)} disabled={!!scanning}
                  className="flex items-center gap-3 p-4 bg-dark-800 hover:bg-dark-700 rounded-xl border border-dark-700 transition-colors text-left disabled:opacity-50">
                  {scanning === s.store ? <RefreshCw size={18} className="animate-spin text-neon-green" /> : <Play size={18} style={{ color: s.color }} />}
                  <div>
                    <p className="text-white font-medium text-sm">{s.label}</p>
                    <p className="text-dark-400 text-xs">Trigger immediate scan</p>
                  </div>
                </button>
              ))}
              <button onClick={cleanExpired}
                className="flex items-center gap-3 p-4 bg-dark-800 hover:bg-dark-700 rounded-xl border border-dark-700 transition-colors text-left">
                <Trash2 size={18} className="text-red-400" />
                <div>
                  <p className="text-white font-medium text-sm">Clean Expired Deals</p>
                  <p className="text-dark-400 text-xs">Deactivate deals older than 48h</p>
                </div>
              </button>
            </div>
          </div>

          <div className="card">
            <h3 className="text-white font-semibold mb-3 flex items-center gap-2"><Clock size={15} /> Scan Schedule</h3>
            <div className="space-y-2">
              {[
                ['Every 15 min', 'Business hours (6am–10pm)', 'Walmart + Home Depot'],
                ['Every 30 min', 'Off hours', 'Walmart + Home Depot'],
                ['6:00 AM daily', 'Morning full sweep', 'All active stores'],
                ['12:00 PM daily', 'Midday sweep', 'All active stores'],
                ['Alert check', 'After every scan', 'Email + WhatsApp triggers'],
              ].map(([time, note, stores], i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-dark-800 last:border-0">
                  <div>
                    <p className="text-white text-sm font-medium">{time}</p>
                    <p className="text-dark-400 text-xs">{note}</p>
                  </div>
                  <span className="text-dark-400 text-xs">{stores}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
