import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, Clock, XCircle, Copy, AlertTriangle } from 'lucide-react';
import api from '../utils/api';

const STATUS_CONFIG = {
  approved:  { label: 'Approved',   color: '#4ADE80', icon: CheckCircle },
  pending:   { label: 'Pending',    color: '#FACC15', icon: Clock },
  rejected:  { label: 'Rejected',   color: '#F87171', icon: XCircle },
  duplicate: { label: 'Duplicate',  color: '#94A3B8', icon: Copy },
  expired:   { label: 'Expired',    color: '#6B7280', icon: AlertTriangle },
};

const TABS = ['all', 'pending', 'approved', 'rejected', 'duplicate'];
const TAB_LABEL = { all: 'All', pending: 'Pending', approved: 'Approved', rejected: 'Rejected', duplicate: 'Duplicate' };

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function CollaboratorSubmissions() {
  const [tab, setTab] = useState('all');
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [tab]);

  async function load() {
    setLoading(true);
    try {
      const params = tab === 'all' ? '' : `?status=${tab}`;
      const r = await api.get(`/collaborators/submissions${params}`);
      setSubmissions(r.data.submissions || []);
    } catch {} finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">My Submissions</h1>
        <Link to="/collaborator/submit" className="btn-primary text-sm px-4 py-2">+ Submit Deal</Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              tab === t ? 'bg-neon-green text-dark-900' : 'text-gray-400 hover:text-white'
            }`}
            style={{ background: tab === t ? undefined : '#141A26', border: '1px solid #273449' }}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-7 h-7 border-2 border-neon-green border-t-transparent rounded-full animate-spin" />
        </div>
      ) : submissions.length === 0 ? (
        <div className="card p-10 text-center space-y-3">
          <p className="text-4xl">📭</p>
          <p className="text-white font-semibold">No submissions here</p>
          <p style={{ color: '#94A3B8' }} className="text-sm">
            {tab === 'all'
              ? "You haven't submitted any deals yet."
              : `No submissions with status "${TAB_LABEL[tab]}".`}
          </p>
          <Link to="/collaborator/submit" className="btn-primary inline-block text-sm px-5 py-2">
            Submit your first deal →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {submissions.map(s => {
            const cfg = STATUS_CONFIG[s.status] || STATUS_CONFIG.pending;
            const Icon = cfg.icon;
            const discount = s.discount_percent ? Math.round(s.discount_percent) : null;
            return (
              <div key={s.id} className="card p-4 space-y-3">
                {/* Header */}
                <div className="flex items-start gap-3">
                  {s.image_url ? (
                    <img src={s.image_url} alt="" className="w-12 h-12 rounded-xl object-cover flex-shrink-0"
                      style={{ background: '#1E293B' }}
                      onError={e => { e.target.style.display = 'none'; }}
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl"
                      style={{ background: '#1E293B', border: '1px solid #273449' }}>🏷️</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm truncate">{s.product_name || s.upc || s.sku || 'Unnamed'}</p>
                    <p className="text-xs" style={{ color: '#94A3B8' }}>{s.store_name} · {timeAgo(s.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                    style={{ background: `${cfg.color}15`, border: `1px solid ${cfg.color}30` }}>
                    <Icon size={11} style={{ color: cfg.color }} />
                    <span className="text-xs font-bold" style={{ color: cfg.color }}>{cfg.label}</span>
                  </div>
                </div>

                {/* Prices */}
                <div className="flex items-center gap-4">
                  <div>
                    <p style={{ color: '#94A3B8' }} className="text-xs">Found price</p>
                    <p className="text-lg font-black text-white">${parseFloat(s.found_price).toFixed(2)}</p>
                  </div>
                  {s.regular_price && (
                    <div>
                      <p style={{ color: '#94A3B8' }} className="text-xs">Regular</p>
                      <p className="text-sm line-through" style={{ color: '#94A3B8' }}>${parseFloat(s.regular_price).toFixed(2)}</p>
                    </div>
                  )}
                  {discount && (
                    <span className="text-sm font-bold px-2 py-0.5 rounded-lg"
                      style={{ background: 'rgba(248,113,113,0.1)', color: '#F87171' }}>
                      -{discount}%
                    </span>
                  )}
                </div>

                {/* Location */}
                {(s.city || s.zip_code) && (
                  <p className="text-xs" style={{ color: '#94A3B8' }}>
                    📍 {[s.city, s.state, s.zip_code].filter(Boolean).join(', ')}
                  </p>
                )}

                {/* Rejection reason */}
                {s.status === 'rejected' && s.rejection_reason && (
                  <div className="flex items-start gap-2 p-3 rounded-xl"
                    style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}>
                    <XCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold" style={{ color: '#F87171' }}>Rejection reason</p>
                      <p className="text-xs mt-0.5" style={{ color: '#CBD5E1' }}>{s.rejection_reason}</p>
                    </div>
                  </div>
                )}

                {/* Duplicate warning */}
                {s.status === 'duplicate' && (
                  <div className="flex items-center gap-2 p-2 rounded-xl"
                    style={{ background: 'rgba(148,163,184,0.08)', border: '1px solid rgba(148,163,184,0.2)' }}>
                    <AlertTriangle size={12} style={{ color: '#94A3B8' }} />
                    <p className="text-xs" style={{ color: '#94A3B8' }}>A similar deal already exists in our database</p>
                  </div>
                )}

                {/* Deal link if approved */}
                {s.status === 'approved' && s.created_deal_id && (
                  <Link to={`/deal/${s.created_deal_id}`}
                    className="flex items-center gap-1.5 text-neon-green text-xs font-semibold hover:underline">
                    <CheckCircle size={12} /> View official deal →
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
