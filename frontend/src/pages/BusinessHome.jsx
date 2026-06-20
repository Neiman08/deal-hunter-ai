import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Briefcase, TrendingUp, Star, Shield, Wallet, Users,
  Zap, Gift, Target, CheckCircle, Clock, Award, Plus,
  ChevronRight, Copy, Check, AlertTriangle, BarChart2,
  Scan, Upload, ThumbsUp, Flame, Activity, GraduationCap, Bot, Trophy, MapPin, Bell,
} from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';

// ── Level config ───────────────────────────────────────────────────────────────
const LEVEL_CONFIG = {
  'Hunter':            { color: '#4ADE80', bg: 'rgba(74,222,128,0.1)',  icon: '🎯', tier: 1 },
  'Líder':             { color: '#60A5FA', bg: 'rgba(96,165,250,0.1)',  icon: '⚡', tier: 2 },
  'Director Regional': { color: '#C084FC', bg: 'rgba(192,132,252,0.1)', icon: '🌎', tier: 3 },
  'Director Nacional': { color: '#FBBF24', bg: 'rgba(251,191,36,0.1)',  icon: '👑', tier: 4 },
};

const MISSION_TYPE_COLOR = {
  daily:     { label: 'Daily',     color: '#4ADE80' },
  weekly:    { label: 'Weekly',    color: '#60A5FA' },
  monthly:   { label: 'Monthly',   color: '#C084FC' },
  permanent: { label: 'All Time',  color: '#FBBF24' },
};

const TX_TYPE_META = {
  scan_product:      { icon: Scan,     color: '#4ADE80', label: 'Scan' },
  submit_deal:       { icon: Upload,   color: '#60A5FA', label: 'Deal Submitted' },
  confirm_deal:      { icon: ThumbsUp, color: '#C084FC', label: 'Confirmed Deal' },
  deal_verified:     { icon: CheckCircle, color: '#4ADE80', label: 'Deal Verified' },
  mission_completed: { icon: Target,   color: '#FBBF24', label: 'Mission Complete' },
  referral_active:   { icon: Gift,     color: '#F97316', label: 'Referral Active' },
  reward_redeemed:   { icon: Star,     color: '#F43F5E', label: 'Reward Redeemed' },
};

// ── Small reusable components ──────────────────────────────────────────────────

function StatTile({ label, value, sub, icon, color = '#4ADE80' }) {
  return (
    <div className="bg-dark-800/60 rounded-2xl p-4 flex flex-col gap-1 border border-dark-700">
      <div className="flex items-center justify-between mb-1">
        <span className="text-gray-400 text-xs">{label}</span>
        <span style={{ color }} className="opacity-70">{icon}</span>
      </div>
      <span className="text-white font-black text-xl leading-none">{value}</span>
      {sub && <span className="text-gray-500 text-xs">{sub}</span>}
    </div>
  );
}

function MissionCard({ m }) {
  const pct  = m.target > 0 ? Math.min(100, Math.round((m.progress / m.target) * 100)) : 0;
  const meta = MISSION_TYPE_COLOR[m.type] || MISSION_TYPE_COLOR.daily;

  return (
    <div className={`rounded-xl p-3 border ${m.completed ? 'border-neon-green/20 bg-neon-green/5' : 'border-dark-700 bg-dark-800/40'}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: `${meta.color}18`, color: meta.color }}>
              {meta.label}
            </span>
            {m.completed && (
              <span className="text-neon-green text-[10px] flex items-center gap-0.5">
                <CheckCircle size={10} /> Done
              </span>
            )}
          </div>
          <p className="text-white text-sm font-semibold truncate">{m.title}</p>
          <p className="text-gray-500 text-xs">{m.description}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-neon-green text-xs font-bold">+{m.xp_reward} XP</p>
          <p className="text-gray-500 text-xs">{m.progress}/{m.target}</p>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-dark-700">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: m.completed ? '#4ADE80' : meta.color }}
        />
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function BusinessHome() {
  const { user } = useAuth();
  const navigate  = useNavigate();
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [copied, setCopied]     = useState(false);
  const [univData, setUnivData]   = useState(null);
  const [coachData, setCoachData] = useState(null);
  const [hofData, setHofData]     = useState(null);
  const [notifData, setNotifData] = useState(null);

  useEffect(() => {
    api.get('/business/home')
      .then(r => setData(r.data))
      .catch(err => {
        if (err.response?.status === 401) navigate('/login');
        else setError('Failed to load Business dashboard.');
      })
      .finally(() => setLoading(false));

    // Load background data (non-blocking)
    api.get('/university/courses').then(r => setUnivData(r.data)).catch(() => {});
    api.get('/business/coach/suggestions').then(r => setCoachData(r.data)).catch(() => {});
    api.get('/business/hall-of-fame').then(r => setHofData(r.data)).catch(() => {});
    api.get('/business/notifications?limit=5').then(r => setNotifData(r.data)).catch(() => {});
  }, [navigate]);

  function copyRef() {
    if (!data?.referrals?.referral_link) return;
    navigator.clipboard.writeText(data.referrals.referral_link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-neon-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <AlertTriangle size={28} className="mx-auto text-yellow-400 mb-2" />
        <p className="text-gray-400 text-sm">{error}</p>
        <button onClick={() => window.location.reload()} className="btn-primary mt-3 text-sm px-5">Retry</button>
      </div>
    );
  }

  if (!data) return null;

  const { profile, wallet, referrals, team, rank, missions, badges, recent_transactions: txs = [] } = data;
  const lvlCfg   = LEVEL_CONFIG[profile.level] || LEVEL_CONFIG['Hunter'];
  const dailyMissions   = missions.filter(m => m.type === 'daily');
  const weeklyMissions  = missions.filter(m => m.type === 'weekly');
  const monthlyMissions = missions.filter(m => m.type === 'monthly');
  const permMissions    = missions.filter(m => m.type === 'permanent');

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-2xl mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Briefcase size={20} className="text-neon-green" />
            <h1 className="text-xl font-black text-white">Deal Hunter Business</h1>
          </div>
          <p className="text-gray-400 text-sm mt-0.5">
            Welcome back, <span className="text-white font-semibold">{profile.display_name || user?.name}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/business/notifications" className="relative p-2 rounded-xl border border-dark-700 text-gray-400 hover:text-white hover:border-dark-600 transition-colors">
            <Bell size={16} />
            {(notifData?.unread_count || 0) > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black flex items-center justify-center">
                {Math.min(9, notifData.unread_count)}
              </span>
            )}
          </Link>
          <Link to="/collaborator/submit"
            className="btn-primary flex items-center gap-1.5 text-sm px-4 py-2">
            <Plus size={14} /> Report Deal
          </Link>
        </div>
      </div>

      {/* ── Level + XP card ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl p-5 border"
        style={{ background: lvlCfg.bg, borderColor: `${lvlCfg.color}30` }}>
        <div className="flex items-center gap-4 mb-4">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
            style={{ background: `${lvlCfg.color}15`, border: `2px solid ${lvlCfg.color}30` }}>
            {lvlCfg.icon}
          </div>
          <div className="flex-1">
            <p className="text-xs uppercase tracking-widest font-bold mb-0.5" style={{ color: lvlCfg.color }}>
              Nivel {profile.tier} — {profile.level}
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-white">{profile.points.toLocaleString()}</span>
              <span className="text-gray-400 text-sm">XP</span>
            </div>
            {profile.next_level_at && (
              <p className="text-xs mt-0.5" style={{ color: `${lvlCfg.color}99` }}>
                {(profile.next_level_at - profile.points).toLocaleString()} XP to {profile.next_level_name}
              </p>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-gray-500 text-xs">Global Rank</p>
            <p className="text-white font-black text-xl">#{rank}</p>
          </div>
        </div>

        {/* XP Progress bar */}
        {profile.next_level_at && (
          <div>
            <div className="flex justify-between text-xs mb-1.5" style={{ color: `${lvlCfg.color}80` }}>
              <span>{profile.level}</span>
              <span>{profile.progress}% · {profile.next_level_name}</span>
            </div>
            <div className="h-2.5 rounded-full bg-dark-900/60">
              <div className="h-full rounded-full transition-all"
                style={{ width: `${profile.progress}%`, background: lvlCfg.color }} />
            </div>
          </div>
        )}

        {/* Trust Score + Level inline */}
        <div className="flex items-center gap-3 mt-3">
          <div className="flex items-center gap-1.5">
            <Shield size={12} style={{ color: lvlCfg.color }} />
            <span className="text-xs" style={{ color: `${lvlCfg.color}99` }}>
              Trust: <span className="font-bold text-white">{profile.trust_score}</span>/100
            </span>
          </div>
          {profile.trust_level && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{
                background: profile.trust_level === 'Excelente' ? '#4ADE8018' : profile.trust_level === 'Bueno' ? '#60A5FA18' : profile.trust_level === 'En observación' ? '#FBBF2418' : profile.trust_level === 'Suspendido' ? '#F43F5E18' : '#9CA3AF18',
                color: profile.trust_level === 'Excelente' ? '#4ADE80' : profile.trust_level === 'Bueno' ? '#60A5FA' : profile.trust_level === 'En observación' ? '#FBBF24' : profile.trust_level === 'Suspendido' ? '#F43F5E' : '#9CA3AF',
              }}>
              {profile.trust_level}
            </span>
          )}
        </div>
      </div>

      {/* ── Leadership quick links (tier-based) ─────────────────────────── */}
      {profile.tier >= 2 && (
        <div className="grid grid-cols-2 gap-3">
          <Link to="/business/crm"
            className="flex items-center gap-3 p-3 rounded-xl border border-dark-700 bg-dark-800/40 hover:border-neon-green/30 hover:bg-dark-700/30 transition-all">
            <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center flex-shrink-0">
              <Users size={14} className="text-blue-400" />
            </div>
            <div className="min-w-0">
              <p className="text-white text-xs font-semibold">Team CRM</p>
              <p className="text-gray-500 text-[10px]">Manage your members</p>
            </div>
          </Link>
          <Link to="/business/stats"
            className="flex items-center gap-3 p-3 rounded-xl border border-dark-700 bg-dark-800/40 hover:border-neon-green/30 hover:bg-dark-700/30 transition-all">
            <div className="w-8 h-8 rounded-lg bg-neon-green/15 flex items-center justify-center flex-shrink-0">
              <BarChart2 size={14} className="text-neon-green" />
            </div>
            <div className="min-w-0">
              <p className="text-white text-xs font-semibold">Business Stats</p>
              <p className="text-gray-500 text-[10px]">Production metrics</p>
            </div>
          </Link>
        </div>
      )}

      {/* ── Stats grid ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Available Points"
          value={wallet.points_available.toLocaleString()}
          sub="redeemable"
          icon={<Star size={14} />}
          color="#FBBF24"
        />
        <StatTile
          label="Credit Balance"
          value={`$${parseFloat(wallet.credit_balance).toFixed(2)}`}
          sub="wallet"
          icon={<Wallet size={14} />}
          color="#4ADE80"
        />
        <StatTile
          label="Deals Verified"
          value={profile.approved_deals}
          sub="approved"
          icon={<CheckCircle size={14} />}
          color="#60A5FA"
        />
        <StatTile
          label="Referrals"
          value={referrals.conversions}
          sub={`${referrals.total_signups} signups`}
          icon={<Gift size={14} />}
          color="#C084FC"
        />
      </div>

      {/* ── Quick actions ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <Link to="/referrals"
          className="flex items-center gap-3 p-4 rounded-2xl bg-dark-800/60 border border-dark-700 hover:border-neon-green/30 transition-colors group">
          <div className="w-10 h-10 rounded-xl bg-neon-green/10 flex items-center justify-center flex-shrink-0">
            <Gift size={18} className="text-neon-green" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold">Invite People</p>
            <p className="text-gray-500 text-xs truncate">
              {referrals.code ? `Code: ${referrals.code}` : 'Get your code →'}
            </p>
          </div>
          <ChevronRight size={14} className="text-gray-600 group-hover:text-neon-green transition-colors" />
        </Link>

        <Link to="/teams"
          className="flex items-center gap-3 p-4 rounded-2xl bg-dark-800/60 border border-dark-700 hover:border-neon-blue/30 transition-colors group">
          <div className="w-10 h-10 rounded-xl bg-neon-blue/10 flex items-center justify-center flex-shrink-0">
            <Users size={18} className="text-neon-blue" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold">
              {team ? team.name : 'Join a Team'}
            </p>
            <p className="text-gray-500 text-xs">
              {team ? `${team.member_count || '?'} members` : 'Find your squad →'}
            </p>
          </div>
          <ChevronRight size={14} className="text-gray-600 group-hover:text-neon-blue transition-colors" />
        </Link>

        <Link to="/community"
          className="flex items-center gap-3 p-4 rounded-2xl bg-dark-800/60 border border-dark-700 hover:border-yellow-400/30 transition-colors group">
          <div className="w-10 h-10 rounded-xl bg-yellow-400/10 flex items-center justify-center flex-shrink-0">
            <Zap size={18} className="text-yellow-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold">Community</p>
            <p className="text-gray-500 text-xs">Deal feed & confirmations</p>
          </div>
          <ChevronRight size={14} className="text-gray-600 group-hover:text-yellow-400 transition-colors" />
        </Link>

        <Link to="/collaborator/leaderboard"
          className="flex items-center gap-3 p-4 rounded-2xl bg-dark-800/60 border border-dark-700 hover:border-purple-400/30 transition-colors group">
          <div className="w-10 h-10 rounded-xl bg-purple-400/10 flex items-center justify-center flex-shrink-0">
            <Award size={18} className="text-purple-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold">Leaderboard</p>
            <p className="text-gray-500 text-xs">You're #{rank} nationwide</p>
          </div>
          <ChevronRight size={14} className="text-gray-600 group-hover:text-purple-400 transition-colors" />
        </Link>
      </div>

      {/* ── Referral link ────────────────────────────────────────────────────── */}
      {referrals.referral_link && (
        <div className="rounded-2xl p-4 border border-purple-400/20 bg-purple-400/5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-purple-300 text-sm font-semibold flex items-center gap-2">
              <Gift size={14} /> Your Referral Link
            </p>
            <button onClick={copyRef}
              className="flex items-center gap-1.5 text-xs text-purple-300 hover:text-white transition-colors">
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="text-gray-400 text-xs font-mono truncate bg-dark-800/60 px-3 py-2 rounded-xl">
            {referrals.referral_link}
          </p>
        </div>
      )}

      {/* ── Hall of Fame card ───────────────────────────────────────────────── */}
      {(() => {
        const topHunter = hofData?.top_hunters?.[0];
        const topTeam   = hofData?.top_teams?.[0];
        const topCity   = hofData?.top_cities?.[0];
        const myRank    = hofData?.my_rank;
        return (
          <div className="rounded-2xl border border-dark-700 bg-dark-800/40 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-dark-700">
              <Trophy size={14} className="text-yellow-400" />
              <h2 className="text-white font-bold text-sm">Hall of Fame</h2>
              {myRank && (
                <span className="text-gray-400 text-xs">— You're #{myRank}</span>
              )}
              <Link to="/business/hall-of-fame" className="ml-auto text-neon-blue text-xs hover:underline">
                View All →
              </Link>
            </div>
            <div className="divide-y divide-dark-700">
              {topHunter && (
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-base flex-shrink-0">🥇</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide">Top Hunter</p>
                    <p className="text-white text-xs font-semibold truncate">{topHunter.name || 'Hunter'}</p>
                  </div>
                  <span className="text-neon-green text-xs font-bold flex-shrink-0">
                    {(topHunter.xp || 0).toLocaleString()} XP
                  </span>
                </div>
              )}
              {topTeam && (
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <Users size={14} className="text-neon-blue flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide">Top Team</p>
                    <p className="text-white text-xs font-semibold truncate">{topTeam.name}</p>
                  </div>
                  <span className="text-neon-blue text-xs font-bold flex-shrink-0">
                    {parseInt(topTeam.total_xp || 0).toLocaleString()} XP
                  </span>
                </div>
              )}
              {topCity && (
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <MapPin size={14} className="text-purple-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide">Top City</p>
                    <p className="text-white text-xs font-semibold">
                      {topCity.city}{topCity.state ? `, ${topCity.state}` : ''}
                    </p>
                  </div>
                  <span className="text-purple-400 text-xs font-bold flex-shrink-0">
                    {topCity.verified_deals || 0} deals
                  </span>
                </div>
              )}
              {!topHunter && !topTeam && !topCity && (
                <div className="px-4 py-4 text-center">
                  <Trophy size={20} className="mx-auto text-gray-600 mb-1" />
                  <p className="text-gray-500 text-xs">Rankings loading…</p>
                </div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-dark-700">
              <Link to="/business/hall-of-fame"
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold"
                style={{ background: '#FBBF2410', color: '#FBBF24', border: '1px solid #FBBF2425' }}>
                <Trophy size={13} /> View Hall of Fame
              </Link>
            </div>
          </div>
        );
      })()}

      {/* ── University Progress card ─────────────────────────────────────────── */}
      {(() => {
        const courses     = univData?.courses || [];
        const completed   = courses.filter(c => c.is_completed).length;
        const inProgress  = courses.filter(c => !c.is_completed && (c.completed_lessons || 0) > 0).length;
        const certs       = courses.filter(c => c.has_certificate).length;
        const next        = courses.find(c => !c.is_completed && (c.completed_lessons || 0) > 0)
                         || courses.find(c => !c.is_completed);
        const totalXp     = courses.filter(c => !c.is_completed).reduce((s, c) => s + (c.xp_reward || 0), 0);
        return (
          <div className="rounded-2xl border border-dark-700 bg-dark-800/40 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-dark-700">
              <GraduationCap size={14} className="text-neon-green" />
              <h2 className="text-white font-bold text-sm">University Progress</h2>
              <Link to="/business/university" className="ml-auto text-neon-blue text-xs hover:underline">
                Continue Learning →
              </Link>
            </div>
            <div className="grid grid-cols-3 divide-x divide-dark-700">
              {[
                { label: 'Completed',   value: completed,   color: '#4ADE80' },
                { label: 'In Progress', value: inProgress,  color: '#60A5FA' },
                { label: 'Certificates', value: certs,      color: '#FBBF24' },
              ].map(({ label, value, color }) => (
                <div key={label} className="p-3 text-center">
                  <p className="text-gray-500 text-[10px] uppercase tracking-wide mb-0.5">{label}</p>
                  <p className="font-black text-lg leading-none" style={{ color }}>{value}</p>
                </div>
              ))}
            </div>
            {next && (
              <div className="px-4 py-3 border-t border-dark-700 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-gray-500 text-[10px]">
                    {inProgress > 0 ? 'Continue:' : 'Next course:'}
                  </p>
                  <p className="text-white text-xs font-semibold truncate">{next.title}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                  {totalXp > 0 && (
                    <span className="text-neon-green text-xs font-bold">+{totalXp} XP available</span>
                  )}
                  <Link to="/business/university"
                    className="text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors"
                    style={{ background: '#4ADE8015', color: '#4ADE80', border: '1px solid #4ADE8030' }}>
                    {inProgress > 0 ? 'Continue' : 'Start'} →
                  </Link>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Coach IA card ─────────────────────────────────────────────────────── */}
      {(() => {
        const suggs = coachData?.suggestions?.slice(0, 2) || [];
        return (
          <div className="rounded-2xl border border-dark-700 bg-dark-800/40 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-dark-700">
              <Bot size={14} className="text-neon-green" />
              <h2 className="text-white font-bold text-sm">Coach IA</h2>
              <Link to="/business/coach" className="ml-auto text-neon-blue text-xs hover:underline">
                Open Coach →
              </Link>
            </div>
            {suggs.length > 0 ? (
              <div className="divide-y divide-dark-700">
                {suggs.map((s, i) => (
                  <div key={i} className="px-4 py-3 flex items-start gap-3">
                    <div className="w-7 h-7 rounded-lg bg-neon-green/10 flex items-center justify-center flex-shrink-0">
                      <Zap size={12} className="text-neon-green" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs font-semibold">{s.title}</p>
                      <p className="text-gray-500 text-[11px] mt-0.5 leading-relaxed line-clamp-2">{s.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-4 text-center">
                <Bot size={20} className="mx-auto text-gray-600 mb-1.5" />
                <p className="text-gray-500 text-xs">Your coach is analyzing your data…</p>
              </div>
            )}
            <div className="px-4 py-3 border-t border-dark-700">
              <Link to="/business/coach"
                className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold transition-colors"
                style={{ background: '#4ADE8010', color: '#4ADE80', border: '1px solid #4ADE8025' }}>
                <Bot size={13} /> Chat with Coach
              </Link>
            </div>
          </div>
        );
      })()}

      {/* ── Missions ────────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <h2 className="text-white font-bold flex items-center gap-2">
          <Target size={16} className="text-neon-green" /> Active Missions
        </h2>

        {dailyMissions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <Clock size={10} /> Daily
            </p>
            {dailyMissions.map(m => <MissionCard key={m.id} m={m} />)}
          </div>
        )}

        {weeklyMissions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <BarChart2 size={10} /> Weekly
            </p>
            {weeklyMissions.map(m => <MissionCard key={m.id} m={m} />)}
          </div>
        )}

        {monthlyMissions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp size={10} /> Monthly
            </p>
            {monthlyMissions.map(m => <MissionCard key={m.id} m={m} />)}
          </div>
        )}

        {permMissions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <Star size={10} /> All Time
            </p>
            {permMissions.map(m => <MissionCard key={m.id} m={m} />)}
          </div>
        )}
      </div>

      {/* ── Badges ──────────────────────────────────────────────────────────── */}
      {badges?.length > 0 && (
        <div>
          <h2 className="text-white font-bold flex items-center gap-2 mb-3">
            <Award size={16} className="text-yellow-400" /> Badges Earned
          </h2>
          <div className="flex flex-wrap gap-2">
            {badges.map(b => (
              <div key={b.badge_slug}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-yellow-400/10 border border-yellow-400/20">
                <Star size={11} className="text-yellow-400" />
                <span className="text-yellow-300 text-xs font-semibold">{b.badge_name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Level roadmap ────────────────────────────────────────────────────── */}
      <div className="rounded-2xl p-4 border border-dark-700 bg-dark-800/40">
        <h2 className="text-white font-bold text-sm mb-4 flex items-center gap-2">
          <TrendingUp size={14} className="text-neon-green" /> Level Roadmap
        </h2>
        <div className="space-y-3">
          {[
            { name: 'Hunter',            tier: 1, min: 0,     icon: '🎯', color: '#4ADE80', desc: 'Scan, post, earn XP, join community' },
            { name: 'Líder',             tier: 2, min: 1000,  icon: '⚡', color: '#60A5FA', desc: 'Create team, access advanced Coach AI, earn team bonuses' },
            { name: 'Director Regional', tier: 3, min: 5000,  icon: '🌎', color: '#C084FC', desc: 'Manage multiple teams, regional panel, exclusive events' },
            { name: 'Director Nacional', tier: 4, min: 20000, icon: '👑', color: '#FBBF24', desc: 'Executive panel, national metrics, official campaigns' },
          ].map(lvl => {
            const isCurrentOrBelow = profile.points >= lvl.min;
            const isCurrent = profile.level === lvl.name;
            return (
              <div key={lvl.tier}
                className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${isCurrent ? 'border' : ''}`}
                style={isCurrent ? { borderColor: `${lvl.color}30`, background: `${lvl.color}08` } : {}}>
                <span className="text-xl flex-shrink-0">{lvl.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm" style={{ color: isCurrentOrBelow ? lvl.color : '#4B5563' }}>
                    Nivel {lvl.tier} — {lvl.name}
                    {isCurrent && <span className="ml-2 text-[10px] font-normal opacity-70">← You are here</span>}
                  </p>
                  <p className="text-xs text-gray-500">{lvl.desc}</p>
                </div>
                <span className="text-xs font-mono flex-shrink-0" style={{ color: isCurrentOrBelow ? lvl.color : '#374151' }}>
                  {lvl.min.toLocaleString()} XP
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Wallet expanded ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-dark-700 bg-dark-800/40 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-dark-700">
          <Wallet size={14} className="text-neon-green" />
          <h2 className="text-white font-bold text-sm">Wallet</h2>
          <Link to="/community" className="ml-auto text-neon-blue text-xs hover:underline">
            Redeem →
          </Link>
        </div>
        <div className="grid grid-cols-3 divide-x divide-dark-700">
          {[
            { label: 'Points Available', value: wallet.points_available?.toLocaleString() || '0',    color: '#FBBF24' },
            { label: 'Points Pending',   value: wallet.points_pending?.toLocaleString() || '0',     color: '#94A3B8' },
            { label: 'Credit Balance',   value: `$${parseFloat(wallet.credit_balance || 0).toFixed(2)}`, color: '#4ADE80' },
          ].map(({ label, value, color }) => (
            <div key={label} className="p-3 text-center">
              <p className="text-gray-500 text-[10px] uppercase tracking-wide mb-0.5">{label}</p>
              <p className="font-black text-lg leading-none" style={{ color }}>{value}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 divide-x divide-dark-700 border-t border-dark-700">
          {[
            { label: 'XP This Month', value: (profile.xp_this_month || 0).toLocaleString() + ' XP', color: '#60A5FA' },
            { label: 'Lifetime XP',   value: (wallet.lifetime_points || profile.points || 0).toLocaleString() + ' XP', color: '#C084FC' },
          ].map(({ label, value, color }) => (
            <div key={label} className="p-3 text-center">
              <p className="text-gray-500 text-[10px] uppercase tracking-wide mb-0.5">{label}</p>
              <p className="font-bold text-sm" style={{ color }}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Recent Activity ──────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-white font-bold flex items-center gap-2 mb-3">
          <Activity size={15} className="text-neon-blue" /> Recent Activity
        </h2>
        {txs.length === 0 ? (
          <div className="rounded-xl border border-dark-700 bg-dark-800/40 p-6 text-center">
            <Flame size={22} className="mx-auto text-gray-600 mb-2" />
            <p className="text-gray-500 text-sm">No activity yet.</p>
            <p className="text-gray-600 text-xs mt-1">Scan products or submit deals to earn XP.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {txs.slice(0, 10).map((tx, i) => {
              const meta = TX_TYPE_META[tx.type] || { icon: Zap, color: '#94A3B8', label: tx.type };
              const Icon = meta.icon;
              const xpStr    = tx.xp_delta    > 0 ? `+${tx.xp_delta} XP`  : null;
              const ptsStr   = tx.points_delta > 0 ? `+${tx.points_delta} pts` : null;
              const amtStr   = parseFloat(tx.amount_delta || 0) > 0
                ? `+$${parseFloat(tx.amount_delta).toFixed(2)}` : null;
              const gainStr  = [xpStr, ptsStr, amtStr].filter(Boolean).join(' · ') || null;
              const isPending = tx.status === 'pending';
              return (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-dark-800/40 border border-dark-700">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: `${meta.color}15` }}>
                    <Icon size={14} style={{ color: meta.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-semibold truncate">
                      {tx.description || meta.label}
                    </p>
                    <p className="text-gray-500 text-[10px]">
                      {new Date(tx.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                    {gainStr && (
                      <span className="text-xs font-bold" style={{ color: isPending ? '#94A3B8' : meta.color }}>
                        {gainStr}
                      </span>
                    )}
                    {isPending && (
                      <span className="text-[9px] text-gray-500 bg-dark-700 px-1.5 py-0.5 rounded-full">
                        pending
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
