import { useState, useEffect } from 'react';
import { Trophy, Users } from 'lucide-react';
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

const RANK_STYLE = {
  1: { bg: '#f59e0b20', border: '#f59e0b40', text: '#f59e0b', emoji: '🥇' },
  2: { bg: '#94a3b820', border: '#94a3b840', text: '#94a3b8', emoji: '🥈' },
  3: { bg: '#b4530920', border: '#b4530940', text: '#b45309', emoji: '🥉' },
};

export default function CollaboratorLeaderboard() {
  const { user } = useAuth();
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/collaborators/leaderboard')
      .then(r => setLeaderboard(r.data.leaderboard || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4 lg:p-6 max-w-xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Trophy size={24} className="text-neon-green" /> Leaderboard
        </h1>
        <p style={{ color: '#CBD5E1' }} className="text-sm mt-1">Top deal hunters ranked by points</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-7 h-7 border-2 border-neon-green border-t-transparent rounded-full animate-spin" />
        </div>
      ) : leaderboard.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-4xl mb-3">🏆</p>
          <p className="text-white font-semibold">Leaderboard is empty</p>
          <p style={{ color: '#94A3B8' }} className="text-sm mt-1">Be the first to submit a deal!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {leaderboard.map((entry) => {
            const rank = parseInt(entry.rank);
            const rankStyle = RANK_STYLE[rank] || {};
            const levelColor = LEVEL_COLOR[entry.level] || '#6b7280';
            const isMe = entry.user_id === user?.id;

            return (
              <div key={entry.id}
                className="card p-4 flex items-center gap-4 transition-all"
                style={isMe ? { border: '1px solid rgba(74,222,128,0.4)', background: 'rgba(74,222,128,0.05)' } : {}}>
                {/* Rank */}
                <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm flex-shrink-0"
                  style={rankStyle.bg
                    ? { background: rankStyle.bg, border: `1px solid ${rankStyle.border}`, color: rankStyle.text }
                    : { background: '#1E293B', color: '#64748B', border: '1px solid #273449' }}>
                  {rankStyle.emoji || rank}
                </div>

                {/* Avatar */}
                <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold flex-shrink-0"
                  style={{ background: 'rgba(74,222,128,0.1)', color: '#4ADE80' }}>
                  {(entry.display_name || entry.user_name || 'U')[0].toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-semibold text-sm">
                      {entry.display_name || entry.user_name}
                      {isMe && <span className="ml-1 text-neon-green text-xs font-normal">(you)</span>}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                      style={{ color: levelColor, background: `${levelColor}20` }}>
                      {entry.level}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs" style={{ color: '#94A3B8' }}>
                    <span>✅ {entry.approved_deals_count || 0} deals approved</span>
                    {entry.team_name && (
                      <span className="flex items-center gap-1">
                        <Users size={9} /> {entry.team_name}
                      </span>
                    )}
                  </div>
                </div>

                {/* Points */}
                <div className="text-right flex-shrink-0">
                  <p className="text-lg font-black" style={{ color: levelColor }}>
                    {parseInt(entry.points || 0).toLocaleString()}
                  </p>
                  <p className="text-xs" style={{ color: '#94A3B8' }}>pts</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
