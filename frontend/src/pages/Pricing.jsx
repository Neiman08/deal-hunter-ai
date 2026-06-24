import { useState } from 'react';
import { Check, Zap, Star, Crown, ArrowRight, Shield, X, Loader } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import { useTranslation } from 'react-i18next';

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    icon: <Zap size={20} />,
    color: '#6b7280',
    borderClass: 'border-dark-600',
    description: 'Get started hunting deals',
    features: [
      '3 price alerts',
      '10 searches/day',
      'Basic deal feed',
      'UPC scanner',
      'Email notifications',
    ],
    missing: [
      'Store map view',
      'Unlimited alerts',
      'WhatsApp alerts',
      'AI recommendations',
      'Resale profit calculator',
      'Price history charts',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 19,
    icon: <Star size={20} />,
    color: '#00d4ff',
    borderClass: 'border-neon-blue/40',
    badge: 'Most Popular',
    badgeBg: 'bg-neon-blue text-dark-900',
    description: 'For serious deal hunters',
    highlight: true,
    trial: '7-day free trial',
    features: [
      'Unlimited alerts',
      'Unlimited searches',
      'Store map view',
      'Full resale calculator',
      'Price history (90 days)',
      'AI recommendations',
      'Watchlist (brands/UPCs)',
      'Email + push notifications',
      'Advanced filters',
      'Priority support',
    ],
    missing: ['WhatsApp alerts', 'Early deal access (1hr)'],
  },
  {
    id: 'elite',
    name: 'Elite',
    price: 49,
    icon: <Crown size={20} />,
    color: '#00ff88',
    borderClass: 'border-neon-green/40',
    badge: 'Best ROI',
    badgeBg: 'bg-neon-green text-dark-900',
    description: 'For resale professionals',
    features: [
      'Everything in Pro',
      'WhatsApp instant alerts',
      '1-hour early deal access',
      'AI resale scoring',
      'Multi-ZIP monitoring',
      'Bulk UPC scanner',
      'ROI tracker & analytics',
      'Export to CSV/spreadsheet',
      'Dedicated support',
      'API access (coming soon)',
    ],
    missing: [],
  },
];

const FAQ = [
  { q: 'Can I cancel anytime?', a: 'Yes, cancel instantly from Settings. No contracts, no cancellation fees. Your plan stays active until the end of the billing period.' },
  { q: 'How accurate is the resale estimate?', a: 'We pull live data from Amazon, eBay, and Facebook Marketplace listings to estimate resale value. Estimates are updated every 24 hours.' },
  { q: 'What is the 7-day Pro trial?', a: 'New Pro subscribers get 7 days free before the first charge. Cancel anytime during the trial and pay nothing.' },
  { q: 'Which stores are currently supported?', a: 'Walmart and Home Depot are live. Target, Best Buy, and Lowe\'s are in beta rollout.' },
  { q: 'How often does the scanner check prices?', a: 'Pro and Elite: every 15 min during business hours, every 30 min off-hours. Free: hourly.' },
  { q: 'Do I need to install anything?', a: 'No. Deal Hunter AI is fully web-based. The mobile app for iOS and Android is coming soon.' },
];

export default function Pricing() {
  const [loading, setLoading] = useState('');
  const [annual, setAnnual] = useState(false);
  const { user } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const success = params.get('success');
  const canceled = params.get('canceled');

  async function subscribe(planId) {
    if (planId === 'free') return navigate('/');
    if (!user) return navigate('/login');
    setLoading(planId);
    try {
      const r = await api.post('/subscriptions/checkout', { plan: planId });
      if (r.data.url) window.location.href = r.data.url;
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to start checkout');
    } finally {
      setLoading('');
    }
  }

  async function openPortal() {
    try {
      const r = await api.post('/subscriptions/portal');
      if (r.data.url) window.location.href = r.data.url;
    } catch { alert('Billing portal unavailable in demo mode'); }
  }

  const annualDiscount = 0.20;
  const displayPrice = (p) => annual ? Math.round(p * 12 * (1 - annualDiscount)) : p;

  return (
    <div className="min-h-screen p-6 lg:p-10">
      <div className="max-w-5xl mx-auto space-y-10">

        {/* Success / cancel banners */}
        {success && (
          <div className="bg-neon-green/10 border border-neon-green/40 text-neon-green rounded-2xl p-4 flex items-center gap-3">
            <Check size={20} />
            <div>
              <p className="font-semibold">Welcome to {params.get('plan')} plan! 🎉</p>
              <p className="text-sm opacity-80">Your account has been upgraded. Enjoy full access.</p>
            </div>
          </div>
        )}
        {canceled && (
          <div className="bg-dark-700 border border-dark-600 text-dark-200 rounded-2xl p-4 flex items-center gap-3">
            <X size={16} />
            <p className="text-sm">Checkout canceled. Your plan was not changed.</p>
          </div>
        )}

        {/* Header */}
        <div className="text-center">
          <h1 className="text-4xl font-black text-white mb-3">{t('pricing.title')}</h1>
          <p className="text-dark-300 text-lg max-w-lg mx-auto">
            {t('pricing.subtitle')}
          </p>

          {/* Annual toggle */}
          <div className="flex items-center justify-center gap-3 mt-6">
            <span className={`text-sm ${!annual ? 'text-white font-semibold' : 'text-dark-400'}`}>Monthly</span>
            <button
              onClick={() => setAnnual(!annual)}
              className={`relative w-12 h-6 rounded-full transition-colors ${annual ? 'bg-neon-green' : 'bg-dark-600'}`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${annual ? 'translate-x-7' : 'translate-x-1'}`} />
            </button>
            <span className={`text-sm ${annual ? 'text-white font-semibold' : 'text-dark-400'}`}>
              Annual <span className="text-neon-green text-xs font-bold">Save 20%</span>
            </span>
          </div>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {PLANS.map(plan => {
            const isCurrent = user?.plan === plan.id;
            const isLoading = loading === plan.id;

            return (
              <div key={plan.id}
                className={`relative rounded-2xl border-2 p-6 flex flex-col transition-all ${plan.borderClass} ${plan.highlight ? 'bg-neon-blue/5' : 'bg-dark-800/50'}`}>

                {plan.badge && (
                  <div className={`absolute -top-3.5 left-1/2 -translate-x-1/2 text-xs font-black px-4 py-1 rounded-full ${plan.badgeBg}`}>
                    {plan.badge}
                  </div>
                )}

                {/* Plan header */}
                <div className="mb-5">
                  <div className="w-10 h-10 rounded-xl mb-3 flex items-center justify-center" style={{ background: `${plan.color}20`, color: plan.color }}>
                    {plan.icon}
                  </div>
                  <h2 className="text-xl font-black text-white">{plan.name}</h2>
                  <p className="text-dark-400 text-sm mt-0.5">{plan.description}</p>
                </div>

                {/* Price */}
                <div className="mb-5">
                  <div className="flex items-end gap-1">
                    <span className="text-4xl font-black text-white">${plan.price === 0 ? '0' : displayPrice(plan.price)}</span>
                    {plan.price > 0 && (
                      <span className="text-dark-400 mb-1.5 text-sm">/{annual ? 'yr' : 'mo'}</span>
                    )}
                    {plan.price === 0 && <span className="text-dark-400 mb-1.5 text-sm">forever</span>}
                  </div>
                  {plan.trial && !annual && (
                    <p className="text-neon-green text-xs font-semibold mt-1">✓ {plan.trial}</p>
                  )}
                  {annual && plan.price > 0 && (
                    <p className="text-dark-400 text-xs mt-1">${plan.price}/mo billed annually</p>
                  )}
                </div>

                {/* Features */}
                <div className="space-y-2 mb-6 flex-1">
                  {plan.features.map((f, i) => (
                    <div key={i} className="flex items-start gap-2.5 text-sm">
                      <Check size={14} className="flex-shrink-0 mt-0.5" style={{ color: plan.color }} />
                      <span className="text-dark-200">{f}</span>
                    </div>
                  ))}
                  {plan.missing.map((f, i) => (
                    <div key={i} className="flex items-start gap-2.5 text-sm opacity-40">
                      <X size={14} className="flex-shrink-0 mt-0.5 text-dark-400" />
                      <span className="text-dark-400 line-through">{f}</span>
                    </div>
                  ))}
                </div>

                {/* CTA */}
                {isCurrent ? (
                  <div className="space-y-2">
                    <div className="w-full py-3 rounded-xl text-center text-sm font-semibold border border-neon-green/40 text-neon-green">
                      ✓ {t('pricing.currentPlan')}
                    </div>
                    {plan.id !== 'free' && (
                      <button onClick={openPortal} className="w-full text-xs text-dark-400 hover:text-white underline">
                        Manage billing
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => subscribe(plan.id)}
                    disabled={isLoading}
                    className={`w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                      plan.id === 'elite' ? 'bg-neon-green text-dark-900 hover:bg-neon-green/90' :
                      plan.id === 'pro' ? 'bg-neon-blue/20 text-neon-blue border border-neon-blue/40 hover:bg-neon-blue/30' :
                      'bg-dark-700 text-white hover:bg-dark-600'
                    } disabled:opacity-60 disabled:cursor-not-allowed`}>
                    {isLoading ? <Loader size={15} className="animate-spin" /> : null}
                    {plan.price === 0 ? t('pricing.plans.free.btn') : `${t('pricing.upgrade')} ${plan.name}`}
                    {!isLoading && plan.price > 0 && <ArrowRight size={14} />}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Trust badges */}
        <div className="flex flex-wrap justify-center gap-6 text-center">
          {[
            { icon: '🔒', label: 'Secure Payments', sub: 'Stripe encrypted' },
            { icon: '❌', label: 'Cancel Anytime', sub: 'No contracts' },
            { icon: '🔄', label: 'Instant Upgrade', sub: 'Access immediately' },
            { icon: '💬', label: 'Priority Support', sub: 'Pro & Elite plans' },
          ].map(b => (
            <div key={b.label} className="flex flex-col items-center gap-1">
              <span className="text-2xl">{b.icon}</span>
              <p className="text-white text-sm font-semibold">{b.label}</p>
              <p className="text-dark-400 text-xs">{b.sub}</p>
            </div>
          ))}
        </div>

        {/* FAQ */}
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl font-bold text-white text-center mb-6">Frequently Asked Questions</h2>
          <div className="space-y-3">
            {FAQ.map((f, i) => (
              <div key={i} className="card">
                <p className="text-white font-semibold text-sm mb-1.5">{f.q}</p>
                <p className="text-dark-300 text-sm leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
