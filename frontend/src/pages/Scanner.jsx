import { useState, useRef } from 'react';
import { Scan, Search, TrendingUp, Package, AlertTriangle, BarChart3, History, Camera } from 'lucide-react';
import api from '../utils/api';
import CameraScanner from '../components/CameraScanner';

const DEMO_RESULT = {
  name: 'DeWalt 20V Max Drill Kit', brand: 'DeWalt', upc: '885911416443',
  current_price: 49.00, regular_price: 199.00, discount_percent: 75,
  in_stock: true, stock_quantity: 3,
  opportunity_score: 98, opportunity_label: '🔥 Excelente',
  is_error_price: true,
  estimated_profit: 81, roi_percent: 165,
  resale_price_amazon: 149, resale_price_ebay: 137, resale_price_facebook: 127,
  demand_level: 'Very High', estimated_days_to_sell: 2,
  price_history: [
    { date: 'May 1', price: 199 }, { date: 'May 10', price: 149 },
    { date: 'May 20', price: 99 }, { date: 'May 28', price: 49 },
  ],
  store_name: 'Home Depot',
};

const HISTORY = [
  { query: '885911416443', result: 'DeWalt 20V Drill', score: 98, profit: 81, time: '2 min ago' },
  { query: '037-77-8001', result: 'Dyson V8 Origin', score: 91, profit: 68, time: '15 min ago' },
  { query: '193948560342', result: 'Apple AirPods Pro', score: 76, profit: 34, time: '1 hr ago' },
];

function ScoreDisplay({ score, label }) {
  const color = score >= 91 ? '#00ff88' : score >= 71 ? '#00d4ff' : score >= 41 ? '#fbbf24' : '#ef4444';
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-24 h-24">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 90 90">
          <circle cx="45" cy="45" r="38" fill="none" stroke="#1e1e2e" strokeWidth="7" />
          <circle cx="45" cy="45" r="38" fill="none" stroke={color} strokeWidth="7"
            strokeDasharray={2 * Math.PI * 38}
            strokeDashoffset={2 * Math.PI * 38 * (1 - score / 100)}
            strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.7s ease' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold" style={{ color }}>{score}</span>
          <span className="text-xs text-dark-400">/ 100</span>
        </div>
      </div>
      <p className="text-sm font-semibold mt-2" style={{ color }}>{label}</p>
    </div>
  );
}

export default function Scanner() {
  const [mode, setMode] = useState('upc'); // upc | sku
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState(HISTORY);
  const [showCamera, setShowCamera] = useState(false);
  const [notFound, setNotFound] = useState(false);

  async function lookup(overrideCode) {
    const code = (overrideCode || query).trim();
    if (!code) return;
    setLoading(true);
    setError('');
    setResult(null);
    setNotFound(false);
    try {
      const r = await api.get(`/search/barcode/${encodeURIComponent(code)}`);
      if (r.data.found) {
        const deal = r.data.deals?.[0] || {};
        const product = r.data.product || {};
        const data = {
          ...deal,
          name: product.name || deal.product_name,
          brand: product.brand,
          image_url: product.image_url,
          upc: product.upc,
          sku: product.sku,
          product_url: product.product_url,
          store_name: deal.store_name || product.store_name,
        };
        setResult(data);
        setHistory(prev => [{ query: code, result: data.name, score: data.opportunity_score || 0, profit: data.estimated_profit || 0, time: 'Just now' }, ...prev.slice(0, 9)]);
      } else {
        // Try legacy UPC endpoint as fallback
        try {
          const r2 = await api.get(`/search/upc/${encodeURIComponent(code)}`);
          const data = r2.data.product || r2.data;
          setResult(data);
          setHistory(prev => [{ query: code, result: data.name, score: data.opportunity_score || 0, profit: data.estimated_profit || 0, time: 'Just now' }, ...prev.slice(0, 9)]);
        } catch {
          setNotFound(true);
        }
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }

  function handleCameraDetect(code) {
    setShowCamera(false);
    setQuery(code);
    lookup(code);
  }

  const scoreColor = result ? (result.opportunity_score >= 91 ? '#00ff88' : result.opportunity_score >= 71 ? '#00d4ff' : result.opportunity_score >= 41 ? '#fbbf24' : '#ef4444') : '#6b7280';

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-2xl mx-auto">
      {showCamera && (
        <CameraScanner
          onDetected={handleCameraDetect}
          onClose={() => setShowCamera(false)}
        />
      )}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Scan size={24} className="text-neon-green" /> UPC / SKU Scanner
        </h1>
        <p style={{ color: '#CBD5E1' }} className="text-sm mt-1">Scan any product in-store to check price, history, and resale potential</p>
      </div>

      {/* Camera scan button */}
      <button
        onClick={() => setShowCamera(true)}
        className="w-full flex items-center justify-center gap-3 py-3 rounded-xl border-2 border-dashed transition-colors"
        style={{ borderColor: '#4ADE80', background: 'rgba(74,222,128,0.05)', color: '#4ADE80' }}
      >
        <Camera size={20} />
        <span className="font-semibold text-sm">Scan with camera</span>
      </button>

      {/* Manual input */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <Scan size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: '#94A3B8' }} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && lookup()}
            placeholder="Enter UPC / SKU / barcode..."
            className="w-full rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none"
            style={{ background: '#1E293B', border: '1px solid #334155', color: 'white' }}
          />
        </div>
        <button onClick={() => lookup()} disabled={loading} className="btn-primary flex items-center gap-2 px-5 disabled:opacity-50">
          <Search size={16} /> {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {/* Quick examples */}
      <div className="flex gap-2 flex-wrap">
        <span className="text-dark-400 text-xs">Try:</span>
        {['885911416443', '037-77-8001', '193948560342'].map(ex => (
          <button key={ex} onClick={() => { setQuery(ex); }}
            className="text-xs text-neon-blue hover:underline">{ex}</button>
        ))}
      </div>

      {/* Not found */}
      {notFound && !loading && (
        <div className="card flex items-center gap-3 py-4">
          <AlertTriangle size={20} className="text-yellow-400 flex-shrink-0" />
          <div>
            <p className="text-white font-semibold text-sm">Product not found</p>
            <p style={{ color: '#94A3B8' }} className="text-xs mt-0.5">No active deals found for: <span className="font-mono text-neon-blue">{query}</span></p>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="card space-y-5 animate-fade-in">
          {/* Header */}
          <div className="flex items-start gap-4">
            <div className="flex-1">
              {result.is_error_price && (
                <div className="flex items-center gap-1 text-yellow-400 text-xs mb-2">
                  <AlertTriangle size={12} /> Possible Price Error Detected
                </div>
              )}
              {result.brand && <p className="text-dark-300 text-xs mb-1">{result.brand} · {result.store_name}</p>}
              <h2 className="text-white font-bold text-lg leading-snug">{result.name}</h2>
              {result.upc && <p className="text-dark-400 text-xs mt-1">UPC: {result.upc}</p>}
            </div>
            <ScoreDisplay score={result.opportunity_score || 0} label={result.opportunity_label || ''} />
          </div>

          {/* Prices */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-dark-800/50 rounded-xl p-3 text-center">
              <p className="text-dark-400 text-xs mb-1">Store Price</p>
              <p className="text-2xl font-bold text-white">${parseFloat(result.current_price || 0).toFixed(0)}</p>
            </div>
            <div className="bg-dark-800/50 rounded-xl p-3 text-center">
              <p className="text-dark-400 text-xs mb-1">Regular</p>
              <p className="text-2xl font-bold text-dark-400 line-through">${parseFloat(result.regular_price || 0).toFixed(0)}</p>
            </div>
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-center">
              <p className="text-dark-400 text-xs mb-1">Discount</p>
              <p className="text-2xl font-bold text-red-400">-{Math.round(result.discount_percent || 0)}%</p>
            </div>
          </div>

          {/* Stock */}
          <div className="flex items-center gap-2 text-sm">
            <Package size={14} className={result.in_stock ? 'text-neon-green' : 'text-red-400'} />
            <span className={result.in_stock ? 'text-neon-green' : 'text-red-400'}>
              {result.in_stock ? (result.stock_quantity ? `${result.stock_quantity} in stock` : 'In stock') : 'Out of stock'}
            </span>
            {result.stock_quantity <= 3 && result.in_stock && (
              <span className="text-yellow-400 text-xs">⚠️ Low stock!</span>
            )}
          </div>

          {/* Resale */}
          {result.resale_price_amazon && (
            <div>
              <p className="text-dark-300 text-xs uppercase tracking-wider mb-2">Resale Breakdown</p>
              <div className="space-y-2">
                {[
                  { label: 'Amazon', price: result.resale_price_amazon, fees: Math.round(result.resale_price_amazon * 0.15), ship: 12 },
                  { label: 'eBay', price: result.resale_price_ebay, fees: Math.round(result.resale_price_ebay * 0.13), ship: 12 },
                  { label: 'FB Marketplace', price: result.resale_price_facebook, fees: 0, ship: 0 },
                ].map(p => {
                  const net = Math.round(p.price - p.fees - p.ship - result.current_price);
                  return (
                    <div key={p.label} className="flex items-center justify-between text-sm py-2 border-b border-dark-800">
                      <span className="text-dark-300">{p.label}</span>
                      <span className="text-white">${p.price}</span>
                      <span className={`font-bold ${net > 0 ? 'text-neon-green' : 'text-red-400'}`}>
                        {net > 0 ? '+' : ''}{net} profit
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex gap-4">
                <div className="text-center flex-1">
                  <p className="text-2xl font-bold text-neon-green">${Math.round(result.estimated_profit || 0)}</p>
                  <p className="text-dark-400 text-xs">Best net profit</p>
                </div>
                <div className="text-center flex-1">
                  <p className="text-2xl font-bold text-neon-blue">{Math.round(result.roi_percent || 0)}%</p>
                  <p className="text-dark-400 text-xs">ROI</p>
                </div>
                <div className="text-center flex-1">
                  <p className="text-2xl font-bold text-white">{result.estimated_days_to_sell || '—'}</p>
                  <p className="text-dark-400 text-xs">Days to sell</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Lookup history */}
      {history.length > 0 && (
        <div className="card">
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <History size={16} className="text-dark-400" /> Recent Lookups
          </h3>
          <div className="space-y-2">
            {history.map((h, i) => {
              const c = h.score >= 91 ? '#00ff88' : h.score >= 71 ? '#00d4ff' : h.score >= 41 ? '#fbbf24' : '#ef4444';
              return (
                <button key={i} onClick={() => setQuery(h.query)} className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-dark-800 transition-colors text-left">
                  <span className="font-mono text-dark-400 text-xs w-32 truncate">{h.query}</span>
                  <span className="text-white text-sm flex-1 truncate">{h.result}</span>
                  <span className="text-xs font-bold" style={{ color: c }}>Score {h.score}</span>
                  {h.profit > 0 && <span className="text-neon-green text-xs font-semibold">+${h.profit}</span>}
                  <span className="text-dark-500 text-xs">{h.time}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
