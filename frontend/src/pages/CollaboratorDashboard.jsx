import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Star, Award, CheckCircle, Clock, XCircle, Users, ChevronRight, Zap, Plus } from 'lucide-react';
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
  const [loading, setLoading] = useState(true);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [recentSubmissions, setRecentSubmissions] = useState([]);

  useEffect(() => { loadProfile(); }, []);

  async function loadProfile() {
    setLoading(true);
    try {
      const r = await api.get('/collaborators/profile');
      if (r.data.profile) {
        setProfile(r.data.profile);
        loadSubmissions();
      }
    } catch {} finally {
      setLoading(false);
    }
  }

  async function loadSubmissions() {
    try {
      const r = await api.get('/collaborators/submissions?limit=5');
      setRecentSubmissions(r.data.submissions || []);
    } catch {}
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
  const totalSubmissions = (profile.approved_deals_count || 0) + (profile.pending_deals_count || 0) + (profile.rejected_deals_count || 0);
  const commissionEst = parseFloat(profile.total_commission_estimated || 0).toFixed(2);

  const STATUS_COLOR = { approved: '#4ADE80', pending: '#FACC15', rejected: '#F87171', duplicate: '#94A3B8' };
  const STATUS_LABEL = { approved: 'Approved', pending: 'Pending', rejected: 'Rejected', duplicate: 'Duplicate' };

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
        <StatCard label="Approved" value={profile.approved_deals_count || 0}
          icon={<CheckCircle size={18} style={{ color: '#4ADE80' }} />} color="#4ADE80" />
        <StatCard label="Pending" value={profile.pending_deals_count || 0}
          icon={<Clock size={18} style={{ color: '#FACC15' }} />} color="#FACC15" />
        <StatCard label="Rejected" value={profile.rejected_deals_count || 0}
          icon={<XCircle size={18} style={{ color: '#F87171' }} />} color="#F87171" />
        <StatCard label="Reputation" value={`${repScore}%`}
          icon={<Star size={18} style={{ color: '#8B5CF6' }} />} color="#8B5CF6"
          sub={totalSubmissions ? `${totalSubmissions} total` : ''} />
      </div>

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
