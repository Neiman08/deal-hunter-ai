import { useState, useEffect, useCallback } from 'react';
import {
  Users, TrendingUp, Clock, Star, CheckCircle, MapPin,
  Award, AlertTriangle, Wallet, Gift, ChevronRight,
  Scan, RefreshCw, Filter, Zap, Shield,
} from 'lucide-react';
import { Link } from 'react-router-dom';
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

const STATUS_META = {
  submitted:            { label: 'Submitted',       color: '#00D4FF', bg: 'bg-neon-blue/10  border-neon-blue/30' },
  pending_confirmation: { label: 'Needs Confirm',   color: '#FACC15', bg: 'bg-yellow-400/10 border-yellow-400/30' },
  verified:             { label: 'Verified ✓',      color: '#4ADE80', bg: 'bg-neon-green/10 border-neon-green/30' },
  official:             { label: 'Official ⭐',      color: '#8B5CF6', bg: 'bg-purple-400/10 border-purple-400/30' },
  rejected:             { label: 'Rejected',         color: '#F87171', bg: 'bg-red-400/10    border-red-400/30' },
  expired:              { label: 'Expired',           color: '#6B7280', bg: 'bg-gray-700/10   border-gray-600/30' },
};

const CONFIRM_BUTTONS = [
  { type: 'price_confirmed', label: '✅ Price OK',     pos: true  },
  { type: 'in_stock',        label: '📦 In Stock',     pos: true  },
  { type: 'great_deal',      label: '🔥 Great Deal',   pos: true  },
  { type: 'out_of_stock',    label: '❌ Out of Stock', pos: false },
  { type: 'price_mismatch',  label: '⚠️ Wrong Price',  pos: false },
  { type: 'not_found',       label: '🚫 Not Found',    pos: false },
  { type: 'wrong_product',   label: '📦 Wrong Item',   pos: false },
  { type: 'expired',         label: '⏰ Expired',       pos: false },
];

const FEED_FILTERS = [
  { id: 'all',       label: 'All',         status: 'submitted,pending_confirmation,verified,official' },
  { id: 'newest',    label: 'Newest',      status: 'submitted,pending_confirmation,verified,official', sort: 'newest' },
  { id: 'verified',  label: 'Verified',    status: 'verified,official' },
  { id: 'roi',       label: 'Highest ROI', status: 'submitted,pending_confirmation,verified,official', sort: 'roi' },
  { id: 'confirm',   label: 'Needs Vote',  status: 'submitted,pending_confirmation' },
];

const LEVEL_COLOR = {
  'Legend Hunter': '#f59e0b', 'Elite Hunter': '#8b5cf6',
  'Gold Hunter': '#f59e0b',   'Silver Hunter': '#94a3b8',
  'Bronze Hunter': '#b45309', 'Rookie Hunter': '#6b7280',
};

const TABS = ['feed', 'leaderboard', 'my_deals', 'wallet'];
const TAB_LABELS = { feed: '🏠 Feed', leaderboard: '🏆 Leaderboard', my_deals: '📋 My Deals', wallet: '💰 Wallet' };

// ── Deal Card ──────────────────────────────────────────────────────────────────
function DealCard({ deal, onConfirm, currentUserId }) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [confirmed, setConfirmed] = useState(null);
  const [confErr, setConfErr] = useState('');

  const sm = STATUS_META[deal.status] || STATUS_META.submitted;
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
      setConfErr(msg === 'You cannot confirm your own deal.' ? 'Cannot confirm your own deal.' :
                 msg === 'You have already confirmed this deal.' ? 'Already confirmed.' : msg);
    } finally {
      setConfirming(null);
    }
  }

  return (
    <div className="card space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${sm.bg}`} style={{ color: sm.color }}>
              {sm.label}
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
            <p className="text-[9px] text-gray-500">score</p>
          </div>
        )}
      </div>

      {/* Price row */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-dark-800/60 rounded-lg p-2 text-center">
          <p className="text-gray-500 text-[10px]">Store price</p>
          <p className="text-white font-bold">{fmt(deal.found_price) || '—'}</p>
        </div>
        <div className="bg-dark-800/60 rounded-lg p-2 text-center">
          <p className="text-gray-500 text-[10px]">Market price</p>
          <p className="text-neon-blue font-bold">{fmt(deal.effective_market_price) || '—'}</p>
        </div>
        <div className="bg-dark-800/60 rounded-lg p-2 text-center">
          <p className="text-gray-500 text-[10px]">Profit</p>
          <p className={`font-bold ${profit > 0 ? 'text-neon-green' : 'text-red-400'}`}>
            {fmt(deal.estimated_profit) || '—'}
          </p>
        </div>
      </div>

      {/* ROI + confirmations */}
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
            {deal.confirmation_count || 0}/{deal.trust_threshold || 2} confirmations
          </span>
        </div>
      </div>

      {/* Confirmation buttons */}
      {!isOwn && (
        <div>
          {confirmed ? (
            <p className="text-neon-green text-xs flex items-center gap-1.5 py-1">
              <CheckCircle size={12} /> Confirmed! +5 pts
            </p>
          ) : confErr ? (
            <p className="text-yellow-400 text-xs flex items-center gap-1.5 py-1">
              <AlertTriangle size={12} /> {confErr}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {CONFIRM_BUTTONS.slice(0, expanded ? undefined : 3).map(btn => (
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
                    +{CONFIRM_BUTTONS.length - 3} more
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-gray-500 pt-1 border-t border-dark-700/50">
        <span>
          {deal.submitter_name && `by ${deal.submitter_name}`}
          {deal.submitter_level && ` · ${deal.submitter_level}`}
        </span>
        <span>{timeAgo(deal.created_at)}</span>
      </div>
    </div>
  );
}

// ── Feed Tab ───────────────────────────────────────────────────────────────────
function FeedTab({ currentUserId }) {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const LIMIT = 10;

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
      {/* Filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {FEED_FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              filter === f.id
                ? 'bg-neon-green text-dark-900 border-neon-green'
                : 'text-gray-400 border-dark-600 hover:text-white bg-dark-800'
            }`}>
            {f.label}
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
          <p className="text-white font-semibold">No community deals yet</p>
          <p className="text-gray-500 text-sm">Be the first to submit a deal from the Scanner</p>
          <Link to="/scanner" className="btn-primary inline-flex items-center gap-2 text-sm px-5 mt-1">
            <Scan size={14} /> Go to Scanner
          </Link>
        </div>
      ) : (
        <>
          <p className="text-gray-500 text-xs">{total} deal{total !== 1 ? 's' : ''}</p>
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
              {loading ? 'Loading…' : `Load more (${total - deals.length} remaining)`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ── Leaderboard Tab ────────────────────────────────────────────────────────────
function LeaderboardTab() {
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

  const PERIOD_OPTIONS = [{ id: 'all', label: 'All Time' }, { id: 'month', label: 'This Month' }, { id: 'week', label: 'This Week' }];

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
          <p className="text-gray-400">No hunters yet. Start submitting deals to appear here!</p>
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
                    <span>{e.approved_deals_count || 0} verified deals</span>
                    {e.trust_score != null && (
                      <span className="flex items-center gap-0.5"><Shield size={9} /> Trust {e.trust_score}</span>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-black text-lg" style={{ color: lvlColor }}>{(e.points || 0).toLocaleString()}</p>
                  <p className="text-[10px] text-gray-500">pts</p>
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
        <p className="text-white font-semibold">No submissions yet</p>
        <p className="text-gray-500 text-sm">Use the Scanner to find deals and submit them to the community</p>
        <Link to="/scanner" className="btn-primary inline-flex items-center gap-2 text-sm px-5 mt-1">
          <Scan size={14} /> Open Scanner
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-gray-500 text-xs">{deals.length} submission{deals.length !== 1 ? 's' : ''}</p>
      {deals.map(d => {
        const sm = STATUS_META[d.status] || STATUS_META.submitted;
        const needsConf = d.trust_threshold - (d.confirmation_count || 0);
        return (
          <div key={d.id} className="card space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-sm truncate">{d.product_name}</p>
                <p className="text-gray-500 text-xs">{d.store_name} · {fmt(d.found_price)}</p>
              </div>
              <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${sm.bg}`} style={{ color: sm.color }}>
                {sm.label}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <p className="text-gray-500 text-[10px]">ROI</p>
                <p className="text-white font-semibold">{d.roi_percent ? `${Math.round(d.roi_percent)}%` : '—'}</p>
              </div>
              <div>
                <p className="text-gray-500 text-[10px]">Score</p>
                <p className="text-white font-semibold">{d.opportunity_score || '—'}</p>
              </div>
              <div>
                <p className="text-gray-500 text-[10px]">Confirmations</p>
                <p className="text-white font-semibold">{d.confirmation_count || 0}/{d.trust_threshold || 2}</p>
              </div>
            </div>

            {d.points_awarded ? (
              <p className="text-neon-green text-xs flex items-center gap-1"><CheckCircle size={11} /> Points awarded!</p>
            ) : d.points_pending > 0 ? (
              <p className="text-yellow-400 text-xs flex items-center gap-1">
                <Clock size={11} /> +{d.points_pending} pts pending
                {needsConf > 0 && ` · needs ${needsConf} more confirmation${needsConf > 1 ? 's' : ''}`}
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
const TIER_META = [
  { bg: 'bg-dark-800',        border: 'border-dark-600',         color: 'text-gray-300',    icon: '🎁' },
  { bg: 'bg-neon-blue/5',    border: 'border-neon-blue/20',     color: 'text-neon-blue',   icon: '💵' },
  { bg: 'bg-yellow-400/5',   border: 'border-yellow-400/20',    color: 'text-yellow-400',  icon: '💰' },
  { bg: 'bg-purple-400/5',   border: 'border-purple-400/20',    color: 'text-purple-400',  icon: '💎' },
  { bg: 'bg-neon-green/5',   border: 'border-neon-green/20',    color: 'text-neon-green',  icon: '👑' },
];

function WalletTab() {
  const [walletData, setWalletData] = useState(null);
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState(null);
  const [redeemMsg, setRedeemMsg] = useState('');

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [w, t] = await Promise.all([
        api.get('/community/wallet'),
        api.get('/community/redemption-tiers'),
      ]);
      setWalletData(w.data);
      setTiers(t.data.tiers || []);
    } catch {} finally {
      setLoading(false);
    }
  }

  async function redeem(tierId) {
    setRedeeming(tierId);
    setRedeemMsg('');
    try {
      const r = await api.post('/community/redeem', { tier_id: tierId });
      setRedeemMsg(`✅ Redeemed: ${r.data.tier}! ${r.data.remaining_points} pts remaining.`);
      await loadAll();
    } catch (err) {
      setRedeemMsg(`❌ ${err.response?.data?.error || 'Redemption failed'}`);
    } finally {
      setRedeeming(null);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="w-7 h-7 border-2 border-neon-green border-t-transparent rounded-full animate-spin" /></div>;

  const wallet  = walletData?.wallet;
  const profile = walletData?.profile;
  const earnings = walletData?.recent_earnings || [];

  return (
    <div className="space-y-5">
      {/* Points summary */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Wallet size={18} className="text-neon-green" />
          <p className="text-white font-bold">Points Wallet</p>
          {profile?.level && (
            <span className="text-xs ml-auto font-bold" style={{ color: LEVEL_COLOR[profile.level] || '#6b7280' }}>
              {profile.level}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-dark-800/60 rounded-xl p-3">
            <p className="text-2xl font-black text-neon-green">{wallet?.points_available || 0}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">Available</p>
          </div>
          <div className="bg-dark-800/60 rounded-xl p-3">
            <p className="text-2xl font-black text-yellow-400">{wallet?.points_pending || 0}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">Pending</p>
          </div>
          <div className="bg-dark-800/60 rounded-xl p-3">
            <p className="text-2xl font-black text-neon-blue">{wallet?.lifetime_points || 0}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">Lifetime</p>
          </div>
        </div>

        {(wallet?.credit_balance > 0) && (
          <div className="bg-neon-green/5 border border-neon-green/20 rounded-xl px-4 py-2 text-center">
            <p className="text-neon-green font-bold">${parseFloat(wallet.credit_balance).toFixed(2)} account credit</p>
          </div>
        )}

        <p className="text-gray-500 text-xs text-center">
          Pending points unlock when your submitted deals get verified by the community.
        </p>
      </div>

      {/* Redemption message */}
      {redeemMsg && (
        <div className={`rounded-xl px-4 py-3 text-sm font-medium ${redeemMsg.startsWith('✅') ? 'bg-neon-green/10 text-neon-green border border-neon-green/20' : 'bg-red-400/10 text-red-400 border border-red-400/20'}`}>
          {redeemMsg}
        </div>
      )}

      {/* Redemption tiers */}
      <div>
        <p className="text-white font-semibold mb-3 flex items-center gap-2"><Gift size={15} className="text-neon-green" /> Redeem Points</p>
        <div className="space-y-2">
          {tiers.map((tier, i) => {
            const m = TIER_META[i] || TIER_META[0];
            const isRedeeming = redeeming === tier.id;
            return (
              <div key={tier.id} className={`flex items-center gap-3 p-3 rounded-xl border ${m.bg} ${m.border} ${!tier.can_redeem ? 'opacity-60' : ''}`}>
                <span className="text-2xl w-8 text-center flex-shrink-0">{m.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-bold ${m.color}`}>{tier.label}</p>
                  <p className="text-gray-500 text-xs">{tier.points.toLocaleString()} points</p>
                </div>
                {tier.can_redeem ? (
                  <button
                    onClick={() => redeem(tier.id)}
                    disabled={!!redeeming}
                    className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50 flex-shrink-0"
                  >
                    {isRedeeming ? '…' : 'Redeem'}
                  </button>
                ) : (
                  <span className="text-gray-500 text-xs flex-shrink-0 text-right">
                    Need {(tier.points - (wallet?.points_available || 0)).toLocaleString()} more
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent earnings */}
      {earnings.length > 0 && (
        <div className="card">
          <p className="text-white font-semibold mb-3 text-sm">Recent Earnings</p>
          <div className="space-y-2">
            {earnings.slice(0, 8).map((e, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-dark-700/50 last:border-0">
                <div>
                  <p className="text-gray-300 text-xs">{e.product_name || e.description || e.earning_type}</p>
                  <p className="text-gray-600 text-[10px]">{timeAgo(e.created_at)}</p>
                </div>
                <span className={`text-xs font-bold ${e.status === 'available' ? 'text-neon-green' : 'text-yellow-400'}`}>
                  +{e.points} pts {e.status === 'pending' ? '(pending)' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* How to earn */}
      <div className="card bg-dark-800/40">
        <p className="text-gray-400 text-xs font-semibold mb-2 uppercase tracking-wider">How to earn points</p>
        <div className="space-y-1.5 text-xs text-gray-400">
          {[
            ['Submit a deal (BUY)', '+10 to +100 pts (pending)'],
            ['Deal gets verified', 'Points unlocked'],
            ['Deal goes Official', '+50 bonus pts'],
            ['Confirm a deal', '+5 pts (immediate)'],
            ['High ROI deal (>100%)', '+100 pts bonus'],
          ].map(([action, pts]) => (
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
  const [tab, setTab] = useState('feed');

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-2xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Users size={22} className="text-neon-green" /> Community
        </h1>
        <p className="text-gray-400 text-sm mt-0.5">Real deals found by real hunters · Confirm · Earn · Level up</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-dark-800 p-1 rounded-xl overflow-x-auto scrollbar-hide">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
              tab === t ? 'bg-neon-green text-dark-900' : 'text-gray-400 hover:text-white'
            }`}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'feed'        && <FeedTab currentUserId={user?.id} />}
      {tab === 'leaderboard' && <LeaderboardTab />}
      {tab === 'my_deals'    && <MyDealsTab />}
      {tab === 'wallet'      && <WalletTab />}
    </div>
  );
}
