import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Users, Trophy, MapPin, CheckCircle, Crown, Shield, UserPlus } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';

const LEVEL_COLOR = {
  'Legend Hunter': '#f59e0b', 'Elite Hunter': '#8b5cf6', 'Gold Hunter': '#f59e0b',
  'Silver Hunter': '#94a3b8', 'Bronze Hunter': '#b45309', 'Rookie Hunter': '#6b7280',
};

const ROLE_CONFIG = {
  owner:   { icon: Crown,  label: 'Founder', color: '#f59e0b' },
  manager: { icon: Shield, label: 'Manager', color: '#00D4FF' },
  hunter:  { icon: Users,  label: 'Hunter',  color: '#94A3B8' },
};

export default function TeamDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [team, setTeam] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    api.get(`/collaborators/teams/${id}`)
      .then(r => { setTeam(r.data.team); setMembers(r.data.members || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  async function joinTeam() {
    setJoining(true);
    try {
      await api.post(`/collaborators/teams/${id}/join`);
      const r = await api.get(`/collaborators/teams/${id}`);
      setMembers(r.data.members || []);
      setTeam(r.data.team);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to join team');
    } finally {
      setJoining(false);
    }
  }

  const isMember = members.some(m => m.user_id === user?.id);

  if (loading) {
    return (
      <div className="p-6 flex justify-center">
        <div className="w-8 h-8 border-2 border-neon-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!team) {
    return (
      <div className="p-6 text-center">
        <p className="text-white font-semibold">Team not found</p>
        <Link to="/teams" className="text-neon-blue text-sm mt-2 block">← Back to Teams</Link>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-xl mx-auto space-y-5">
      <Link to="/teams" className="text-xs text-neon-blue hover:underline flex items-center gap-1">
        ← Teams
      </Link>

      {/* Team header */}
      <div className="card p-5 space-y-4">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-black text-2xl flex-shrink-0"
            style={{ background: 'rgba(74,222,128,0.1)', border: '2px solid rgba(74,222,128,0.3)' }}>
            {team.name[0].toUpperCase()}
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-black text-white">{team.name}</h1>
            {(team.city || team.state) && (
              <p className="text-xs flex items-center gap-1 mt-0.5" style={{ color: '#94A3B8' }}>
                <MapPin size={10} /> {[team.city, team.state].filter(Boolean).join(', ')}
              </p>
            )}
            {team.description && <p className="text-sm mt-1" style={{ color: '#CBD5E1' }}>{team.description}</p>}
          </div>
          {!isMember && (
            <button onClick={joinTeam} disabled={joining}
              className="btn-primary flex items-center gap-1.5 text-sm px-3 py-2 disabled:opacity-50">
              <UserPlus size={14} /> {joining ? 'Joining...' : 'Join'}
            </button>
          )}
          {isMember && (
            <span className="text-xs text-neon-green flex items-center gap-1">
              <CheckCircle size={12} /> Member
            </span>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Points',  value: parseInt(team.points || 0).toLocaleString(), color: '#FACC15', icon: Trophy },
            { label: 'Deals',   value: team.approved_deals_count || 0,              color: '#4ADE80', icon: CheckCircle },
            { label: 'Members', value: members.length,                              color: '#00D4FF', icon: Users },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center py-2 rounded-xl" style={{ background: '#1E293B' }}>
              <p className="text-lg font-black" style={{ color }}>{value}</p>
              <p className="text-xs" style={{ color: '#94A3B8' }}>{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Members */}
      <div className="card">
        <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
          <Users size={16} className="text-neon-green" /> Members ({members.length})
        </h2>
        <div className="space-y-2">
          {members.map((m, i) => {
            const roleCfg = ROLE_CONFIG[m.role] || ROLE_CONFIG.hunter;
            const RoleIcon = roleCfg.icon;
            const levelColor = LEVEL_COLOR[m.level] || '#6b7280';
            const isMe = m.user_id === user?.id;

            return (
              <div key={m.user_id}
                className="flex items-center gap-3 py-2 px-2 rounded-xl transition-colors"
                style={isMe ? { background: 'rgba(74,222,128,0.05)', border: '1px solid rgba(74,222,128,0.2)' } : {}}>
                <div className="w-6 text-center">
                  <span className="text-xs font-bold" style={{ color: i === 0 ? '#f59e0b' : '#64748B' }}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                  </span>
                </div>
                <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                  style={{ background: 'rgba(74,222,128,0.1)', color: '#4ADE80' }}>
                  {(m.display_name || m.name || 'U')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white text-sm font-medium">
                      {m.display_name || m.name}
                      {isMe && <span className="ml-1 text-neon-green text-xs">(you)</span>}
                    </span>
                    {m.level && (
                      <span className="text-[9px] px-1 py-0.5 rounded font-bold"
                        style={{ color: levelColor, background: `${levelColor}20` }}>
                        {m.level}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs" style={{ color: roleCfg.color }}>
                    <RoleIcon size={9} /> {roleCfg.label}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold" style={{ color: levelColor }}>
                    {parseInt(m.points || 0).toLocaleString()}
                  </p>
                  <p className="text-[10px]" style={{ color: '#94A3B8' }}>pts</p>
                </div>
              </div>
            );
          })}
          {members.length === 0 && (
            <p className="text-center py-4 text-sm" style={{ color: '#94A3B8' }}>No members yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
