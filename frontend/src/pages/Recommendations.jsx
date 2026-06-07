import { useState, useEffect } from 'react';
import { Brain, Star, Heart, Plus, Trash2, TrendingUp, Lightbulb, Zap } from 'lucide-react';
import api from '../utils/api';
import DealCard from '../components/DealCard';

const BRANDS = ['DeWalt', 'Milwaukee', 'Makita', 'Ryobi', 'Dyson', 'Apple', 'Samsung', 'Sony', 'KitchenAid', 'iRobot'];
const CATEGORIES = ['Power Tools', 'Electronics', 'Appliances', 'Kitchen', 'Outdoor', 'Automotive', 'Toys'];

const DEMO_INSIGHTS = [
  { icon: '🎯', type: 'brand', text: 'You favor DeWalt & Milwaukee tools. We prioritize these in your feed.' },
  { icon: '💡', type: 'tip', text: 'Milwaukee tools generate 42% higher resale margins than Ryobi in Power Tools.' },
  { icon: '📈', type: 'profit', text: 'Your saved deals average $73 estimated profit per item.' },
  { icon: '🧠', type: 'pattern', text: 'Weekend morning deals (6–10 AM) show 23% higher profit margins historically.' },
  { icon: '⚡', type: 'alert', text: '3 new DeWalt deals detected today — matching your preference profile.' },
];

const DEMO_DEALS = [
  { id: '1', name: 'DeWalt Flexvolt Advantage Circular Saw', brand: 'DeWalt', store_name: 'Home Depot', store_slug: 'home-depot', store_color: '#F96302', regular_price: 249, deal_price: 89, discount_percent: 64, estimated_profit: 96, roi_percent: 107, opportunity_score: 94, opportunity_label: '🔥 Excelente', stock_quantity: 2, resale_price_amazon: 209, demand_level: 'Very High', category_name: 'Power Tools' },
  { id: '3', name: 'Milwaukee M18 FUEL Combo Kit', brand: 'Milwaukee', store_name: 'Home Depot', store_slug: 'home-depot', store_color: '#F96302', regular_price: 399, deal_price: 129, discount_percent: 68, estimated_profit: 174, roi_percent: 134, opportunity_score: 93, opportunity_label: '🔥 Excelente', stock_quantity: 1, resale_price_amazon: 339, demand_level: 'Very High', category_name: 'Power Tools' },
];

const DEMO_FAVORITES = [
  { id: '1', type: 'brand', value: 'DeWalt' },
  { id: '2', type: 'brand', value: 'Milwaukee' },
  { id: '3', type: 'category', value: 'Power Tools' },
];

export default function Recommendations() {
  const [recommended, setRecommended] = useState(DEMO_DEALS);
  const [insights, setInsights] = useState(DEMO_INSIGHTS);
  const [favorites, setFavorites] = useState(DEMO_FAVORITES);
  const [profile, setProfile] = useState({ topBrand: 'DeWalt', topCategory: 'Power Tools', avgProfit: 73 });
  const [adding, setAdding] = useState({ type: 'brand', value: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/recommendations').then(r => {
      setRecommended(r.data.recommended || DEMO_DEALS);
      setInsights(r.data.insights || DEMO_INSIGHTS);
      setProfile(r.data.profile || {});
    }).catch(() => {});
    api.get('/recommendations/favorites').then(r => setFavorites(r.data.favorites || DEMO_FAVORITES)).catch(() => {});
  }, []);

  async function addFavorite() {
    if (!adding.value) return;
    try {
      const r = await api.post('/recommendations/favorites', adding);
      setFavorites(prev => [...prev, r.data.favorite || { id: Date.now(), ...adding }]);
      setAdding({ ...adding, value: '' });
    } catch {
      setFavorites(prev => [...prev, { id: Date.now(), ...adding }]);
      setAdding({ ...adding, value: '' });
    }
  }

  async function removeFavorite(id) {
    try { await api.delete(`/recommendations/favorites/${id}`); } catch {}
    setFavorites(prev => prev.filter(f => f.id !== id));
  }

  const typeIcon = { brand: '🏷️', category: '📦', store: '🏪', product: '🛍️' };
  const typeColor = { brand: 'text-neon-green', category: 'text-neon-blue', store: 'text-yellow-400', product: 'text-purple-400' };

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Brain size={24} className="text-neon-blue" />
        <div>
          <h1 className="text-2xl font-bold text-white">AI Recommendations</h1>
          <p className="text-dark-300 text-sm">Personalized deals based on your behavior</p>
        </div>
      </div>

      {/* Profile summary */}
      <div className="card border-neon-blue/30 bg-neon-blue/5">
        <p className="text-dark-300 text-xs uppercase tracking-wider mb-3">Your Profile</p>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-dark-400 text-xs">Top Brand</p>
            <p className="text-white font-semibold">{profile.topBrand || '—'}</p>
          </div>
          <div>
            <p className="text-dark-400 text-xs">Top Category</p>
            <p className="text-white font-semibold">{profile.topCategory || '—'}</p>
          </div>
          <div>
            <p className="text-dark-400 text-xs">Avg Profit/Deal</p>
            <p className="text-neon-green font-bold">${profile.avgProfit || 0}</p>
          </div>
        </div>
      </div>

      {/* AI Insights */}
      <div className="card">
        <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
          <Lightbulb size={18} className="text-yellow-400" /> AI Insights
        </h2>
        <div className="space-y-3">
          {insights.map((ins, i) => (
            <div key={i} className="flex items-start gap-3 p-3 bg-dark-800/50 rounded-xl">
              <span className="text-lg flex-shrink-0">{ins.icon}</span>
              <p className="text-dark-200 text-sm">{ins.text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Favorites manager */}
      <div className="card">
        <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
          <Heart size={18} className="text-red-400" /> Following
        </h2>

        {/* Add new */}
        <div className="flex gap-2 mb-4">
          <select
            value={adding.type}
            onChange={e => setAdding({ ...adding, type: e.target.value })}
            className="bg-dark-800 border border-dark-700 text-white text-sm rounded-xl px-3 py-2"
          >
            <option value="brand">Brand</option>
            <option value="category">Category</option>
            <option value="store">Store</option>
          </select>
          <input
            value={adding.value}
            onChange={e => setAdding({ ...adding, value: e.target.value })}
            onKeyDown={e => e.key === 'Enter' && addFavorite()}
            placeholder={adding.type === 'brand' ? 'e.g. DeWalt' : adding.type === 'category' ? 'e.g. Power Tools' : 'e.g. Walmart'}
            list={`${adding.type}-list`}
            className="flex-1 bg-dark-800 border border-dark-700 text-white text-sm rounded-xl px-3 py-2 placeholder-dark-400"
          />
          <datalist id="brand-list">{BRANDS.map(b => <option key={b} value={b} />)}</datalist>
          <datalist id="category-list">{CATEGORIES.map(c => <option key={c} value={c} />)}</datalist>
          <button onClick={addFavorite} className="btn-primary flex items-center gap-1 text-sm px-4">
            <Plus size={15} /> Follow
          </button>
        </div>

        {/* List */}
        <div className="flex flex-wrap gap-2">
          {favorites.map(fav => (
            <div key={fav.id} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-dark-800 border border-dark-700">
              <span className="text-sm">{typeIcon[fav.type]}</span>
              <span className={`text-sm font-medium ${typeColor[fav.type]}`}>{fav.value}</span>
              <span className="text-dark-500 text-xs capitalize">{fav.type}</span>
              <button onClick={() => removeFavorite(fav.id)} className="text-dark-400 hover:text-red-400 ml-1">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {favorites.length === 0 && <p className="text-dark-400 text-sm">Follow brands, categories, or stores to get personalized deals.</p>}
        </div>
      </div>

      {/* Recommended deals */}
      <div>
        <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
          <Zap size={18} className="text-neon-green" /> Recommended For You
        </h2>
        {recommended.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {recommended.map(deal => <DealCard key={deal.id} deal={deal} />)}
          </div>
        ) : (
          <div className="card text-center text-dark-400 py-10">
            <Brain size={32} className="mx-auto mb-3 opacity-40" />
            <p>Follow some brands or save deals to get personalized recommendations.</p>
          </div>
        )}
      </div>
    </div>
  );
}
