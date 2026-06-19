import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, ExternalLink, Bookmark, AlertTriangle,
  Package, MapPin, TrendingUp, CheckCircle, Clock,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine
} from 'recharts';
import api from '../utils/api';


function ScoreBar({ label, value, max, color }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-gray-400 text-xs w-24 flex-shrink-0">{label}</span>
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
  const [marketData, setMarketData] = useState(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchDeal(); }, [id]);

  async function fetchDeal() {
    try {
      const r = await api.get(`/deals/${id}`);
      setDeal(r.data.deal);
      setHistory(r.data.price_history || []);
      setHistStats(r.data.history_stats);
      setMarketData(r.data.market_data || null);
    } catch {
      setDeal(null);
    } finally {
      setLoading(false);
    }
  }

  async function toggleSave() {
    try {
      saved ? await api.delete(`/deals/${id}/save`) : await api.post(`/deals/${id}/save`);
      setSaved(!saved);
    } catch {
      alert('No se pudo guardar el deal');
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-neon-green border-t-transparent rounded-full animate-spin" /></div>;
  if (!deal) return <div className="p-6 text-center text-gray-400">Deal not found</div>;

  const score = deal.opportunity_score || 0;
  const scoreColor = score >= 91 ? '#00ff88' : score >= 71 ? '#00d4ff' : score >= 41 ? '#fbbf24' : '#ef4444';
  const chartData = history.map(h => ({ date: new Date(h.recorded_at).toLocaleDateString('en', { month: 'short', day: 'numeric' }), price: parseFloat(h.current_price) }));
  const isStale = deal.last_seen_at && (Date.now() - new Date(deal.last_seen_at).getTime()) > 48 * 3600000;
  const isMacysStale = deal.store_slug === 'macys' && isStale;

  const trendLabels = { dropping_fast: '📉 Dropping fast', dropping: '↘️ Dropping', stable: '→ Stable', rising: '↗️ Rising', unknown: '' };

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-4xl mx-auto animate-fade-in">
      {/* Back */}
      <Link to="/" className="inline-flex items-center gap-2 text-gray-400 hover:text-white text-sm transition-colors">
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
                <span className="text-xs text-gray-400">{trendLabels[deal.price_trend]}</span>
              )}
            </div>
            {deal.brand && <p className="text-gray-400 text-sm mb-1">{deal.brand} · {deal.category_name}</p>}
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
            <div className="text-xl text-gray-500 line-through">${parseFloat(deal.regular_price).toFixed(2)}</div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-2xl font-bold text-red-400">-{Math.round(deal.discount_percent)}%</div>
            <div className="text-gray-400 text-sm">You save ${parseFloat(deal.savings_amount || 0).toFixed(0)}</div>
          </div>
        </div>

        {/* Stock */}
        {deal.stock_quantity !== null && (
          <div className={`mt-3 flex items-center gap-2 text-sm ${deal.stock_quantity <= 3 ? 'text-yellow-400' : 'text-gray-400'}`}>
            <Package size={14} />
            {deal.stock_quantity <= 3 ? `🔥 Only ${deal.stock_quantity} left!` : `${deal.stock_quantity} in stock`}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 mt-4">
          {deal.store_slug === 'macys' ? (
            // Use direct /ID/ URL when available; otherwise fall back to search
            deal.product_url?.includes('/ID/') ? (
              <a
                href={deal.product_url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary flex items-center gap-2 text-sm flex-1 justify-center"
              >
                <ExternalLink size={15} /> View at Macy's
              </a>
            ) : (
              <a
                href={`https://www.macys.com/shop/featured/${encodeURIComponent(deal.name)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary flex items-center gap-2 text-sm flex-1 justify-center"
              >
                <ExternalLink size={15} /> Search on Macy's
              </a>
            )
          ) : deal.product_url ? (
            <a href={deal.product_url} target="_blank" rel="noopener noreferrer" className="btn-primary flex items-center gap-2 text-sm flex-1 justify-center">
              <ExternalLink size={15} /> View at {deal.store_name}
            </a>
          ) : null}
          <button onClick={toggleSave} className={`btn-ghost flex items-center gap-2 text-sm px-4 ${saved ? 'text-neon-green border-neon-green/40' : ''}`}>
            <Bookmark size={15} fill={saved ? 'currentColor' : 'none'} />
            {saved ? 'Saved' : 'Save'}
          </button>
        </div>
        {isStale && (
          <p className="text-xs text-yellow-400/80 flex items-center gap-1.5 mt-2">
            <AlertTriangle size={11} />
            This deal is stale. The product page may have changed since the last verification.
          </p>
        )}
      </div>

      {/* Two-col layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Price History */}
        <div className="card">
          <h2 className="text-white font-semibold mb-1">Price History</h2>
          {histStats && (
            <div className="flex gap-4 text-xs text-gray-400 mb-4">
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
                <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip contentStyle={{ background: '#111119', border: '1px solid #2a2a3a', borderRadius: 8, color: '#fff' }} formatter={v => [`$${v}`, 'Price']} />
                {histStats?.all_time_min && (
                  <ReferenceLine y={histStats.all_time_min} stroke="#00ff88" strokeDasharray="3 3" label={{ value: 'ATL', fill: '#00ff88', fontSize: 10 }} />
                )}
                <Line type="monotone" dataKey="price" stroke="#00d4ff" strokeWidth={2} dot={{ fill: '#00d4ff', r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center text-gray-500 text-sm py-8">No price history yet</div>
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
                <span className="text-gray-400 text-sm">Total Score</span>
                <span className="font-bold text-lg" style={{ color: scoreColor }}>{score}/100</span>
              </div>
            </div>
          ) : (
            <div className="text-gray-500 text-sm text-center py-8">Score breakdown unavailable</div>
          )}
        </div>
      </div>

      {/* Resale Analysis */}
      <div className="card">
        <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
          <TrendingUp size={18} className="text-neon-green" />
          Resale Analysis
        </h2>

        {/* Keepa verified data panel */}
        {marketData ? (() => {
          const emp = marketData.effective_market_price ? parseFloat(marketData.effective_market_price) : null;
          const empSourceMap = {
            buy_box: 'Buy Box', amazon_current: 'Amazon current',
            amazon_90d_avg: 'Keepa 90d avg', amazon_180d_avg: 'Keepa 180d avg',
            ebay_median: 'eBay median', none: null,
          };
          const empLabel = empSourceMap[marketData.effective_market_source] || null;
          return (
            <div className="mb-4 bg-dark-800/50 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-neon-green" />
                  <span className="text-neon-green text-xs font-bold">Amazon data verified by Keepa</span>
                </div>
                {marketData.fetched_at && (
                  <span className="text-gray-500 text-xs flex items-center gap-1">
                    <Clock size={10} />
                    {Math.round((Date.now() - new Date(marketData.fetched_at).getTime()) / 3600000)}h ago
                  </span>
                )}
              </div>

              {/* Effective Market Price — prominent highlight */}
              {emp && (
                <div className="flex items-center justify-between bg-neon-green/10 border border-neon-green/20 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-gray-400 text-xs">Effective Market Price</p>
                    <p className="text-neon-green font-bold text-xl">${emp.toFixed(2)}</p>
                  </div>
                  {empLabel && (
                    <div className="text-right">
                      <p className="text-gray-500 text-xs">Source</p>
                      <p className="text-neon-green text-xs font-semibold">{empLabel}</p>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-gray-500 text-xs">Amazon current</p>
                  <p className={marketData.amazon_current_price ? 'text-white font-semibold' : 'text-gray-600 text-xs'}>
                    {marketData.amazon_current_price ? `$${parseFloat(marketData.amazon_current_price).toFixed(2)}` : 'Not available'}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Buy Box</p>
                  <p className={marketData.amazon_buy_box_price ? 'text-neon-green font-bold' : 'text-gray-600 text-xs'}>
                    {marketData.amazon_buy_box_price ? `$${parseFloat(marketData.amazon_buy_box_price).toFixed(2)}` : 'Not available'}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">90d avg</p>
                  <p className="text-white">
                    {marketData.amazon_90d_avg_price ? `$${parseFloat(marketData.amazon_90d_avg_price).toFixed(2)}` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">180d avg</p>
                  <p className="text-white">
                    {marketData.amazon_180d_avg_price ? `$${parseFloat(marketData.amazon_180d_avg_price).toFixed(2)}` : '—'}
                  </p>
                </div>
                {marketData.sales_rank && (
                  <div>
                    <p className="text-gray-500 text-xs">Sales rank</p>
                    <p className="text-white">#{parseInt(marketData.sales_rank).toLocaleString()}</p>
                  </div>
                )}
                {marketData.keepa_confidence > 0 && (
                  <div>
                    <p className="text-gray-500 text-xs">Keepa confidence</p>
                    <p className="text-white">{marketData.keepa_confidence}%</p>
                  </div>
                )}
              </div>
            </div>
          );
        })() : (
          <div className="mb-4 px-3 py-2 bg-dark-800/30 rounded-lg">
            <p className="text-gray-500 text-xs flex items-center gap-1.5">
              <AlertTriangle size={11} className="text-yellow-500/70" />
              Estimate only — not verified by marketplace API
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <PlatformRow platform="Amazon FBA" price={deal.resale_price_amazon || 0} fees={deal.amazon_fees || 0} shipping={deal.shipping_estimate || 0} currentPrice={deal.deal_price} />
          <PlatformRow platform="eBay" price={deal.resale_price_ebay || 0} fees={deal.ebay_fees || 0} shipping={deal.shipping_estimate || 0} currentPrice={deal.deal_price} />
          <PlatformRow platform="FB Marketplace" price={deal.resale_price_facebook || 0} fees={0} shipping={0} currentPrice={deal.deal_price} />
        </div>
        <div className="grid grid-cols-3 gap-3 border-t border-dark-700 pt-4">
          <div className="text-center">
            <p className="text-gray-400 text-xs mb-1">Best Net Profit</p>
            <p className="text-2xl font-bold text-neon-green">${Math.round(deal.estimated_profit || 0)}</p>
          </div>
          <div className="text-center">
            <p className="text-gray-400 text-xs mb-1">ROI</p>
            <p className="text-2xl font-bold text-neon-blue">{Math.round(deal.roi_percent || 0)}%</p>
          </div>
          <div className="text-center">
            <p className="text-gray-400 text-xs mb-1">Est. Days to Sell</p>
            <p className="text-2xl font-bold text-white">{deal.estimated_days_to_sell || '—'}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full ${deal.demand_level === 'Very High' ? 'bg-neon-green/20 text-neon-green' : deal.demand_level === 'High' ? 'bg-neon-blue/20 text-neon-blue' : 'bg-dark-700 text-gray-400'}`}>
            {deal.demand_level || 'Unknown'} demand
          </span>
          {marketData
            ? <span className="text-xs text-neon-green/70">Keepa verified · {marketData.confidence}% confidence</span>
            : <span className="text-xs text-gray-500">Internal estimates · no marketplace verification</span>
          }
        </div>
      </div>

      {/* Location */}
      {deal.store_address && (
        <div className="card flex items-center gap-3">
          <MapPin size={18} className="text-neon-blue flex-shrink-0" />
          <div>
            <p className="text-white font-medium text-sm">{deal.store_name}</p>
            <p className="text-gray-400 text-sm">{deal.store_address}</p>
          </div>
          <Link to="/map" className="ml-auto text-neon-blue text-xs hover:underline">View on map →</Link>
        </div>
      )}
    </div>
  );
}
