import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Bot, Send, Zap, TrendingUp, Target, Users, Star,
  ArrowLeft, AlertTriangle, Loader2, RefreshCw,
} from 'lucide-react';
import api from '../utils/api';

const SUGGESTION_ICONS = {
  level_up:    { icon: TrendingUp, color: '#60A5FA' },
  mission:     { icon: Target,     color: '#4ADE80' },
  points:      { icon: Star,       color: '#FBBF24' },
  trust:       { icon: Zap,        color: '#F97316' },
  university:  { icon: '🎓',       color: '#C084FC', isEmoji: true },
  onboarding:  { icon: Zap,        color: '#4ADE80' },
};

function SuggestionCard({ s }) {
  const { t } = useTranslation();
  const meta = SUGGESTION_ICONS[s.type] || { icon: Zap, color: '#94A3B8' };
  const Icon = meta.isEmoji ? null : meta.icon;

  return (
    <div className="rounded-xl p-3 bg-dark-800/60 border border-dark-700 flex items-start gap-3">
      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-base"
        style={{ background: `${meta.color}15` }}>
        {meta.isEmoji
          ? meta.icon
          : <Icon size={14} style={{ color: meta.color }} />
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-semibold">{s.title}</p>
        <p className="text-gray-400 text-xs mt-0.5 leading-relaxed">{s.message}</p>
        {s.action_url && (
          <Link to={s.action_url}
            className="inline-block mt-1.5 text-xs font-semibold"
            style={{ color: meta.color }}>
            {t('coach.go', 'Go')} →
          </Link>
        )}
      </div>
    </div>
  );
}

function ChatBubble({ role, content }) {
  const isUser = role === 'user';

  const formattedContent = content
    .split('\n')
    .map((line, i) => {
      if (!line.trim()) return <br key={i} />;
      return (
        <p key={i} className="text-sm leading-relaxed"
          dangerouslySetInnerHTML={{
            __html: line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'),
          }}
        />
      );
    });

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-neon-green/15 flex items-center justify-center flex-shrink-0">
          <Bot size={14} className="text-neon-green" />
        </div>
      )}
      <div className={`max-w-[85%] px-4 py-3 rounded-2xl space-y-1 ${
        isUser
          ? 'bg-neon-green/15 text-white rounded-tr-sm'
          : 'bg-dark-700 text-gray-200 rounded-tl-sm'
      }`}>
        {formattedContent}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function AICoach() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('es') ? 'es' : 'en';

  const quickPrompts = lang === 'es'
    ? [
        { label: t('coach.prompt_levelup',  '¿Cómo subo de nivel?'),        msg: '¿Cómo subo de nivel más rápido?' },
        { label: t('coach.prompt_points',   '¿Cómo gano más puntos?'),      msg: '¿Cómo gano más puntos?' },
        { label: t('coach.prompt_today',    '¿Qué debo hacer hoy?'),        msg: '¿Qué debo hacer hoy?' },
        { label: t('coach.prompt_team',     '¿Cómo hago crecer mi equipo?'),msg: '¿Cómo hago crecer mi equipo?' },
      ]
    : [
        { label: t('coach.prompt_levelup',  'How do I level up?'),          msg: 'How do I level up faster?' },
        { label: t('coach.prompt_points',   'How can I earn more points?'), msg: 'How can I earn more points?' },
        { label: t('coach.prompt_today',    'What should I do today?'),     msg: 'What should I do today?' },
        { label: t('coach.prompt_team',     'How can I grow my team?'),     msg: 'How can I grow my team?' },
      ];

  const [summary, setSummary]         = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [messages, setMessages]       = useState([]);
  const [input, setInput]             = useState('');
  const [loading, setLoading]         = useState(true);
  const [sending, setSending]         = useState(false);
  const [error, setError]             = useState('');
  const messagesEndRef                = useRef(null);

  useEffect(() => {
    Promise.all([
      api.get(`/business/coach/summary?language=${lang}`),
      api.get(`/business/coach/suggestions?language=${lang}`),
    ]).then(([summaryRes, suggRes]) => {
      const rest = summaryRes.data;
      const suggs = suggRes.data.suggestions || [];
      setSummary(rest);
      setSuggestions(suggs);

      const greeting = lang === 'es'
        ? `¡Hola! Soy tu Coach de Deal Hunter. Estás en nivel **${rest.level}** con **${rest.xp} XP**.${rest.next_level ? ` Te faltan **${rest.xp_to_next} XP** para llegar a **${rest.next_level}**.` : ' ¡Estás en el nivel máximo!'}\n\nTengo **${suggs.length}** sugerencias personalizadas para ti. ¿Con qué quieres que te ayude hoy?`
        : `Hi, I'm your Deal Hunter Coach! You are currently at **${rest.level}** with **${rest.xp} XP**.${rest.next_level ? ` You're **${rest.xp_to_next} XP** away from **${rest.next_level}**.` : ' You\'re at the top level!'}\n\nI have **${suggs.length}** personalized suggestions for you. What would you like help with today?`;

      setMessages([{ role: 'assistant', content: greeting }]);
    }).catch(err => {
      if (err.response?.status === 401) navigate('/login');
      else setError(t('coach.load_error', 'Failed to load Coach.'));
    }).finally(() => setLoading(false));
  }, [navigate, lang]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send(text) {
    const msg = (text || input).trim();
    if (!msg || sending) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setSending(true);

    try {
      const res = await api.post('/business/coach/ask', { message: msg, language: lang });
      setMessages(prev => [...prev, { role: 'assistant', content: res.data.response }]);
    } catch (_) {
      const errMsg = lang === 'es'
        ? 'Tengo problemas en este momento. Por favor intenta de nuevo en un momento.'
        : "I'm having trouble right now. Please try again in a moment.";
      setMessages(prev => [...prev, { role: 'assistant', content: errMsg }]);
    }

    setSending(false);
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-neon-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <AlertTriangle size={28} className="mx-auto text-yellow-400 mb-2" />
        <p className="text-gray-400 text-sm">{error}</p>
        <button onClick={() => window.location.reload()} className="btn-primary mt-3 text-sm px-5">
          {t('common.retry', 'Retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-dark-700 flex-shrink-0">
        <Link to="/business" className="text-gray-400 hover:text-white transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div className="w-9 h-9 rounded-xl bg-neon-green/15 flex items-center justify-center flex-shrink-0">
          <Bot size={18} className="text-neon-green" />
        </div>
        <div className="flex-1">
          <h1 className="text-white font-black text-sm">Coach IA</h1>
          <p className="text-gray-500 text-xs">
            {t('coach.mode_label', 'Smart guidance mode · powered by your data')}
          </p>
        </div>
        {summary && (
          <div className="text-right flex-shrink-0">
            <p className="text-neon-green text-xs font-bold">{summary.level}</p>
            <p className="text-gray-500 text-[10px]">{summary.xp.toLocaleString()} XP</p>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-5">

          {/* Summary card */}
          {summary && (
            <div className="rounded-2xl p-4 border border-neon-green/20 bg-neon-green/5">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1">
                  <p className="text-neon-green text-xs font-bold uppercase tracking-wider">
                    {t('coach.hunter_status', 'Your Hunter Status')}
                  </p>
                  <p className="text-white font-black text-lg">{summary.level}</p>
                </div>
                <div className="text-right">
                  <p className="text-white font-black text-xl">{summary.xp.toLocaleString()}</p>
                  <p className="text-gray-400 text-xs">XP total</p>
                </div>
              </div>
              <p className="text-gray-300 text-sm">{summary.summary}</p>
              {summary.next_level && summary.xp_to_next > 0 && (
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>{t('coach.progress_to', 'Progress to')} {summary.next_level}</span>
                    <span>{summary.xp_to_next} XP {t('coach.remaining', 'remaining')}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-dark-900/60">
                    <div className="h-full rounded-full bg-neon-green transition-all"
                      style={{ width: `${Math.max(2, Math.min(98, Math.round(((summary.xp - (summary.xp - summary.xp_to_next - (summary.xp))) / (summary.xp + summary.xp_to_next)) * 100)))}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-white font-bold text-sm flex items-center gap-2">
                <Zap size={13} className="text-yellow-400" />
                {t('coach.personalized_suggestions', 'Personalized Suggestions')}
              </h2>
              {suggestions.map((s, i) => (
                <SuggestionCard key={i} s={s} />
              ))}
            </div>
          )}

          {/* Chat */}
          <div className="space-y-3">
            <h2 className="text-white font-bold text-sm flex items-center gap-2">
              <Bot size={13} className="text-neon-green" />
              {t('coach.chat_title', 'Chat with Coach')}
            </h2>

            <div className="space-y-3 min-h-[120px]">
              {messages.map((m, i) => (
                <ChatBubble key={i} role={m.role} content={m.content} />
              ))}
              {sending && (
                <div className="flex gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-neon-green/15 flex items-center justify-center flex-shrink-0">
                    <Bot size={14} className="text-neon-green" />
                  </div>
                  <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-dark-700">
                    <Loader2 size={14} className="text-gray-400 animate-spin" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Quick prompt buttons */}
          <div className="grid grid-cols-2 gap-2">
            {quickPrompts.map(p => (
              <button key={p.label} onClick={() => send(p.msg)} disabled={sending}
                className="text-left px-3 py-2 rounded-xl bg-dark-800/60 border border-dark-700 hover:border-neon-green/30 transition-all text-xs text-gray-400 hover:text-white disabled:opacity-50">
                {p.label}
              </button>
            ))}
          </div>

        </div>
      </div>

      {/* Input bar */}
      <div className="flex-shrink-0 p-4 border-t border-dark-700 bg-dark-800">
        <div className="flex gap-2.5 items-end">
          <div className="flex-1 bg-dark-700 rounded-xl border border-dark-600 focus-within:border-neon-green/40 transition-colors">
            <textarea
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={t('coach.input_placeholder', 'Ask your coach anything...')}
              className="w-full bg-transparent px-3 py-2.5 text-sm text-white placeholder-gray-500 resize-none outline-none max-h-28"
              style={{ minHeight: '40px' }}
            />
          </div>
          <button onClick={() => send()} disabled={!input.trim() || sending}
            className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl transition-all disabled:opacity-40"
            style={{ background: input.trim() && !sending ? '#4ADE80' : '#1F2937' }}>
            <Send size={15} style={{ color: input.trim() && !sending ? '#0A0A0A' : '#6B7280' }} />
          </button>
        </div>
        <p className="text-center text-gray-600 text-[10px] mt-2">
          {t('coach.footer', 'Coach IA is running in smart guidance mode · powered by your real data')}
        </p>
      </div>
    </div>
  );
}
