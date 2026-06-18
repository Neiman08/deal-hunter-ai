import { useState, useEffect } from 'react';
import { Brain, Star, Heart, Plus, Trash2, TrendingUp, Lightbulb, Zap } from 'lucide-react';
import api from '../utils/api';
import DealCard from '../components/DealCard';

const BRANDS = ['DeWalt', 'Milwaukee', 'Makita', 'Ryobi', 'Dyson', 'Apple', 'Samsung', 'Sony', 'KitchenAid', 'iRobot'];
const CATEGORIES = ['Power Tools', 'Electronics', 'Appliances', 'Kitchen', 'Outdoor', 'Automotive', 'Toys'];

export default function Recommendations() {
  const [recommended, setRecommended] = useState([]);
  const [insights, setInsights] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [profile, setProfile] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState({ type: 'brand', value: '' });

  useEffect(() => {
    fetchAll();
  }, []);

  async function fetchAll() {
    setLoading(true);
    setError(null);
    try {
      const [recRes, favRes] = await Promise.all([
        api.get('/recommendations'),
        api.get('/recommendations/favorites'),
      ]);
      setRecommended(recRes.data.recommended || []);
      setInsights(recRes.data.insights || []);
      setProfile(recRes.data.profile || {});
      setFavorites(favRes.data.favorites || []);
    } catch {
      setError('No se pudieron cargar las recomendaciones.');
    } finally {
      setLoading(false);
    }
  }

  async function addFavorite() {
    if (!adding.value) return;
    try {
      const r = await api.post('/recommendations/favorites', adding);
      if (r.data.favorite) {
        setFavorites(prev => [...prev, r.data.favorite]);
      }
      setAdding({ ...adding, value: '' });
    } catch (err) {
      alert(err.response?.data?.error || 'Error al agregar seguimiento');
    }
  }

  async function removeFavorite(id) {
    try {
      await api.delete(`/recommendations/favorites/${id}`);
      setFavorites(prev => prev.filter(f => f.id !== id));
    } catch {
      alert('No se pudo eliminar el seguimiento');
    }
  }

  const typeIcon = { brand: '🏷️', category: '📦', store: '🏪', product: '🛍️' };
  const typeColor = { brand: 'text-neon-green', category: 'text-neon-blue', store: 'text-yellow-400', product: 'text-purple-400' };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-neon-blue/30 border-t-neon-blue rounded-full animate-spin" />
    </div>
  );

  if (error) return (
    <div className="p-6 text-center text-red-400">
      <Brain size={40} className="mx-auto mb-3 opacity-30" />
      <p>{error}</p>
    </div>
  );

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Brain size={24} className="text-neon-blue" />
        <div>
          <h1 className="text-2xl font-bold text-white">AI Recommendations</h1>
          <p className="text-gray-400 text-sm">Personalized deals based on your behavior</p>
        </div>
      </div>

      {/* Profile summary */}
      <div className="card border-neon-blue/30 bg-neon-blue/5">
        <p className="text-gray-400 text-xs uppercase tracking-wider mb-3">Your Profile</p>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-gray-400 text-xs">Top Brand</p>
            <p className="text-white font-semibold">{profile.topBrand || '—'}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs">Top Category</p>
            <p className="text-white font-semibold">{profile.topCategory || '—'}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs">Avg Profit/Deal</p>
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
              <span className="text-gray-500 text-xs capitalize">{fav.type}</span>
              <button onClick={() => removeFavorite(fav.id)} className="text-gray-400 hover:text-red-400 ml-1">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {favorites.length === 0 && <p className="text-gray-400 text-sm">Follow brands, categories, or stores to get personalized deals.</p>}
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
          <div className="card text-center text-gray-400 py-10">
            <Brain size={32} className="mx-auto mb-3 opacity-40" />
            <p>Follow some brands or save deals to get personalized recommendations.</p>
          </div>
        )}
      </div>
    </div>
  );
}
