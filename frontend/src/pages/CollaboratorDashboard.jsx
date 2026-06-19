import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Star, Award, CheckCircle, Clock, XCircle, Users, ChevronRight, Zap, Plus, Wallet, Shield, AlertCircle } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';

const LEVEL_CONFIG = {
  'Legend Hunter': { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', min: 5000, next: null },
  'Elite Hunter':  { color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', min: 2500, next: 5000 },
  'Gold Hunter':   { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', min: 1000, next: 2500 },
  'Silver Hunter': { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', min: 500,  next: 1000 },
  'Bronze Hunter': { color: '#b45309', bg: 'rgba(180,83,9,0.1)',    min: 100,  next: 500 },
  'Rookie Hunter': { color: '#6b7280', bg: 'rgba(107,114,128,0.1)', min: 0,    next: 100 },
};

function LevelBadge({ level, points }) {
  const cfg = LEVEL_CONFIG[level] || LEVEL_CONFIG['Rookie Hunter'];
  const nextLevel = cfg.next;
  const progress = nextLevel ? Math.round(((points - cfg.min) / (nextLevel - cfg.min)) * 100) : 100;

  return (
    <div className="card p-5">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{ background: cfg.bg, border: `2px solid ${cfg.color}40` }}>
          <Award size={28} style={{ color: cfg.color }} />
        </div>
        <div className="flex-1">
          <p style={{ color: '#94A3B8' }} className="text-xs uppercase tracking-wider mb-0.5">Current Level</p>
          <h2 className="text-xl font-black" style={{ color: cfg.color }}>{level}</h2>
          <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>
            {points.toLocaleString()} points
            {nextLevel && ` · ${(nextLevel - points).toLocaleString()} to ${Object.entries(LEVEL_CONFIG).find(([, v]) => v.min === nextLevel)?.[0] || ''}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-black" style={{ color: cfg.color }}>{points.toLocaleString()}</p>
          <p style={{ color: '#94A3B8' }} className="text-xs">pts</p>
        </div>
      </div>
      {nextLevel && (
        <div className="mt-3">
          <div className="flex justify-between text-xs mb-1" style={{ color: '#94A3B8' }}>
            <span>{level}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 rounded-full" style={{ background: '#273449' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: cfg.color }} />
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon, color = '#4ADE80', sub }) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: `${color}15`, border: `1px solid ${color}30` }}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-black" style={{ color }}>{value}</p>
        <p className="text-xs" style={{ color: '#94A3B8' }}>{label}</p>
        {sub && <p className="text-xs" style={{ color: '#64748B' }}>{sub}</p>}
      </div>
    </div>
  );
}

export default function CollaboratorDashboard() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [recentSubmissions, setRecentSubmissions] = useState([]);
  const [pendingDeals, setPendingDeals] = useState([]);

  useEffect(() => { loadProfile(); }, []);

  async function loadProfile() {
    setLoading(true);
    try {
      const r = await api.get('/collaborators/profile');
      if (r.data.profile) {
        setProfile(r.data.profile);
        loadSubmissions();
        loadWallet();
        loadPendingDeals();
      }
    } catch {} finally {
      setLoading(false);
    }
  }

  async function loadSubmissions() {
    try {
      const r = await api.get('/community/my-deals');
      setRecentSubmissions((r.data.deals || []).slice(0, 5));
    } catch {
      const r2 = await api.get('/collaborators/submissions?limit=5').catch(() => ({ data: { submissions: [] } }));
      setRecentSubmissions(r2.data.submissions || []);
    }
  }

  async function loadWallet() {
    try {
      const r = await api.get('/community/wallet');
      setWallet(r.data.wallet);
    } catch {}
  }

  async function loadPendingDeals() {
    try {
      const r = await api.get('/community/deals?status=submitted,pending_confirmation&limit=3');
      setPendingDeals(r.data.deals || []);
    } catch {}
  }

  async function confirm(dealId, type) {
    try {
      await api.post(`/community/deals/${dealId}/confirm`, { confirmation_type: type });
      loadPendingDeals();
    } catch (err) {
      console.warn('Confirm failed:', err.response?.data?.error);
    }
  }

  async function createProfile() {
    if (!displayName.trim()) return;
    setCreatingProfile(true);
    try {
      const r = await api.post('/collaborators/profile', { display_name: displayName.trim() });
      setProfile(r.data.profile);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create profile');
    } finally {
      setCreatingProfile(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex justify-center">
        <div className="w-8 h-8 border-2 border-neon-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="p-4 lg:p-6 max-w-md mx-auto">
        <div className="card p-8 text-center space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-neon-green/10 flex items-center justify-center mx-auto">
            <Star size={32} className="text-neon-green" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white">Join as a Collaborator</h1>
            <p className="mt-2 text-sm" style={{ color: '#CBD5E1' }}>
              Report deals, earn points, level up, and help your community find the best deals.
            </p>
          </div>
          <input
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createProfile()}
            placeholder="Your hunter name..."
            className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none text-white"
            style={{ background: '#1E293B', border: '1px solid #334155' }}
          />
          <button onClick={createProfile} disabled={creatingProfile || !displayName.trim()}
            className="btn-primary w-full py-3 font-bold disabled:opacity-50">
            {creatingProfile ? 'Creating...' : 'Create collaborator profile →'}
          </button>
          <div className="grid grid-cols-3 gap-3 pt-2">
            {[['Rookie', '0 pts'], ['Bronze', '100 pts'], ['Legend', '5,000 pts']].map(([l, p]) => (
              <div key={l} className="text-center">
                <p className="text-white text-xs font-bold">{l}</p>
                <p style={{ color: '#94A3B8' }} className="text-xs">{p}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const level = profile.level || 'Rookie Hunter';
  const points = profile.points || 0;
  const repScore = parseFloat(profile.reputation_score || 100).toFixed(0);
  const trustScore = profile.trust_score != null ? profile.trust_score : 50;
  const totalSubmissions = (profile.approved_deals_count || 0) + (profile.pending_deals_count || 0) + (profile.rejected_deals_count || 0);
  const commissionEst = parseFloat(profile.total_commission_estimated || 0).toFixed(2);

  const STATUS_COLOR = {
    approved: '#4ADE80', pending: '#FACC15', rejected: '#F87171', duplicate: '#94A3B8',
    submitted: '#00D4FF', pending_confirmation: '#FACC15', verified: '#4ADE80', official: '#8B5CF6',
  };
  const STATUS_LABEL = {
    approved: 'Approved', pending: 'Pending', rejected: 'Rejected', duplicate: 'Duplicate',
    submitted: 'Submitted', pending_confirmation: 'Needs Confirmation', verified: 'Verified', official: 'Official',
  };

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Collaborator Dashboard</h1>
          <p style={{ color: '#94A3B8' }} className="text-sm mt-0.5">Welcome, {profile.display_name}</p>
        </div>
        <Link to="/collaborator/submit" className="btn-primary flex items-center gap-2 px-4 py-2 text-sm">
          <Plus size={14} /> Submit Deal
        </Link>
      </div>

      {/* Level card */}
      <LevelBadge level={level} points={points} />

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Verified Deals" value={profile.approved_deals_count || 0}
          icon={<CheckCircle size={18} style={{ color: '#4ADE80' }} />} color="#4ADE80" />
        <StatCard label="Pending" value={profile.pending_deals_count || 0}
          icon={<Clock size={18} style={{ color: '#FACC15' }} />} color="#FACC15" />
        <StatCard label="Trust Score" value={`${trustScore}`}
          icon={<Shield size={18} style={{ color: '#8B5CF6' }} />} color="#8B5CF6"
          sub={trustScore >= 70 ? 'High trust' : trustScore >= 40 ? 'Building trust' : 'Low trust'} />
        <StatCard label="Reputation" value={`${repScore}%`}
          icon={<Star size={18} style={{ color: '#F59E0B' }} />} color="#F59E0B"
          sub={totalSubmissions ? `${totalSubmissions} total` : ''} />
      </div>

      {/* Wallet */}
      {wallet && (
        <div className="card p-4 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <Wallet size={16} className="text-neon-green" />
            <p className="text-white font-semibold text-sm">Points Wallet</p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xl font-black text-neon-green">{wallet.points_available || 0}</p>
              <p className="text-xs text-gray-500">Available</p>
            </div>
            <div>
              <p className="text-xl font-black text-yellow-400">{wallet.points_pending || 0}</p>
              <p className="text-xs text-gray-500">Pending</p>
            </div>
            <div>
              <p className="text-xl font-black text-neon-blue">{wallet.lifetime_points || 0}</p>
              <p className="text-xs text-gray-500">Lifetime</p>
            </div>
          </div>
          {(wallet.credit_balance > 0) && (
            <p className="text-xs text-neon-green text-center">+ ${parseFloat(wallet.credit_balance).toFixed(2)} credit balance</p>
          )}
          <p className="text-xs text-gray-600 text-center">Points become available after your deals are verified</p>
        </div>
      )}

      {/* Deals needing confirmation */}
      {pendingDeals.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle size={16} className="text-neon-blue" />
            <p className="text-white font-semibold text-sm">Help Confirm Community Deals</p>
            <span className="text-xs text-gray-500 ml-auto">+5 pts each</span>
          </div>
          <div className="space-y-3">
            {pendingDeals.map(d => (
              <div key={d.id} className="bg-dark-800/50 rounded-xl p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{d.product_name}</p>
                    <p className="text-gray-400 text-xs">{d.store_name} · ${parseFloat(d.found_price).toFixed(2)} · {d.confirmation_count}/{d.trust_threshold} confirmations</p>
                  </div>
                  {d.opportunity_score && (
                    <span className="text-xs font-bold text-neon-green flex-shrink-0">Score {d.opportunity_score}</span>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { type: 'price_confirmed', label: '✅ Price OK',    cls: 'text-neon-green border-neon-green/30 hover:bg-neon-green/10' },
                    { type: 'in_stock',        label: '📦 In Stock',    cls: 'text-neon-blue  border-neon-blue/30  hover:bg-neon-blue/10' },
                    { type: 'out_of_stock',    label: '❌ Out of Stock', cls: 'text-red-400    border-red-400/30    hover:bg-red-400/10' },
                    { type: 'price_mismatch',  label: '⚠️ Wrong Price', cls: 'text-yellow-400 border-yellow-400/30 hover:bg-yellow-400/10' },
                  ].map(btn => (
                    <button key={btn.type} onClick={() => confirm(d.id, btn.type)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${btn.cls}`}>
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Earnings estimate */}
      {parseFloat(commissionEst) > 0 && (
        <div className="card p-4 flex items-center gap-3">
          <Zap size={20} className="text-neon-green" />
          <div>
            <p className="text-white font-bold">Estimated commission: <span className="text-neon-green">${commissionEst}</span></p>
            <p className="text-xs" style={{ color: '#94A3B8' }}>Based on sales generated from your approved deals</p>
          </div>
        </div>
      )}

      {/* Team */}
      {profile.team_name ? (
        <Link to={`/teams/${profile.team_id}`} className="card p-4 flex items-center gap-3 hover:border-neon-green/30 transition-colors">
          <Users size={18} className="text-neon-blue flex-shrink-0" />
          <div className="flex-1">
            <p className="text-white font-semibold">{profile.team_name}</p>
            {profile.team_city && <p className="text-xs" style={{ color: '#94A3B8' }}>{profile.team_city}</p>}
          </div>
          <ChevronRight size={16} style={{ color: '#94A3B8' }} />
        </Link>
      ) : (
        <Link to="/teams" className="card p-4 flex items-center gap-3 hover:border-neon-green/30 transition-colors">
          <Users size={18} style={{ color: '#94A3B8' }} className="flex-shrink-0" />
          <div className="flex-1">
            <p className="text-white font-semibold">Join a team</p>
            <p className="text-xs" style={{ color: '#94A3B8' }}>Collaborate with other hunters in your area</p>
          </div>
          <ChevronRight size={16} style={{ color: '#94A3B8' }} />
        </Link>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { to: '/collaborator/submit',      label: 'Submit Deal',   icon: '📤', color: '#4ADE80' },
          { to: '/collaborator/submissions', label: 'My Submissions', icon: '📋', color: '#00D4FF' },
          { to: '/collaborator/leaderboard', label: 'Leaderboard',   icon: '🏆', color: '#FACC15' },
          { to: '/feed',                     label: 'Deal Feed',     icon: '🔥', color: '#F87171' },
        ].map(a => (
          <Link key={a.to} to={a.to}
            className="card p-4 flex items-center gap-3 hover:border-neon-green/30 transition-colors">
            <span className="text-2xl">{a.icon}</span>
            <span className="text-white font-semibold text-sm">{a.label}</span>
          </Link>
        ))}
      </div>

      {/* Recent submissions */}
      {recentSubmissions.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold">Recent Submissions</h3>
            <Link to="/collaborator/submissions" className="text-xs text-neon-blue hover:underline">View all</Link>
          </div>
          <div className="space-y-2">
            {recentSubmissions.map(s => (
              <div key={s.id} className="flex items-center gap-3 py-2 border-b last:border-0" style={{ borderColor: '#273449' }}>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{s.product_name || s.upc || s.sku || 'Unnamed'}</p>
                  <p className="text-xs" style={{ color: '#94A3B8' }}>{s.store_name} · ${parseFloat(s.found_price).toFixed(2)}</p>
                </div>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ color: STATUS_COLOR[s.status] || '#94A3B8', background: `${STATUS_COLOR[s.status] || '#94A3B8'}15` }}>
                  {STATUS_LABEL[s.status] || s.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
