import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Users, MapPin, Trophy, Plus, ChevronRight } from 'lucide-react';
import api from '../utils/api';

export default function Teams() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', city: '', state: '', description: '' });

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
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create team');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="p-4 lg:p-6 max-w-xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Users size={24} className="text-neon-green" /> Teams
          </h1>
          <p style={{ color: '#CBD5E1' }} className="text-sm mt-1">Groups of deal hunters organized by area</p>
        </div>
        <button onClick={() => setShowCreate(s => !s)}
          className="btn-primary flex items-center gap-2 text-sm px-3 py-2">
          <Plus size={14} /> Create
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="card p-4 space-y-3">
          <h3 className="text-white font-semibold">New team</h3>
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
              placeholder="Description (optional)" rows={2}
              className="w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none text-white resize-none"
              style={{ background: '#1E293B', border: '1px solid #334155' }}
            />
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowCreate(false)}
                className="flex-1 py-2 rounded-xl text-sm"
                style={{ background: '#1E293B', border: '1px solid #273449', color: '#94A3B8' }}>
                Cancel
              </button>
              <button type="submit" disabled={creating}
                className="flex-1 btn-primary py-2 text-sm disabled:opacity-50">
                {creating ? 'Creating...' : 'Create team'}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-7 h-7 border-2 border-neon-green border-t-transparent rounded-full animate-spin" />
        </div>
      ) : teams.length === 0 ? (
        <div className="card p-10 text-center space-y-3">
          <p className="text-4xl">👥</p>
          <p className="text-white font-semibold">No teams yet</p>
          <p style={{ color: '#94A3B8' }} className="text-sm">Create the first team and start hunting deals together</p>
        </div>
      ) : (
        <div className="space-y-3">
          {teams.map(team => (
            <Link key={team.id} to={`/teams/${team.slug || team.id}`}
              className="card p-4 flex items-center gap-4 hover:border-neon-green/30 transition-colors">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xl flex-shrink-0"
                style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.2)' }}>
                {team.name[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold">{team.name}</p>
                <div className="flex items-center gap-3 mt-0.5 text-xs" style={{ color: '#94A3B8' }}>
                  {(team.city || team.state) && (
                    <span className="flex items-center gap-1">
                      <MapPin size={9} /> {[team.city, team.state].filter(Boolean).join(', ')}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Users size={9} /> {team.member_count || 0} member{team.member_count !== 1 ? 's' : ''}
                  </span>
                  <span className="flex items-center gap-1">
                    <Trophy size={9} /> {parseInt(team.points || 0).toLocaleString()} pts
                  </span>
                </div>
                {team.description && (
                  <p className="text-xs mt-1 truncate" style={{ color: '#64748B' }}>{team.description}</p>
                )}
              </div>
              <ChevronRight size={16} style={{ color: '#94A3B8' }} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
