import { useState, useEffect, useCallback } from 'react';
import {
  Users, TrendingUp, Clock, CheckCircle, MapPin,
  Award, AlertTriangle, Wallet, Gift, ChevronDown,
  Scan, Shield, BarChart2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmt(v) {
  const n = parseFloat(v);
  return isNaN(n) ? null : `$${n.toFixed(2)}`;
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const STATUS_COLORS = {
  submitted:            { color: '#00D4FF', bg: 'bg-neon-blue/10  border-neon-blue/30' },
  pending_confirmation: { color: '#FACC15', bg: 'bg-yellow-400/10 border-yellow-400/30' },
  verified:             { color: '#4ADE80', bg: 'bg-neon-green/10 border-neon-green/30' },
  official:             { color: '#8B5CF6', bg: 'bg-purple-400/10 border-purple-400/30' },
  rejected:             { color: '#F87171', bg: 'bg-red-400/10    border-red-400/30' },
  expired:              { color: '#6B7280', bg: 'bg-gray-700/10   border-gray-600/30' },
};

const STATUS_LABELS_EN = {
  submitted: 'Submitted', pending_confirmation: 'Needs Confirm',
  verified: 'Verified ✓', official: 'Official ⭐', rejected: 'Rejected', expired: 'Expired',
};
const STATUS_LABELS_ES = {
  submitted: 'Enviado', pending_confirmation: 'Necesita Confirmación',
  verified: 'Verificado ✓', official: 'Oficial ⭐', rejected: 'Rechazado', expired: 'Expirado',
};

const CONFIRM_BUTTONS_EN = [
  { type: 'price_confirmed', label: '✅ Price OK',     pos: true  },
  { type: 'in_stock',        label: '📦 In Stock',     pos: true  },
  { type: 'great_deal',      label: '🔥 Great Deal',   pos: true  },
  { type: 'out_of_stock',    label: '❌ Out of Stock', pos: false },
  { type: 'price_mismatch',  label: '⚠️ Wrong Price',  pos: false },
  { type: 'not_found',       label: '🚫 Not Found',    pos: false },
  { type: 'wrong_product',   label: '📦 Wrong Item',   pos: false },
  { type: 'expired',         label: '⏰ Expired',       pos: false },
];
const CONFIRM_BUTTONS_ES = [
  { type: 'price_confirmed', label: '✅ Precio OK',    pos: true  },
  { type: 'in_stock',        label: '📦 En Stock',     pos: true  },
  { type: 'great_deal',      label: '🔥 Gran Deal',    pos: true  },
  { type: 'out_of_stock',    label: '❌ Sin Stock',    pos: false },
  { type: 'price_mismatch',  label: '⚠️ Precio Mal',  pos: false },
  { type: 'not_found',       label: '🚫 No Encontrado',pos: false },
  { type: 'wrong_product',   label: '📦 Producto Mal', pos: false },
  { type: 'expired',         label: '⏰ Expirado',      pos: false },
];

const FEED_FILTERS = [
  { id: 'all',      status: 'submitted,pending_confirmation,verified,official' },
  { id: 'newest',   status: 'submitted,pending_confirmation,verified,official', sort: 'newest' },
  { id: 'verified', status: 'verified,official' },
  { id: 'roi',      status: 'submitted,pending_confirmation,verified,official', sort: 'roi' },
  { id: 'confirm',  status: 'submitted,pending_confirmation' },
];

const LEVEL_COLOR = {
  'Legend Hunter': '#f59e0b', 'Elite Hunter': '#8b5cf6',
  'Gold Hunter': '#f59e0b',   'Silver Hunter': '#94a3b8',
  'Bronze Hunter': '#b45309', 'Rookie Hunter': '#6b7280',
};

const TABS = ['feed', 'leaderboard', 'my_deals', 'wallet'];

const TIER_META = [
  { bg: 'bg-dark-800',        border: 'border-dark-600',         color: 'text-gray-300',    icon: '🎁' },
  { bg: 'bg-neon-blue/5',    border: 'border-neon-blue/20',     color: 'text-neon-blue',   icon: '💵' },
  { bg: 'bg-yellow-400/5',   border: 'border-yellow-400/20',    color: 'text-yellow-400',  icon: '💰' },
  { bg: 'bg-purple-400/5',   border: 'border-purple-400/20',    color: 'text-purple-400',  icon: '💎' },
  { bg: 'bg-neon-green/5',   border: 'border-neon-green/20',    color: 'text-neon-green',  icon: '👑' },
];

// ── Deal Card ──────────────────────────────────────────────────────────────────
function DealCard({ deal, onConfirm, currentUserId }) {
  const { t, i18n } = useTranslation();
  const es = i18n.language?.startsWith('es');
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [confirmed, setConfirmed] = useState(null);
  const [confErr, setConfErr] = useState('');

  const statusColors = STATUS_COLORS[deal.status] || STATUS_COLORS.submitted;
  const statusLabel  = es
    ? (STATUS_LABELS_ES[deal.status] || deal.status)
    : (STATUS_LABELS_EN[deal.status] || deal.status);
  const confirmButtons = es ? CONFIRM_BUTTONS_ES : CONFIRM_BUTTONS_EN;

  const profit = parseFloat(deal.estimated_profit);
  const roi    = parseFloat(deal.roi_percent);
  const isOwn  = deal.user_id === currentUserId || deal.submitter_name === 'me';

  async function handleConfirm(type) {
    if (confirming || confirmed) return;
    setConfirming(type);
    setConfErr('');
    try {
      const r = await api.post(`/community/deals/${deal.id}/confirm`, { confirmation_type: type });
      setConfirmed(type);
      onConfirm?.(deal.id, r.data);
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed';
      if (msg === 'You cannot confirm your own deal.') setConfErr(t('community.cant_confirm_own'));
      else if (msg === 'You have already confirmed this deal.') setConfErr(t('community.already_confirmed'));
      else setConfErr(msg);
    } finally {
      setConfirming(null);
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusColors.bg}`} style={{ color: statusColors.color }}>
              {statusLabel}
            </span>
            {deal.store_name && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-dark-700 text-gray-300">
                {deal.store_name}
              </span>
            )}
            {(deal.store_city || deal.store_state) && (
              <span className="text-[10px] text-gray-500 flex items-center gap-0.5">
                <MapPin size={9} /> {[deal.store_city, deal.store_state].filter(Boolean).join(', ')}
              </span>
            )}
          </div>
          <h3 className="text-white font-semibold text-sm leading-snug truncate">{deal.product_name}</h3>
          {deal.brand && <p className="text-gray-500 text-xs">{deal.brand}</p>}
        </div>
        {deal.opportunity_score != null && (
          <div className="flex-shrink-0 text-center">
            <p className="text-xl font-black" style={{ color: deal.opportunity_score >= 70 ? '#4ADE80' : deal.opportunity_score >= 40 ? '#FACC15' : '#F87171' }}>
              {deal.opportunity_score}
            </p>
            <p className="text-[9px] text-gray-500">{t('community.score_label', 'score')}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-dark-800/60 rounded-lg p-2 text-center">
          <p className="text-gray-500 text-[10px]">{t('community.store_price', 'Store price')}</p>
          <p className="text-white font-bold">{fmt(deal.found_price) || '—'}</p>
        </div>
        <div className="bg-dark-800/60 rounded-lg p-2 text-center">
          <p className="text-gray-500 text-[10px]">{t('community.market_price', 'Market price')}</p>
          <p className="text-neon-blue font-bold">{fmt(deal.effective_market_price) || '—'}</p>
        </div>
        <div className="bg-dark-800/60 rounded-lg p-2 text-center">
          <p className="text-gray-500 text-[10px]">{es ? 'Ganancia' : 'Profit'}</p>
          <p className={`font-bold ${profit > 0 ? 'text-neon-green' : 'text-red-400'}`}>
            {fmt(deal.estimated_profit) || '—'}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          {roi > 0 && (
            <span className={`font-bold ${roi >= 25 ? 'text-neon-green' : 'text-gray-400'}`}>
              {Math.round(roi)}% ROI
            </span>
          )}
          {deal.recommendation && (
            <span className={`text-[10px] font-bold ${deal.recommendation === 'BUY' ? 'text-neon-green' : deal.recommendation === 'MAYBE' ? 'text-yellow-400' : 'text-gray-500'}`}>
              {deal.recommendation}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-gray-400">
          <span className="flex items-center gap-1">
            <CheckCircle size={10} />
            {deal.confirmation_count || 0}/{deal.trust_threshold || 2} {t('community.confirmations', 'confirmations')}
          </span>
        </div>
      </div>

      {!isOwn && (
        <div>
          {confirmed ? (
            <p className="text-neon-green text-xs flex items-center gap-1.5 py-1">
              <CheckCircle size={12} /> {t('community.confirmed', 'Confirmed! +5 pts')}
            </p>
          ) : confErr ? (
            <p className="text-yellow-400 text-xs flex items-center gap-1.5 py-1">
              <AlertTriangle size={12} /> {confErr}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {confirmButtons.slice(0, expanded ? undefined : 3).map(btn => (
                <button
                  key={btn.type}
                  onClick={() => handleConfirm(btn.type)}
                  disabled={!!confirming}
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors disabled:opacity-50 ${
                    confirming === btn.type
                      ? 'bg-neon-green/20 text-neon-green border-neon-green/40'
                      : btn.pos
                        ? 'bg-dark-800 text-gray-300 border-dark-600 hover:border-neon-green/40 hover:text-neon-green'
                        : 'bg-dark-800 text-gray-400 border-dark-600 hover:border-red-400/40 hover:text-red-400'
                  }`}
                >
                  {confirming === btn.type ? '…' : btn.label}
                </button>
              ))}
              {!expanded && (
                <button onClick={() => setExpanded(true)}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-dark-600 text-gray-500 hover:text-gray-300">
                  +{confirmButtons.length - 3} {es ? 'más' : 'more'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] text-gray-500 pt-1 border-t border-dark-700/50">
        <span>
          {deal.submitter_name && `${t('community.by_user', 'by')} ${deal.submitter_name}`}
          {deal.submitter_level && ` · ${deal.submitter_level}`}
        </span>
        <span>{timeAgo(deal.created_at)}</span>
      </div>
    </div>
  );
}

// ── Feed Tab ───────────────────────────────────────────────────────────────────
function FeedTab({ currentUserId }) {
  const { t } = useTranslation();
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const LIMIT = 10;

  const filterLabels = {
    all:      t('community.all',        'All'),
    newest:   t('community.newest',     'Newest'),
    verified: t('community.verified',   'Verified'),
    roi:      t('community.highest_roi','Highest ROI'),
    confirm:  t('community.needs_vote', 'Needs Vote'),
  };

  const load = useCallback(async (f, p) => {
    setLoading(true);
    try {
      const cfg = FEED_FILTERS.find(x => x.id === f) || FEED_FILTERS[0];
      const params = { status: cfg.status, limit: LIMIT, offset: p * LIMIT };
      if (cfg.sort === 'roi') params.sort = 'roi_percent';
      const r = await api.get('/community/deals', { params });
      const rows = r.data.deals || [];
      setDeals(p === 0 ? rows : prev => [...prev, ...rows]);
      setTotal(r.data.total || 0);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { setPage(0); load(filter, 0); }, [filter, load]);

  function handleConfirm(dealId, resp) {
    setDeals(prev => prev.map(d =>
      d.id === dealId
        ? { ...d, confirmation_count: (d.confirmation_count || 0) + 1, status: resp.new_status || d.status }
        : d
    ));
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {FEED_FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              filter === f.id
                ? 'bg-neon-green text-dark-900 border-neon-green'
                : 'text-gray-400 border-dark-600 hover:text-white bg-dark-800'
            }`}>
            {filterLabels[f.id]}
          </button>
        ))}
      </div>

      {loading && deals.length === 0 ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="card h-40 animate-pulse bg-dark-800/60" />)}
        </div>
      ) : deals.length === 0 ? (
        <div className="card py-14 text-center space-y-3">
          <p className="text-4xl">🏪</p>
          <p className="text-white font-semibold">{t('community.no_deals', 'No community deals yet')}</p>
          <p className="text-gray-500 text-sm">{t('community.no_deals_hint', 'Be the first to submit a deal from the Scanner')}</p>
          <Link to="/scanner" className="btn-primary inline-flex items-center gap-2 text-sm px-5 mt-1">
            <Scan size={14} /> {t('community.go_scanner', 'Go to Scanner')}
          </Link>
        </div>
      ) : (
        <>
          <p className="text-gray-500 text-xs">{total} {total !== 1 ? 'deals' : 'deal'}</p>
          <div className="space-y-3">
            {deals.map(d => (
              <DealCard key={d.id} deal={d} onConfirm={handleConfirm} currentUserId={currentUserId} />
            ))}
          </div>
          {deals.length < total && (
            <button
              onClick={() => { const p = page + 1; setPage(p); load(filter, p); }}
              disabled={loading}
              className="w-full btn-ghost text-sm py-3 disabled:opacity-50">
              {loading ? t('common.loading', 'Loading...') : `${t('community.load_more', 'Load more')} (${total - deals.length})`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ── Leaderboard Tab ────────────────────────────────────────────────────────────
function LeaderboardTab() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState([]);
  const [period, setPeriod] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/community/leaderboard?period=${period}`)
      .then(r => setEntries(r.data.leaderboard || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [period]);

  const PERIOD_OPTIONS = [
    { id: 'all',   label: t('community.all_time',   'All Time') },
    { id: 'month', label: t('community.this_month', 'This Month') },
    { id: 'week',  label: t('community.this_week',  'This Week') },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {PERIOD_OPTIONS.map(p => (
          <button key={p.id} onClick={() => setPeriod(p.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              period === p.id ? 'bg-neon-green text-dark-900 border-neon-green' : 'text-gray-400 border-dark-600 bg-dark-800 hover:text-white'
            }`}>
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="card h-16 animate-pulse bg-dark-800/60" />)}</div>
      ) : entries.length === 0 ? (
        <div className="card py-10 text-center">
          <p className="text-gray-400">{t('community.no_hunters_hint', 'Start submitting deals to appear here!')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((e, i) => {
            const lvlColor = LEVEL_COLOR[e.level] || '#6b7280';
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
            return (
              <div key={i} className={`card p-3 flex items-center gap-3 ${i < 3 ? 'border-yellow-500/20' : ''}`}>
                <span className="text-lg w-8 text-center flex-shrink-0">{medal}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-white font-semibold text-sm truncate">{e.display_name}</p>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-dark-800" style={{ color: lvlColor }}>
                      {e.level}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-[10px] text-gray-500">
                    <span>{e.approved_deals_count || 0} {t('community.verified_deals', 'verified deals')}</span>
                    {e.trust_score != null && (
                      <span className="flex items-center gap-0.5"><Shield size={9} /> Trust {e.trust_score}</span>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-black text-lg" style={{ color: lvlColor }}>{(e.points || 0).toLocaleString()}</p>
                  <p className="text-[10px] text-gray-500">{t('community.pts', 'pts')}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── My Deals Tab ───────────────────────────────────────────────────────────────
function MyDealsTab() {
  const { t, i18n } = useTranslation();
  const es = i18n.language?.startsWith('es');
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/community/my-deals')
      .then(r => setDeals(r.data.deals || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12"><div className="w-7 h-7 border-2 border-neon-green border-t-transparent rounded-full animate-spin" /></div>;

  if (deals.length === 0) {
    return (
      <div className="card py-14 text-center space-y-3">
        <p className="text-4xl">📤</p>
        <p className="text-white font-semibold">{t('community.no_submissions', 'No submissions yet')}</p>
        <p className="text-gray-500 text-sm">{t('community.no_submissions_hint', 'Use the Scanner to find deals and submit them to the community')}</p>
        <Link to="/scanner" className="btn-primary inline-flex items-center gap-2 text-sm px-5 mt-1">
          <Scan size={14} /> {t('community.open_scanner', 'Open Scanner')}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-gray-500 text-xs">
        {deals.length} {deals.length !== 1 ? (es ? 'envíos' : 'submissions') : (es ? 'envío' : 'submission')}
      </p>
      {deals.map(d => {
        const sm = STATUS_COLORS[d.status] || STATUS_COLORS.submitted;
        const sl = es ? (STATUS_LABELS_ES[d.status] || d.status) : (STATUS_LABELS_EN[d.status] || d.status);
        const needsConf = (d.trust_threshold || 2) - (d.confirmation_count || 0);
        return (
          <div key={d.id} className="card space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-sm truncate">{d.product_name}</p>
                <p className="text-gray-500 text-xs">{d.store_name} · {fmt(d.found_price)}</p>
              </div>
              <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${sm.bg}`} style={{ color: sm.color }}>
                {sl}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <p className="text-gray-500 text-[10px]">ROI</p>
                <p className="text-white font-semibold">{d.roi_percent ? `${Math.round(d.roi_percent)}%` : '—'}</p>
              </div>
              <div>
                <p className="text-gray-500 text-[10px]">{es ? 'Puntaje' : 'Score'}</p>
                <p className="text-white font-semibold">{d.opportunity_score || '—'}</p>
              </div>
              <div>
                <p className="text-gray-500 text-[10px]">{t('community.confirmations', 'Confirmations')}</p>
                <p className="text-white font-semibold">{d.confirmation_count || 0}/{d.trust_threshold || 2}</p>
              </div>
            </div>

            {d.points_awarded ? (
              <p className="text-neon-green text-xs flex items-center gap-1">
                <CheckCircle size={11} /> {t('community.points_awarded', 'Points awarded!')}
              </p>
            ) : d.points_pending > 0 ? (
              <p className="text-yellow-400 text-xs flex items-center gap-1">
                <Clock size={11} /> +{d.points_pending} {es ? 'pts pendientes' : 'pts pending'}
                {needsConf > 0 && ` · ${es ? `necesita ${needsConf} confirmación${needsConf > 1 ? 'es' : ''} más` : `needs ${needsConf} more confirmation${needsConf > 1 ? 's' : ''}`}`}
              </p>
            ) : null}

            <p className="text-gray-600 text-[10px]">{timeAgo(d.created_at)}</p>
          </div>
        );
      })}
    </div>
  );
}

// ── Wallet + Redemption Tab ────────────────────────────────────────────────────
function WalletTab() {
  const { t, i18n } = useTranslation();
  const es = i18n.language?.startsWith('es');
  const [walletData, setWalletData] = useState(null);
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState(null);
  const [redeemMsg, setRedeemMsg] = useState('');

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [w, tr] = await Promise.all([
        api.get('/community/wallet'),
        api.get('/community/redemption-tiers'),
      ]);
      setWalletData(w.data);
      setTiers(tr.data.tiers || []);
    } catch {} finally {
      setLoading(false);
    }
  }

  async function redeem(tierId) {
    setRedeeming(tierId);
    setRedeemMsg('');
    try {
      const r = await api.post('/community/redeem', { tier_id: tierId });
      setRedeemMsg(`✅ ${es ? 'Canjeado' : 'Redeemed'}: ${r.data.tier}! ${r.data.remaining_points} ${t('community.pts', 'pts')} ${es ? 'restantes' : 'remaining'}.`);
      await loadAll();
    } catch (err) {
      setRedeemMsg(`❌ ${err.response?.data?.error || (es ? 'Error al canjear' : 'Redemption failed')}`);
    } finally {
      setRedeeming(null);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="w-7 h-7 border-2 border-neon-green border-t-transparent rounded-full animate-spin" /></div>;

  const wallet  = walletData?.wallet;
  const profile = walletData?.profile;
  const earnings = walletData?.recent_earnings || [];

  const earnItems = es ? [
    ['Enviar un deal (COMPRAR)', '+10 a +100 pts (pendiente)'],
    ['Deal verificado', 'Puntos desbloqueados'],
    ['Deal Oficial', '+50 pts bono'],
    ['Confirmar un deal', '+5 pts (inmediato)'],
    ['Deal ROI alto (>100%)', '+100 pts bono'],
  ] : [
    ['Submit a deal (BUY)', '+10 to +100 pts (pending)'],
    ['Deal gets verified', 'Points unlocked'],
    ['Deal goes Official', '+50 bonus pts'],
    ['Confirm a deal', '+5 pts (immediate)'],
    ['High ROI deal (>100%)', '+100 pts bonus'],
  ];

  return (
    <div className="space-y-5">
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Wallet size={18} className="text-neon-green" />
          <p className="text-white font-bold">{t('community.points_wallet', 'Points Wallet')}</p>
          {profile?.level && (
            <span className="text-xs ml-auto font-bold" style={{ color: LEVEL_COLOR[profile.level] || '#6b7280' }}>
              {profile.level}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-dark-800/60 rounded-xl p-3">
            <p className="text-2xl font-black text-neon-green">{wallet?.points_available || 0}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">{t('community.available', 'Available')}</p>
          </div>
          <div className="bg-dark-800/60 rounded-xl p-3">
            <p className="text-2xl font-black text-yellow-400">{wallet?.points_pending || 0}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">{t('community.pending', 'Pending')}</p>
          </div>
          <div className="bg-dark-800/60 rounded-xl p-3">
            <p className="text-2xl font-black text-neon-blue">{wallet?.lifetime_points || 0}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">{t('community.lifetime', 'Lifetime')}</p>
          </div>
        </div>

        {(wallet?.credit_balance > 0) && (
          <div className="bg-neon-green/5 border border-neon-green/20 rounded-xl px-4 py-2 text-center">
            <p className="text-neon-green font-bold">${parseFloat(wallet.credit_balance).toFixed(2)} {t('community.account_credit', 'account credit')}</p>
          </div>
        )}

        <p className="text-gray-500 text-xs text-center">
          {t('community.pending_unlock', 'Pending points unlock when your submitted deals get verified by the community.')}
        </p>
      </div>

      {redeemMsg && (
        <div className={`rounded-xl px-4 py-3 text-sm font-medium ${redeemMsg.startsWith('✅') ? 'bg-neon-green/10 text-neon-green border border-neon-green/20' : 'bg-red-400/10 text-red-400 border border-red-400/20'}`}>
          {redeemMsg}
        </div>
      )}

      <div>
        <p className="text-white font-semibold mb-3 flex items-center gap-2"><Gift size={15} className="text-neon-green" /> {t('community.redeem', 'Redeem Points')}</p>
        <div className="space-y-2">
          {tiers.map((tier, i) => {
            const m = TIER_META[i] || TIER_META[0];
            const isRedeeming = redeeming === tier.id;
            const needMore = tier.points - (wallet?.points_available || 0);
            return (
              <div key={tier.id} className={`flex items-center gap-3 p-3 rounded-xl border ${m.bg} ${m.border} ${!tier.can_redeem ? 'opacity-60' : ''}`}>
                <span className="text-2xl w-8 text-center flex-shrink-0">{m.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-bold ${m.color}`}>{tier.label}</p>
                  <p className="text-gray-500 text-xs">{tier.points.toLocaleString()} {t('community.pts', 'pts')}</p>
                </div>
                {tier.can_redeem ? (
                  <button
                    onClick={() => redeem(tier.id)}
                    disabled={!!redeeming}
                    className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50 flex-shrink-0"
                  >
                    {isRedeeming ? '…' : t('community.redeem_btn', 'Redeem')}
                  </button>
                ) : (
                  <span className="text-gray-500 text-xs flex-shrink-0 text-right">
                    {es ? `Necesitas ${needMore.toLocaleString()} más` : `Need ${needMore.toLocaleString()} more`}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {earnings.length > 0 && (
        <div className="card">
          <p className="text-white font-semibold mb-3 text-sm">{t('community.recent_earnings', 'Recent Earnings')}</p>
          <div className="space-y-2">
            {earnings.slice(0, 8).map((e, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-dark-700/50 last:border-0">
                <div>
                  <p className="text-gray-300 text-xs">{e.product_name || e.description || e.earning_type}</p>
                  <p className="text-gray-600 text-[10px]">{timeAgo(e.created_at)}</p>
                </div>
                <span className={`text-xs font-bold ${e.status === 'available' ? 'text-neon-green' : 'text-yellow-400'}`}>
                  +{e.points} {t('community.pts', 'pts')} {e.status === 'pending' ? `(${t('community.pending', 'pending')})` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card bg-dark-800/40">
        <p className="text-gray-400 text-xs font-semibold mb-2 uppercase tracking-wider">{t('community.how_to_earn', 'How to earn points')}</p>
        <div className="space-y-1.5 text-xs text-gray-400">
          {earnItems.map(([action, pts]) => (
            <div key={action} className="flex justify-between">
              <span>{action}</span>
              <span className="text-neon-green font-medium">{pts}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Community Page ────────────────────────────────────────────────────────
export default function Community() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [tab, setTab] = useState('feed');

  const TAB_LABELS = {
    feed:        `🏠 ${t('community.feed',        'Feed')}`,
    leaderboard: `🏆 ${t('community.leaderboard', 'Leaderboard')}`,
    my_deals:    `📋 ${t('community.my_deals',    'My Deals')}`,
    wallet:      `💰 ${t('community.wallet',      'Wallet')}`,
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Users size={22} className="text-neon-green" /> {t('community.title', 'Community')}
        </h1>
        <p className="text-gray-400 text-sm mt-0.5">{t('community.subtitle', 'Real deals found by real hunters · Confirm · Earn · Level up')}</p>
      </div>

      <div className="flex gap-1 bg-dark-800 p-1 rounded-xl overflow-x-auto scrollbar-hide">
        {TABS.map(tabKey => (
          <button key={tabKey} onClick={() => setTab(tabKey)}
            className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
              tab === tabKey ? 'bg-neon-green text-dark-900' : 'text-gray-400 hover:text-white'
            }`}>
            {TAB_LABELS[tabKey]}
          </button>
        ))}
      </div>

      {tab === 'feed'        && <FeedTab currentUserId={user?.id} />}
      {tab === 'leaderboard' && <LeaderboardTab />}
      {tab === 'my_deals'    && <MyDealsTab />}
      {tab === 'wallet'      && <WalletTab />}
    </div>
  );
}
