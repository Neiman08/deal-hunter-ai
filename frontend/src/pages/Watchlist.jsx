import { useState, useEffect } from 'react';
import { Eye, Plus, Trash2, Bell, Search, Tag, Barcode, Hash } from 'lucide-react';
import api from '../utils/api';
import DealCard from '../components/DealCard';
import { useAuth } from '../context/AuthContext';

const TYPE_CONFIG = {
  brand: { icon: <Tag size={14} />, label: 'Brand', color: 'text-neon-green', bg: 'bg-neon-green/15', placeholder: 'e.g. DeWalt, Milwaukee, Dyson' },
  keyword: { icon: <Search size={14} />, label: 'Keyword', color: 'text-neon-blue', bg: 'bg-neon-blue/15', placeholder: 'e.g. drill kit, cordless vacuum' },
  upc: { icon: <Barcode size={14} />, label: 'UPC', color: 'text-yellow-400', bg: 'bg-yellow-400/15', placeholder: 'e.g. 885911416443' },
  sku: { icon: <Hash size={14} />, label: 'SKU', color: 'text-purple-400', bg: 'bg-purple-400/15', placeholder: 'e.g. DCK240C2' },
  category: { icon: <Tag size={14} />, label: 'Category', color: 'text-orange-400', bg: 'bg-orange-400/15', placeholder: 'e.g. Power Tools, Electronics' },
};

const POPULAR = [
  { type: 'brand', value: 'DeWalt', label: '🔧 DeWalt' },
  { type: 'brand', value: 'Milwaukee', label: '🔴 Milwaukee' },
  { type: 'brand', value: 'Dyson', label: '🌀 Dyson' },
  { type: 'brand', value: 'Apple', label: '🍎 Apple' },
  { type: 'brand', value: 'Samsung', label: '📱 Samsung' },
  { type: 'brand', value: 'Makita', label: '🔵 Makita' },
  { type: 'category', value: 'Power Tools', label: '⚡ Power Tools' },
  { type: 'category', value: 'Electronics', label: '💻 Electronics' },
];

export default function Watchlist() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [matches, setMatches] = useState([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingMatches, setLoadingMatches] = useState(true);
  const [error, setError] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ type: 'brand', value: '', min_discount: 20, notify_email: true, notify_whatsapp: false });
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState('watching'); // watching | alerts

  useEffect(() => {
    fetchItems();
    fetchMatches();
  }, []);

  async function fetchItems() {
    setLoadingItems(true);
    setError(null);
    try {
      const r = await api.get('/watchlist');
      setItems(r.data.items || []);
    } catch {
      setError('No se pudo cargar la watchlist.');
    } finally {
      setLoadingItems(false);
    }
  }

  async function fetchMatches() {
    setLoadingMatches(true);
    try {
      const r = await api.get('/watchlist/alerts');
      setMatches(r.data.matches || []);
    } catch {
      setMatches([]);
    } finally {
      setLoadingMatches(false);
    }
  }

  async function addItem() {
    if (!form.value.trim()) return;
    setAdding(true);
    try {
      const r = await api.post('/watchlist', { ...form, label: form.value });
      setItems(prev => [r.data.item, ...prev]);
      setForm({ type: 'brand', value: '', min_discount: 20, notify_email: true, notify_whatsapp: false });
      setShowAdd(false);
      fetchMatches();
    } catch (err) {
      alert(err.response?.data?.error || 'Error al agregar a la watchlist');
    } finally {
      setAdding(false);
    }
  }

  async function removeItem(id) {
    try {
      await api.delete(`/watchlist/${id}`);
      setItems(prev => prev.filter(i => i.id !== id));
    } catch {
      alert('No se pudo eliminar el item');
    }
  }

  function quickAdd(item) {
    if (items.some(i => i.type === item.type && i.value === item.value)) return;
    setForm({ ...form, type: item.type, value: item.value });
    setShowAdd(true);
  }

  const cfg = TYPE_CONFIG[form.type];
  const totalAlerts = matches.reduce((s, m) => s + m.deals.length, 0);

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Eye size={22} className="text-neon-green" /> Watchlist
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">Track brands, products, and UPCs — get alerted when deals appear</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className="btn-primary flex items-center gap-2 text-sm">
          <Plus size={15} /> Watch New
        </button>
      </div>

      {/* Quick-add popular */}
      <div className="card">
        <p className="text-gray-400 text-xs uppercase tracking-wider mb-3">Popular Watches</p>
        <div className="flex flex-wrap gap-2">
          {POPULAR.map(p => {
            const watching = items.some(i => i.type === p.type && i.value === p.value);
            return (
              <button key={`${p.type}-${p.value}`}
                onClick={() => watching ? null : quickAdd(p)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                  watching
                    ? 'border-neon-green/40 bg-neon-green/10 text-neon-green cursor-default'
                    : 'border-dark-600 text-gray-400 hover:border-dark-500 hover:text-white cursor-pointer'
                }`}>
                {p.label} {watching && '✓'}
              </button>
            );
          })}
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="card border-neon-green/20 bg-neon-green/5 space-y-4 animate-fade-in">
          <h3 className="text-white font-semibold">Add to Watchlist</h3>

          {/* Type selector */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(TYPE_CONFIG).map(([key, c]) => (
              <button key={key} onClick={() => setForm({ ...form, type: key })}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                  form.type === key ? `${c.bg} ${c.color} border-current` : 'border-dark-600 text-gray-400 hover:text-white'
                }`}>
                {c.icon} {c.label}
              </button>
            ))}
          </div>

          <input
            value={form.value}
            onChange={e => setForm({ ...form, value: e.target.value })}
            onKeyDown={e => e.key === 'Enter' && addItem()}
            placeholder={cfg.placeholder}
            className="w-full bg-dark-800 border border-dark-600 text-white text-sm rounded-xl px-4 py-3 placeholder-dark-500 focus:outline-none focus:border-neon-green/40"
          />

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1">
              <label className="text-gray-400 text-xs mb-1 block">Min discount: {form.min_discount}%</label>
              <input type="range" min="10" max="80" value={form.min_discount}
                onChange={e => setForm({ ...form, min_discount: parseInt(e.target.value) })}
                className="w-full accent-neon-green" />
            </div>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.notify_email}
                  onChange={e => setForm({ ...form, notify_email: e.target.checked })}
                  className="accent-neon-green" />
                <span className="text-gray-400 text-xs">Email</span>
              </label>
              <label className={`flex items-center gap-2 ${user?.plan === 'elite' ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}>
                <input type="checkbox" checked={form.notify_whatsapp}
                  disabled={user?.plan !== 'elite'}
                  onChange={e => setForm({ ...form, notify_whatsapp: e.target.checked })}
                  className="accent-neon-green" />
                <span className="text-gray-400 text-xs">WhatsApp {user?.plan !== 'elite' && '(Elite)'}</span>
              </label>
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={addItem} disabled={adding || !form.value} className="btn-primary text-sm disabled:opacity-50">
              {adding ? 'Adding...' : 'Add to Watchlist'}
            </button>
            <button onClick={() => setShowAdd(false)} className="btn-ghost text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-dark-700">
        {[
          ['watching', `Watching (${items.length})`],
          ['alerts', `Live Alerts ${totalAlerts > 0 ? `(${totalAlerts})` : ''}`],
        ].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === id ? 'border-neon-green text-neon-green' : 'border-transparent text-gray-400 hover:text-white'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Watching tab */}
      {tab === 'watching' && (
        <div className="space-y-2">
          {loadingItems ? (
            <div className="text-center py-12 text-gray-400">
              <div className="w-8 h-8 border-2 border-neon-green/30 border-t-neon-green rounded-full animate-spin mx-auto mb-3" />
              <p>Cargando watchlist...</p>
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-400">
              <Eye size={40} className="mx-auto mb-3 opacity-30" />
              <p>{error}</p>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12">
              <Eye size={40} className="mx-auto text-gray-500 mb-3" />
              <p className="text-gray-400">Your watchlist is empty.</p>
              <p className="text-gray-500 text-sm mt-1">Add brands, UPCs, or keywords to track.</p>
            </div>
          ) : null}
          {!loadingItems && !error && items.map(item => {
            const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.keyword;
            const matchCount = matches.find(m => m.watchItem.id === item.id)?.deals.length || 0;
            return (
              <div key={item.id} className={`card flex items-center gap-4 ${matchCount > 0 ? 'border-neon-green/20' : ''}`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
                  <span className={cfg.color}>{cfg.icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-white font-semibold text-sm">{item.label || item.value}</p>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                    {matchCount > 0 && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-neon-green/20 text-neon-green font-bold">
                        {matchCount} deal{matchCount > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                    <span>Min -{item.min_discount}%</span>
                    {item.notify_email && <span>✉️ Email</span>}
                    {item.notify_whatsapp && <span>📱 WhatsApp</span>}
                  </div>
                </div>
                <button onClick={() => removeItem(item.id)} className="text-gray-500 hover:text-red-400 transition-colors">
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Alerts tab */}
      {tab === 'alerts' && (
        <div className="space-y-6">
          {loadingMatches ? (
            <div className="text-center py-12 text-gray-400">
              <div className="w-8 h-8 border-2 border-neon-green/30 border-t-neon-green rounded-full animate-spin mx-auto mb-3" />
              <p>Buscando deals activos...</p>
            </div>
          ) : matches.length === 0 ? (
            <div className="text-center py-12">
              <Bell size={40} className="mx-auto text-gray-500 mb-3" />
              <p className="text-gray-400">No matching deals right now.</p>
              <p className="text-gray-500 text-sm mt-1">We'll notify you when deals appear for your watched items.</p>
            </div>
          ) : matches.map(match => (
            <div key={match.watchItem.id}>
              <div className="flex items-center gap-2 mb-3">
                <Bell size={14} className="text-neon-green" />
                <p className="text-white font-semibold text-sm">
                  {match.watchItem.label || match.watchItem.value}
                  <span className="text-gray-400 font-normal ml-2 text-xs">({match.watchItem.type})</span>
                </p>
                <span className="text-xs bg-neon-green/20 text-neon-green px-2 py-0.5 rounded-full">{match.deals.length} live</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {match.deals.map(deal => <DealCard key={deal.id} deal={deal} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
