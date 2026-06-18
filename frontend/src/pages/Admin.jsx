import { useState, useEffect, useCallback } from 'react';
import {
  Shield, RefreshCw, Users, Activity, AlertCircle,
  CheckCircle, Play, Trash2, TrendingUp, DollarSign, Bell,
  Package, Star, Clock, Zap, Database, BarChart2
} from 'lucide-react';
import api from '../utils/api';
import StatCard from '../components/StatCard';

function timeAgo(iso) {
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

const planBadge = { free: 'text-gray-400 bg-dark-700', pro: 'text-neon-blue bg-neon-blue/15', elite: 'text-neon-green bg-neon-green/15' };
const CAT_COLORS = ['#00ff88', '#00d4ff', '#fbbf24', '#a78bfa'];

function formatMinutes(ms) {
  const m = Math.round(ms / 60000);
  if (m <= 0) return 'now';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function freshnessLabel(isoStr) {
  if (!isoStr) return null;
  const ms = Date.now() - new Date(isoStr).getTime();
  if (ms < 0) return 'upcoming';
  return formatMinutes(ms) + ' ago';
}

function nextScanCountdown(isoStr) {
  if (!isoStr) return '—';
  const ms = new Date(isoStr).getTime() - Date.now();
  if (ms <= 0) return 'now';
  return 'in ' + formatMinutes(ms);
}

export default function Admin() {
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [logs, setLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [topCats, setTopCats] = useState([]);
  const [health, setHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState('');
  const [msg, setMsg] = useState('');

  const loadHealth = useCallback(() => {
    setHealthLoading(true);
    api.get('/admin/scanner-health')
      .then(r => setHealth(r.data))
      .catch(() => {})
      .finally(() => setHealthLoading(false));
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/admin/dashboard'),
      api.get('/admin/scan-logs'),
      api.get('/admin/users'),
      api.get('/deals/stats'),
    ]).then(([dash, scanRes, userRes, dealsStats]) => {
      setStats(dash.data);
      setLogs(scanRes.data.logs || []);
      setUsers(userRes.data.users || []);
      setTopCats(dealsStats.data.top_categories || []);
    }).catch(() => {}).finally(() => setLoading(false));
    loadHealth();
  }, [loadHealth]);

  async function scan(store) {
    setScanning(store);
    try {
      const r = await api.post('/admin/scan', { store });
      setMsg(r.data.message || 'Scan triggered');
    } catch (err) {
      setMsg(err.response?.data?.error || 'Error al iniciar el scan');
    }
    setTimeout(() => { setScanning(''); setMsg(''); }, 3000);
  }

  async function discover(store) {
    setScanning(`discover-${store}`);
    try {
      const r = await api.post('/admin/discover', { store, limit: 200 });
      setMsg(r.data.message || `Discovery started for ${store}`);
    } catch (err) {
      setMsg(err.response?.data?.error || `Error starting discovery for ${store}`);
    }
    setTimeout(() => { setScanning(''); setMsg(''); }, 4000);
  }

  async function cleanExpired() {
    try {
      const r = await api.delete('/admin/deals/expired');
      setMsg(r.data.message || 'Cleanup complete');
    } catch (err) {
      setMsg(err.response?.data?.error || 'Error al ejecutar cleanup');
    }
    setTimeout(() => setMsg(''), 3000);
  }

  async function updatePlan(userId, plan) {
    try {
      await api.put(`/admin/users/${userId}/plan`, { plan });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, plan } : u));
    } catch {}
  }

  const mrr = stats ? (stats.revenue?.mrr_cents || 0) / 100 : 0;
  const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'health', label: 'Scanner Health' },
    { id: 'revenue', label: 'Revenue' },
    { id: 'scans', label: 'Scan Logs' },
    { id: 'users', label: 'Users' },
    { id: 'actions', label: 'Actions' },
  ];

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-neon-green/30 border-t-neon-green rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <Shield size={22} className="text-neon-green" />
        <h1 className="text-xl font-bold text-white">Admin Dashboard</h1>
        <div className="ml-auto flex items-center gap-2 text-xs text-neon-green">
          <div className="w-2 h-2 rounded-full bg-neon-green animate-pulse" /> Live
        </div>
      </div>

      <div className="flex gap-1 border-b border-dark-700 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              tab === t.id ? 'border-neon-green text-neon-green' : 'border-transparent text-gray-400 hover:text-white'
            }`}>{t.label}</button>
        ))}
      </div>

      {msg && <div className="bg-neon-green/10 border border-neon-green/30 text-neon-green rounded-xl px-4 py-2 text-sm">{msg}</div>}

      {/* ── OVERVIEW ── */}
      {tab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard icon={<Users size={16} />} title="Total Users" value={stats?.users?.total?.toLocaleString() || '—'} sub={`+${stats?.users?.new_this_week || 0} this week`} color="blue" />
            <StatCard icon={<Activity size={16} />} title="Active Deals" value={stats?.deals?.active?.toLocaleString() || '—'} sub={`${stats?.deals?.error_prices || 0} price errors`} color="green" />
            <StatCard icon={<DollarSign size={16} />} title="MRR" value={mrr ? `$${mrr.toLocaleString()}` : '—'} sub={mrr ? `$${Math.round(mrr * 12 / 1000)}k ARR` : 'No data'} color="yellow" />
            <StatCard icon={<Bell size={16} />} title="Alerts Sent" value={stats?.notifications?.sent_today?.toLocaleString() || '—'} sub="Today" color="purple" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top Categories */}
            <div className="card">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2"><Package size={15} className="text-neon-blue" /> Top Categories</h3>
              {topCats.length > 0 ? (() => {
                const maxCount = Math.max(...topCats.map(c => parseInt(c.deal_count) || 0), 1);
                return (
                  <div className="space-y-2 pt-1">
                    {topCats.map((cat, i) => {
                      const count = parseInt(cat.deal_count) || 0;
                      const pct = Math.round((count / maxCount) * 100);
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <span className="text-gray-400 text-xs w-36 truncate flex-shrink-0">{cat.name}</span>
                          <div className="flex-1 h-5 bg-dark-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: CAT_COLORS[i % CAT_COLORS.length] }} />
                          </div>
                          <span className="text-xs font-bold w-6 text-right flex-shrink-0" style={{ color: CAT_COLORS[i % CAT_COLORS.length] }}>{count}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })() : (
                <div className="text-center text-gray-400 text-sm py-10">No category data available</div>
              )}
            </div>

            {/* Top Brands — coming soon */}
            <div className="card">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2"><Star size={15} className="text-yellow-400" /> Top Brands</h3>
              <div className="text-center text-gray-400 text-sm py-10">
                <Star size={28} className="mx-auto mb-3 opacity-30" />
                <p>Brand performance analytics coming soon</p>
              </div>
            </div>
          </div>

          {/* System status */}
          <div className="card">
            <h3 className="text-white font-semibold mb-4">System Health</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Walmart Scanner', ok: true, val: stats?.scans?.last_scan ? timeAgo(stats.scans.last_scan) : '—' },
                { label: 'Notification Service', ok: true, val: 'Running' },
                { label: 'Scan Success Rate', ok: true, val: stats?.scans?.total ? `${Math.round((stats.scans.success / stats.scans.total) * 100)}%` : '—' },
                { label: 'Total Scans', ok: true, val: stats?.scans?.total?.toLocaleString() || '—' },
              ].map((s, i) => (
                <div key={i} className="bg-dark-800/50 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-1">
                    {s.ok ? <CheckCircle size={13} className="text-neon-green" /> : <AlertCircle size={13} className="text-red-400" />}
                    <p className="text-gray-400 text-xs">{s.label}</p>
                  </div>
                  <p className={`text-sm font-semibold ${s.ok ? 'text-white' : 'text-red-400'}`}>{s.val}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── SCANNER HEALTH ── */}
      {tab === 'health' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-white font-semibold flex items-center gap-2"><Zap size={15} className="text-neon-green" /> Scanner Health</h3>
            <button onClick={loadHealth} disabled={healthLoading}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white px-3 py-1.5 bg-dark-800 rounded-lg border border-dark-700 transition-colors disabled:opacity-50">
              <RefreshCw size={12} className={healthLoading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>

          {/* Last scan summary */}
          {health?.last_scan && (
            <div className="card">
              <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Last Scan</h4>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-dark-800/60 rounded-xl p-3">
                  <p className="text-gray-400 text-xs mb-1">Stores</p>
                  <p className="text-white font-semibold text-sm">{health.last_scan.store_name}</p>
                </div>
                <div className="bg-dark-800/60 rounded-xl p-3">
                  <p className="text-gray-400 text-xs mb-1">Started</p>
                  <p className="text-white font-semibold text-sm">{timeAgo(health.last_scan.started_at)}</p>
                </div>
                <div className="bg-dark-800/60 rounded-xl p-3">
                  <p className="text-gray-400 text-xs mb-1">Duration</p>
                  <p className="text-white font-semibold text-sm">{health.last_scan.duration_seconds}s</p>
                </div>
                <div className="bg-dark-800/60 rounded-xl p-3">
                  <p className="text-gray-400 text-xs mb-1">Status</p>
                  <p className={`font-semibold text-sm ${health.last_scan.status === 'success' ? 'text-neon-green' : health.last_scan.status === 'running' ? 'text-neon-blue' : 'text-red-400'}`}>
                    {health.last_scan.status}
                  </p>
                </div>
                <div className="bg-dark-800/60 rounded-xl p-3">
                  <p className="text-gray-400 text-xs mb-1">Products Scanned</p>
                  <p className="text-white font-semibold text-sm">{health.last_scan.products_scanned}</p>
                </div>
                <div className="bg-dark-800/60 rounded-xl p-3">
                  <p className="text-gray-400 text-xs mb-1">Deals Found</p>
                  <p className="text-neon-green font-semibold text-sm">+{health.last_scan.deals_found}</p>
                </div>
                <div className="bg-dark-800/60 rounded-xl p-3">
                  <p className="text-gray-400 text-xs mb-1">Errors</p>
                  <p className={`font-semibold text-sm ${health.last_scan.errors_count > 0 ? 'text-red-400' : 'text-white'}`}>{health.last_scan.errors_count}</p>
                </div>
                <div className="bg-dark-800/60 rounded-xl p-3">
                  <p className="text-gray-400 text-xs mb-1">Error Rate</p>
                  <p className={`font-semibold text-sm ${health.last_scan.error_rate > 20 ? 'text-red-400' : health.last_scan.error_rate > 0 ? 'text-yellow-400' : 'text-white'}`}>
                    {health.last_scan.error_rate}%
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Next scan + interval */}
          <div className="grid grid-cols-2 gap-3">
            <div className="card flex items-center gap-3">
              <Clock size={20} className="text-neon-blue flex-shrink-0" />
              <div>
                <p className="text-gray-400 text-xs">Next Scan Estimated</p>
                <p className="text-white font-semibold">{nextScanCountdown(health?.next_scan_estimated)}</p>
              </div>
            </div>
            <div className="card flex items-center gap-3">
              <BarChart2 size={20} className="text-neon-green flex-shrink-0" />
              <div>
                <p className="text-gray-400 text-xs">Cron Interval</p>
                <p className="text-white font-semibold">Every {health?.scan_interval_minutes || '—'} min</p>
              </div>
            </div>
          </div>

          {/* Per-store table */}
          <div className="card overflow-x-auto">
            <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-4 flex items-center gap-2">
              <Database size={13} /> Per-Store Metrics
            </h4>
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="text-gray-400 text-xs border-b border-dark-700">
                  <th className="text-left py-2 pr-4">Store</th>
                  <th className="text-left py-2 pr-4">Scanner</th>
                  <th className="text-right py-2 pr-4">Products</th>
                  <th className="text-right py-2 pr-4">Active Deals</th>
                  <th className="text-right py-2 pr-4">Verified 24h</th>
                  <th className="text-right py-2 pr-4">Verified 48h</th>
                  <th className="text-right py-2 pr-4">Stale</th>
                  <th className="text-left py-2">Last Deal Seen</th>
                </tr>
              </thead>
              <tbody>
                {(health?.stores || []).map(s => (
                  <tr key={s.store_slug} className="border-b border-dark-800 hover:bg-dark-800/30">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.store_color || '#666' }} />
                        <span className="text-white font-medium">{s.store_name}</span>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      {s.is_active_scanner
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-neon-green/15 text-neon-green font-semibold">Active</span>
                        : <span className="text-xs px-2 py-0.5 rounded-full bg-dark-700 text-gray-400">Inactive</span>}
                    </td>
                    <td className="py-3 pr-4 text-right text-gray-400">{s.product_count.toLocaleString()}</td>
                    <td className="py-3 pr-4 text-right font-semibold text-white">{s.active_deals.toLocaleString()}</td>
                    <td className="py-3 pr-4 text-right">
                      <span className={s.verified_last_24h > 0 ? 'text-neon-green font-semibold' : 'text-gray-500'}>
                        {s.verified_last_24h.toLocaleString()}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <span className={s.verified_last_48h > 0 ? 'text-neon-blue font-semibold' : 'text-gray-500'}>
                        {s.verified_last_48h.toLocaleString()}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <span className={s.stale_deals > 0 ? 'text-yellow-400 font-semibold' : 'text-gray-500'}>
                        {s.stale_deals.toLocaleString()}
                      </span>
                    </td>
                    <td className="py-3 text-gray-400 text-xs">
                      {s.last_deal_seen_at ? timeAgo(s.last_deal_seen_at) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Recent scan logs mini */}
          {health?.recent_logs?.length > 0 && (
            <div className="card">
              <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Recent Scan History</h4>
              <div className="space-y-2">
                {health.recent_logs.map((log, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 border-b border-dark-800 last:border-0">
                    {log.status === 'success'
                      ? <CheckCircle size={13} className="text-neon-green flex-shrink-0" />
                      : log.status === 'running'
                        ? <RefreshCw size={13} className="text-neon-blue animate-spin flex-shrink-0" />
                        : <AlertCircle size={13} className="text-red-400 flex-shrink-0" />}
                    <span className="text-gray-400 text-xs w-24 flex-shrink-0">{timeAgo(log.started_at)}</span>
                    <span className="text-gray-400 text-xs flex-1">{log.store_name}</span>
                    <span className="text-white text-xs font-medium">{log.products_scanned} scanned</span>
                    <span className="text-neon-green text-xs font-semibold w-16 text-right">+{log.deals_found} deals</span>
                    <span className={`text-xs w-14 text-right ${log.errors_count > 0 ? 'text-red-400' : 'text-gray-500'}`}>
                      {log.errors_count} err
                    </span>
                    <span className="text-gray-500 text-xs w-12 text-right">{log.duration_seconds}s</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── REVENUE ── */}
      {tab === 'revenue' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard icon={<DollarSign size={16} />} title="MRR" value={mrr ? `$${mrr.toLocaleString()}` : '—'} sub="Monthly recurring" color="green" />
            <StatCard icon={<TrendingUp size={16} />} title="ARR" value={mrr ? `$${Math.round(mrr * 12 / 1000)}k` : '—'} sub="Annual run rate" color="blue" />
            <StatCard icon={<Users size={16} />} title="Paying Users" value={(parseInt(stats?.users?.pro) || 0) + (parseInt(stats?.users?.elite) || 0) || '—'} sub={`${parseInt(stats?.users?.pro) || 0} Pro + ${parseInt(stats?.users?.elite) || 0} Elite`} color="yellow" />
            <StatCard icon={<Star size={16} />} title="New This Month" value={stats?.revenue?.new_this_month ?? '—'} sub="Conversions" color="purple" />
          </div>

          <div className="card text-center py-12 text-gray-400">
            <TrendingUp size={32} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium text-white">Revenue trend chart</p>
            <p className="text-sm mt-1">Revenue analytics will appear after Stripe payments are active.</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Free', count: parseInt(stats?.users?.free) || 0, color: '#6b7280' },
              { label: 'Pro', count: parseInt(stats?.users?.pro) || 0, color: '#00d4ff' },
              { label: 'Elite', count: parseInt(stats?.users?.elite) || 0, color: '#00ff88' },
            ].map(p => {
              const total = parseInt(stats?.users?.total) || 0;
              const pct = total ? Math.round((p.count || 0) / total * 100) : 0;
              return (
                <div key={p.label} className="card text-center">
                  <div className="text-2xl font-black mb-1" style={{ color: p.color }}>{p.count?.toLocaleString() ?? '—'}</div>
                  <div className="text-gray-400 text-sm">{p.label} Users</div>
                  <div className="mt-2 bg-dark-700 rounded-full h-2">
                    <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: p.color }} />
                  </div>
                  <div className="text-gray-400 text-xs mt-1">{pct}% of total</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── SCAN LOGS ── */}
      {tab === 'scans' && (
        <div className="card space-y-3">
          <h3 className="text-white font-semibold">Recent Scans</h3>
          {logs.length === 0 && (
            <div className="text-center py-10 text-gray-400">
              <Activity size={32} className="mx-auto mb-3 opacity-30" />
              <p>No scan logs yet</p>
            </div>
          )}
          {logs.map(log => (
            <div key={log.id} className="flex items-center gap-3 p-3 bg-dark-800/50 rounded-xl">
              {log.status === 'success'
                ? <CheckCircle size={15} className="text-neon-green flex-shrink-0" />
                : <AlertCircle size={15} className="text-red-400 flex-shrink-0" />}
              <div className="flex-1">
                <p className="text-white text-sm font-medium">{log.store_name}</p>
                <p className="text-gray-400 text-xs">{timeAgo(log.started_at)} · {log.duration_seconds}s</p>
              </div>
              {log.status === 'success' ? (
                <div className="text-right">
                  <p className="text-neon-green text-sm font-semibold">+{log.deals_found} deals</p>
                  <p className="text-gray-400 text-xs">{log.products_scanned} scanned</p>
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
          {users.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <Users size={32} className="mx-auto mb-3 opacity-30" />
              <p>No users found</p>
            </div>
          ) : (
            <table className="w-full text-sm min-w-[600px]">
              <thead><tr className="text-gray-400 text-xs border-b border-dark-700">
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
                      <p className="text-gray-400 text-xs">{u.email}</p>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${planBadge[u.plan] || 'text-gray-400 bg-dark-700'}`}>{u.plan}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${u.is_active ? 'bg-neon-green/15 text-neon-green' : 'bg-red-500/15 text-red-400'}`}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-gray-400 text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
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
          )}
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
                    <p className="text-gray-400 text-xs">Trigger immediate scan</p>
                  </div>
                </button>
              ))}
              <button onClick={cleanExpired}
                className="flex items-center gap-3 p-4 bg-dark-800 hover:bg-dark-700 rounded-xl border border-dark-700 transition-colors text-left">
                <Trash2 size={18} className="text-red-400" />
                <div>
                  <p className="text-white font-medium text-sm">Clean Expired Deals</p>
                  <p className="text-gray-400 text-xs">Deactivate deals older than 48h</p>
                </div>
              </button>
            </div>
          </div>

          <div className="card">
            <h3 className="text-white font-semibold mb-4 flex items-center gap-2"><Database size={15} className="text-neon-blue" /> Product Discovery</h3>
            <p className="text-gray-400 text-xs mb-3">Finds new product URLs and inserts them into the DB without creating deals. Runs in background.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                { store: 'office-depot', label: 'Discover Office Depot', icon: '📎', color: '#CC0000' },
                { store: 'gamestop', label: 'Discover GameStop', icon: '🎮', color: '#5CB85C' },
              ].map(s => (
                <button key={s.store} onClick={() => discover(s.store)} disabled={!!scanning}
                  className="flex items-center gap-3 p-4 bg-dark-800 hover:bg-dark-700 rounded-xl border border-dark-700 transition-colors text-left disabled:opacity-50">
                  {scanning === `discover-${s.store}` ? <RefreshCw size={18} className="animate-spin text-neon-blue" /> : <Zap size={18} style={{ color: s.color }} />}
                  <div>
                    <p className="text-white font-medium text-sm">{s.label}</p>
                    <p className="text-gray-400 text-xs">Insert up to 200 new product URLs</p>
                  </div>
                </button>
              ))}
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
                    <p className="text-gray-400 text-xs">{note}</p>
                  </div>
                  <span className="text-gray-400 text-xs">{stores}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
