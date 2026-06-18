import { Link } from 'react-router-dom';
import { TrendingUp, Package, Clock, AlertTriangle, CheckCircle } from 'lucide-react';

function ScoreRing({ score }) {
  const r = 20;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(score / 100, 1);
  const color = score >= 91 ? '#00ff88' : score >= 71 ? '#00d4ff' : score >= 41 ? '#fbbf24' : '#ef4444';
  return (
    <div className="relative w-14 h-14 flex-shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 52 52">
        <circle cx="26" cy="26" r={r} fill="none" stroke="#1e1e2e" strokeWidth="5" />
        <circle cx="26" cy="26" r={r} fill="none" stroke={color} strokeWidth="5"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold" style={{ color }}>{score}</span>
    </div>
  );
}

function getDealFreshness(lastSeenAt) {
  if (!lastSeenAt) return null;
  const ms = Date.now() - new Date(lastSeenAt).getTime();
  const h = ms / 3600000;
  if (h <= 24) return { label: `Verified ${Math.round(ms / 60000)}m ago`, color: '#00ff88', bg: 'rgba(0,255,136,0.12)' };
  if (h <= 48) return { label: `Verified ${Math.round(h)}h ago`, color: '#00d4ff', bg: 'rgba(0,212,255,0.12)' };
  return { label: 'Stale — needs verification', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' };
}

export default function DealCard({ deal }) {
  const {
    id, name, brand, store_name, store_slug, store_color,
    regular_price, deal_price, discount_percent, estimated_profit, roi_percent,
    opportunity_score, opportunity_label, is_error_price, stock_quantity,
    resale_price_amazon, demand_level, category_name, image_url, last_seen_at,
    has_keepa_data,
  } = deal;

  const stockUrgent = stock_quantity !== null && stock_quantity <= 3;
  const score = Math.round(opportunity_score || 0);
  const scoreColor = score >= 91 ? '#00ff88' : score >= 71 ? '#00d4ff' : score >= 41 ? '#fbbf24' : '#ef4444';
  const freshness = getDealFreshness(last_seen_at);

  return (
    <Link to={`/deal/${id}`} className="card hover:border-white/20 hover:-translate-y-0.5 transition-all duration-200 flex flex-col gap-3 group">
      {/* Top row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {/* Store badge */}
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: `${store_color}25`, color: store_color }}>
              {store_name}
            </span>
            {is_error_price && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-yellow-400/20 text-yellow-400 flex items-center gap-1">
                <AlertTriangle size={10} /> Error Price
              </span>
            )}
            {has_keepa_data && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-neon-green/10 text-neon-green/80 flex items-center gap-1">
                <CheckCircle size={9} /> Keepa
              </span>
            )}
            {category_name && (
              <span className="text-xs text-gray-500">{category_name}</span>
            )}
          </div>
          {brand && <p className="text-gray-400 text-xs mb-0.5">{brand}</p>}
          <p className="text-white font-semibold text-sm leading-tight line-clamp-2 group-hover:text-neon-green transition-colors">{name}</p>
        </div>
        <ScoreRing score={score} />
      </div>

      {/* Price row */}
      <div className="flex items-end gap-3">
        <div>
          <span className="text-2xl font-bold text-white">${parseFloat(deal_price || 0).toFixed(0)}</span>
          <span className="text-gray-500 line-through text-sm ml-2">${parseFloat(regular_price || 0).toFixed(0)}</span>
        </div>
        <span className="px-2 py-0.5 rounded-lg text-sm font-bold bg-red-500/20 text-red-400 ml-auto">
          -{Math.round(discount_percent || 0)}%
        </span>
      </div>

      {/* Resale row */}
      {resale_price_amazon && (
        <div className="flex items-center justify-between text-xs border-t border-white/8 pt-2">
          <span className="text-gray-400">Amazon ~${parseFloat(resale_price_amazon).toFixed(0)}</span>
          {estimated_profit > 0 && (
            <span className="font-bold flex items-center gap-1" style={{ color: '#00ff88' }}>
              <TrendingUp size={11} /> +${Math.round(estimated_profit)} profit
            </span>
          )}
        </div>
      )}

      {/* ROI & demand */}
      <div className="flex items-center justify-between text-xs">
        {roi_percent > 0 && (
          <span className="text-gray-400">ROI <span className="text-neon-blue font-semibold">{Math.round(roi_percent)}%</span></span>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {demand_level && (
            <span className={`px-1.5 py-0.5 rounded text-xs ${demand_level === 'Very High' ? 'bg-neon-green/20 text-neon-green' : demand_level === 'High' ? 'bg-neon-blue/20 text-neon-blue' : 'bg-dark-700 text-gray-400'}`}>
              {demand_level} demand
            </span>
          )}
          {stockUrgent && (
            <span className="flex items-center gap-1 text-yellow-400">
              <Package size={10} /> {stock_quantity} left
            </span>
          )}
        </div>
      </div>

      {/* Freshness + Score label */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium" style={{ color: scoreColor }}>{opportunity_label}</div>
        {freshness && (
          <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0" style={{ color: freshness.color, background: freshness.bg }}>
            <Clock size={9} className="inline mr-1" style={{ verticalAlign: 'middle' }} />
            {freshness.label}
          </span>
        )}
      </div>
    </Link>
  );
}
