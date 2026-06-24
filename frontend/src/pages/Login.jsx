import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Eye, EyeOff, Zap, TrendingUp, Bell, Gift, Scan, Users, Brain } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../utils/api';

function TopDealCard({ t }) {
  const [deal, setDeal] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.get('/deals', { params: { sort: 'score', limit: 1, min_discount: 30 } })
      .then(r => {
        const d = (r.data.deals || [])[0];
        if (d) setDeal(d);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) {
    return (
      <div className="glass rounded-2xl p-5 border border-neon-green/20 animate-pulse">
        <div className="h-4 bg-dark-600 rounded w-2/3 mb-3" />
        <div className="h-3 bg-dark-600 rounded w-full mb-2" />
        <div className="h-8 bg-dark-600 rounded w-1/3 mt-3" />
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="glass rounded-2xl p-5 border border-neon-green/20">
        <p className="text-dark-300 text-sm text-center py-2">{t('login.topDealFallback')}</p>
      </div>
    );
  }

  const discount = deal.discount_percent || deal.discount || 0;
  const score    = deal.opportunity_score || deal.score || 0;
  const profit   = deal.estimated_profit  || deal.profit || 0;
  const price    = parseFloat(deal.current_price || deal.price || 0);
  const original = parseFloat(deal.original_price || deal.list_price || 0);

  return (
    <div className="glass rounded-2xl p-5 border border-neon-green/20">
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1 min-w-0 pr-3">
          <p className="text-xs text-dark-300 mb-1 truncate">
            {deal.store_name || deal.store_slug || 'Store'}{deal.category ? ` · ${deal.category}` : ''}
          </p>
          <p className="text-white font-semibold text-sm leading-snug line-clamp-2">
            {deal.name || deal.product_name || 'Top Deal'}
          </p>
        </div>
        {discount > 0 && (
          <span className="bg-neon-green/20 text-neon-green text-xs font-bold px-2 py-1 rounded-full flex-shrink-0">
            -{Math.round(discount)}%
          </span>
        )}
      </div>

      {deal.image_url && (
        <img src={deal.image_url} alt={deal.name}
          className="w-full h-24 object-contain rounded-xl mb-3 bg-dark-700/40"
          onError={e => { e.target.style.display = 'none'; }}
        />
      )}

      <div className="flex items-end gap-3">
        {price > 0 && (
          <span className="text-2xl font-bold text-neon-green">${price.toFixed(0)}</span>
        )}
        {original > 0 && original > price && (
          <span className="text-dark-300 line-through text-sm mb-1">${original.toFixed(0)}</span>
        )}
        {score > 0 && (
          <span className="text-xs text-dark-300 mb-1 ml-auto">
            🔥 {t('login.score')}: {Math.round(score)}
          </span>
        )}
      </div>

      {profit > 0 && (
        <div className="mt-3 pt-3 border-t border-dark-700 flex justify-between text-xs">
          <span className="text-dark-300">{t('login.profit')}</span>
          <span className="text-neon-green font-semibold">+${Math.round(profit)}</span>
        </div>
      )}
    </div>
  );
}

export default function Login() {
  const location = useLocation();
  const params   = new URLSearchParams(location.search);
  const urlRef   = params.get('ref') || '';
  const urlMode  = params.get('mode') === 'register' ? 'register' : 'login';

  const [mode, setMode]       = useState(urlMode);
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [form, setForm]       = useState({ name: '', email: '', password: '', zip_code: '', ref_code: urlRef });

  const { login, register } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    if (urlRef && mode === 'login') setMode('register');
  }, []);

  const handle = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const submit = async () => {
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(form.email, form.password);
      } else {
        await register({ name: form.name, email: form.email, password: form.password, zip_code: form.zip_code, ref_code: form.ref_code || undefined });
      }
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter') submit();
  };

  const features = [
    { icon: <Zap size={15} />,    text: t('login.features.realtime') },
    { icon: <Scan size={15} />,   text: t('login.features.scanner') },
    { icon: <Bell size={15} />,   text: t('login.features.alerts') },
    { icon: <Brain size={15} />,  text: t('login.features.ai') },
    { icon: <Users size={15} />,  text: t('login.features.community') },
  ];

  return (
    <div className="min-h-screen bg-dark-900 flex">

      {/* ── Left panel ─────────────────────────────────────────────────────────── */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 bg-gradient-to-br from-dark-800 to-dark-900 p-12 border-r border-dark-700">
        <div>
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 rounded-xl bg-neon-green/20 flex items-center justify-center">
              <Zap size={20} className="text-neon-green" />
            </div>
            <span className="text-xl font-bold text-white">Deal Hunter AI</span>
          </div>

          <h1 className="text-3xl font-bold text-white leading-tight mb-4">
            {t('login.tagline')}
          </h1>
          <p className="text-gray-400 text-base mb-8 leading-relaxed">
            {t('login.description')}
          </p>

          <div className="space-y-3 mb-8">
            {features.map((f, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-neon-green/10 flex items-center justify-center text-neon-green flex-shrink-0">
                  {f.icon}
                </div>
                <span className="text-gray-300 text-sm font-medium">✓ {f.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Dynamic top deal card */}
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider font-mono mb-3">
            {t('login.topDeal')}
          </p>
          <TopDealCard t={t} />
        </div>
      </div>

      {/* ── Right panel — form ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-md">

          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <div className="w-10 h-10 rounded-xl bg-neon-green/20 flex items-center justify-center">
              <Zap size={20} className="text-neon-green" />
            </div>
            <span className="text-xl font-bold text-white">Deal Hunter AI</span>
          </div>

          <h2 className="text-2xl font-bold text-white mb-1">
            {mode === 'login' ? t('login.welcomeBack') : t('login.createAccount')}
          </h2>
          <p className="text-gray-400 mb-8">
            {mode === 'login' ? t('login.signInDesc') : t('login.startFree')}
          </p>

          {/* Referral banner */}
          {mode === 'register' && form.ref_code && (
            <div className="flex items-center gap-2 bg-neon-green/10 border border-neon-green/30 text-neon-green rounded-xl px-4 py-3 text-sm mb-4">
              <Gift size={14} />
              <span>{t('login.referralBanner', { code: form.ref_code })}</span>
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl px-4 py-3 text-sm mb-6">
              {error}
            </div>
          )}

          <div className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="text-gray-300 text-sm mb-1.5 block font-medium">{t('login.fields.name')}</label>
                <input
                  name="name"
                  value={form.name}
                  onChange={handle}
                  onKeyDown={handleKey}
                  placeholder="John Smith"
                  className="w-full bg-dark-800 border border-dark-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-neon-green/50 transition-colors"
                />
              </div>
            )}

            <div>
              <label className="text-gray-300 text-sm mb-1.5 block font-medium">{t('login.fields.email')}</label>
              <input
                name="email"
                type="email"
                value={form.email}
                onChange={handle}
                onKeyDown={handleKey}
                placeholder="you@example.com"
                className="w-full bg-dark-800 border border-dark-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-neon-green/50 transition-colors"
              />
            </div>

            <div>
              <label className="text-gray-300 text-sm mb-1.5 block font-medium">{t('login.fields.password')}</label>
              <div className="relative">
                <input
                  name="password"
                  type={showPass ? 'text' : 'password'}
                  value={form.password}
                  onChange={handle}
                  onKeyDown={handleKey}
                  placeholder="••••••••"
                  className="w-full bg-dark-800 border border-dark-700 rounded-xl px-4 py-3 pr-12 text-white placeholder-gray-600 focus:outline-none focus:border-neon-green/50 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors"
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {mode === 'register' && (
              <div>
                <label className="text-gray-300 text-sm mb-1.5 block font-medium">{t('login.fields.zipCode')}</label>
                <input
                  name="zip_code"
                  value={form.zip_code}
                  onChange={handle}
                  onKeyDown={handleKey}
                  placeholder="77001"
                  className="w-full bg-dark-800 border border-dark-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-neon-green/50 transition-colors"
                />
              </div>
            )}

            {mode === 'register' && (
              <div>
                <label className="text-gray-300 text-sm mb-1.5 block font-medium">
                  {t('login.fields.referralCode')} <span className="text-gray-500 font-normal">{t('login.fields.optional')}</span>
                </label>
                <input
                  name="ref_code"
                  value={form.ref_code}
                  onChange={handle}
                  onKeyDown={handleKey}
                  placeholder="HUNTER123"
                  className="w-full bg-dark-800 border border-dark-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-neon-green/50 transition-colors uppercase"
                />
              </div>
            )}
          </div>

          <button
            onClick={submit}
            disabled={loading}
            className="btn-primary w-full mt-6 py-3.5 text-base font-bold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? t('login.loading') : mode === 'login' ? t('login.signIn') : t('login.createBtn')}
          </button>

          {/* Toggle mode CTA */}
          <div className="mt-5 p-4 rounded-xl border border-dark-700 bg-dark-800/50 text-center">
            <p className="text-gray-400 text-sm mb-2">
              {mode === 'login' ? t('login.noAccount') : t('login.hasAccount')}
            </p>
            <button
              onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
              className="w-full py-2.5 rounded-xl border border-neon-green/40 text-neon-green text-sm font-bold hover:bg-neon-green/10 transition-colors"
            >
              {mode === 'login' ? t('login.signUpFree') : t('login.signInLink')}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
