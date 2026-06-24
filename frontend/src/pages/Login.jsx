import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Eye, EyeOff, Zap, TrendingUp, Bell, Gift } from 'lucide-react';

export default function Login() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const urlRef  = params.get('ref') || '';
  const urlMode = params.get('mode') === 'register' ? 'register' : 'login';

  const [mode, setMode] = useState(urlMode);
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', zip_code: '', ref_code: urlRef });

  const { login, register } = useAuth();
  const navigate = useNavigate();

  // If ref code present, default to register mode
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
      setError(err.response?.data?.error || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const features = [
    { icon: <Zap size={18} />, text: 'Real-time deal detection' },
    { icon: <TrendingUp size={18} />, text: 'Resale profit calculator' },
    { icon: <Bell size={18} />, text: 'Instant deal alerts' },
  ];

  return (
    <div className="min-h-screen bg-dark-900 flex">
      {/* Left panel */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 bg-gradient-to-br from-dark-800 to-dark-900 p-12 border-r border-dark-700">
        <div>
          <div className="flex items-center gap-3 mb-12">
            <div className="w-10 h-10 rounded-xl bg-neon-green/20 flex items-center justify-center">
              <Zap size={20} className="text-neon-green" />
            </div>
            <span className="text-xl font-bold text-white">Deal Hunter AI</span>
          </div>
          <h1 className="text-4xl font-bold text-white leading-tight mb-4">
            Find hidden deals<br />before anyone else.
          </h1>
          <p className="text-dark-300 text-lg mb-10">
            AI-powered price monitoring across Walmart, Home Depot, Target & more.
          </p>
          <div className="space-y-4">
            {features.map((f, i) => (
              <div key={i} className="flex items-center gap-3 text-dark-200">
                <div className="text-neon-green">{f.icon}</div>
                <span>{f.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Demo deal card */}
        <div className="glass rounded-2xl p-5 border border-neon-green/20">
          <div className="flex justify-between items-start mb-3">
            <div>
              <p className="text-xs text-dark-300 mb-1">Home Depot · Power Tools</p>
              <p className="text-white font-semibold text-sm">DeWalt 20V Max Drill Kit</p>
            </div>
            <span className="bg-neon-green/20 text-neon-green text-xs font-bold px-2 py-1 rounded-full">-75%</span>
          </div>
          <div className="flex items-end gap-3">
            <span className="text-2xl font-bold text-neon-green">$49</span>
            <span className="text-dark-300 line-through text-sm mb-1">$199</span>
            <span className="text-xs text-dark-300 mb-1 ml-auto">🔥 Score: 94</span>
          </div>
          <div className="mt-3 pt-3 border-t border-dark-700 flex justify-between text-xs">
            <span className="text-dark-300">Resale est.</span>
            <span className="text-neon-green font-semibold">+$81 profit</span>
          </div>
        </div>
      </div>

      {/* Right panel - form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <div className="w-10 h-10 rounded-xl bg-neon-green/20 flex items-center justify-center">
              <Zap size={20} className="text-neon-green" />
            </div>
            <span className="text-xl font-bold text-white">Deal Hunter AI</span>
          </div>

          <h2 className="text-2xl font-bold text-white mb-1">
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h2>
          <p className="text-dark-300 mb-8">
            {mode === 'login' ? 'Sign in to your account' : 'Start hunting deals for free'}
          </p>

          {/* Referral banner */}
          {mode === 'register' && form.ref_code && (
            <div className="flex items-center gap-2 bg-neon-green/10 border border-neon-green/30 text-neon-green rounded-xl px-4 py-3 text-sm mb-4">
              <Gift size={14} />
              <span>Invitado con código <strong>{form.ref_code}</strong> — ¡bienvenido!</span>
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
                <label className="text-dark-200 text-sm mb-1.5 block">Full Name</label>
                <input
                  name="name"
                  value={form.name}
                  onChange={handle}
                  placeholder="John Smith"
                  className="w-full bg-dark-800 border border-dark-700 rounded-xl px-4 py-3 text-white placeholder-dark-400 focus:outline-none focus:border-neon-green/50 transition-colors"
                />
              </div>
            )}
            <div>
              <label className="text-dark-200 text-sm mb-1.5 block">Email</label>
              <input
                name="email"
                type="email"
                value={form.email}
                onChange={handle}
                placeholder="you@example.com"
                className="w-full bg-dark-800 border border-dark-700 rounded-xl px-4 py-3 text-white placeholder-dark-400 focus:outline-none focus:border-neon-green/50 transition-colors"
              />
            </div>
            <div>
              <label className="text-dark-200 text-sm mb-1.5 block">Password</label>
              <div className="relative">
                <input
                  name="password"
                  type={showPass ? 'text' : 'password'}
                  value={form.password}
                  onChange={handle}
                  placeholder="••••••••"
                  className="w-full bg-dark-800 border border-dark-700 rounded-xl px-4 py-3 pr-12 text-white placeholder-dark-400 focus:outline-none focus:border-neon-green/50 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-dark-400 hover:text-white"
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {mode === 'register' && (
              <div>
                <label className="text-dark-200 text-sm mb-1.5 block">ZIP Code</label>
                <input
                  name="zip_code"
                  value={form.zip_code}
                  onChange={handle}
                  placeholder="77001"
                  className="w-full bg-dark-800 border border-dark-700 rounded-xl px-4 py-3 text-white placeholder-dark-400 focus:outline-none focus:border-neon-green/50 transition-colors"
                />
              </div>
            )}
            {mode === 'register' && (
              <div>
                <label className="text-dark-200 text-sm mb-1.5 block">Referral Code <span className="text-dark-400">(optional)</span></label>
                <input
                  name="ref_code"
                  value={form.ref_code}
                  onChange={handle}
                  placeholder="NEIMAN123"
                  className="w-full bg-dark-800 border border-dark-700 rounded-xl px-4 py-3 text-white placeholder-dark-400 focus:outline-none focus:border-neon-green/50 transition-colors uppercase"
                />
              </div>
            )}
          </div>

          <button
            onClick={submit}
            disabled={loading}
            className="btn-primary w-full mt-6 py-3 text-base disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Loading...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>

          {mode === 'login' && (
            <div className="mt-4 p-4 bg-dark-800/50 rounded-xl text-xs text-dark-300">
              <p className="mb-1 font-semibold text-dark-200">Demo credentials:</p>
              <p>Admin: admin@dealhunter.ai / admin123</p>
              <p>User: demo@dealhunter.ai / user123</p>
            </div>
          )}

          <p className="text-center text-dark-300 text-sm mt-6">
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
              className="text-neon-green hover:underline font-semibold"
            >
              {mode === 'login' ? 'Sign up free' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
