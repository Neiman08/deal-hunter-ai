import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, ExternalLink, Bookmark, Bell, AlertTriangle,
  Package, MapPin, TrendingDown, TrendingUp, DollarSign, Clock, Zap, BarChart3
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine
} from 'recharts';
import api from '../utils/api';

const DEMO_DEAL = {
  id: '1', name: 'DeWalt 20V Max Drill/Driver Kit', brand: 'DeWalt',
  store_name: 'Home Depot', store_slug: 'home-depot', store_color: '#F96302',
  regular_price: 199, deal_price: 49, discount_percent: 75, savings_amount: 150,
  resale_price_amazon: 149, resale_price_ebay: 137, resale_price_facebook: 127,
  amazon_fees: 22, ebay_fees: 18, shipping_estimate: 12,
  estimated_profit: 81, roi_percent: 165, demand_level: 'Very High', estimated_days_to_sell: 2,
  opportunity_score: 98, opportunity_label: '🔥 Excelente',
  score_breakdown: { discountScore: 35, historyScore: 20, savingsScore: 12, resaleScore: 20, stockScore: 5, demandScore: 5 },
  stock_quantity: 3, is_error_price: true, price_trend: 'dropping_fast',
  category_name: 'Power Tools',
  store_address: '4343 Westheimer Rd, Houston, TX 77027',
  city: 'Houston', state: 'TX',
};

const DEMO_HISTORY = [
  { recorded_at: '2025-05-01', current_price: 199 },
  { recorded_at: '2025-05-08', current_price: 179 },
  { recorded_at: '2025-05-15', current_price: 149 },
  { recorded_at: '2025-05-20', current_price: 99 },
  { recorded_at: '2025-05-25', current_price: 79 },
  { recorded_at: '2025-05-30', current_price: 49 },
];

const DEMO_STATS = { all_time_min: 49, all_time_max: 199, avg_price: 125.67, data_points: 6 };

function ScoreBar({ label, value, max, color }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-gray-300 text-xs w-24 flex-shrink-0">{label}</span>
      <div className="flex-1 bg-dark-700 rounded-full h-2">
        <div className="h-2 rounded-full transition-all" style={{ width: `${(value / max) * 100}%`, background: color }} />
      </div>
      <span className="text-white text-xs w-8 text-right">{value}/{max}</span>
    </div>
  );
}

function PlatformRow({ platform, price, fees, shipping, currentPrice, color }) {
  const net = price - fees - shipping - currentPrice;
  const roi = ((net / currentPrice) * 100).toFixed(0);
  return (
    <div className="p-3 rounded-xl bg-dark-800/50 border border-dark-700 flex items-center justify-between">
      <div>
        <p className="text-white font-medium text-sm">{platform}</p>
        <p className="text-gray-400 text-xs">~${fees} fee + ${shipping} ship</p>
      </div>
      <div className="text-right">
        <p className="text-white font-semibold">${price}</p>
        <p className={`text-xs font-bold ${net > 0 ? 'text-neon-green' : 'text-red-400'}`}>
          {net > 0 ? '+' : ''}{Math.round(net)} ({roi}% ROI)
        </p>
      </div>
    </div>
  );
}

export default function DealDetail() {
  const { id } = useParams();
  const [deal, setDeal] = useState(null);
  const [history, setHistory] = useState([]);
  const [histStats, setHistStats] = useState(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchDeal(); }, [id]);

  async function fetchDeal() {
    try {
      const r = await api.get(`/deals/${id}`);
      setDeal(r.data.deal);
      setHistory(r.data.price_history || []);
      setHistStats(r.data.history_stats);
    } catch {
      setDeal(DEMO_DEAL);
      setHistory(DEMO_HISTORY);
      setHistStats(DEMO_STATS);
    } finally {
      setLoading(false);
    }
  }

  async function toggleSave() {
    try {
      saved ? await api.delete(`/deals/${id}/save`) : await api.post(`/deals/${id}/save`);
      setSaved(!saved);
    } catch { setSaved(!saved); }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-neon-green border-t-transparent rounded-full animate-spin" /></div>;
  if (!deal) return <div className="p-6 text-center text-gray-300">Deal not found</div>;

  const score = deal.opportunity_score || 0;
  const scoreColor = score >= 91 ? '#00ff88' : score >= 71 ? '#00d4ff' : score >= 41 ? '#fbbf24' : '#ef4444';
  const chartData = history.map(h => ({ date: new Date(h.recorded_at).toLocaleDateString('en', { month: 'short', day: 'numeric' }), price: parseFloat(h.current_price) }));

  const trendLabels = { dropping_fast: '📉 Dropping fast', dropping: '↘️ Dropping', stable: '→ Stable', rising: '↗️ Rising', unknown: '' };

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-4xl mx-auto animate-fade-in">
      {/* Back */}
      <Link to="/" className="inline-flex items-center gap-2 text-gray-300 hover:text-white text-sm transition-colors">
        <ArrowLeft size={16} /> Back to deals
      </Link>

      {/* Header */}
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: `${deal.store_color}25`, color: deal.store_color }}>
                {deal.store_name}
              </span>
              {deal.is_error_price && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-yellow-400/20 text-yellow-400 flex items-center gap-1">
                  <AlertTriangle size={10} /> Possible Price Error
                </span>
              )}
              {deal.price_trend && deal.price_trend !== 'unknown' && (
                <span className="text-xs text-gray-300">{trendLabels[deal.price_trend]}</span>
              )}
            </div>
            {deal.brand && <p className="text-gray-300 text-sm mb-1">{deal.brand} · {deal.category_name}</p>}
            <h1 className="text-xl font-bold text-white leading-snug">{deal.name}</h1>
          </div>
          <div className="flex flex-col items-center gap-1 flex-shrink-0">
            <div className="w-16 h-16 rounded-full flex items-center justify-center border-2" style={{ borderColor: scoreColor, color: scoreColor }}>
              <div className="text-center">
                <div className="text-xl font-bold leading-none">{score}</div>
                <div className="text-xs">score</div>
              </div>
            </div>
            <span className="text-xs font-semibold" style={{ color: scoreColor }}>{deal.opportunity_label}</span>
          </div>
        </div>

        {/* Prices */}
        <div className="flex items-end gap-4 flex-wrap">
          <div>
            <span className="text-gray-400 text-sm">Current price</span>
            <div className="text-4xl font-bold text-white">${parseFloat(deal.deal_price).toFixed(2)}</div>
          </div>
          <div>
            <span className="text-gray-400 text-sm">Regular</span>
            <div className="text-xl text-gray-400 line-through">${parseFloat(deal.regular_price).toFixed(2)}</div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-2xl font-bold text-red-400">-{Math.round(deal.discount_percent)}%</div>
            <div className="text-gray-300 text-sm">You save ${parseFloat(deal.savings_amount || 0).toFixed(0)}</div>
          </div>
        </div>

        {/* Stock */}
        {deal.stock_quantity !== null && (
          <div className={`mt-3 flex items-center gap-2 text-sm ${deal.stock_quantity <= 3 ? 'text-yellow-400' : 'text-gray-300'}`}>
            <Package size={14} />
            {deal.stock_quantity <= 3 ? `🔥 Only ${deal.stock_quantity} left!` : `${deal.stock_quantity} in stock`}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 mt-4">
          {deal.product_url && (
            <a href={deal.product_url} target="_blank" rel="noopener noreferrer" className="btn-primary flex items-center gap-2 text-sm flex-1 justify-center">
              <ExternalLink size={15} /> View at {deal.store_name}
            </a>
          )}
          <button onClick={toggleSave} className={`btn-ghost flex items-center gap-2 text-sm px-4 ${saved ? 'text-neon-green border-neon-green/40' : ''}`}>
            <Bookmark size={15} fill={saved ? 'currentColor' : 'none'} />
            {saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      {/* Two-col layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Price History */}
        <div className="card">
          <h2 className="text-white font-semibold mb-1">Price History</h2>
          {histStats && (
            <div className="flex gap-4 text-xs text-gray-300 mb-4">
              <span>Min: <span className="text-neon-green font-semibold">${histStats.all_time_min}</span></span>
              <span>Max: <span className="text-red-400 font-semibold">${histStats.all_time_max}</span></span>
              <span>Avg: <span className="text-white font-semibold">${parseFloat(histStats.avg_price || 0).toFixed(0)}</span></span>
              <span className="ml-auto">{histStats.data_points} data pts</span>
            </div>
          )}
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#1a1a2e" strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fill: '#FFFFFF', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#FFFFFF', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip contentStyle={{ background: '#111119', border: '1px solid #2a2a3a', borderRadius: 8, color: '#fff' }} formatter={v => [`$${v}`, 'Price']} />
                {histStats?.all_time_min && (
                  <ReferenceLine y={histStats.all_time_min} stroke="#00ff88" strokeDasharray="3 3" label={{ value: 'ATL', fill: '#00ff88', fontSize: 10 }} />
                )}
                <Line type="monotone" dataKey="price" stroke="#00d4ff" strokeWidth={2} dot={{ fill: '#00d4ff', r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center text-gray-400 text-sm py-8">No price history yet</div>
          )}
        </div>

        {/* Score Breakdown */}
        <div className="card">
          <h2 className="text-white font-semibold mb-4">Score Breakdown</h2>
          {deal.score_breakdown ? (
            <div className="space-y-3">
              <ScoreBar label="Discount %" value={deal.score_breakdown.discountScore || 0} max={35} color={scoreColor} />
              <ScoreBar label="Price History" value={deal.score_breakdown.historyScore || 0} max={20} color="#00d4ff" />
              <ScoreBar label="$ Savings" value={deal.score_breakdown.savingsScore || 0} max={15} color="#a78bfa" />
              <ScoreBar label="Resale Margin" value={deal.score_breakdown.resaleScore || 0} max={20} color="#00ff88" />
              <ScoreBar label="Stock Urgency" value={deal.score_breakdown.stockScore || 0} max={5} color="#fbbf24" />
              <ScoreBar label="Brand Demand" value={deal.score_breakdown.demandScore || 0} max={5} color="#f97316" />
              <div className="pt-2 border-t border-dark-700 flex justify-between">
                <span className="text-gray-300 text-sm">Total Score</span>
                <span className="font-bold text-lg" style={{ color: scoreColor }}>{score}/100</span>
              </div>
            </div>
          ) : (
            <div className="text-gray-400 text-sm text-center py-8">Score breakdown unavailable</div>
          )}
        </div>
      </div>

      {/* Resale Analysis */}
      <div className="card">
        <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
          <TrendingUp size={18} className="text-neon-green" />
          Resale Analysis
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <PlatformRow platform="Amazon FBA" price={deal.resale_price_amazon || 0} fees={deal.amazon_fees || 0} shipping={deal.shipping_estimate || 0} currentPrice={deal.deal_price} />
          <PlatformRow platform="eBay" price={deal.resale_price_ebay || 0} fees={deal.ebay_fees || 0} shipping={deal.shipping_estimate || 0} currentPrice={deal.deal_price} />
          <PlatformRow platform="FB Marketplace" price={deal.resale_price_facebook || 0} fees={0} shipping={0} currentPrice={deal.deal_price} />
        </div>
        <div className="grid grid-cols-3 gap-3 border-t border-dark-700 pt-4">
          <div className="text-center">
            <p className="text-gray-300 text-xs mb-1">Best Net Profit</p>
            <p className="text-2xl font-bold text-neon-green">${Math.round(deal.estimated_profit || 0)}</p>
          </div>
          <div className="text-center">
            <p className="text-gray-300 text-xs mb-1">ROI</p>
            <p className="text-2xl font-bold text-neon-blue">{Math.round(deal.roi_percent || 0)}%</p>
          </div>
          <div className="text-center">
            <p className="text-gray-300 text-xs mb-1">Est. Days to Sell</p>
            <p className="text-2xl font-bold text-white">{deal.estimated_days_to_sell || '—'}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full ${deal.demand_level === 'Very High' ? 'bg-neon-green/20 text-neon-green' : deal.demand_level === 'High' ? 'bg-neon-blue/20 text-neon-blue' : 'bg-dark-700 text-gray-300'}`}>
            {deal.demand_level || 'Unknown'} demand
          </span>
          <span className="text-xs text-gray-400">Based on current Amazon/eBay/FB listings · Estimates only</span>
        </div>
      </div>

      {/* Location */}
      {deal.store_address && (
        <div className="card flex items-center gap-3">
          <MapPin size={18} className="text-neon-blue flex-shrink-0" />
          <div>
            <p className="text-white font-medium text-sm">{deal.store_name}</p>
            <p className="text-gray-300 text-sm">{deal.store_address}</p>
          </div>
          <Link to="/map" className="ml-auto text-neon-blue text-xs hover:underline">View on map →</Link>
        </div>
      )}
    </div>
  );
}
