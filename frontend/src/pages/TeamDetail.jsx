import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Users, Trophy, MapPin, CheckCircle, Crown, Shield, UserPlus, Star, Zap } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';

const LEVEL_COLOR = {
  'Legend Hunter': '#f59e0b',
  'Elite Hunter':  '#8b5cf6',
  'Gold Hunter':   '#f59e0b',
  'Silver Hunter': '#94a3b8',
  'Bronze Hunter': '#b45309',
  'Rookie Hunter': '#6b7280',
};

const ROLE_CONFIG = {
  owner:   { icon: Crown,  label: 'Founder', color: '#FACC15' },
  manager: { icon: Shield, label: 'Manager', color: '#00D4FF' },
  hunter:  { icon: Zap,    label: 'Hunter',  color: '#94A3B8' },
};

const RANK_MEDAL = { 0: '🥇', 1: '🥈', 2: '🥉' };

export default function TeamDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [team, setTeam] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);

  useEffect(() => { load(); }, [id]);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get(`/collaborators/teams/${id}`);
      setTeam(r.data.team);
      setMembers(r.data.members || []);
    } catch {} finally {
      setLoading(false);
    }
  }

  async function joinTeam() {
    setJoining(true);
    try {
      await api.post(`/collaborators/teams/${id}/join`);
      setJoined(true);
      await load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to join team');
    } finally {
      setJoining(false);
    }
  }

  const isMember = members.some(m => m.user_id === user?.id);
  const totalPoints = members.reduce((s, m) => s + parseInt(m.points || 0), 0);

  if (loading) {
    return (
      <div className="p-6 flex justify-center items-center min-h-40">
        <div className="w-8 h-8 border-2 border-neon-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!team) {
    return (
      <div className="p-6 text-center space-y-3">
        <p className="text-4xl">👥</p>
        <p className="text-white font-semibold">Team not found</p>
        <Link to="/teams" className="text-neon-blue text-sm hover:underline">← Back to Teams</Link>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-xl mx-auto space-y-5">
      <Link to="/teams" className="text-xs flex items-center gap-1 hover:underline" style={{ color: '#94A3B8' }}>
        ← Teams
      </Link>

      {/* Team header card */}
      <div className="card p-5 space-y-4">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center font-black text-3xl flex-shrink-0"
            style={{ background: 'rgba(74,222,128,0.1)', border: '2px solid rgba(74,222,128,0.3)', color: '#4ADE80' }}>
            {team.name[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-black text-white leading-tight">{team.name}</h1>
            {(team.city || team.state) && (
              <p className="text-xs flex items-center gap-1 mt-1" style={{ color: '#94A3B8' }}>
                <MapPin size={10} /> {[team.city, team.state].filter(Boolean).join(', ')}
              </p>
            )}
            {team.description && (
              <p className="text-sm mt-1.5" style={{ color: '#CBD5E1' }}>{team.description}</p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Points',  value: parseInt(team.points || 0).toLocaleString(), color: '#FACC15' },
            { label: 'Deals',   value: team.approved_deals_count || 0,              color: '#4ADE80' },
            { label: 'Members', value: members.length,                              color: '#00D4FF' },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center py-3 rounded-xl" style={{ background: '#0F172A' }}>
              <p className="text-xl font-black" style={{ color }}>{value}</p>
              <p className="text-xs" style={{ color: '#94A3B8' }}>{label}</p>
            </div>
          ))}
        </div>

        {/* Join / Member button */}
        {!isMember ? (
          <button onClick={joinTeam} disabled={joining}
            className="w-full btn-primary flex items-center justify-center gap-2 py-3 font-bold disabled:opacity-50">
            <UserPlus size={16} />
            {joining ? 'Joining...' : 'Join This Team'}
          </button>
        ) : (
          <div className="flex items-center justify-center gap-2 py-2.5 rounded-xl"
            style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)' }}>
            <CheckCircle size={15} className="text-neon-green" />
            <span className="text-neon-green font-semibold text-sm">You are a member</span>
          </div>
        )}
      </div>

      {/* Members list */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <Users size={16} className="text-neon-green" />
            Members
            <span className="text-xs px-2 py-0.5 rounded-full font-bold"
              style={{ background: 'rgba(74,222,128,0.1)', color: '#4ADE80' }}>
              {members.length}
            </span>
          </h2>
          <p className="text-xs" style={{ color: '#64748B' }}>Ranked by points</p>
        </div>

        <div className="space-y-2">
          {members.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-3xl mb-2">👤</p>
              <p className="text-sm" style={{ color: '#94A3B8' }}>No members yet. Be the first to join!</p>
            </div>
          ) : members.map((m, i) => {
            const roleCfg = ROLE_CONFIG[m.role] || ROLE_CONFIG.hunter;
            const RoleIcon = roleCfg.icon;
            const levelColor = LEVEL_COLOR[m.level] || '#6b7280';
            const isMe = m.user_id === user?.id;
            const medal = RANK_MEDAL[i];

            return (
              <div key={m.user_id}
                className="flex items-center gap-3 p-3 rounded-xl transition-colors"
                style={isMe
                  ? { background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.2)' }
                  : { background: '#0F172A' }}>

                {/* Rank */}
                <div className="w-7 text-center flex-shrink-0">
                  <span className="text-sm font-bold" style={{ color: i < 3 ? '#f59e0b' : '#64748B' }}>
                    {medal || `#${i + 1}`}
                  </span>
                </div>

                {/* Avatar */}
                <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                  style={{ background: `${levelColor}18`, color: levelColor, border: `1px solid ${levelColor}30` }}>
                  {(m.display_name || m.name || 'U')[0].toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-white text-sm font-semibold truncate max-w-[120px]">
                      {m.display_name || m.name}
                    </span>
                    {isMe && (
                      <span className="text-[10px] text-neon-green font-bold">(you)</span>
                    )}
                    {m.level && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
                        style={{ color: levelColor, background: `${levelColor}18` }}>
                        {m.level}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5 text-xs" style={{ color: roleCfg.color }}>
                    <RoleIcon size={9} />
                    <span>{roleCfg.label}</span>
                    {m.approved_deals_count > 0 && (
                      <span style={{ color: '#4ADE80' }} className="ml-1">
                        · ✅ {m.approved_deals_count} deals
                      </span>
                    )}
                  </div>
                </div>

                {/* Points */}
                <div className="text-right flex-shrink-0">
                  <p className="text-base font-black" style={{ color: levelColor }}>
                    {parseInt(m.points || 0).toLocaleString()}
                  </p>
                  <p className="text-[10px]" style={{ color: '#64748B' }}>pts</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Team total */}
        {members.length > 0 && (
          <div className="mt-4 pt-3 flex items-center justify-between"
            style={{ borderTop: '1px solid #273449' }}>
            <span className="text-xs font-semibold" style={{ color: '#64748B' }}>Team Total</span>
            <span className="font-black" style={{ color: '#FACC15' }}>
              {totalPoints.toLocaleString()} pts
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Link to="/teams" className="flex-1 text-center py-2.5 rounded-xl text-sm font-semibold"
          style={{ background: '#1E293B', border: '1px solid #273449', color: '#94A3B8' }}>
          ← All Teams
        </Link>
        <Link to="/collaborator/leaderboard" className="flex-1 text-center py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5"
          style={{ background: '#1E293B', border: '1px solid #273449', color: '#94A3B8' }}>
          <Trophy size={13} /> Leaderboard
        </Link>
      </div>
    </div>
  );
}
