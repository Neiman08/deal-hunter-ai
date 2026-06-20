import { useState, useEffect } from 'react';
import {
  Bell, CheckCircle, Gift, Star, Shield, Wallet,
  Award, GraduationCap, TrendingUp, Check, RefreshCw,
} from 'lucide-react';
import api from '../utils/api';

const TYPE_META = {
  deal_verified:        { icon: CheckCircle, color: '#4ADE80', label: 'Deal Verified' },
  mission_completed:    { icon: Star,        color: '#FBBF24', label: 'Mission Complete' },
  badge_earned:         { icon: Award,       color: '#F97316', label: 'Badge Earned' },
  referral_joined:      { icon: Gift,        color: '#C084FC', label: 'New Referral' },
  withdrawal_requested: { icon: Wallet,      color: '#60A5FA', label: 'Withdrawal' },
  withdrawal_paid:      { icon: Wallet,      color: '#4ADE80', label: 'Payment Sent' },
  level_up:             { icon: TrendingUp,  color: '#FBBF24', label: 'Level Up' },
  course_completed:     { icon: GraduationCap, color: '#60A5FA', label: 'Course Done' },
  deal_rejected:        { icon: Shield,      color: '#F43F5E', label: 'Deal Rejected' },
};

function timeAgo(ts) {
  const diff = (Date.now() - new Date(ts)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function NotifCard({ n, onRead }) {
  const meta = TYPE_META[n.type] || { icon: Bell, color: '#9CA3AF', label: n.type };
  const Icon = meta.icon;
  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-xl border transition-all cursor-pointer ${
        n.read ? 'border-dark-700 bg-dark-800/30 opacity-70' : 'border-dark-600 bg-dark-800'
      }`}
      onClick={() => !n.read && onRead(n.id)}
    >
      <div className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center"
        style={{ background: `${meta.color}18` }}>
        <Icon size={16} style={{ color: meta.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ background: `${meta.color}18`, color: meta.color }}>
            {meta.label}
          </span>
          {!n.read && (
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: meta.color }} />
          )}
        </div>
        <p className="text-white text-sm font-semibold">{n.title}</p>
        {n.message && <p className="text-gray-400 text-xs mt-0.5">{n.message}</p>}
        <p className="text-gray-600 text-[10px] mt-1">{timeAgo(n.created_at)}</p>
      </div>
      {!n.read && (
        <button className="text-gray-600 hover:text-neon-green transition-colors flex-shrink-0 mt-0.5">
          <Check size={13} />
        </button>
      )}
    </div>
  );
}

export default function Notifications() {
  const [notifs, setNotifs] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [onlyUnread, setOnlyUnread] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get(`/business/notifications?limit=50${onlyUnread ? '&unread=true' : ''}`);
      setNotifs(r.data.notifications || []);
      setUnread(r.data.unread_count || 0);
    } catch (_) {}
    setLoading(false);
  }

  useEffect(() => { load(); }, [onlyUnread]);

  async function markRead(id) {
    await api.put(`/business/notifications/${id}/read`).catch(() => {});
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    setUnread(u => Math.max(0, u - 1));
  }

  async function markAllRead() {
    await api.post('/business/notifications/read-all').catch(() => {});
    setNotifs(prev => prev.map(n => ({ ...n, read: true })));
    setUnread(0);
  }

  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-3">
            <Bell size={22} className="text-neon-green" /> Notifications
          </h1>
          {unread > 0 && (
            <p className="text-gray-400 text-sm mt-1">{unread} unread</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <button onClick={markAllRead}
              className="text-xs px-3 py-1.5 rounded-lg bg-neon-green/10 text-neon-green hover:bg-neon-green/20 transition-colors font-medium">
              Mark all read
            </button>
          )}
          <button onClick={load}
            className={`p-2 rounded-lg border border-dark-700 text-gray-400 hover:text-white transition-colors ${loading ? 'animate-spin' : ''}`}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {[{ val: false, label: 'All' }, { val: true, label: 'Unread only' }].map(f => (
          <button key={String(f.val)} onClick={() => setOnlyUnread(f.val)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              onlyUnread === f.val ? 'bg-neon-green text-dark-900' : 'bg-dark-800 text-gray-400 border border-dark-700'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="h-20 rounded-xl bg-dark-800 animate-pulse" />
          ))}
        </div>
      ) : notifs.length === 0 ? (
        <div className="text-center py-16">
          <Bell size={40} className="text-gray-700 mx-auto mb-4" />
          <p className="text-gray-400 font-semibold">No notifications yet</p>
          <p className="text-gray-600 text-sm mt-1">
            {onlyUnread ? 'You\'re all caught up!' : 'Activity from deals, missions, and referrals will appear here.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifs.map(n => (
            <NotifCard key={n.id} n={n} onRead={markRead} />
          ))}
        </div>
      )}
    </div>
  );
}
