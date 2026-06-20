import { useState, useEffect } from 'react';
import {
  Users, Star, Shield, Wallet, TrendingUp, Search,
  CheckCircle, AlertTriangle, GraduationCap, Activity,
  RefreshCw, ChevronRight,
} from 'lucide-react';
import api from '../utils/api';

const TRUST_COLOR = {
  'Excelente':      '#4ADE80',
  'Bueno':          '#60A5FA',
  'Normal':         '#9CA3AF',
  'En observación': '#FBBF24',
  'Suspendido':     '#F43F5E',
};

function TrustBadge({ level }) {
  const color = TRUST_COLOR[level] || '#9CA3AF';
  return (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
      style={{ background: `${color}18`, color }}>
      {level || 'Normal'}
    </span>
  );
}

function timeAgo(ts) {
  if (!ts) return 'Never';
  const diff = (Date.now() - new Date(ts)) / 1000;
  if (diff < 86400) return 'Today';
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 604800)}w ago`;
}

function MemberRow({ m }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-dark-700 rounded-xl bg-dark-800/40 overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 p-3 hover:bg-dark-700/30 transition-colors text-left"
      >
        <div className="w-9 h-9 rounded-full bg-neon-green/15 flex items-center justify-center text-neon-green font-black text-sm flex-shrink-0">
          {(m.name || '?')[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-white text-sm font-semibold truncate">{m.name || 'Unknown'}</p>
            <TrustBadge level={m.trust_level} />
            {m.suspicious_activity && <AlertTriangle size={11} className="text-red-400 flex-shrink-0" />}
          </div>
          <p className="text-gray-500 text-[10px]">{m.email} · Last active: {timeAgo(m.last_active)}</p>
        </div>
        <div className="text-right flex-shrink-0 mr-1">
          <p className="text-neon-green text-sm font-black">{(m.xp || 0).toLocaleString()} XP</p>
          <p className="text-gray-500 text-[10px]">{m.deals_verified || 0} deals</p>
        </div>
        <ChevronRight size={14} className={`text-gray-600 transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-dark-700 pt-3">
          <div className="bg-dark-900/60 rounded-xl p-3">
            <p className="text-gray-500 text-[10px] mb-1 flex items-center gap-1"><TrendingUp size={9} /> XP this month</p>
            <p className="text-white font-bold text-sm">{(m.xp_this_month || 0).toLocaleString()}</p>
          </div>
          <div className="bg-dark-900/60 rounded-xl p-3">
            <p className="text-gray-500 text-[10px] mb-1 flex items-center gap-1"><Activity size={9} /> Scans</p>
            <p className="text-white font-bold text-sm">{m.scan_count || 0}</p>
          </div>
          <div className="bg-dark-900/60 rounded-xl p-3">
            <p className="text-gray-500 text-[10px] mb-1 flex items-center gap-1"><GraduationCap size={9} /> Courses</p>
            <p className="text-white font-bold text-sm">{m.courses_completed || 0}</p>
          </div>
          <div className="bg-dark-900/60 rounded-xl p-3">
            <p className="text-gray-500 text-[10px] mb-1 flex items-center gap-1"><Wallet size={9} /> Points</p>
            <p className="text-white font-bold text-sm">{(m.points_available || 0).toLocaleString()}</p>
          </div>
          <div className="bg-dark-900/60 rounded-xl p-3">
            <p className="text-gray-500 text-[10px] mb-1 flex items-center gap-1"><Shield size={9} /> Trust Score</p>
            <p className="font-bold text-sm" style={{ color: TRUST_COLOR[m.trust_level] || '#9CA3AF' }}>
              {m.trust_score || 50}/100
            </p>
          </div>
          <div className="bg-dark-900/60 rounded-xl p-3">
            <p className="text-gray-500 text-[10px] mb-1">Pending Deals</p>
            <p className="text-white font-bold text-sm">{m.deals_pending || 0}</p>
          </div>
          <div className="bg-dark-900/60 rounded-xl p-3">
            <p className="text-gray-500 text-[10px] mb-1">Referrals Made</p>
            <p className="text-white font-bold text-sm">{m.referrals_made || 0}</p>
          </div>
          <div className="bg-dark-900/60 rounded-xl p-3">
            <p className="text-gray-500 text-[10px] mb-1">Role</p>
            <p className="text-white font-bold text-sm capitalize">{m.role || 'member'}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TeamCRM() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    try {
      const r = await api.get(`/business/crm?filter=${filter}&search=${encodeURIComponent(search)}`);
      setData(r.data);
    } catch (_) {}
    setLoading(false);
  }

  useEffect(() => { load(); }, [filter, search]);

  const FILTERS = [
    { val: 'all',      label: 'All Members' },
    { val: 'active',   label: 'Active (7d)' },
    { val: 'inactive', label: 'Inactive' },
    { val: 'top',      label: 'Top Performers' },
  ];

  if (!loading && data && !data.is_leader) {
    return (
      <div className="p-6 text-center py-20">
        <Users size={40} className="text-gray-700 mx-auto mb-4" />
        <p className="text-white font-bold text-lg">CRM for Team Leaders</p>
        <p className="text-gray-400 text-sm mt-2">
          You need to be a team owner to access Team CRM.
          Create or lead a team in the Teams section.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-3">
            <Users size={22} className="text-neon-green" /> Team CRM
          </h1>
          {data?.team && (
            <p className="text-gray-400 text-sm mt-1">
              {data.team.name} · {data.members?.length || 0} members
            </p>
          )}
        </div>
        <button onClick={load}
          className={`p-2 rounded-lg border border-dark-700 text-gray-400 hover:text-white transition-colors ${loading ? 'animate-spin' : ''}`}>
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Filters + Search */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(f => (
          <button key={f.val} onClick={() => setFilter(f.val)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === f.val ? 'bg-neon-green text-dark-900' : 'bg-dark-800 text-gray-400 border border-dark-700'
            }`}>
            {f.label}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search member…"
            className="pl-7 pr-3 py-1.5 rounded-lg bg-dark-800 border border-dark-700 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-neon-green/40 w-44"
          />
        </div>
      </div>

      {/* Summary tiles */}
      {data?.team && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Members',       value: data.team.member_count || 0, icon: <Users size={14} /> },
            { label: 'Team XP',       value: (data.team.total_xp || 0).toLocaleString(), icon: <Star size={14} /> },
            { label: 'Team Deals',    value: data.team.total_deals || 0, icon: <CheckCircle size={14} /> },
            { label: 'Showing',       value: data.members?.length || 0, icon: <Activity size={14} /> },
          ].map(t => (
            <div key={t.label} className="bg-dark-800/60 rounded-xl p-3 border border-dark-700">
              <div className="flex items-center gap-1.5 text-gray-500 text-[10px] mb-1">{t.icon}{t.label}</div>
              <p className="text-white font-black text-lg">{t.value}</p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-dark-800 animate-pulse" />)}
        </div>
      ) : (data?.members || []).length === 0 ? (
        <div className="text-center py-12">
          <Users size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400 font-semibold">No members found</p>
          <p className="text-gray-600 text-sm mt-1">Try changing the filter or invite members to your team.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {(data?.members || []).map(m => <MemberRow key={m.user_id} m={m} />)}
        </div>
      )}
    </div>
  );
}
