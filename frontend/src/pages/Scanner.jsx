import { useState, useRef, useCallback } from 'react';
import {
  Scan, Search, TrendingUp, Package, AlertTriangle, History,
  Camera, X, ExternalLink, ChevronDown, CheckCircle, ShoppingCart,
  BarChart2, Clock, Upload,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../utils/api';
import CameraScanner from '../components/CameraScanner';

// ── Helpers ────────────────────────────────────────────────────────────────────

function safe(v) {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function fmt(v, decimals = 2) {
  const n = safe(v);
  return n !== null ? `$${n.toFixed(decimals)}` : '—';
}

function fmtPct(v) {
  const n = safe(v);
  return n !== null ? `${Math.round(n)}%` : '—';
}

const REC_COLORS = {
  BUY: { bg: 'bg-neon-green/20', text: 'text-neon-green', border: 'border-neon-green/40' },
  MAYBE: { bg: 'bg-yellow-400/20', text: 'text-yellow-400', border: 'border-yellow-400/40' },
  SKIP: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/40' },
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function ScoreDisplay({ score, label }) {
  const color = score >= 91 ? '#00ff88' : score >= 71 ? '#00d4ff' : score >= 41 ? '#fbbf24' : '#ef4444';
  const circ = 2 * Math.PI * 38;
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-24 h-24">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 90 90">
          <circle cx="45" cy="45" r="38" fill="none" stroke="#1e1e2e" strokeWidth="7" />
          <circle cx="45" cy="45" r="38" fill="none" stroke={color} strokeWidth="7"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - Math.min(score, 100) / 100)}
            strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.7s ease' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold" style={{ color }}>{score}</span>
          <span className="text-xs text-gray-500">/ 100</span>
        </div>
      </div>
      {label && <p className="text-sm font-semibold mt-2 text-center" style={{ color }}>{label}</p>}
    </div>
  );
}

const SOURCE_LABELS = {
  buy_box:         'Amazon Buy Box',
  amazon_current:  'Amazon Current Price',
  amazon_90d_avg:  'Amazon 90-Day Average',
  amazon_180d_avg: 'Amazon 180-Day Average',
  ebay_median:     'eBay Median',
  ebay_avg:        'eBay Average',
  none:            null,
};

// 'live' | 'estimated' | 'ebay' | null
function priceType(src) {
  if (!src || src === 'none') return null;
  if (src === 'buy_box' || src === 'amazon_current') return 'live';
  if (src === 'amazon_90d_avg' || src === 'amazon_180d_avg') return 'estimated';
  if (src.startsWith('ebay')) return 'ebay';
  return null;
}

const PRICE_TYPE_META = {
  live:      { dot: '🟢', label: 'Live Price',     color: 'text-neon-green',  bg: 'bg-neon-green/10  border-neon-green/25' },
  estimated: { dot: '🟡', label: 'Estimated Price', color: 'text-yellow-400',  bg: 'bg-yellow-400/10  border-yellow-400/25' },
  ebay:      { dot: '🔵', label: 'eBay Estimate',   color: 'text-neon-blue',   bg: 'bg-neon-blue/10   border-neon-blue/25'  },
};

function KeepaPanel({ keepa }) {
  if (!keepa) return null;

  if (!keepa.configured) {
    return (
      <div className="bg-dark-800/50 rounded-xl p-3 text-xs text-gray-500 flex items-center gap-2">
        <BarChart2 size={14} /> Keepa not configured
      </div>
    );
  }

  if (!keepa.found) {
    return (
      <div className="bg-dark-800/50 rounded-xl p-3 text-xs text-gray-500 flex items-center gap-2">
        <BarChart2 size={14} /> {keepa.error || 'Not found in Keepa'}
      </div>
    );
  }

  const hoursAgo = keepa.fetched_at
    ? Math.round((Date.now() - new Date(keepa.fetched_at).getTime()) / 3600000)
    : null;

  const hasEffective = keepa.effective_market_price != null;
  const src        = keepa.effective_market_source;
  const sourceLabel = SOURCE_LABELS[src] || src;
  const type       = priceType(src);
  const typeMeta   = type ? PRICE_TYPE_META[type] : null;

  // Only show live price fields when they have data OR when effective is live
  const showCurrent = keepa.amazon_current_price != null;
  const showBuyBox  = keepa.amazon_buy_box_price  != null;
  // When both live prices are absent but we have avg data, skip the "Not available" noise
  const showLiveRows = showCurrent || showBuyBox || !hasEffective;

  return (
    <div className="bg-dark-800/50 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle size={14} className="text-neon-green" />
          <span className="text-neon-green text-xs font-bold">Verified by Keepa</span>
          {keepa.cached && <span className="text-gray-500 text-xs">(cached)</span>}
        </div>
        {hoursAgo !== null && (
          <span className="text-gray-500 text-xs flex items-center gap-1">
            <Clock size={10} /> {hoursAgo}h ago
          </span>
        )}
      </div>

      {/* Market Price block */}
      {hasEffective ? (
        <div className={`rounded-xl border px-3 py-2.5 ${typeMeta?.bg ?? 'bg-dark-700/60 border-dark-600'}`}>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-1.5 mb-0.5">
                {typeMeta && <span className="text-xs">{typeMeta.dot}</span>}
                <p className="text-gray-400 text-xs">
                  {typeMeta ? typeMeta.label : 'Market Price'}
                </p>
              </div>
              <p className={`font-bold text-xl leading-none ${typeMeta?.color ?? 'text-white'}`}>
                {fmt(keepa.effective_market_price)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-gray-500 text-xs">Source</p>
              <p className={`text-xs font-semibold ${typeMeta?.color ?? 'text-gray-300'}`}>
                {sourceLabel}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-dark-700/40 border border-dark-600 rounded-xl px-3 py-2 text-xs text-gray-500">
          No resale price data available
        </div>
      )}

      {/* Price detail grid — only rows that have data */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {showLiveRows && (
          <>
            <div>
              <p className="text-gray-500">Amazon current</p>
              <p className={showCurrent ? 'text-white font-semibold' : 'text-gray-600'}>
                {showCurrent ? fmt(keepa.amazon_current_price) : 'Not available'}
              </p>
            </div>
            <div>
              <p className="text-gray-500">Buy Box</p>
              <p className={showBuyBox ? 'text-neon-green font-semibold' : 'text-gray-600'}>
                {showBuyBox ? fmt(keepa.amazon_buy_box_price) : 'Not available'}
              </p>
            </div>
          </>
        )}
        {keepa.amazon_90d_avg_price != null && (
          <div>
            <p className="text-gray-500">90d avg</p>
            <p className="text-white">{fmt(keepa.amazon_90d_avg_price)}</p>
          </div>
        )}
        {keepa.amazon_180d_avg_price != null && (
          <div>
            <p className="text-gray-500">180d avg</p>
            <p className="text-white">{fmt(keepa.amazon_180d_avg_price)}</p>
          </div>
        )}
        {keepa.sales_rank != null && (
          <div>
            <p className="text-gray-500">Sales rank</p>
            <p className="text-white">#{keepa.sales_rank.toLocaleString()}</p>
          </div>
        )}
        <div>
          <p className="text-gray-500">Keepa confidence</p>
          <p className="text-white">{keepa.confidence ?? 0}%</p>
        </div>
      </div>
    </div>
  );
}

function EvalPanel({ evaluation, onSave, saving }) {
  if (!evaluation) return null;
  const rec = evaluation.recommendation || 'SKIP';
  const c = REC_COLORS[rec] || REC_COLORS.SKIP;

  return (
    <div className={`rounded-xl p-4 border space-y-3 ${c.bg} ${c.border}`}>
      <div className="flex items-center justify-between">
        <span className={`text-xl font-bold ${c.text}`}>{rec}</span>
        <span className="text-gray-400 text-xs">Score {evaluation.opportunity_score}/100</span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-gray-400 text-xs">Resale price</p>
          <p className="text-white font-bold">{fmt(evaluation.resale_price)}</p>
          <p className="text-gray-500 text-xs">{evaluation.resale_source}</p>
        </div>
        <div>
          <p className="text-gray-400 text-xs">Net profit</p>
          <p className={`font-bold ${(evaluation.net_profit || 0) > 0 ? 'text-neon-green' : 'text-red-400'}`}>
            {fmt(evaluation.net_profit)}
          </p>
        </div>
        <div>
          <p className="text-gray-400 text-xs">Amazon fees</p>
          <p className="text-white">{fmt(evaluation.fees_estimate)}</p>
        </div>
        <div>
          <p className="text-gray-400 text-xs">ROI</p>
          <p className={`font-bold ${(evaluation.roi_percent || 0) >= 25 ? 'text-neon-blue' : 'text-gray-400'}`}>
            {fmtPct(evaluation.roi_percent)}
          </p>
        </div>
      </div>
      <p className="text-gray-500 text-xs">+$10 shipping · 15% FBA fee · based on {evaluation.resale_source}</p>
      <button
        onClick={onSave}
        disabled={saving}
        className="btn-ghost w-full text-sm py-2 flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <ShoppingCart size={14} /> {saving ? 'Saving…' : 'Save Scan'}
      </button>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

const REAL_SKU_EXAMPLES = ['gs-344870', '6620073', '6510363'];

const FEEDBACK_TAGS = ['Found in Store', 'Out of Stock', 'Price Mismatch', 'Wrong Product', 'Good Deal', 'Bad Deal'];

export default function Scanner() {
  const [mode, setMode] = useState('upc');
  const [query, setQuery] = useState('');
  const [lookupResult, setLookupResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [showAllDeals, setShowAllDeals] = useState(false);

  // In-store price flow
  const [storePrice, setStorePrice] = useState('');
  const [evaluation, setEvaluation] = useState(null);
  const [evaluating, setEvaluating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState(null);

  // Submit as Deal
  const [feedbackTag, setFeedbackTag] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null); // { id, points_pending, confirmations_needed, error }

  // History
  const [history, setHistory] = useState([]);

  const inputRef = useRef(null);
  const storePriceRef = useRef(null);
  const isSearchingRef = useRef(false);
  const lastCameraScanRef = useRef({ code: '', time: 0 });

  const resetResult = () => {
    setLookupResult(null);
    setError('');
    setStorePrice('');
    setEvaluation(null);
    setSavedId(null);
    setShowAllDeals(false);
    setFeedbackTag('');
    setSubmitting(false);
    setSubmitResult(null);
  };

  const doLookup = useCallback(async (code, lookupMode, opts = {}) => {
    const term = (code || query).trim();
    if (!term) return;

    // Block concurrent requests
    if (isSearchingRef.current) return;

    // Camera debounce: ignore the same code within 5 seconds to prevent duplicate scans
    if (opts.fromCamera) {
      const now = Date.now();
      const last = lastCameraScanRef.current;
      if (last.code === term && now - last.time < 5000) return;
      lastCameraScanRef.current = { code: term, time: now };
    }

    isSearchingRef.current = true;
    resetResult();
    setQuery(term);
    setLoading(true);

    try {
      const isUpc = (lookupMode || mode) === 'upc' || /^\d{8,14}$/.test(term);

      if (isUpc) {
        // Use new scanner endpoint for UPC — enriches with Keepa
        const r = await api.get(`/scanner/lookup/${encodeURIComponent(term)}`);
        setLookupResult(r.data);

        if (!r.data.found_internal && !r.data.keepa?.found) {
          setError(`"${term}" not found in Deal Hunter or Keepa.`);
        }

        addHistory(term, r.data);
      } else {
        // SKU — search internal DB
        const r = await api.get('/search', { params: { sku: term, limit: 20 } });
        const results = r.data.results || [];
        if (!results.length) {
          setError(`No deals found for SKU "${term}".`);
          return;
        }
        const sorted = [...results].sort((a, b) => (b.opportunity_score || 0) - (a.opportunity_score || 0));
        setLookupResult({ found_internal: true, sku_results: sorted, keepa: null, external_enabled: false });
        addHistory(term, { found_internal: true, deals: sorted });
      }
    } catch (err) {
      if (err.response?.status === 401) return;
      setError('Lookup failed. Check your connection and try again.');
    } finally {
      setLoading(false);
      isSearchingRef.current = false;
    }
  }, [query, mode]);

  function addHistory(term, data) {
    const bestDeal = data.deals?.[0];
    setHistory(prev => [
      {
        code: term,
        name: data.product?.name || data.keepa?.title || bestDeal?.name || term,
        found: data.found_internal || data.keepa?.found,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
      ...prev.filter(h => h.code !== term).slice(0, 9),
    ]);
  }

  async function calculateProfit() {
    const sp = parseFloat(storePrice);
    if (!sp || sp <= 0) return;

    setEvaluating(true);
    setEvaluation(null);
    try {
      const keepa = lookupResult?.keepa;
      const r = await api.post('/scanner/evaluate', {
        code: query,
        in_store_price: sp,
        effective_market_price: keepa?.effective_market_price ?? null,
        effective_market_source: keepa?.effective_market_source ?? null,
        pricing_confidence: keepa?.pricing_confidence ?? 0,
        amazon_current_price: keepa?.amazon_current_price ?? null,
        amazon_buy_box_price: keepa?.amazon_buy_box_price ?? null,
        amazon_90d_avg_price: keepa?.amazon_90d_avg_price ?? null,
        sales_rank: keepa?.sales_rank ?? null,
        confidence: keepa?.confidence ?? 0,
      });
      setEvaluation(r.data);
    } catch {
      setError('Profit calculation failed');
    } finally {
      setEvaluating(false);
    }
  }

  async function saveScan() {
    if (saving || savedId) return;
    setSaving(true);
    try {
      const keepa = lookupResult?.keepa;
      const r = await api.post('/scanner/history', {
        code: query,
        code_type: mode,
        product_id: lookupResult?.product?.product_id || null,
        found_internal: lookupResult?.found_internal || false,
        in_store_price: storePrice ? parseFloat(storePrice) : null,
        evaluation: evaluation || null,
        keepa_asin: keepa?.asin || null,
        keepa_confidence: keepa?.confidence || null,
      });
      setSavedId(r.data.id);
    } catch {
      // fail silently — don't disrupt UX
    } finally {
      setSaving(false);
    }
  }

  async function submitDeal() {
    if (submitting || submitResult?.id) return;
    setSubmitting(true);
    try {
      const k = lookupResult?.keepa;
      const p = lookupResult?.product;
      const r = await api.post('/scanner/submit-deal', {
        upc:   p?.upc  || (mode === 'upc' ? query : null),
        sku:   p?.sku  || (mode === 'sku' ? query : null),
        title: p?.name || k?.title || query,
        brand: p?.brand || k?.brand || null,
        store_slug:              p?.store_slug || null,
        found_price:             parseFloat(storePrice),
        effective_market_price:  k?.effective_market_price ?? null,
        effective_market_source: k?.effective_market_source ?? null,
        net_profit:              evaluation?.net_profit ?? null,
        roi_percent:             evaluation?.roi_percent ?? null,
        opportunity_score:       evaluation?.opportunity_score ?? null,
        recommendation:          evaluation?.recommendation ?? null,
        keepa_confidence:        k?.confidence ?? null,
        feedback_tag:            feedbackTag || null,
      });
      setSubmitResult({ id: r.data.id, points_pending: r.data.points_pending, confirmations_needed: r.data.confirmations_needed });
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.error || 'Failed to submit deal.';
      const code = err.response?.data?.error;
      if (code === 'photo_required') {
        setSubmitResult({ error: 'photo_required', message: msg });
      } else if (code === 'duplicate') {
        setSubmitResult({ error: 'duplicate', message: msg });
      } else {
        setSubmitResult({ error: 'generic', message: msg });
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e) { e?.preventDefault(); doLookup(); }
  function handleCameraScan(code) { setShowCamera(false); setMode('upc'); doLookup(code, 'upc', { fromCamera: true }); }
  function handleExampleClick(ex) { setMode('sku'); doLookup(ex, 'sku'); }

  // Derived data from lookupResult
  const keepa = lookupResult?.keepa;
  const product = lookupResult?.product;
  const deals = lookupResult?.deals || [];
  const skuResults = lookupResult?.sku_results || [];
  const bestDeal = deals[0] || skuResults[0] || null;

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-2xl mx-auto">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Scan size={24} className="text-neon-green" /> In-Store Scanner
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          Scan a barcode or enter UPC/SKU to check deal potential in real time
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 p-1 bg-dark-800 rounded-xl w-fit">
        {[{ id: 'upc', label: 'UPC / Barcode' }, { id: 'sku', label: 'SKU' }].map(m => (
          <button key={m.id} onClick={() => { setMode(m.id); setError(''); }}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${mode === m.id ? 'bg-neon-green text-dark-900' : 'text-gray-400 hover:text-white'}`}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-3">
        <div className="flex-1 relative">
          <Scan size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
            placeholder={mode === 'upc' ? 'Enter UPC barcode…' : 'Enter SKU / model number…'}
            className="w-full bg-dark-800 border border-dark-700 text-white rounded-xl pl-10 pr-4 py-3 text-sm placeholder-gray-500 focus:outline-none focus:border-neon-green/50" />
          {query && (
            <button type="button" onClick={() => { resetResult(); setQuery(''); inputRef.current?.focus(); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
              <X size={14} />
            </button>
          )}
        </div>
        <button type="button" onClick={() => setShowCamera(true)}
          className="btn-ghost px-3 text-neon-blue border-neon-blue/30 flex items-center gap-1.5 text-sm" title="Scan with camera">
          <Camera size={16} />
        </button>
        <button type="submit" disabled={loading || !query.trim()} className="btn-primary flex items-center gap-2 px-5 disabled:opacity-50">
          <Search size={16} /> {loading ? 'Searching…' : 'Lookup'}
        </button>
      </form>

      {/* SKU examples */}
      {!lookupResult && !loading && (
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-gray-500 text-xs">Try a real SKU:</span>
          {REAL_SKU_EXAMPLES.map(ex => (
            <button key={ex} onClick={() => handleExampleClick(ex)} className="text-xs text-neon-blue hover:underline font-mono">{ex}</button>
          ))}
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="py-4 px-5 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
          <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="card space-y-4 animate-pulse">
          <p className="text-gray-400 text-sm">Searching Deal Hunter{keepa !== undefined ? ' + Keepa' : ''}…</p>
          <div className="h-6 bg-dark-700 rounded w-3/4" />
          <div className="h-4 bg-dark-700 rounded w-1/2" />
        </div>
      )}

      {/* Result — UPC lookup */}
      {lookupResult && !loading && (

        <div className="space-y-4 animate-fade-in">

          {/* Product header */}
          {(product || keepa?.found) && (
            <div className="card space-y-3">
              <div className="flex items-start gap-3">
                {(product?.image_url || keepa?.image_url) && (
                  <img src={product?.image_url || keepa?.image_url} alt=""
                    className="w-16 h-16 object-contain rounded-lg bg-dark-800/50 flex-shrink-0"
                    onError={e => { e.currentTarget.style.display = 'none'; }} />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-gray-400 text-xs mb-0.5">{product?.brand || keepa?.brand}</p>
                  <h2 className="text-white font-bold text-base leading-snug">
                    {product?.name || keepa?.title || query}
                  </h2>
                  {product?.store_name && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full mt-1 inline-block"
                      style={{ background: `${product.store_color}25`, color: product.store_color }}>
                      {product.store_name}
                    </span>
                  )}
                </div>
              </div>

              {/* UPC/SKU codes */}
              <div className="flex gap-3 text-xs text-gray-500 font-mono">
                {product?.upc && <span>UPC: {product.upc}</span>}
                {product?.sku && <span>SKU: {product.sku}</span>}
              </div>
            </div>
          )}

          {/* Keepa market data */}
          {keepa && <KeepaPanel keepa={keepa} />}

          {/* Internal deals */}
          {deals.length > 0 && (
            <div className="card space-y-3">
              <p className="text-gray-400 text-xs uppercase tracking-wider">Deal Hunter Match</p>
              {deals.slice(0, 3).map(d => (
                <div key={d.deal_id} className="flex items-center justify-between text-sm p-2.5 bg-dark-800/50 rounded-xl">
                  <div>
                    <span className="text-white font-bold">{fmt(d.deal_price, 0)}</span>
                    <span className="text-gray-500 line-through ml-2">{fmt(d.regular_price, 0)}</span>
                    <span className="text-red-400 ml-2">-{Math.round(d.discount_percent || 0)}%</span>
                  </div>
                  <Link to={`/deal/${d.deal_id}`} className="text-neon-blue text-xs hover:underline flex items-center gap-1">
                    <ExternalLink size={11} /> View
                  </Link>
                </div>
              ))}
              {deals.length > 3 && (
                <button onClick={() => setShowAllDeals(!showAllDeals)} className="text-xs text-gray-400 flex items-center gap-1">
                  <ChevronDown size={12} className={showAllDeals ? 'rotate-180' : ''} /> {deals.length - 3} more
                </button>
              )}
            </div>
          )}

          {/* SKU results (non-UPC mode) */}
          {skuResults.length > 0 && (
            <div className="card space-y-3">
              <p className="text-gray-400 text-xs uppercase tracking-wider">SKU Results</p>
              {skuResults.slice(0, 5).map(d => (
                <div key={d.id} className="flex items-center gap-3 text-sm p-2.5 bg-dark-800/50 rounded-xl">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-medium truncate">{d.name}</p>
                    <p className="text-gray-500 text-xs">{d.store_name} · {fmt(d.deal_price, 0)}</p>
                  </div>
                  <Link to={`/deal/${d.id}`} className="text-neon-blue text-xs hover:underline flex-shrink-0">View →</Link>
                </div>
              ))}
            </div>
          )}

          {/* In-store price → profit calculation */}
          {(keepa?.found || deals.length > 0) && (() => {
            const sp = parseFloat(storePrice);
            const storePriceValid = sp > 0;
            const empSrc = keepa?.effective_market_source;
            const empType = priceType(empSrc);
            const empMeta = empType ? PRICE_TYPE_META[empType] : null;
            const empLabel = SOURCE_LABELS[empSrc] || empSrc;
            const hasEmp = keepa?.effective_market_price != null;

            return (
              <div className="card space-y-3">
                <p className="text-white font-semibold text-sm flex items-center gap-2">
                  <ShoppingCart size={15} className="text-neon-green" /> What's the in-store price?
                </p>

                <div className="flex gap-3">
                  <div className="flex-1 relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input ref={storePriceRef} type="number" min="0.01" step="0.01"
                      value={storePrice} onChange={e => { setStorePrice(e.target.value); setEvaluation(null); setSavedId(null); }}
                      placeholder="0.00"
                      className="w-full bg-dark-800 border border-dark-700 text-white rounded-xl pl-7 pr-4 py-2.5 text-sm focus:outline-none focus:border-neon-green/50" />
                  </div>
                  <button onClick={calculateProfit} disabled={evaluating || !storePriceValid}
                    className="btn-primary px-5 text-sm disabled:opacity-50 flex items-center gap-2">
                    <TrendingUp size={14} /> {evaluating ? 'Calculating…' : 'Calculate Profit'}
                  </button>
                </div>

                {/* Context line: what price will be used, or prompt to enter store price */}
                {!storePriceValid ? (
                  <p className="text-gray-500 text-xs flex items-center gap-1.5">
                    <AlertTriangle size={11} className="text-gray-600" />
                    Enter the in-store purchase price to calculate profit.
                  </p>
                ) : hasEmp ? (
                  <p className="text-xs text-gray-500 flex items-center gap-1.5">
                    {empMeta && <span>{empMeta.dot}</span>}
                    ROI calculated using <span className={`font-semibold ${empMeta?.color ?? 'text-gray-300'}`}>
                      {fmt(keepa.effective_market_price)}
                    </span>
                    &nbsp;·&nbsp;{empLabel}
                  </p>
                ) : null}

                {evaluation && (
                  <>
                    <EvalPanel evaluation={evaluation} onSave={saveScan} saving={saving} />

                    {/* Submit as Community Deal — only for BUY or score ≥ 70 */}
                    {(evaluation.recommendation === 'BUY' || (evaluation.opportunity_score || 0) >= 70) && (
                      <div className="mt-1 p-3 rounded-xl border border-neon-blue/20 bg-neon-blue/5 space-y-3">
                        <p className="text-neon-blue text-xs font-semibold uppercase tracking-wider">Submit as Community Deal</p>

                        {/* Feedback tags */}
                        <div>
                          <p className="text-gray-400 text-xs mb-2">What did you find? (optional)</p>
                          <div className="flex flex-wrap gap-1.5">
                            {FEEDBACK_TAGS.map(tag => (
                              <button
                                key={tag}
                                onClick={() => setFeedbackTag(t => t === tag ? '' : tag)}
                                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                                  feedbackTag === tag
                                    ? 'bg-neon-blue/20 text-neon-blue border-neon-blue/40'
                                    : 'bg-dark-800 text-gray-400 border-dark-700 hover:border-gray-500'
                                }`}
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                        </div>

                        {submitResult?.id ? (
                          <div className="space-y-1">
                            <p className="text-neon-green text-xs flex items-center gap-1.5">
                              <CheckCircle size={12} /> Deal submitted — needs {submitResult.confirmations_needed} confirmations to go live.
                            </p>
                            <p className="text-gray-500 text-xs">
                              +{submitResult.points_pending} pts will be awarded when verified.
                            </p>
                          </div>
                        ) : submitResult?.error ? (
                          <p className="text-yellow-400 text-xs flex items-center gap-1.5">
                            <AlertTriangle size={12} /> {submitResult.message}
                          </p>
                        ) : (
                          <button
                            onClick={submitDeal}
                            disabled={submitting}
                            className="btn-primary w-full text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                          >
                            <Upload size={14} /> {submitting ? 'Submitting…' : 'Submit to Community'}
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}

                {savedId && (
                  <p className="text-neon-green text-xs flex items-center gap-1">
                    <CheckCircle size={12} /> Scan saved to history
                  </p>
                )}
              </div>
            );
          })()}

          {/* Not found state */}
          {!lookupResult.found_internal && !keepa?.found && (
            <div className="card text-center py-6 text-gray-400">
              <Scan size={28} className="mx-auto mb-2 text-gray-600" />
              <p className="text-sm">Product not found in Deal Hunter or Keepa</p>
              <p className="text-xs mt-1 text-gray-500">Try searching with a different code or check the Search page</p>
            </div>
          )}
        </div>
      )}

      {/* Session history */}
      {history.length > 0 && (
        <div className="card">
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2 text-sm">
            <History size={15} className="text-gray-400" /> Recent Lookups
          </h3>
          <div className="space-y-1">
            {history.map((h, i) => (
              <button key={i} onClick={() => { setMode('upc'); doLookup(h.code, 'upc'); }}
                className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-dark-800 transition-colors text-left">
                <span className="font-mono text-gray-400 text-xs w-28 truncate">{h.code}</span>
                <span className="text-white text-sm flex-1 truncate">{h.name}</span>
                {h.found
                  ? <CheckCircle size={12} className="text-neon-green flex-shrink-0" />
                  : <X size={12} className="text-red-400 flex-shrink-0" />}
                <span className="text-gray-500 text-xs flex-shrink-0">{h.time}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Camera modal */}
      {showCamera && (
        <CameraScanner onDetected={handleCameraScan} onClose={() => setShowCamera(false)} />
      )}
    </div>
  );
}
