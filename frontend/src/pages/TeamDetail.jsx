import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Trophy, MapPin, CheckCircle, Crown, Shield, UserPlus,
  Star, Zap, Bot, Target, Flame, Clock, Activity,
  TrendingUp, Search, Award, UserCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
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

const MISSION_ICON = {
  scan_deals:     <Search size={14} />,
  submit_deals:   <Zap size={14} />,
  verify_deals:   <UserCheck size={14} />,
  invite_members: <UserPlus size={14} />,
  photo_hunt:     <Flame size={14} />,
};

const ACTIVITY_ICON = {
  scan:              <Search size={12} />,
  submit_deal:       <Zap size={12} />,
  verify_deal:       <UserCheck size={12} />,
  invite_member:     <UserPlus size={12} />,
  mission_completed: <Award size={12} />,
  coach_tip:         <Bot size={12} />,
  member_joined:     <UserPlus size={12} />,
};

const ACTIVITY_COLOR = {
  scan:              '#00D4FF',
  submit_deal:       '#4ADE80',
  verify_deal:       '#8b5cf6',
  invite_member:     '#FACC15',
  mission_completed: '#f59e0b',
  coach_tip:         '#4ADE80',
  member_joined:     '#00D4FF',
};

const RANK_MEDAL = { 0: '🥇', 1: '🥈', 2: '🥉' };

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function TeamDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const lang = i18n.language === 'es' ? 'es' : 'en';

  useEffect(() => { load(); }, [id]);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get(`/collaborators/teams/${id}`);
      setData(r.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  async function joinTeam() {
    setJoining(true);
    try {
      await api.post(`/collaborators/teams/${id}/join`);
      setShowOnboarding(true);
      await load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to join team');
    } finally {
      setJoining(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex justify-center items-center min-h-40">
        <div className="w-8 h-8 border-2 border-neon-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data?.team) {
    return (
      <div className="p-6 text-center space-y-3">
        <p className="text-4xl">👥</p>
        <p className="text-white font-semibold">{t('teams.notFound')}</p>
        <Link to="/teams" className="text-neon-blue text-sm hover:underline">{t('teams.back')}</Link>
      </div>
    );
  }

  const { team, members = [], missions = [], activity = [], stats = {} } = data;
  const isMember = members.some(m => m.user_id === user?.id);
  const totalPoints = members.reduce((s, m) => s + parseInt(m.points || 0), 0);
  const teamTypeLabel = t(`teams.type.${team.team_type || 'national'}`);

  return (
    <div className="p-4 lg:p-6 max-w-xl mx-auto space-y-4">
      <Link to="/teams" className="text-xs flex items-center gap-1 hover:underline" style={{ color: '#94A3B8' }}>
        {t('teams.back')}
      </Link>

      {/* ── SECTION 1: Header ─────────────────────────────────────────────── */}
      <div className="card p-5 space-y-4">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center font-black text-3xl flex-shrink-0"
            style={{ background: 'rgba(74,222,128,0.1)', border: '2px solid rgba(74,222,128,0.3)', color: '#4ADE80' }}>
            {team.name[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-black text-white leading-tight">{team.name}</h1>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                style={{ background: 'rgba(0,212,255,0.12)', color: '#00D4FF', border: '1px solid rgba(0,212,255,0.25)' }}>
                {teamTypeLabel}
              </span>
            </div>
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

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: t('teams.stats.points'),  value: parseInt(team.points || 0).toLocaleString(), color: '#FACC15' },
            { label: t('teams.stats.deals'),   value: team.approved_deals_count || 0,              color: '#4ADE80' },
            { label: t('teams.stats.members'), value: members.length,                              color: '#00D4FF' },
          ].map(({ label, value, color }) => (
            <div key={label} className="text-center py-3 rounded-xl" style={{ background: '#0F172A' }}>
              <p className="text-xl font-black" style={{ color }}>{value}</p>
              <p className="text-xs" style={{ color: '#94A3B8' }}>{label}</p>
            </div>
          ))}
        </div>

        {/* Join / Member */}
        {!isMember ? (
          <button onClick={joinTeam} disabled={joining}
            className="w-full btn-primary flex items-center justify-center gap-2 py-3 font-bold disabled:opacity-50">
            <UserPlus size={16} />
            {joining ? t('teams.joining') : t('teams.join')}
          </button>
        ) : (
          <div className="flex items-center justify-center gap-2 py-2.5 rounded-xl"
            style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)' }}>
            <CheckCircle size={15} className="text-neon-green" />
            <span className="text-neon-green font-semibold text-sm">{t('teams.joined')}</span>
          </div>
        )}
      </div>

      {/* ── Onboarding (shown after join) ────────────────────────────────── */}
      {showOnboarding && (
        <div className="card p-5 space-y-4"
          style={{ border: '1px solid rgba(74,222,128,0.3)', background: 'rgba(74,222,128,0.04)' }}>
          <div className="flex items-center justify-between">
            <h2 className="text-white font-bold text-base">{t('teams.onboarding.title')} 🎯</h2>
            <button onClick={() => setShowOnboarding(false)} className="text-gray-500 hover:text-white text-xs">✕</button>
          </div>
          <p className="text-sm" style={{ color: '#94A3B8' }}>{t('teams.onboarding.subtitle')}</p>
          <div className="space-y-2">
            {['step1','step2','step3','step4'].map((step, i) => (
              <div key={step} className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0"
                  style={{ background: 'rgba(74,222,128,0.15)', color: '#4ADE80' }}>
                  {i + 1}
                </div>
                <span className="text-sm" style={{ color: '#CBD5E1' }}>{t(`teams.onboarding.${step}`)}</span>
              </div>
            ))}
          </div>
          <button onClick={() => { setShowOnboarding(false); navigate('/scanner'); }}
            className="w-full btn-primary py-2.5 font-bold text-sm">
            {t('teams.onboarding.cta')}
          </button>
        </div>
      )}

      {/* ── SECTION 2: Mission Brief ──────────────────────────────────────── */}
      {team.mission_brief && (
        <div className="card p-4 space-y-3">
          <h2 className="text-white font-semibold flex items-center gap-2 text-sm">
            <Target size={15} style={{ color: '#FACC15' }} />
            {t('teams.missionBrief')}
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: '#CBD5E1' }}>{team.mission_brief}</p>
          <div className="grid grid-cols-2 gap-2">
            {team.target_stores?.length > 0 && (
              <div className="rounded-lg p-2.5" style={{ background: '#0F172A' }}>
                <p className="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color: '#64748B' }}>
                  {t('teams.targetStores')}
                </p>
                <p className="text-xs text-white font-semibold">{team.target_stores.join(', ')}</p>
              </div>
            )}
            {team.target_categories?.length > 0 && (
              <div className="rounded-lg p-2.5" style={{ background: '#0F172A' }}>
                <p className="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color: '#64748B' }}>
                  {t('teams.targetCategories')}
                </p>
                <p className="text-xs text-white font-semibold">{team.target_categories.join(', ')}</p>
              </div>
            )}
            {team.min_discount_pct > 0 && (
              <div className="rounded-lg p-2.5" style={{ background: '#0F172A' }}>
                <p className="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color: '#64748B' }}>
                  {t('teams.minDiscount')}
                </p>
                <p className="text-xs font-black" style={{ color: '#4ADE80' }}>{team.min_discount_pct}%+</p>
              </div>
            )}
            {team.min_roi_pct > 0 && (
              <div className="rounded-lg p-2.5" style={{ background: '#0F172A' }}>
                <p className="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color: '#64748B' }}>
                  {t('teams.minROI')}
                </p>
                <p className="text-xs font-black" style={{ color: '#FACC15' }}>{team.min_roi_pct}%+</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SECTION 3: AI Coach Message ───────────────────────────────────── */}
      {team.coach_name && (
        <div className="card p-4 space-y-3"
          style={{ border: '1px solid rgba(74,222,128,0.2)', background: 'rgba(74,222,128,0.03)' }}>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.3)' }}>
              <Bot size={14} className="text-neon-green" />
            </div>
            <div>
              <p className="text-white text-xs font-bold">{team.coach_name}</p>
              <p className="text-[10px]" style={{ color: '#4ADE80' }}>
                {team.coach_label || 'AI Coach'} · {t('teams.coachTip')}
              </p>
            </div>
          </div>
          {(() => {
            const coachActivity = activity.find(a => a.action_type === 'coach_tip');
            const tipText = coachActivity?.description || team.coach_persona || '';
            return tipText ? (
              <p className="text-sm leading-relaxed" style={{ color: '#CBD5E1' }}>"{tipText}"</p>
            ) : null;
          })()}
        </div>
      )}

      {/* ── SECTION 4: Active Missions ────────────────────────────────────── */}
      <div className="card p-4 space-y-3">
        <h2 className="text-white font-semibold flex items-center gap-2 text-sm">
          <Flame size={15} style={{ color: '#f59e0b' }} />
          {t('teams.activeMissions')}
          {missions.length > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold"
              style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
              {missions.length}
            </span>
          )}
        </h2>

        {missions.length === 0 ? (
          <p className="text-sm text-center py-4" style={{ color: '#64748B' }}>{t('teams.noMissions')}</p>
        ) : (
          <div className="space-y-3">
            {missions.map(m => {
              const title = (lang === 'es' && m.title_es) ? m.title_es : m.title;
              const desc  = (lang === 'es' && m.description_es) ? m.description_es : m.description;
              const progress = parseInt(m.my_progress || 0);
              const pct = Math.min(100, Math.round((progress / m.target_count) * 100));
              const done = m.my_completed_at != null;

              return (
                <div key={m.id} className="rounded-xl p-3 space-y-2"
                  style={{
                    background: done ? 'rgba(74,222,128,0.06)' : '#0F172A',
                    border: done ? '1px solid rgba(74,222,128,0.25)' : '1px solid transparent',
                  }}>
                  <div className="flex items-start gap-2">
                    <span style={{ color: '#f59e0b' }}>{MISSION_ICON[m.type] || <Target size={14} />}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-white text-xs font-bold truncate">{title}</p>
                        <span className="text-[10px] font-black flex-shrink-0" style={{ color: '#FACC15' }}>
                          {t('teams.missionReward', { pts: m.reward_points })}
                        </span>
                      </div>
                      {desc && <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>{desc}</p>}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px]" style={{ color: '#64748B' }}>
                        {t('teams.missionProgress')}: {progress}/{m.target_count}
                      </span>
                      {done
                        ? <span className="text-[10px] font-bold text-neon-green">{t('teams.missionComplete')}</span>
                        : <span className="text-[10px]" style={{ color: '#64748B' }}>{pct}%</span>
                      }
                    </div>
                    <div className="h-1.5 rounded-full" style={{ background: '#1E293B' }}>
                      <div className="h-1.5 rounded-full transition-all"
                        style={{ width: `${pct}%`, background: done ? '#4ADE80' : '#f59e0b' }} />
                    </div>
                  </div>
                  {m.ends_at && !done && (
                    <p className="text-[10px] flex items-center gap-1" style={{ color: '#64748B' }}>
                      <Clock size={9} /> {new Date(m.ends_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── SECTION 5: Team Stats ─────────────────────────────────────────── */}
      <div className="card p-4 space-y-3">
        <h2 className="text-white font-semibold flex items-center gap-2 text-sm">
          <TrendingUp size={15} style={{ color: '#00D4FF' }} />
          Stats
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: 'today', scans: stats.scans_today, deals: stats.deals_today, verified: stats.verified_today, pts: stats.points_today },
            { key: 'thisWeek', scans: stats.scans_week, deals: stats.deals_week, verified: stats.verified_week, pts: stats.points_week },
          ].map(({ key, scans, deals, verified, pts }) => (
            <div key={key} className="rounded-xl p-3 space-y-2" style={{ background: '#0F172A' }}>
              <p className="text-[10px] uppercase tracking-wider font-bold" style={{ color: '#64748B' }}>
                {t(`teams.stats.${key}`)}
              </p>
              <div className="space-y-1">
                {[
                  { label: t('teams.stats.scans'),     value: scans    || 0, color: '#00D4FF' },
                  { label: t('teams.stats.submitted'), value: deals    || 0, color: '#4ADE80' },
                  { label: t('teams.stats.verified'),  value: verified || 0, color: '#8b5cf6' },
                  { label: t('teams.stats.pts'),       value: parseInt(pts || 0).toLocaleString(), color: '#FACC15' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex justify-between items-center">
                    <span className="text-[11px]" style={{ color: '#94A3B8' }}>{label}</span>
                    <span className="text-xs font-black" style={{ color }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── SECTION 6: Leaderboard ────────────────────────────────────────── */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-white font-semibold flex items-center gap-2 text-sm">
            <Trophy size={15} style={{ color: '#FACC15' }} />
            {t('teams.leaderboard')}
          </h2>
          <p className="text-[10px]" style={{ color: '#64748B' }}>{t('teams.leaderboardSub')}</p>
        </div>

        {members.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-3xl mb-2">👤</p>
            <p className="text-sm" style={{ color: '#94A3B8' }}>{t('teams.noMembers')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {members.map((m, i) => {
              const roleKey = m.role || 'hunter';
              const ROLE_ICON  = { owner: Crown, manager: Shield, hunter: Zap, verifier: Star, ai_coach: Bot };
              const ROLE_COLOR = { owner: '#FACC15', manager: '#00D4FF', hunter: '#94A3B8', verifier: '#8b5cf6', ai_coach: '#4ADE80' };
              const RoleIcon   = ROLE_ICON[roleKey] || Zap;
              const roleColor  = ROLE_COLOR[roleKey] || '#94A3B8';
              const levelColor = LEVEL_COLOR[m.level] || '#6b7280';
              const isMe  = m.user_id === user?.id;
              const medal = RANK_MEDAL[i];

              return (
                <div key={m.user_id}
                  className="flex items-center gap-3 p-3 rounded-xl"
                  style={isMe
                    ? { background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.2)' }
                    : { background: '#0F172A' }}>
                  <div className="w-7 text-center flex-shrink-0">
                    <span className="text-sm font-bold" style={{ color: i < 3 ? '#f59e0b' : '#64748B' }}>
                      {medal || `#${i + 1}`}
                    </span>
                  </div>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                    style={{ background: `${levelColor}18`, color: levelColor, border: `1px solid ${levelColor}30` }}>
                    {(m.display_name || m.name || 'U')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-white text-sm font-semibold truncate max-w-[110px]">
                        {m.display_name || m.name}
                      </span>
                      {isMe && <span className="text-[10px] text-neon-green font-bold">(you)</span>}
                      {m.level && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
                          style={{ color: levelColor, background: `${levelColor}18` }}>
                          {m.level}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5 text-xs" style={{ color: roleColor }}>
                      <RoleIcon size={9} />
                      <span>{t(`teams.roles.${roleKey}`)}</span>
                      {m.approved_deals_count > 0 && (
                        <span style={{ color: '#4ADE80' }} className="ml-1">· ✅ {m.approved_deals_count}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-base font-black" style={{ color: levelColor }}>
                      {parseInt(m.points || 0).toLocaleString()}
                    </p>
                    <p className="text-[10px]" style={{ color: '#64748B' }}>{t('teams.pts')}</p>
                  </div>
                </div>
              );
            })}
            <div className="pt-3 flex items-center justify-between"
              style={{ borderTop: '1px solid #273449' }}>
              <span className="text-xs font-semibold" style={{ color: '#64748B' }}>{t('teams.teamTotal')}</span>
              <span className="font-black" style={{ color: '#FACC15' }}>
                {totalPoints.toLocaleString()} {t('teams.pts')}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── SECTION 7: Activity Feed ──────────────────────────────────────── */}
      <div className="card p-4">
        <h2 className="text-white font-semibold flex items-center gap-2 text-sm mb-3">
          <Activity size={15} style={{ color: '#4ADE80' }} />
          {t('teams.activityFeed')}
        </h2>

        {activity.filter(a => a.action_type !== 'coach_tip').length === 0 ? (
          <p className="text-sm text-center py-6" style={{ color: '#64748B' }}>{t('teams.noActivity')}</p>
        ) : (
          <div className="space-y-1">
            {activity
              .filter(a => a.action_type !== 'coach_tip')
              .slice(0, 12)
              .map(a => {
                const icon  = ACTIVITY_ICON[a.action_type] || <Zap size={12} />;
                const color = ACTIVITY_COLOR[a.action_type] || '#94A3B8';
                const who   = a.user_display_name || a.user_name || 'A hunter';

                return (
                  <div key={a.id} className="flex items-start gap-3 py-2"
                    style={{ borderBottom: '1px solid #1E293B' }}>
                    <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ background: `${color}18`, color }}>
                      {icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs" style={{ color: '#CBD5E1' }}>
                        <span className="font-semibold text-white">{who}</span>{' '}
                        {t(`teams.activity.${a.action_type}`, { defaultValue: a.action_type })}
                        {a.points_earned > 0 && (
                          <span className="ml-1 font-bold" style={{ color: '#FACC15' }}>
                            +{a.points_earned} {t('teams.pts')}
                          </span>
                        )}
                      </p>
                      {a.description && (
                        <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: '#64748B' }}>{a.description}</p>
                      )}
                    </div>
                    <span className="text-[10px] flex-shrink-0 mt-0.5" style={{ color: '#475569' }}>
                      {timeAgo(a.created_at)}
                    </span>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* ── SECTION 8: Action Buttons ─────────────────────────────────────── */}
      {isMember && (
        <div className="grid grid-cols-3 gap-2">
          <Link to="/scanner"
            className="flex flex-col items-center gap-1.5 py-3 rounded-xl text-xs font-semibold"
            style={{ background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.2)', color: '#00D4FF' }}>
            <Search size={16} />
            {t('teams.actions.scan')}
          </Link>
          <Link to="/collaborator"
            className="flex flex-col items-center gap-1.5 py-3 rounded-xl text-xs font-semibold"
            style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', color: '#4ADE80' }}>
            <Zap size={16} />
            {t('teams.actions.submit')}
          </Link>
          <Link to="/referrals"
            className="flex flex-col items-center gap-1.5 py-3 rounded-xl text-xs font-semibold"
            style={{ background: 'rgba(250,204,21,0.08)', border: '1px solid rgba(250,204,21,0.2)', color: '#FACC15' }}>
            <UserPlus size={16} />
            {t('teams.actions.invite')}
          </Link>
        </div>
      )}

      <div className="flex gap-2">
        <Link to="/teams" className="flex-1 text-center py-2.5 rounded-xl text-sm font-semibold"
          style={{ background: '#1E293B', border: '1px solid #273449', color: '#94A3B8' }}>
          {t('teams.actions.allTeams')}
        </Link>
        <Link to="/collaborator/leaderboard"
          className="flex-1 text-center py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5"
          style={{ background: '#1E293B', border: '1px solid #273449', color: '#94A3B8' }}>
          <Trophy size={13} /> {t('nav.ranking')}
        </Link>
      </div>
    </div>
  );
}
