import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Users, MapPin, Trophy, Plus, ChevronRight, Zap, CheckCircle, Star, X } from 'lucide-react';
import api from '../utils/api';

const RANK_MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };

const TAB_CONFIG = [
  { key: 'top',    label: '🏆 Top Teams',    sort: (a, b) => b.points - a.points },
  { key: 'active', label: '⚡ Most Active',  sort: (a, b) => b.approved_deals_count - a.approved_deals_count },
  { key: 'new',    label: '✨ New Teams',    sort: (a, b) => new Date(b.created_at) - new Date(a.created_at) },
];

function TeamCard({ team, rank, onJoin, joining }) {
  const medal = RANK_MEDAL[rank];
  return (
    <div className="card p-4 space-y-3 hover:border-neon-green/30 transition-colors">
      <div className="flex items-start gap-3">
        {/* Rank */}
        <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm flex-shrink-0"
          style={rank <= 3
            ? { background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b' }
            : { background: '#1E293B', border: '1px solid #273449', color: '#64748B' }}>
          {medal || `#${rank}`}
        </div>

        {/* Avatar */}
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xl flex-shrink-0"
          style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.2)', color: '#4ADE80' }}>
          {team.name[0].toUpperCase()}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold leading-tight">{team.name}</p>
          {(team.city || team.state) && (
            <p className="text-xs flex items-center gap-1 mt-0.5" style={{ color: '#94A3B8' }}>
              <MapPin size={10} /> {[team.city, team.state].filter(Boolean).join(', ')}
            </p>
          )}
        </div>
      </div>

      {/* Description */}
      {team.description && (
        <p className="text-sm" style={{ color: '#94A3B8' }}>{team.description}</p>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="text-center py-2 rounded-xl" style={{ background: '#0F172A' }}>
          <p className="text-base font-black" style={{ color: '#FACC15' }}>
            {parseInt(team.points || 0).toLocaleString()}
          </p>
          <p className="text-[10px]" style={{ color: '#94A3B8' }}>Points</p>
        </div>
        <div className="text-center py-2 rounded-xl" style={{ background: '#0F172A' }}>
          <p className="text-base font-black text-neon-green">
            {team.approved_deals_count || 0}
          </p>
          <p className="text-[10px]" style={{ color: '#94A3B8' }}>Deals</p>
        </div>
        <div className="text-center py-2 rounded-xl" style={{ background: '#0F172A' }}>
          <p className="text-base font-black" style={{ color: '#00D4FF' }}>
            {team.member_count || 0}
          </p>
          <p className="text-[10px]" style={{ color: '#94A3B8' }}>Members</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Link to={`/teams/${team.slug || team.id}`}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold transition-colors"
          style={{ background: '#1E293B', border: '1px solid #273449', color: '#CBD5E1' }}>
          <Users size={13} /> View Team
        </Link>
        <button onClick={() => onJoin(team)}
          disabled={joining === team.id}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
          style={{ background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.3)', color: '#4ADE80' }}>
          {joining === team.id ? '...' : <><Plus size={13} /> Join</>}
        </button>
      </div>
    </div>
  );
}

export default function Teams() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('top');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(null);
  const [form, setForm] = useState({ name: '', city: '', state: '', description: '' });
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/collaborators/teams')
      .then(r => setTeams(r.data.teams || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function createTeam(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      const r = await api.post('/collaborators/teams', form);
      setTeams(t => [r.data.team, ...t]);
      setShowCreate(false);
      setForm({ name: '', city: '', state: '', description: '' });
      navigate(`/teams/${r.data.team.slug || r.data.team.id}`);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create team');
    } finally {
      setCreating(false);
    }
  }

  async function joinTeam(team) {
    setJoining(team.id);
    try {
      await api.post(`/collaborators/teams/${team.id}/join`);
      navigate(`/teams/${team.slug || team.id}`);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to join team');
      setJoining(null);
    }
  }

  const sortedTeams = [...teams].sort(TAB_CONFIG.find(t => t.key === tab)?.sort || (() => 0));

  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Users size={24} className="text-neon-green" /> Teams
          </h1>
          <p style={{ color: '#CBD5E1' }} className="text-sm mt-1">
            Join a team and hunt deals together
          </p>
        </div>
        <button onClick={() => setShowCreate(s => !s)}
          className="btn-primary flex items-center gap-2 text-sm px-3 py-2">
          {showCreate ? <X size={14} /> : <Plus size={14} />}
          {showCreate ? 'Cancel' : 'Create'}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="card p-4 space-y-3 border-neon-green/20"
          style={{ borderColor: 'rgba(74,222,128,0.2)' }}>
          <h3 className="text-white font-semibold flex items-center gap-2">
            <Zap size={15} className="text-neon-green" /> New Team
          </h3>
          <form onSubmit={createTeam} className="space-y-3">
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Team name *" required
              className="w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none text-white"
              style={{ background: '#1E293B', border: '1px solid #334155' }}
            />
            <div className="grid grid-cols-2 gap-2">
              <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                placeholder="City"
                className="rounded-xl px-4 py-2.5 text-sm focus:outline-none text-white"
                style={{ background: '#1E293B', border: '1px solid #334155' }}
              />
              <input value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))}
                placeholder="State" maxLength={5}
                className="rounded-xl px-4 py-2.5 text-sm focus:outline-none text-white"
                style={{ background: '#1E293B', border: '1px solid #334155' }}
              />
            </div>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe your team (optional)" rows={2}
              className="w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none text-white resize-none"
              style={{ background: '#1E293B', border: '1px solid #334155' }}
            />
            <button type="submit" disabled={creating || !form.name.trim()}
              className="w-full btn-primary py-2.5 text-sm font-bold disabled:opacity-50">
              {creating ? 'Creating...' : 'Create Team'}
            </button>
          </form>
        </div>
      )}

      {/* Leaderboard tabs */}
      <div className="space-y-3">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {TAB_CONFIG.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                tab === t.key ? 'bg-neon-green text-dark-900' : 'text-gray-400 hover:text-white'
              }`}
              style={{ background: tab === t.key ? undefined : '#141A26', border: '1px solid #273449' }}>
              {t.label}
              {t.key === 'top' && <span className="text-[10px] opacity-70">{teams.length}</span>}
            </button>
          ))}
        </div>

        {/* Tab description */}
        <p className="text-xs" style={{ color: '#64748B' }}>
          {tab === 'top'    && 'Ranked by total points earned across all members.'}
          {tab === 'active' && 'Ranked by number of approved deals submitted.'}
          {tab === 'new'    && 'Recently created teams — be an early member!'}
        </p>
      </div>

      {/* Teams list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-7 h-7 border-2 border-neon-green border-t-transparent rounded-full animate-spin" />
        </div>
      ) : sortedTeams.length === 0 ? (
        <div className="card p-10 text-center space-y-3">
          <p className="text-4xl">👥</p>
          <p className="text-white font-semibold">No teams yet</p>
          <p style={{ color: '#94A3B8' }} className="text-sm">Be the first to create a team!</p>
          <button onClick={() => setShowCreate(true)}
            className="btn-primary inline-flex items-center gap-2 text-sm px-5 py-2">
            <Plus size={13} /> Create First Team
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedTeams.map((team, i) => (
            <TeamCard key={team.id} team={team} rank={i + 1} onJoin={joinTeam} joining={joining} />
          ))}
        </div>
      )}

      {/* Community stats footer */}
      {!loading && teams.length > 0 && (
        <div className="card p-4">
          <p className="text-xs font-semibold mb-3" style={{ color: '#94A3B8' }}>COMMUNITY STATS</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xl font-black text-neon-green">{teams.length}</p>
              <p className="text-xs" style={{ color: '#94A3B8' }}>Teams</p>
            </div>
            <div>
              <p className="text-xl font-black" style={{ color: '#FACC15' }}>
                {teams.reduce((s, t) => s + parseInt(t.member_count || 0), 0)}
              </p>
              <p className="text-xs" style={{ color: '#94A3B8' }}>Hunters</p>
            </div>
            <div>
              <p className="text-xl font-black" style={{ color: '#00D4FF' }}>
                {teams.reduce((s, t) => s + parseInt(t.approved_deals_count || 0), 0)}
              </p>
              <p className="text-xs" style={{ color: '#94A3B8' }}>Deals Found</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
