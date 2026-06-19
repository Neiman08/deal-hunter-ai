import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Search, Map, Scan, Bell, Brain,
  Shield, Tag, Menu, LogOut, Zap, Eye, Crown,
  Crosshair, BarChart3, Gift, Flame, Star, Users, Briefcase,
  Target, Wallet,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const NAV_PRIMARY = [
  { to: '/', icon: <LayoutDashboard size={16} />, label: 'Dashboard', exact: true },
  { to: '/search', icon: <Search size={16} />, label: 'Search' },
  { to: '/pro-hunter', icon: <Crosshair size={16} />, label: 'Pro Hunter', plan: 'pro' },
  { to: '/map', icon: <Map size={16} />, label: 'Map', plan: 'pro' },
  { to: '/scanner', icon: <Scan size={16} />, label: 'Scanner' },
];

const NAV_TOOLS = [
  { to: '/alerts', icon: <Bell size={16} />, label: 'Alerts' },
  { to: '/watchlist', icon: <Eye size={16} />, label: 'Watchlist' },
  { to: '/recommendations', icon: <Brain size={16} />, label: 'AI Recs' },
  { to: '/analytics', icon: <BarChart3 size={16} />, label: 'Analytics' },
];

const PLAN_STYLE = {
  free: 'text-dark-400 bg-dark-700',
  pro: 'text-neon-blue bg-neon-blue/20',
  elite: 'text-neon-green bg-neon-green/20',
};

function NavItem({ item, onClick }) {
  const { user } = useAuth();
  return (
    <NavLink to={item.to} end={item.exact} onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all group ${
          isActive
            ? 'bg-neon-green/12 text-neon-green border border-neon-green/20'
            : 'text-gray-400 hover:text-white hover:bg-dark-700'
        }`
      }>
      {item.icon}
      <span className="flex-1">{item.label}</span>
      {item.plan && user?.plan === 'free' && (
        <span className="text-[9px] bg-neon-blue/15 text-neon-blue px-1.5 py-0.5 rounded-full font-bold">PRO</span>
      )}
    </NavLink>
  );
}

export default function Layout() {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function doLogout() { logout(); navigate('/login'); }
  const close = () => setOpen(false);

  const SidebarContent = () => (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-dark-700 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-neon-green/15 flex items-center justify-center flex-shrink-0">
            <Zap size={18} className="text-neon-green" />
          </div>
          <div>
            <p className="text-white font-black text-sm leading-none">Deal Hunter AI</p>
            <p className="text-gray-500 text-xs mt-0.5">v4.0 · Launch Ready</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {NAV_PRIMARY.map(item => <NavItem key={item.to} item={item} onClick={close} />)}

        <div className="pt-2 pb-0.5 px-3">
          <p className="text-gray-500 text-[10px] uppercase tracking-wider font-semibold">Tools</p>
        </div>
        {NAV_TOOLS.map(item => <NavItem key={item.to} item={item} onClick={close} />)}

        {/* ── Deal Hunter Business ───────────────────────────────────── */}
        <div className="pt-2 pb-0.5 px-3">
          <p className="text-[10px] uppercase tracking-wider font-bold"
            style={{ color: '#4ADE80', opacity: 0.7 }}>
            ⚡ Business
          </p>
        </div>
        <NavItem item={{ to: '/business', icon: <Briefcase size={16} />, label: 'Business Home' }} onClick={close} />
        <NavItem item={{ to: '/referrals', icon: <Gift size={16} />, label: 'Refer & Earn' }} onClick={close} />
        <NavItem item={{ to: '/teams', icon: <Users size={16} />, label: 'Teams' }} onClick={close} />
        <NavItem item={{ to: '/collaborator/leaderboard', icon: <Target size={16} />, label: 'Ranking' }} onClick={close} />

        {/* ── Community ────────────────────────────────────────────────── */}
        <div className="pt-2 pb-0.5 px-3">
          <p className="text-gray-500 text-[10px] uppercase tracking-wider font-semibold">Community</p>
        </div>
        <NavItem item={{ to: '/community', icon: <Users size={16} />, label: 'Community' }} onClick={close} />
        <NavItem item={{ to: '/feed', icon: <Flame size={16} />, label: 'Deal Feed' }} onClick={close} />
        <NavItem item={{ to: '/collaborator', icon: <Star size={16} />, label: 'Collaborator' }} onClick={close} />

        <div className="pt-2 border-t border-dark-700 mt-1 space-y-0.5">
          <NavItem item={{ to: '/pricing', icon: <Tag size={16} />, label: 'Pricing' }} onClick={close} />
          {user?.is_admin && (
            <NavItem item={{ to: '/admin', icon: <Shield size={16} />, label: 'Admin Panel' }} onClick={close} />
          )}
          {user?.is_admin && (
            <NavItem item={{ to: '/admin/submitted-deals', icon: <Flame size={16} />, label: 'Offered Deals' }} onClick={close} />
          )}
        </div>
      </nav>

      {/* Upgrade CTA */}
      {user?.plan === 'free' && (
        <div className="mx-2 mb-2 p-3 rounded-xl bg-neon-green/8 border border-neon-green/20 flex-shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <Crown size={13} className="text-neon-green" />
            <span className="text-neon-green text-xs font-bold">Upgrade to Pro — $19/mo</span>
          </div>
          <p className="text-gray-400 text-xs mb-2">Pro Hunter, unlimited alerts, map view, AI recs.</p>
          <NavLink to="/pricing" onClick={close}
            className="block text-center py-1.5 rounded-lg bg-neon-green text-dark-900 text-xs font-black hover:bg-neon-green/90 transition-colors">
            Start Free Trial →
          </NavLink>
        </div>
      )}

      {/* User */}
      <div className="p-2 border-t border-dark-700 flex-shrink-0">
        {user && (
          <div className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-dark-700 transition-colors group cursor-default">
            <div className="w-8 h-8 rounded-full bg-neon-green/15 flex items-center justify-center text-neon-green text-sm font-black flex-shrink-0">
              {(user.name || user.email)[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-semibold truncate">{user.name || user.email}</p>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold capitalize ${PLAN_STYLE[user.plan] || PLAN_STYLE.free}`}>
                {user.plan}
              </span>
            </div>
            <button onClick={doLogout} className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
              <LogOut size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-dark-900 overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden lg:block w-52 flex-shrink-0 bg-dark-800 border-r border-dark-700">
        <SidebarContent />
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="w-60 bg-dark-800 border-r border-dark-700 h-full">
            <SidebarContent />
          </div>
          <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={close} />
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-dark-700 bg-dark-800 flex-shrink-0">
          <button onClick={() => setOpen(true)} className="text-gray-400 hover:text-white">
            <Menu size={19} />
          </button>
          <Zap size={15} className="text-neon-green" />
          <span className="text-white font-black text-sm">Deal Hunter AI</span>
          {user && (
            <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-bold capitalize ${PLAN_STYLE[user.plan] || PLAN_STYLE.free}`}>
              {user.plan}
            </span>
          )}
        </div>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
