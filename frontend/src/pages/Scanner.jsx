import { useState, useRef, useCallback } from 'react';
import { Scan, Search, TrendingUp, Package, AlertTriangle, History, Camera, X, ExternalLink, ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../utils/api';
import CameraScanner from '../components/CameraScanner';

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

// Real SKUs from DB — used as quick-try examples
const REAL_SKU_EXAMPLES = ['gs-344870', '6620073', '6510363'];

export default function Scanner() {
  const [mode, setMode] = useState('sku'); // 'upc' | 'sku'
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);   // best deal found
  const [allDeals, setAllDeals] = useState([]); // all stores for same product
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);   // session-only, starts empty
  const [showCamera, setShowCamera] = useState(false);
  const [showAllDeals, setShowAllDeals] = useState(false);
  const inputRef = useRef(null);

  const lookupCode = useCallback(async (code, lookupMode) => {
    const term = (code || query).trim();
    if (!term) return;

    setLoading(true);
    setError('');
    setResult(null);
    setAllDeals([]);
    setShowAllDeals(false);

    try {
      let deals = [];

      if (lookupMode === 'upc' || mode === 'upc') {
        const r = await api.get(`/search/upc/${encodeURIComponent(term)}`);
        deals = r.data.all_deals || (r.data.product ? [r.data.product] : []);
      } else {
        // SKU mode — use search endpoint with sku param
        const r = await api.get('/search', { params: { sku: term, limit: 20 } });
        deals = r.data.results || [];
      }

      if (deals.length === 0) {
        setError(`No active deals found for "${term}". It may not be in our database yet.`);
        return;
      }

      // Best deal = highest score
      const sorted = [...deals].sort((a, b) => (parseInt(b.opportunity_score) || 0) - (parseInt(a.opportunity_score) || 0));
      const best = sorted[0];

      setResult(best);
      setAllDeals(sorted);

      setHistory(prev => [{
        query: term,
        mode: lookupMode || mode,
        name: best.name || 'Unknown',
        score: parseInt(best.opportunity_score) || 0,
        profit: parseFloat(best.estimated_profit) || 0,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }, ...prev.slice(0, 9)]);
    } catch (err) {
      if (err.response?.status === 404) {
        setError(`"${term}" not found — no active deals for this code.`);
      } else if (err.response?.status === 400) {
        setError('Enter a valid UPC or SKU to look up.');
      } else {
        setError('Lookup failed. Check your connection and try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [query, mode]);

  function handleSubmit(e) {
    e?.preventDefault();
    lookupCode();
  }

  function handleCameraScan(code) {
    setShowCamera(false);
    setQuery(code);
    setMode('upc'); // camera always scans barcodes → UPC mode
    lookupCode(code, 'upc');
  }

  function handleExampleClick(ex) {
    setQuery(ex);
    setMode('sku');
    lookupCode(ex, 'sku');
  }

  function clearResult() {
    setResult(null);
    setAllDeals([]);
    setError('');
    setQuery('');
    inputRef.current?.focus();
  }

  // Field helpers — API returns strings from Postgres
  const dealPrice = result ? parseFloat(result.deal_price || 0) : 0;
  const regularPrice = result ? parseFloat(result.regular_price || 0) : 0;
  const discount = result ? Math.round(parseFloat(result.discount_percent || 0)) : 0;
  const score = result ? (parseInt(result.opportunity_score) || 0) : 0;
  const profit = result ? parseFloat(result.estimated_profit || 0) : 0;
  const roi = result ? Math.round(parseFloat(result.roi_percent || 0)) : 0;
  const inStock = result ? (result.stock_quantity !== null || result.deal_price) : false;
  const stockQty = result ? result.stock_quantity : null;

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-2xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Scan size={24} className="text-neon-green" /> UPC / SKU Scanner
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Look up any product to check price, history, and resale potential
          </p>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 p-1 bg-dark-800 rounded-xl w-fit">
        {[
          { id: 'sku', label: 'SKU' },
          { id: 'upc', label: 'UPC' },
        ].map(m => (
          <button
            key={m.id}
            onClick={() => { setMode(m.id); setError(''); }}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              mode === m.id ? 'bg-neon-green text-dark-900' : 'text-gray-400 hover:text-white'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Input row */}
      <form onSubmit={handleSubmit} className="flex gap-3">
        <div className="flex-1 relative">
          <Scan size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={mode === 'upc' ? 'Enter UPC barcode…' : 'Enter SKU / model number…'}
            className="w-full bg-dark-800 border border-dark-700 text-white rounded-xl pl-10 pr-4 py-3 text-sm placeholder-gray-500 focus:outline-none focus:border-neon-green/50"
          />
          {query && (
            <button type="button" onClick={clearResult} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
              <X size={14} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowCamera(true)}
          className="btn-ghost px-3 text-neon-blue border-neon-blue/30 flex items-center gap-1.5 text-sm"
          title="Scan with camera"
        >
          <Camera size={16} />
        </button>
        <button type="submit" disabled={loading || !query.trim()} className="btn-primary flex items-center gap-2 px-5 disabled:opacity-50">
          <Search size={16} /> {loading ? 'Looking up…' : 'Lookup'}
        </button>
      </form>

      {/* Real SKU examples */}
      {!result && !loading && (
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-gray-500 text-xs">Try a real SKU:</span>
          {REAL_SKU_EXAMPLES.map(ex => (
            <button
              key={ex}
              onClick={() => handleExampleClick(ex)}
              className="text-xs text-neon-blue hover:underline font-mono"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="py-4 px-5 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
          <AlertTriangle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 text-sm">{error}</p>
            <p className="text-gray-500 text-xs mt-1">
              {mode === 'upc'
                ? 'UPCs may not exist in our DB yet — try a SKU instead.'
                : 'Check the SKU and try again, or use the Search page for keyword lookups.'}
            </p>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="card space-y-4 animate-pulse">
          <div className="h-6 bg-dark-700 rounded w-3/4" />
          <div className="h-4 bg-dark-700 rounded w-1/2" />
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map(i => <div key={i} className="h-20 bg-dark-700 rounded-xl" />)}
          </div>
        </div>
      )}

      {/* Result card */}
      {result && !loading && (
        <div className="card space-y-5 animate-fade-in">

          {/* Header row */}
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              {result.is_error_price && (
                <div className="flex items-center gap-1 text-yellow-400 text-xs mb-2">
                  <AlertTriangle size={12} /> Possible price error detected
                </div>
              )}
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                {result.store_color && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: `${result.store_color}25`, color: result.store_color }}>
                    {result.store_name}
                  </span>
                )}
                {result.category_name && (
                  <span className="text-xs text-gray-500">{result.category_name}</span>
                )}
              </div>
              {result.brand && <p className="text-gray-400 text-xs mb-0.5">{result.brand}</p>}
              <h2 className="text-white font-bold text-lg leading-snug">{result.name}</h2>
              <div className="flex gap-3 mt-1 flex-wrap">
                {result.sku && <p className="text-gray-500 text-xs font-mono">SKU: {result.sku}</p>}
                {result.upc && <p className="text-gray-500 text-xs font-mono">UPC: {result.upc}</p>}
              </div>
            </div>
            <ScoreDisplay score={score} label={result.opportunity_label} />
          </div>

          {/* Image */}
          {result.image_url && (
            <img
              src={result.image_url}
              alt={result.name}
              className="w-full max-h-48 object-contain rounded-xl bg-dark-800/50"
              onError={e => { e.currentTarget.style.display = 'none'; }}
            />
          )}

          {/* Price grid */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-dark-800/50 rounded-xl p-3 text-center">
              <p className="text-gray-400 text-xs mb-1">Deal Price</p>
              <p className="text-2xl font-bold text-white">${dealPrice.toFixed(0)}</p>
            </div>
            <div className="bg-dark-800/50 rounded-xl p-3 text-center">
              <p className="text-gray-400 text-xs mb-1">Regular</p>
              <p className="text-2xl font-bold text-gray-500 line-through">${regularPrice.toFixed(0)}</p>
            </div>
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-center">
              <p className="text-gray-400 text-xs mb-1">Discount</p>
              <p className="text-2xl font-bold text-red-400">-{discount}%</p>
            </div>
          </div>

          {/* Stock */}
          <div className="flex items-center gap-2 text-sm">
            <Package size={14} className={inStock ? 'text-neon-green' : 'text-red-400'} />
            <span className={inStock ? 'text-neon-green' : 'text-red-400'}>
              {inStock
                ? (stockQty != null ? `${stockQty} in stock` : 'In stock')
                : 'Stock unknown'}
            </span>
            {stockQty != null && stockQty <= 3 && (
              <span className="text-yellow-400 text-xs">⚠️ Low stock</span>
            )}
            {result.demand_level && (
              <span className="ml-auto text-xs text-gray-400">{result.demand_level} demand</span>
            )}
          </div>

          {/* Resale breakdown */}
          {(result.resale_price_amazon || result.resale_price_ebay || result.resale_price_facebook) && (
            <div>
              <p className="text-gray-400 text-xs uppercase tracking-wider mb-2">Resale Breakdown</p>
              <div className="space-y-0">
                {[
                  { label: 'Amazon', price: parseFloat(result.resale_price_amazon || 0), feeRate: 0.15, ship: 12 },
                  { label: 'eBay', price: parseFloat(result.resale_price_ebay || 0), feeRate: 0.13, ship: 12 },
                  { label: 'FB Marketplace', price: parseFloat(result.resale_price_facebook || 0), feeRate: 0, ship: 0 },
                ].filter(p => p.price > 0).map(p => {
                  const fees = Math.round(p.price * p.feeRate);
                  const net = Math.round(p.price - fees - p.ship - dealPrice);
                  return (
                    <div key={p.label} className="flex items-center justify-between text-sm py-2 border-b border-dark-800 last:border-0">
                      <span className="text-gray-400 w-28">{p.label}</span>
                      <span className="text-white">${p.price.toFixed(0)}</span>
                      <span className="text-gray-500 text-xs">-${fees + p.ship} fees</span>
                      <span className={`font-bold text-sm ${net > 0 ? 'text-neon-green' : 'text-red-400'}`}>
                        {net > 0 ? '+' : ''}{net > 0 ? `$${net}` : `$${net}`}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-neon-green">${profit.toFixed(2)}</p>
                  <p className="text-gray-400 text-xs">Best net profit</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-neon-blue">{roi}%</p>
                  <p className="text-gray-400 text-xs">ROI</p>
                </div>
              </div>
            </div>
          )}

          {/* Product link */}
          {result.product_url && (
            <a
              href={result.product_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-neon-blue text-sm hover:underline"
            >
              <ExternalLink size={14} /> View product page
            </a>
          )}

          {/* Full deal link */}
          {result.id && (
            <Link to={`/deal/${result.id}`} className="btn-primary w-full text-center text-sm py-2.5 block">
              View Full Deal Details
            </Link>
          )}

          {/* Other stores */}
          {allDeals.length > 1 && (
            <div>
              <button
                onClick={() => setShowAllDeals(!showAllDeals)}
                className="flex items-center gap-1.5 text-gray-400 text-xs hover:text-white transition-colors"
              >
                <ChevronDown size={14} className={showAllDeals ? 'rotate-180 transition-transform' : 'transition-transform'} />
                {allDeals.length - 1} more deal{allDeals.length - 1 !== 1 ? 's' : ''} at other stores
              </button>
              {showAllDeals && (
                <div className="mt-2 space-y-2">
                  {allDeals.slice(1).map(d => (
                    <div key={d.id} className="flex items-center gap-3 p-2.5 bg-dark-800/50 rounded-xl text-sm">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: `${d.store_color}25`, color: d.store_color }}>
                        {d.store_name}
                      </span>
                      <span className="text-white font-bold">${parseFloat(d.deal_price || 0).toFixed(0)}</span>
                      <span className="text-red-400">-{Math.round(parseFloat(d.discount_percent || 0))}%</span>
                      <span className="text-neon-green ml-auto text-xs">Score {d.opportunity_score}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Empty state — after lookup returns nothing and no error */}
      {!result && !loading && !error && query && (
        <div className="text-center py-12 text-gray-400">
          <Scan size={32} className="mx-auto mb-3 text-gray-500" />
          <p className="text-sm">Enter a SKU or UPC and press Lookup</p>
        </div>
      )}

      {/* Session history */}
      {history.length > 0 && (
        <div className="card">
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2 text-sm">
            <History size={15} className="text-gray-400" /> Recent Lookups
          </h3>
          <div className="space-y-1">
            {history.map((h, i) => {
              const c = h.score >= 91 ? '#00ff88' : h.score >= 71 ? '#00d4ff' : h.score >= 41 ? '#fbbf24' : '#ef4444';
              return (
                <button
                  key={i}
                  onClick={() => { setQuery(h.query); setMode(h.mode); lookupCode(h.query, h.mode); }}
                  className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-dark-800 transition-colors text-left"
                >
                  <span className="font-mono text-gray-400 text-xs w-28 truncate">{h.query}</span>
                  <span className="text-white text-sm flex-1 truncate">{h.name}</span>
                  {h.score > 0 && <span className="text-xs font-bold flex-shrink-0" style={{ color: c }}>Score {h.score}</span>}
                  {h.profit > 0 && <span className="text-neon-green text-xs font-semibold flex-shrink-0">+${h.profit.toFixed(0)}</span>}
                  <span className="text-gray-500 text-xs flex-shrink-0">{h.time}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Camera scanner modal */}
      {showCamera && (
        <CameraScanner
          onDetected={handleCameraScan}
          onClose={() => setShowCamera(false)}
        />
      )}
    </div>
  );
}
