import { useState, useEffect } from 'react';
import { TrendingUp, Bookmark, ShoppingBag, DollarSign, Brain, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../utils/api';

function StatTile({ icon, label, value, sub, color = 'green' }) {
  const colors = {
    green:  'text-neon-green bg-neon-green/15',
    blue:   'text-neon-blue bg-neon-blue/15',
    yellow: 'text-yellow-400 bg-yellow-400/15',
    purple: 'text-purple-400 bg-purple-400/15',
  };
  return (
    <div className="card">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${colors[color]}`}>{icon}</div>
      <p className="text-2xl font-black text-white">{value}</p>
      <p className="text-gray-400 text-sm mt-0.5">{label}</p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  );
}

export default function Analytics() {
  const { t } = useTranslation();
  const [saves, setSaves]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('7d');

  useEffect(() => {
    setLoading(true);
    api.get('/deals/user/saved')
      .then(r => setSaves(r.data.deals?.slice(0, 20) || []))
      .catch(() => setSaves([]))
      .finally(() => setLoading(false));
  }, []);

  const totalSaves = saves.length;
  const purchased  = saves.filter(s => s.purchased || s.status === 'purchased').length;
  const totalEst   = saves.reduce((sum, s) => sum + (s.estimated_profit || s.profit || 0), 0);
  const avgScore   = saves.length
    ? Math.round(saves.reduce((s, d) => s + (d.opportunity_score || d.score || 0), 0) / saves.length)
    : 0;

  const statusColor = { saved: 'text-neon-blue', purchased: 'text-neon-green', expired: 'text-gray-400' };
  const statusBg    = { saved: 'bg-neon-blue/15', purchased: 'bg-neon-green/15', expired: 'bg-dark-700' };

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <TrendingUp size={22} className="text-neon-green" /> {t('analytics.title', 'My Analytics')}
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">{t('analytics.subtitle', 'Your deal hunting performance & insights')}</p>
        </div>
        <div className="flex gap-1 bg-dark-800 rounded-xl p-1">
          {['7d', '30d', '90d'].map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                period === p ? 'bg-neon-green text-dark-900' : 'text-gray-400 hover:text-white'
              }`}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          icon={<Bookmark size={18} />}
          label={t('analytics.deals_saved', 'Deals Saved')}
          value={totalSaves}
          sub={t('common.all_time', 'All time')}
          color="blue"
        />
        <StatTile
          icon={<ShoppingBag size={18} />}
          label={t('analytics.purchased', 'Purchased')}
          value={purchased}
          sub={`${Math.round(purchased / Math.max(totalSaves, 1) * 100)}% ${t('analytics.conversion', 'conversion')}`}
          color="green"
        />
        <StatTile
          icon={<DollarSign size={18} />}
          label={t('analytics.est_profit', 'Est. Total Profit')}
          value={`$${Math.round(totalEst)}`}
          sub={t('analytics.from_saved', 'From saved deals')}
          color="yellow"
        />
        <StatTile
          icon={<Star size={18} />}
          label={t('analytics.avg_score', 'Avg Deal Score')}
          value={avgScore}
          sub={t('analytics.your_picks', 'Your picks')}
          color="purple"
        />
      </div>

      {/* Brand leaderboard */}
      {(() => {
        const brandMap = {};
        saves.forEach(d => {
          if (!d.brand) return;
          if (!brandMap[d.brand]) brandMap[d.brand] = { brand: d.brand, saves: 0, totalProfit: 0, totalScore: 0 };
          brandMap[d.brand].saves++;
          brandMap[d.brand].totalProfit += parseFloat(d.estimated_profit || 0);
          brandMap[d.brand].totalScore  += parseFloat(d.opportunity_score || 0);
        });
        const brands = Object.values(brandMap)
          .map(b => ({ ...b, avg_profit: Math.round(b.totalProfit / b.saves), avg_score: Math.round(b.totalScore / b.saves) }))
          .sort((a, b) => b.saves - a.saves)
          .slice(0, 5);

        if (!brands.length) return null;
        return (
          <div className="card">
            <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
              <Brain size={16} className="text-neon-blue" /> {t('analytics.top_brands', 'Your Top Brands')}
            </h2>
            <div className="space-y-3">
              {brands.map((b, i) => (
                <div key={b.brand} className="flex items-center gap-3">
                  <span className="text-gray-500 text-xs w-4">{i + 1}</span>
                  <div className="flex-1">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-white font-medium">{b.brand}</span>
                      <div className="flex gap-3 text-xs">
                        <span className="text-neon-green">${b.avg_profit} {t('analytics.avg_profit', 'avg profit')}</span>
                        <span className="text-neon-blue">{b.avg_score} {t('analytics.score', 'score')}</span>
                      </div>
                    </div>
                    <div className="bg-dark-700 rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-neon-green"
                        style={{ width: `${(b.saves / brands[0].saves) * 100}%` }} />
                    </div>
                  </div>
                  <span className="text-gray-400 text-xs w-8 text-right">{b.saves}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Deal history */}
      <div className="card">
        <h2 className="text-white font-semibold mb-4">{t('analytics.history', 'Deal History')}</h2>
        <div className="space-y-2">
          {saves.map((deal, i) => {
            const st = deal.status || (deal.purchased ? 'purchased' : 'saved');
            return (
              <div key={i} className="flex items-center gap-3 p-3 bg-dark-800/50 rounded-xl">
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{deal.name}</p>
                  <p className="text-gray-400 text-xs">{deal.saved_at || t('common.recently', 'Recently')}</p>
                </div>
                <div className="flex items-center gap-3 text-xs flex-shrink-0">
                  <span className="text-neon-green font-bold">+${Math.round(deal.estimated_profit || deal.profit || 0)}</span>
                  <span className="text-neon-blue">{Math.round(deal.roi_percent || deal.roi || 0)}% ROI</span>
                  <span className={`px-2 py-0.5 rounded-full font-semibold capitalize ${statusColor[st] || ''} ${statusBg[st] || 'bg-dark-700'}`}>
                    {st}
                  </span>
                </div>
              </div>
            );
          })}

          {saves.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <Bookmark size={36} className="mx-auto mb-3 opacity-30" />
              <p className="font-semibold">{t('analytics.no_deals', 'No saved deals yet.')}</p>
              <p className="text-sm mt-1 text-gray-500">{t('analytics.no_deals_hint', 'Start scanning and saving deals — your performance metrics will appear here.')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
