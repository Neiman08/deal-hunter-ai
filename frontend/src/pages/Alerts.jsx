import React, { useState, useEffect } from 'react';
import { Bell, Plus, Trash2, Store, Tag, DollarSign, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';

const STORES = ['walmart', 'home-depot', 'target', 'best-buy', 'lowes', 'office-depot', 'gamestop', 'best-buy', 'macys', 'wayfair', 'harbor-freight'];

const STORE_LABELS = {
  walmart: 'Walmart',
  'home-depot': 'Home Depot',
  target: 'Target',
  'best-buy': 'Best Buy',
  lowes: "Lowe's",
  'office-depot': 'Office Depot',
  gamestop: 'GameStop',
  macys: "Macy's",
  wayfair: 'Wayfair',
  'harbor-freight': 'Harbor Freight',
};

const SUGGESTED_BRANDS = ['DeWalt', 'Milwaukee', 'LEGO', 'Apple', 'Nintendo', 'Samsung', 'Ninja', 'Shark'];

export default function Alerts() {
  const { user } = useAuth();
  const { t } = useTranslation();

  const [alerts, setAlerts] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    name: '',
    product_keyword: '',
    store_id: '',
    min_discount_percent: 30,
    min_profit: 0,
    max_distance_miles: 25,
    zip_code: user?.zip_code || '',
    notify_email: true,
    notify_whatsapp: false,
  });

  useEffect(() => {
    fetchAlerts();
  }, []);

  async function fetchAlerts() {
    try {
      const res = await api.get('/alerts');
      setAlerts(res.data.alerts || []);
    } catch {
      setAlerts([]);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('/alerts', form);
      setAlerts((prev) => [res.data.alert, ...prev]);
      setShowForm(false);
      setForm({
        name: '',
        product_keyword: '',
        store_id: '',
        min_discount_percent: 30,
        min_profit: 0,
        max_distance_miles: 25,
        zip_code: user?.zip_code || '',
        notify_email: true,
        notify_whatsapp: false,
      });
    } catch (err) {
      alert(err.response?.data?.error || 'Error creating alert');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id) {
    try {
      await api.delete(`/alerts/${id}`);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch {
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    }
  }

  async function handleToggle(id, isActive) {
    try {
      await api.put(`/alerts/${id}`, { is_active: !isActive });
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, is_active: !isActive } : a)));
    } catch {
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, is_active: !isActive } : a)));
    }
  }

  const planLimits = { free: 3, pro: 50, elite: 999 };
  const maxAlerts  = planLimits[user?.plan || 'free'];
  const activeAlerts = alerts.filter((a) => a.is_active).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black">{t('alerts.title', 'My Alerts')}</h1>
          <p className="text-slate-300 text-sm">
            {activeAlerts} {t('common.active_of', 'active of')} {maxAlerts} {t('common.allowed_plan', 'allowed on your plan')}
          </p>
        </div>

        <button
          onClick={() => setShowForm(!showForm)}
          className="btn-primary flex items-center gap-2"
          disabled={activeAlerts >= maxAlerts}
        >
          <Plus size={16} />
          {t('alerts.new_alert', 'New Alert')}
        </button>
      </div>

      {user?.plan === 'free' && (
        <div className="p-4 bg-orange-500/10 border border-orange-500/20 rounded-xl flex items-center gap-3">
          <Bell size={18} className="text-orange-400" />
          <div>
            <p className="text-sm font-semibold text-orange-400">
              {t('common.free_plan_alerts', 'Free Plan: max 3 alerts')}
            </p>
            <p className="text-xs text-slate-300 mt-0.5">
              {t('common.upgrade_pro_alerts', 'Upgrade to Pro for unlimited alerts and WhatsApp')}
            </p>
          </div>
          <a href="/pricing" className="ml-auto text-xs text-orange-400 font-bold hover:underline whitespace-nowrap">
            {t('common.see_plans', 'Ver planes')} →
          </a>
        </div>
      )}

      {showForm && (
        <div className="card p-5 border-neon-green/20 animate-slide-up">
          <h2 className="font-bold mb-4">{t('alerts.new_alert', 'New Alert')}</h2>

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-300 mb-1.5 block">{t('alerts.alert_name', 'Alert name')}</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. DeWalt Tools"
                  className="w-full bg-dark-500 border border-dark-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-neon-green/50"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 mb-1.5 block">{t('alerts.product_keyword', 'Product keyword')}</label>
                <input
                  type="text"
                  value={form.product_keyword}
                  onChange={(e) => setForm({ ...form, product_keyword: e.target.value })}
                  placeholder="e.g. DeWalt, iPad, TV..."
                  className="w-full bg-dark-500 border border-dark-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-neon-green/50"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-slate-300 mb-1.5 block">{t('alerts.store', 'Store')}</label>
                <select
                  value={form.store_id}
                  onChange={(e) => setForm({ ...form, store_id: e.target.value })}
                  className="w-full bg-dark-500 border border-dark-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-neon-green/50"
                >
                  <option value="">{t('alerts.all_stores', 'All stores')}</option>
                  {STORES.map((store) => (
                    <option key={store} value={store}>{STORE_LABELS[store]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-300 mb-1.5 block">
                  {t('alerts.min_discount', 'Minimum discount:')} {form.min_discount_percent}%
                </label>
                <input
                  type="range" min="10" max="90" step="5" value={form.min_discount_percent}
                  onChange={(e) => setForm({ ...form, min_discount_percent: parseInt(e.target.value, 10) })}
                  className="w-full accent-neon-green"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 mb-1.5 block">
                  {t('alerts.min_profit', 'Minimum profit:')} ${form.min_profit}
                </label>
                <input
                  type="range" min="0" max="200" step="10" value={form.min_profit}
                  onChange={(e) => setForm({ ...form, min_profit: parseInt(e.target.value, 10) })}
                  className="w-full accent-neon-green"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-300 mb-1.5 block">{t('alerts.zip_code', 'ZIP Code')}</label>
                <div className="relative">
                  <MapPin size={16} className="absolute left-3 top-3 text-slate-300" />
                  <input
                    type="text" value={form.zip_code}
                    onChange={(e) => setForm({ ...form, zip_code: e.target.value })}
                    placeholder="e.g. 60074"
                    className="w-full bg-dark-500 border border-dark-300 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-neon-green/50"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-300 mb-1.5 block">
                  {t('alerts.max_distance', 'Max distance:')} {form.max_distance_miles} {t('alerts.miles', 'miles')}
                </label>
                <input
                  type="range" min="5" max="100" step="5" value={form.max_distance_miles}
                  onChange={(e) => setForm({ ...form, max_distance_miles: parseInt(e.target.value, 10) })}
                  className="w-full accent-neon-green"
                />
              </div>
            </div>

            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox" checked={form.notify_email}
                  onChange={(e) => setForm({ ...form, notify_email: e.target.checked })}
                  className="accent-neon-green"
                />
                <span className="text-sm">{t('alerts.email', 'Email')}</span>
              </label>

              <label className={`flex items-center gap-2 cursor-pointer ${user?.plan !== 'elite' ? 'opacity-50' : ''}`}>
                <input
                  type="checkbox" checked={form.notify_whatsapp}
                  disabled={user?.plan !== 'elite'}
                  onChange={(e) => setForm({ ...form, notify_whatsapp: e.target.checked })}
                  className="accent-neon-green"
                />
                <span className="text-sm">
                  {t('alerts.whatsapp', 'WhatsApp')}{' '}
                  {user?.plan !== 'elite' && <span className="text-xs text-yellow-400">(Elite)</span>}
                </span>
              </label>
            </div>

            <div className="flex gap-3">
              <button type="submit" disabled={loading} className="btn-primary">
                {loading ? t('alerts.creating', 'Creating...') : t('alerts.create', 'Create Alert')}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-ghost">
                {t('alerts.cancel', 'Cancel')}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {alerts.length === 0 ? (
          <div className="text-center py-16 text-slate-300">
            <Bell size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-semibold">{t('alerts.no_alerts', 'No alerts configured')}</p>
            <p className="text-sm mt-1">{t('alerts.no_alerts_hint', 'Create an alert to get notified when deals match your criteria.')}</p>
            <div className="mt-6">
              <p className="text-xs text-gray-500 mb-2">{t('alerts.suggested_brands', 'Suggested brands to watch:')}</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {SUGGESTED_BRANDS.map(brand => (
                  <button
                    key={brand}
                    onClick={() => { setForm(f => ({ ...f, name: brand, product_keyword: brand })); setShowForm(true); }}
                    className="px-3 py-1.5 bg-dark-700 hover:bg-dark-600 border border-dark-600 hover:border-neon-green/30 rounded-xl text-xs text-gray-400 hover:text-white transition-all"
                  >
                    {brand}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          alerts.map((alert) => (
            <div key={alert.id} className={`card p-4 ${!alert.is_active ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${alert.is_active ? 'bg-neon-green/15 text-neon-green' : 'bg-dark-400 text-slate-300'}`}>
                  <Bell size={18} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold">{alert.name || alert.product_keyword || 'Alerta general'}</h3>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleToggle(alert.id, alert.is_active)}
                        className={`text-xs px-3 py-1 rounded-lg font-semibold transition-all ${alert.is_active ? 'bg-neon-green/15 text-neon-green' : 'bg-dark-400 text-slate-300'}`}
                      >
                        {alert.is_active ? t('alerts.active', 'Active') : t('alerts.paused', 'Paused')}
                      </button>
                      <button onClick={() => handleDelete(alert.id)} className="text-slate-400 hover:text-red-400 transition-colors">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 mt-2">
                    {alert.product_keyword && (
                      <span className="text-xs bg-dark-500 text-slate-300 px-2 py-0.5 rounded-lg inline-flex items-center gap-1">
                        <Tag size={12} /> {alert.product_keyword}
                      </span>
                    )}
                    {alert.store_name && (
                      <span className="text-xs bg-dark-500 text-slate-300 px-2 py-0.5 rounded-lg inline-flex items-center gap-1">
                        <Store size={12} /> {alert.store_name}
                      </span>
                    )}
                    <span className="text-xs bg-dark-500 text-slate-300 px-2 py-0.5 rounded-lg">
                      📉 -{alert.min_discount_percent}% min
                    </span>
                    {alert.min_profit > 0 && (
                      <span className="text-xs bg-dark-500 text-slate-300 px-2 py-0.5 rounded-lg inline-flex items-center gap-1">
                        <DollarSign size={12} />+${alert.min_profit} profit
                      </span>
                    )}
                    {alert.notify_email && (
                      <span className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-lg">
                        ✉️ {t('alerts.email', 'Email')}
                      </span>
                    )}
                    {alert.notify_whatsapp && (
                      <span className="text-xs bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-lg">
                        📱 WhatsApp
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
