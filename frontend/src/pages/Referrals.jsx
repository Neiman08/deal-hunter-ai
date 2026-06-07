import { useState, useEffect } from 'react';
import { Gift, Copy, Check, Users, DollarSign, Share2, ExternalLink, Star } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';

export default function Referrals() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/referrals').then(r => setData(r.data)).catch(() => {
      // Demo
      setData({
        code: `${(user?.name || 'USER').split(' ')[0].toUpperCase().slice(0, 6)}ABC123`,
        referral_link: `https://dealhunter.ai/signup?ref=DEMO123`,
        stats: { total_signups: 7, conversions: 2, months_earned: 2 },
        recent: [
          { referee_name: 'John S.', plan: 'pro', converted_to_paid: true, created_at: '2025-05-01' },
          { referee_name: 'Maria G.', plan: 'free', converted_to_paid: false, created_at: '2025-05-10' },
          { referee_name: 'Robert K.', plan: 'pro', converted_to_paid: true, created_at: '2025-05-15' },
        ],
        rewards: { per_conversion: '1 month Pro free', description: 'Earn 1 free month of Pro for every user who upgrades to a paid plan.' },
      });
    }).finally(() => setLoading(false));
  }, []);

  function copyLink() {
    navigator.clipboard.writeText(data.referral_link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function share() {
    if (navigator.share) {
      navigator.share({
        title: 'Deal Hunter AI',
        text: 'Find liquidation deals and resale opportunities. Use my referral code!',
        url: data.referral_link,
      });
    } else copyLink();
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-neon-green border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Gift size={22} className="text-neon-green" /> Refer & Earn
        </h1>
        <p className="text-gray-300 text-sm mt-0.5">Earn free Pro months for every user you refer</p>
      </div>

      {/* How it works */}
      <div className="card border-neon-green/20 bg-neon-green/5">
        <p className="text-neon-green text-sm font-semibold mb-3">How it works</p>
        <div className="grid grid-cols-3 gap-3 text-center">
          {[
            { step: '1', icon: '🔗', label: 'Share your link' },
            { step: '2', icon: '👤', label: 'Friend signs up' },
            { step: '3', icon: '💰', label: 'They upgrade → you earn 1 month Pro free' },
          ].map(s => (
            <div key={s.step}>
              <div className="text-2xl mb-1">{s.icon}</div>
              <p className="text-gray-300 text-xs leading-relaxed">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Your code */}
      <div className="card">
        <p className="text-gray-400 text-xs uppercase tracking-wider mb-3">Your Referral Code</p>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 bg-dark-800 border border-dark-600 rounded-xl px-4 py-3 font-mono text-xl font-black text-white tracking-widest text-center">
            {data?.code}
          </div>
        </div>

        <p className="text-gray-400 text-xs mb-2">Referral Link</p>
        <div className="flex gap-2">
          <div className="flex-1 bg-dark-800 border border-dark-700 rounded-xl px-3 py-2 text-gray-300 text-xs truncate">
            {data?.referral_link}
          </div>
          <button onClick={copyLink} className="btn-primary flex items-center gap-2 text-sm px-4">
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button onClick={share} className="btn-ghost flex items-center gap-2 text-sm px-3">
            <Share2 size={14} />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: <Users size={16} />, label: 'Total Signups', value: data?.stats?.total_signups || 0, color: 'text-neon-blue' },
          { icon: <Star size={16} />, label: 'Conversions', value: data?.stats?.conversions || 0, color: 'text-neon-green' },
          { icon: <DollarSign size={16} />, label: 'Months Earned', value: data?.stats?.months_earned || 0, color: 'text-yellow-400' },
        ].map(s => (
          <div key={s.label} className="card text-center">
            <div className={`flex justify-center mb-2 ${s.color}`}>{s.icon}</div>
            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
            <p className="text-gray-400 text-xs mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Reward explanation */}
      <div className="card">
        <h3 className="text-white font-semibold mb-3">Your Reward</h3>
        <div className="p-4 bg-neon-green/5 border border-neon-green/20 rounded-xl mb-3">
          <p className="text-neon-green font-bold text-lg">🎁 {data?.rewards?.per_conversion}</p>
          <p className="text-gray-300 text-sm mt-1">{data?.rewards?.description}</p>
        </div>
        <p className="text-gray-400 text-xs">Rewards are applied automatically within 24 hours of a successful conversion. No payout required — bonus months stack on your account.</p>
      </div>

      {/* Recent referrals */}
      {data?.recent?.length > 0 && (
        <div className="card">
          <h3 className="text-white font-semibold mb-3">Recent Referrals</h3>
          <div className="space-y-2">
            {data.recent.map((r, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-dark-800 last:border-0">
                <div>
                  <p className="text-white text-sm">{r.referee_name}</p>
                  <p className="text-gray-400 text-xs">{new Date(r.created_at).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${r.plan === 'free' ? 'text-gray-400 bg-dark-700' : 'text-neon-blue bg-neon-blue/15'}`}>
                    {r.plan}
                  </span>
                  {r.converted_to_paid ? (
                    <span className="text-neon-green text-xs font-bold">+1 mo 🎁</span>
                  ) : (
                    <span className="text-gray-400 text-xs">Pending</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
