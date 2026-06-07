import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Clock, ExternalLink, Image, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../utils/api';

const STATUS_TABS = ['pending', 'approved', 'rejected', 'all'];
const STATUS_LABEL = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', all: 'All' };
const STATUS_COLOR = { pending: '#FACC15', approved: '#4ADE80', rejected: '#F87171', duplicate: '#94A3B8' };

function timeAgo(d) {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function SubmissionCard({ sub, onApprove, onReject }) {
  const [expanded, setExpanded] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [acting, setActing] = useState(false);

  const discount = sub.discount_percent ? Math.round(sub.discount_percent) : null;
  const images = [sub.image_url, sub.shelf_image_url, sub.price_tag_image_url, sub.receipt_image_url].filter(Boolean);

  async function doApprove() {
    setActing(true);
    try {
      await api.post(`/admin/submitted-deals/${sub.id}/approve`, { admin_notes: adminNotes });
      onApprove(sub.id);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to approve');
    } finally {
      setActing(false);
    }
  }

  async function doReject() {
    if (!rejectReason.trim()) { alert('Rejection reason is required'); return; }
    setActing(true);
    try {
      await api.post(`/admin/submitted-deals/${sub.id}/reject`, { rejection_reason: rejectReason, admin_notes: adminNotes });
      onReject(sub.id);
      setShowRejectModal(false);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to reject');
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="card space-y-3">
      {/* Header */}
      <div className="flex items-start gap-3">
        {sub.image_url ? (
          <img src={sub.image_url} alt="" className="w-14 h-14 rounded-xl object-cover flex-shrink-0"
            style={{ background: '#1E293B' }}
            onError={e => { e.target.style.display = 'none'; }}
          />
        ) : (
          <div className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl"
            style={{ background: '#1E293B', border: '1px solid #273449' }}>🏷️</div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold truncate">{sub.product_name || sub.upc || sub.sku || 'Unnamed'}</p>
          {sub.brand && <p className="text-xs" style={{ color: '#94A3B8' }}>{sub.brand}</p>}
          <div className="flex items-center gap-2 mt-1 text-xs flex-wrap" style={{ color: '#94A3B8' }}>
            <span className="font-medium" style={{ color: '#CBD5E1' }}>{sub.store_name}</span>
            <span>·</span>
            <span>{sub.display_name || sub.submitter_name || sub.submitter_email}</span>
            {sub.level && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                style={{ color: STATUS_COLOR[sub.status] || '#94A3B8', background: `${STATUS_COLOR[sub.status] || '#94A3B8'}15` }}>
                {sub.level}
              </span>
            )}
            <span>· {timeAgo(sub.created_at)}</span>
          </div>
        </div>
        <span className="text-xs px-2 py-1 rounded-lg font-bold flex-shrink-0"
          style={{ color: STATUS_COLOR[sub.status] || '#94A3B8', background: `${STATUS_COLOR[sub.status] || '#94A3B8'}15` }}>
          {STATUS_LABEL[sub.status] || sub.status}
        </span>
      </div>

      {/* Prices */}
      <div className="flex items-center gap-4">
        <div>
          <p className="text-2xl font-black text-neon-green">${parseFloat(sub.found_price).toFixed(2)}</p>
          <p className="text-xs" style={{ color: '#94A3B8' }}>Found price</p>
        </div>
        {sub.regular_price && (
          <div>
            <p className="text-lg line-through" style={{ color: '#94A3B8' }}>${parseFloat(sub.regular_price).toFixed(2)}</p>
            <p className="text-xs" style={{ color: '#94A3B8' }}>Regular</p>
          </div>
        )}
        {discount && (
          <span className="text-lg font-black px-3 py-1 rounded-xl"
            style={{ background: 'rgba(248,113,113,0.1)', color: '#F87171' }}>
            -{discount}%
          </span>
        )}
      </div>

      {/* Location */}
      {(sub.city || sub.zip_code) && (
        <p className="text-xs" style={{ color: '#94A3B8' }}>
          📍 {[sub.city, sub.state, sub.zip_code].filter(Boolean).join(', ')}
        </p>
      )}

      {/* Expand toggle */}
      <button onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1.5 text-xs" style={{ color: '#94A3B8' }}>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {expanded ? 'Less details' : 'More details'}
        {images.length > 0 && (
          <span className="flex items-center gap-1 ml-2">
            <Image size={11} /> {images.length} photo{images.length > 1 ? 's' : ''}
          </span>
        )}
      </button>

      {expanded && (
        <div className="space-y-3">
          {sub.notes && (
            <div className="p-3 rounded-xl text-sm" style={{ background: '#0F172A', color: '#CBD5E1' }}>
              {sub.notes}
            </div>
          )}
          {sub.product_url && (
            <a href={sub.product_url} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-xs text-neon-blue hover:underline">
              <ExternalLink size={11} /> View product
            </a>
          )}
          {sub.approved_deals_count !== undefined && (
            <div className="flex gap-4 text-xs">
              <span className="text-neon-green">✅ {sub.approved_deals_count} approved</span>
              <span style={{ color: '#F87171' }}>❌ {sub.rejected_deals_count} rejected</span>
              <span style={{ color: '#94A3B8' }}>⭐ Rep: {parseFloat(sub.reputation_score || 100).toFixed(0)}%</span>
            </div>
          )}
          {images.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {images.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noreferrer">
                  <img src={url} alt="" className="w-full rounded-xl object-cover"
                    style={{ height: '120px', background: '#1E293B' }}
                    onError={e => { e.target.style.display = 'none'; }}
                  />
                </a>
              ))}
            </div>
          )}
          <textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)}
            placeholder="Admin notes (optional)..." rows={2}
            className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none resize-none"
            style={{ background: '#1E293B', border: '1px solid #334155', color: 'white' }}
          />
        </div>
      )}

      {/* Approve / Reject actions */}
      {sub.status === 'pending' && (
        <div className="flex gap-2 pt-1">
          <button onClick={doApprove} disabled={acting}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50"
            style={{ background: 'rgba(74,222,128,0.15)', color: '#4ADE80', border: '1px solid rgba(74,222,128,0.3)' }}>
            <CheckCircle size={15} /> {acting ? 'Approving...' : 'Approve'}
          </button>
          <button onClick={() => setShowRejectModal(true)} disabled={acting}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50"
            style={{ background: 'rgba(248,113,113,0.1)', color: '#F87171', border: '1px solid rgba(248,113,113,0.3)' }}>
            <XCircle size={15} /> Reject
          </button>
        </div>
      )}

      {/* Reject reason modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.8)' }}>
          <div className="card w-full max-w-sm space-y-4 p-5">
            <h3 className="text-white font-bold">Rejection reason</h3>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              placeholder="Explain why this deal is being rejected..."
              rows={3} autoFocus
              className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none resize-none"
              style={{ background: '#1E293B', border: '1px solid #334155', color: 'white' }}
            />
            <div className="flex gap-2">
              <button onClick={() => setShowRejectModal(false)}
                className="flex-1 py-2 rounded-xl text-sm"
                style={{ background: '#1E293B', border: '1px solid #273449', color: '#94A3B8' }}>
                Cancel
              </button>
              <button onClick={doReject} disabled={acting || !rejectReason.trim()}
                className="flex-1 py-2 rounded-xl text-sm font-bold disabled:opacity-50"
                style={{ background: 'rgba(248,113,113,0.15)', color: '#F87171', border: '1px solid rgba(248,113,113,0.3)' }}>
                {acting ? 'Rejecting...' : 'Confirm rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminSubmittedDeals() {
  const [tab, setTab] = useState('pending');
  const [submissions, setSubmissions] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [tab]);

  async function load() {
    setLoading(true);
    try {
      const r = await api.get(`/admin/submitted-deals?status=${tab}`);
      setSubmissions(r.data.submissions || []);
      setCounts(r.data.counts || {});
    } catch {} finally {
      setLoading(false);
    }
  }

  function handleApprove(id) {
    setSubmissions(s => s.filter(x => x.id !== id));
    setCounts(c => ({ ...c, pending: Math.max(0, (c.pending || 0) - 1), approved: (c.approved || 0) + 1 }));
  }

  function handleReject(id) {
    setSubmissions(s => s.filter(x => x.id !== id));
    setCounts(c => ({ ...c, pending: Math.max(0, (c.pending || 0) - 1), rejected: (c.rejected || 0) + 1 }));
  }

  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <AlertTriangle size={22} className="text-yellow-400" /> Submitted Deals
        </h1>
        <p style={{ color: '#CBD5E1' }} className="text-sm mt-1">Admin panel — review and approve / reject collaborator deals</p>
      </div>

      {/* Tabs with counts */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {STATUS_TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              tab === t ? 'bg-neon-green text-dark-900' : 'text-gray-400 hover:text-white'
            }`}
            style={{ background: tab === t ? undefined : '#141A26', border: '1px solid #273449' }}>
            {STATUS_LABEL[t]}
            {counts[t] > 0 && (
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-black`}
                style={tab !== t ? { background: `${STATUS_COLOR[t] || '#94A3B8'}20`, color: STATUS_COLOR[t] || '#94A3B8' } : { background: 'rgba(0,0,0,0.2)', color: 'inherit' }}>
                {counts[t]}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-7 h-7 border-2 border-neon-green border-t-transparent rounded-full animate-spin" />
        </div>
      ) : submissions.length === 0 ? (
        <div className="card p-10 text-center">
          <p className="text-4xl mb-3">{tab === 'pending' ? '✅' : '📋'}</p>
          <p className="text-white font-semibold">
            {tab === 'pending' ? 'No pending submissions' : `No submissions with status "${STATUS_LABEL[tab]}"`}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {submissions.map(s => (
            <SubmissionCard key={s.id} sub={s} onApprove={handleApprove} onReject={handleReject} />
          ))}
        </div>
      )}
    </div>
  );
}
