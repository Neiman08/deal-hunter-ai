import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Trophy, TrendingUp, Users, MapPin, Star, Zap, Award,
  ArrowLeft, AlertTriangle, RefreshCw, ChevronRight, Shield,
  Target, GraduationCap, Gift, Flame,
} from 'lucide-react';
import api from '../utils/api';

// ── Level config ───────────────────────────────────────────────────────────────
const LEVEL_COLOR = {
  'Hunter':            '#4ADE80',
  'Líder':             '#60A5FA',
  'Director Regional': '#C084FC',
  'Director Nacional': '#FBBF24',
};

const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };

const TABS = [
  { id: 'hunters',   label: 'Top Hunters',  icon: Zap       },
  { id: 'teams',     label: 'Top Teams',    icon: Users     },
  { id: 'cities',    label: 'Top Cities',   icon: MapPin    },
  { id: 'deals',     label: 'Top Deals',    icon: TrendingUp },
  { id: 'referrers', label: 'Referrers',   icon: Gift      },
  { id: 'learners',  label: 'Learners',    icon: GraduationCap },
  { id: 'rising',    label: 'Rising Stars', icon: Flame     },
];

const PERIODS = [
  { id: 'week',     label: 'This Week' },
  { id: 'month',    label: 'This Month' },
  { id: 'all_time', label: 'All Time' },
];

// ── Shared components ──────────────────────────────────────────────────────────

function LevelBadge({ level }) {
  const color = LEVEL_COLOR[level] || '#94A3B8';
  return (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
      style={{ background: `${color}18`, color }}>
      {level}
    </span>
  );
}

function EmptyState({ msg = 'No data yet.' }) {
  return (
    <div className="rounded-2xl border border-dark-700 bg-dark-800/40 p-10 text-center">
      <Trophy size={28} className="mx-auto text-gray-600 mb-2" />
      <p className="text-gray-500 text-sm">{msg}</p>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-7 h-7 border-2 border-neon-green border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// ── Hunter row ────────────────────────────────────────────────────────────────
function HunterRow({ h, highlight }) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
      highlight ? 'border-neon-green/30 bg-neon-green/5' : 'border-dark-700 bg-dark-800/40'
    }`}>
      <div className="w-8 text-center flex-shrink-0">
        {MEDAL[h.rank]
          ? <span className="text-lg">{MEDAL[h.rank]}</span>
          : <span className="text-gray-500 text-sm font-bold">#{h.rank}</span>
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-white text-sm font-semibold truncate">{h.name || 'Hunter'}</p>
          <LevelBadge level={h.level} />
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-[10px] text-gray-500">
          {(h.city || h.state) && (
            <span className="flex items-center gap-0.5">
              <MapPin size={9} /> {[h.city, h.state].filter(Boolean).join(', ')}
            </span>
          )}
          {h.team_name && (
            <span className="flex items-center gap-0.5">
              <Users size={9} /> {h.team_name}
            </span>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        <p className="text-neon-green text-sm font-black">{(h.period_xp || h.xp || 0).toLocaleString()} XP</p>
        <div className="flex items-center justify-end gap-2 text-[10px] text-gray-500 mt-0.5">
          {h.verified_deals > 0 && <span>✓{h.verified_deals}</span>}
          {h.trust_score != null && (
            <span className="flex items-center gap-0.5">
              <Shield size={8} />{h.trust_score}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Team row ──────────────────────────────────────────────────────────────────
function TeamRow({ t }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-dark-700 bg-dark-800/40">
      <div className="w-8 text-center flex-shrink-0">
        {MEDAL[t.rank]
          ? <span className="text-lg">{MEDAL[t.rank]}</span>
          : <span className="text-gray-500 text-sm font-bold">#{t.rank}</span>
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-semibold truncate">{t.name}</p>
        <div className="flex items-center gap-3 mt-0.5 text-[10px] text-gray-500">
          {(t.city || t.state) && (
            <span className="flex items-center gap-0.5">
              <MapPin size={9} /> {[t.city, t.state].filter(Boolean).join(', ')}
            </span>
          )}
          <span className="flex items-center gap-0.5">
            <Users size={9} /> {t.members_count || 0} members
          </span>
          {t.leader_name && <span>Led by {t.leader_name}</span>}
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        <p className="text-neon-blue text-sm font-black">{(parseInt(t.total_xp) || 0).toLocaleString()} XP</p>
        {t.verified_deals > 0 && (
          <p className="text-gray-500 text-[10px]">✓{t.verified_deals} deals</p>
        )}
      </div>
    </div>
  );
}

// ── City row ──────────────────────────────────────────────────────────────────
function CityRow({ c }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-dark-700 bg-dark-800/40">
      <div className="w-8 text-center flex-shrink-0">
        {MEDAL[c.rank]
          ? <span className="text-lg">{MEDAL[c.rank]}</span>
          : <span className="text-gray-500 text-sm font-bold">#{c.rank}</span>
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-semibold">{c.city}{c.state ? `, ${c.state}` : ''}</p>
        <p className="text-gray-500 text-[10px] mt-0.5">
          {c.hunters_count} hunters · {c.submitted_deals} deals submitted
        </p>
      </div>
      <div className="flex-shrink-0 text-right">
        <p className="text-purple-400 text-sm font-black">{parseInt(c.verified_deals) || 0} verified</p>
        {c.avg_roi != null && (
          <p className="text-gray-500 text-[10px]">avg {parseFloat(c.avg_roi).toFixed(0)}% ROI</p>
        )}
      </div>
    </div>
  );
}

// ── Deal row ──────────────────────────────────────────────────────────────────
function DealRow({ d }) {
  const roi = parseFloat(d.roi || 0);
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-dark-700 bg-dark-800/40">
      <div className="w-8 text-center flex-shrink-0">
        {MEDAL[d.rank]
          ? <span className="text-lg">{MEDAL[d.rank]}</span>
          : <span className="text-gray-500 text-sm font-bold">#{d.rank}</span>
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-semibold truncate">{d.title || 'Unknown product'}</p>
        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-500">
          {d.store && <span>{d.store}</span>}
          {(d.city || d.state) && (
            <span className="flex items-center gap-0.5">
              <MapPin size={8} /> {[d.city, d.state].filter(Boolean).join(', ')}
            </span>
          )}
          {d.author && <span>by {d.author}</span>}
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        <p className="font-black text-sm" style={{ color: roi >= 100 ? '#4ADE80' : roi >= 50 ? '#60A5FA' : '#FBBF24' }}>
          {roi.toFixed(0)}% ROI
        </p>
        {d.profit != null && (
          <p className="text-gray-500 text-[10px]">~${parseFloat(d.profit).toFixed(0)} profit</p>
        )}
      </div>
    </div>
  );
}

// ── Referrer row ──────────────────────────────────────────────────────────────
function ReferrerRow({ r }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-dark-700 bg-dark-800/40">
      <div className="w-8 text-center flex-shrink-0">
        {MEDAL[r.rank]
          ? <span className="text-lg">{MEDAL[r.rank]}</span>
          : <span className="text-gray-500 text-sm font-bold">#{r.rank}</span>
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-semibold">{r.name || 'Hunter'}</p>
        <p className="text-gray-500 text-[10px] mt-0.5">
          {r.total_signups || 0} signups · {r.conversions || 0} conversions
        </p>
      </div>
      <div className="flex-shrink-0 text-right">
        <p className="text-orange-400 text-sm font-black">{parseInt(r.conversions) || 0}</p>
        <p className="text-gray-500 text-[10px]">conversions</p>
      </div>
    </div>
  );
}

// ── Learner row ───────────────────────────────────────────────────────────────
function LearnerRow({ l }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-dark-700 bg-dark-800/40">
      <div className="w-8 text-center flex-shrink-0">
        {MEDAL[l.rank]
          ? <span className="text-lg">{MEDAL[l.rank]}</span>
          : <span className="text-gray-500 text-sm font-bold">#{l.rank}</span>
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-semibold">{l.name || 'Hunter'}</p>
        <p className="text-gray-500 text-[10px] mt-0.5">
          {l.lessons_completed || 0} lessons completed
        </p>
      </div>
      <div className="flex-shrink-0 text-right">
        <p className="text-yellow-400 text-sm font-black">{parseInt(l.certificates) || 0} 🎓</p>
        <p className="text-gray-500 text-[10px]">certificates</p>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function HallOfFame() {
  const navigate = useNavigate();

  const [activeTab, setActiveTab]     = useState('hunters');
  const [period, setPeriod]           = useState('all_time');
  const [cityFilter, setCityFilter]   = useState('');
  const [stateFilter, setStateFilter] = useState('');

  const [summary, setSummary]   = useState(null);
  const [tabData, setTabData]   = useState({});   // { `${tab}-${period}`: rows }
  const [loading, setLoading]   = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const [error, setError]       = useState('');

  // Load summary on mount
  useEffect(() => {
    api.get('/business/hall-of-fame')
      .then(r => setSummary(r.data))
      .catch(err => {
        if (err.response?.status === 401) navigate('/login');
        else setError('Failed to load Hall of Fame.');
      })
      .finally(() => setLoading(false));
  }, [navigate]);

  // Load tab data when tab or period changes
  const loadTab = useCallback(async (tab, per, city, state) => {
    const key = `${tab}-${per}-${city}-${state}`;
    if (tabData[key]) return; // cached

    setTabLoading(true);
    try {
      let url = '';
      const params = new URLSearchParams({ period: per });
      if (city)  params.set('city',  city);
      if (state) params.set('state', state);

      if (tab === 'hunters' || tab === 'rising') {
        url = `/business/hall-of-fame/hunters?${params}`;
        if (tab === 'rising') params.set('period', 'month');
      } else if (tab === 'teams')    url = `/business/hall-of-fame/teams?${params}`;
      else if (tab === 'cities')     url = `/business/hall-of-fame/cities?${params}`;
      else if (tab === 'deals')      url = `/business/hall-of-fame/deals?${params}`;
      // referrers, learners use summary data

      if (url) {
        const res = await api.get(url);
        const rows = res.data.hunters || res.data.teams || res.data.cities || res.data.deals || [];
        setTabData(prev => ({ ...prev, [key]: rows }));
      }
    } catch (_) {}
    setTabLoading(false);
  }, [tabData]);

  useEffect(() => {
    loadTab(activeTab, period, cityFilter, stateFilter);
  }, [activeTab, period, cityFilter, stateFilter, loadTab]);

  function getTabRows(tab) {
    // referrers and learners come from summary
    if (!summary) return [];
    if (tab === 'referrers') return summary.top_referrers || [];
    if (tab === 'learners')  return summary.top_learners  || [];
    if (tab === 'rising')    return summary.rising_stars  || [];

    const key = `${tab}-${period}-${cityFilter}-${stateFilter}`;
    if (tabData[key]) return tabData[key];

    // Fallback to summary data while loading
    if (tab === 'hunters') return summary.top_hunters || [];
    if (tab === 'teams')   return summary.top_teams   || [];
    if (tab === 'cities')  return summary.top_cities  || [];
    if (tab === 'deals')   return summary.top_deals   || [];
    return [];
  }

  const rows = getTabRows(activeTab);
  const showPeriod = ['hunters', 'deals'].includes(activeTab);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-neon-green border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error) return (
    <div className="p-6 text-center">
      <AlertTriangle size={28} className="mx-auto text-yellow-400 mb-2" />
      <p className="text-gray-400 text-sm">{error}</p>
      <button onClick={() => window.location.reload()} className="btn-primary mt-3 text-sm px-5">Retry</button>
    </div>
  );

  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/business" className="text-gray-400 hover:text-white transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <Trophy size={20} className="text-yellow-400" />
            <h1 className="text-xl font-black text-white">Hall of Fame</h1>
          </div>
          <p className="text-gray-400 text-xs mt-0.5">Rankings for hunters, teams, cities & deals</p>
        </div>
        {summary?.my_rank && (
          <div className="ml-auto text-right flex-shrink-0">
            <p className="text-gray-500 text-[10px]">Your Rank</p>
            <p className="text-white font-black text-lg">#{summary.my_rank}</p>
          </div>
        )}
      </div>

      {/* Top 3 showcase */}
      {summary && summary.top_hunters?.length > 0 && activeTab === 'hunters' && (
        <div className="grid grid-cols-3 gap-2">
          {[summary.top_hunters[1], summary.top_hunters[0], summary.top_hunters[2]].map((h, idx) => {
            if (!h) return <div key={idx} />;
            const sizes  = ['h-20', 'h-24', 'h-20'];
            const colors = [LEVEL_COLOR[h.level] || '#4ADE80'];
            return (
              <div key={h.user_id || idx}
                className={`rounded-2xl border flex flex-col items-center justify-end p-2 ${sizes[idx]}`}
                style={{ borderColor: `${colors[0]}25`, background: `${colors[0]}08` }}>
                <span className="text-xl">{MEDAL[h.rank] || `#${h.rank}`}</span>
                <p className="text-white text-[10px] font-bold text-center truncate w-full mt-1">{h.name || 'Hunter'}</p>
                <p className="text-[9px] font-black" style={{ color: colors[0] }}>
                  {(h.period_xp || h.xp || 0).toLocaleString()} XP
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Period filter (only for hunters + deals) */}
      {showPeriod && (
        <div className="flex gap-2">
          {PERIODS.map(p => (
            <button key={p.id} onClick={() => setPeriod(p.id)}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
              style={{
                background: period === p.id ? '#4ADE80' : '#1F2937',
                color:      period === p.id ? '#0A0A0A' : '#9CA3AF',
              }}>
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* City / State filters */}
      <div className="flex gap-2">
        <input
          type="text" placeholder="Filter by city…"
          value={cityFilter}
          onChange={e => setCityFilter(e.target.value.slice(0, 50))}
          className="flex-1 bg-dark-700 border border-dark-600 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-neon-green/40"
        />
        <input
          type="text" placeholder="State…"
          value={stateFilter}
          onChange={e => setStateFilter(e.target.value.slice(0, 5).toUpperCase())}
          className="w-20 bg-dark-700 border border-dark-600 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-neon-green/40"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
              style={{
                background: activeTab === tab.id ? '#4ADE8020' : '#1F2937',
                color:      activeTab === tab.id ? '#4ADE80'   : '#6B7280',
                border:     activeTab === tab.id ? '1px solid #4ADE8030' : '1px solid transparent',
              }}>
              <Icon size={11} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {tabLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState msg={
          activeTab === 'cities'
            ? 'No city data yet. Submit deals with your location to appear here.'
            : activeTab === 'deals'
            ? 'No deals found for this period. Submit deals to appear in the ranking.'
            : activeTab === 'referrers'
            ? 'No referrals yet. Share your referral link to earn a spot!'
            : activeTab === 'learners'
            ? 'No University graduates yet. Complete a course to appear here!'
            : activeTab === 'rising'
            ? 'No XP earned this month yet. Start scanning and completing missions!'
            : 'No Hunters ranked yet.'
        } />
      ) : (
        <div className="space-y-2">
          {activeTab === 'hunters' && rows.map(h => (
            <HunterRow key={h.user_id || h.rank} h={h} highlight={h.user_id === summary?.my_user_id} />
          ))}
          {activeTab === 'rising' && rows.map(h => (
            <HunterRow key={h.user_id || h.rank} h={{ ...h, period_xp: h.xp_this_month || h.period_xp }} highlight={false} />
          ))}
          {activeTab === 'teams' && rows.map(t => (
            <TeamRow key={t.team_id || t.rank} t={t} />
          ))}
          {activeTab === 'cities' && rows.map(c => (
            <CityRow key={`${c.city}-${c.state}-${c.rank}`} c={c} />
          ))}
          {activeTab === 'deals' && rows.map(d => (
            <DealRow key={d.deal_id || d.rank} d={d} />
          ))}
          {activeTab === 'referrers' && rows.map(r => (
            <ReferrerRow key={r.user_id || r.rank} r={r} />
          ))}
          {activeTab === 'learners' && rows.map(l => (
            <LearnerRow key={l.user_id || l.rank} l={l} />
          ))}
        </div>
      )}

      {/* Footer tip */}
      <p className="text-center text-gray-600 text-[10px] pb-4">
        Rankings update in real time · XP earned by scanning, submitting and confirming deals
      </p>
    </div>
  );
}
