import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Camera, CheckCircle, AlertTriangle, MapPin, Tag, DollarSign } from 'lucide-react';
import api from '../utils/api';
import CameraScanner from '../components/CameraScanner';

export default function CollaboratorSubmit() {
  const navigate = useNavigate();
  const [stores, setStores] = useState([]);
  const [showCamera, setShowCamera] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [form, setForm] = useState({
    store_id: '', product_name: '', brand: '', sku: '', upc: '',
    product_url: '', image_url: '', shelf_image_url: '',
    price_tag_image_url: '', receipt_image_url: '',
    regular_price: '', found_price: '',
    zip_code: '', city: '', state: '', latitude: '', longitude: '', notes: '',
  });

  useEffect(() => {
    api.get('/stores').then(r => setStores(r.data.stores || [])).catch(() => {});
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        setForm(f => ({
          ...f,
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        }));
      });
    }
  }, []);

  const foundPrice   = parseFloat(form.found_price) || 0;
  const regularPrice = parseFloat(form.regular_price) || 0;
  const discountPct  = regularPrice && foundPrice && regularPrice > foundPrice
    ? Math.round(((regularPrice - foundPrice) / regularPrice) * 100)
    : null;

  function set(field, val) { setForm(f => ({ ...f, [field]: val })); }

  function handleCameraDetect(code) {
    setShowCamera(false);
    if (/^\d{8,14}$/.test(code.replace(/-/g, ''))) {
      set('upc', code);
    } else {
      set('sku', code);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.store_id || !form.found_price) {
      alert('Store and found price are required');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        regular_price: form.regular_price ? parseFloat(form.regular_price) : null,
        found_price:   parseFloat(form.found_price),
        latitude:      form.latitude  ? parseFloat(form.latitude)  : null,
        longitude:     form.longitude ? parseFloat(form.longitude) : null,
      };
      const r = await api.post('/collaborators/submit', payload);
      setResult(r.data);
    } catch (err) {
      alert(err.response?.data?.error || 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    const isDuplicate = result.status === 'duplicate';
    return (
      <div className="p-4 lg:p-6 max-w-md mx-auto">
        <div className="card p-8 text-center space-y-4">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto ${isDuplicate ? 'bg-yellow-500/10' : 'bg-neon-green/10'}`}>
            {isDuplicate
              ? <AlertTriangle size={32} className="text-yellow-400" />
              : <CheckCircle size={32} className="text-neon-green" />
            }
          </div>
          <div>
            <h2 className="text-xl font-black text-white">
              {isDuplicate ? '⚠️ Possible duplicate' : '✅ Deal submitted!'}
            </h2>
            <p className="mt-2 text-sm" style={{ color: '#CBD5E1' }}>{result.message}</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => { setResult(null); setForm(f => ({ ...f, product_name: '', upc: '', sku: '', found_price: '', notes: '' })); }}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: '#1E293B', border: '1px solid #273449', color: '#CBD5E1' }}>
              Submit another
            </button>
            <button onClick={() => navigate('/collaborator/submissions')}
              className="flex-1 btn-primary py-2.5 text-sm">
              View my submissions →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-xl mx-auto space-y-5">
      {showCamera && (
        <CameraScanner onDetected={handleCameraDetect} onClose={() => setShowCamera(false)} />
      )}

      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Upload size={22} className="text-neon-green" /> Submit a Deal
        </h1>
        <p style={{ color: '#CBD5E1' }} className="text-sm mt-1">Report a deal you found in store</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Store */}
        <div className="card p-4 space-y-3">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2">
            <Tag size={14} className="text-neon-green" /> Store
          </h3>
          <select value={form.store_id} onChange={e => set('store_id', e.target.value)} required
            className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none"
            style={{ background: '#1E293B', border: '1px solid #334155', color: form.store_id ? 'white' : '#94A3B8' }}>
            <option value="" style={{ color: '#94A3B8' }}>Select a store *</option>
            {stores.map(s => (
              <option key={s.id} value={s.id} style={{ color: 'white', background: '#1E293B' }}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Product */}
        <div className="card p-4 space-y-3">
          <h3 className="text-white font-semibold text-sm">Product</h3>
          <input value={form.product_name} onChange={e => set('product_name', e.target.value)}
            placeholder="Product name"
            className="w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none text-white"
            style={{ background: '#1E293B', border: '1px solid #334155' }}
          />
          <input value={form.brand} onChange={e => set('brand', e.target.value)}
            placeholder="Brand (e.g. Samsung, Nike)"
            className="w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none text-white"
            style={{ background: '#1E293B', border: '1px solid #334155' }}
          />
          <div className="grid grid-cols-2 gap-2">
            <input value={form.upc} onChange={e => set('upc', e.target.value)}
              placeholder="UPC"
              className="w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none text-white"
              style={{ background: '#1E293B', border: '1px solid #334155' }}
            />
            <input value={form.sku} onChange={e => set('sku', e.target.value)}
              placeholder="SKU"
              className="w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none text-white"
              style={{ background: '#1E293B', border: '1px solid #334155' }}
            />
          </div>
          <button type="button" onClick={() => setShowCamera(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border-2 border-dashed transition-colors"
            style={{ borderColor: '#4ADE80', color: '#4ADE80', background: 'rgba(74,222,128,0.05)' }}>
            <Camera size={16} /> Scan barcode
          </button>
          <input value={form.product_url} onChange={e => set('product_url', e.target.value)}
            placeholder="Product URL (optional)"
            className="w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none text-white"
            style={{ background: '#1E293B', border: '1px solid #334155' }}
          />
        </div>

        {/* Prices */}
        <div className="card p-4 space-y-3">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2">
            <DollarSign size={14} className="text-neon-green" /> Prices
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs mb-1 block" style={{ color: '#94A3B8' }}>Regular price</label>
              <input type="number" step="0.01" min="0"
                value={form.regular_price} onChange={e => set('regular_price', e.target.value)}
                placeholder="0.00"
                className="w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none text-white"
                style={{ background: '#1E293B', border: '1px solid #334155' }}
              />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: '#94A3B8' }}>Found price *</label>
              <input type="number" step="0.01" min="0.01" required
                value={form.found_price} onChange={e => set('found_price', e.target.value)}
                placeholder="0.00"
                className="w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none text-white"
                style={{ background: '#1E293B', border: '1px solid #334155' }}
              />
            </div>
          </div>
          {discountPct !== null && (
            <div className="flex items-center gap-2 py-2 px-3 rounded-xl"
              style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)' }}>
              <CheckCircle size={14} className="text-neon-green" />
              <span className="text-neon-green font-bold text-sm">{discountPct}% discount detected!</span>
              {discountPct >= 50 && <span className="text-xs text-neon-green">+10 bonus pts if approved</span>}
            </div>
          )}
        </div>

        {/* Photos */}
        <div className="card p-4 space-y-3">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2">
            <Camera size={14} className="text-neon-green" /> Photos (URLs)
            <span className="text-[10px]" style={{ color: '#94A3B8' }}>+5 pts per photo, +10 pts for receipt</span>
          </h3>
          {[
            { field: 'image_url',           label: 'Product photo' },
            { field: 'shelf_image_url',     label: 'Shelf / aisle photo (+5 pts)' },
            { field: 'price_tag_image_url', label: 'Price tag photo (+5 pts)' },
            { field: 'receipt_image_url',   label: 'Receipt photo (+10 pts)' },
          ].map(({ field, label }) => (
            <div key={field}>
              <label className="text-xs mb-1 block" style={{ color: '#94A3B8' }}>{label}</label>
              <input value={form[field]} onChange={e => set(field, e.target.value)}
                placeholder="https://..."
                className="w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none text-white"
                style={{ background: '#1E293B', border: '1px solid #334155' }}
              />
            </div>
          ))}
        </div>

        {/* Location */}
        <div className="card p-4 space-y-3">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2">
            <MapPin size={14} className="text-neon-green" /> Location
          </h3>
          <div className="grid grid-cols-3 gap-2">
            <input value={form.zip_code} onChange={e => set('zip_code', e.target.value)}
              placeholder="ZIP" maxLength={10}
              className="rounded-xl px-4 py-2.5 text-sm focus:outline-none text-white"
              style={{ background: '#1E293B', border: '1px solid #334155' }}
            />
            <input value={form.city} onChange={e => set('city', e.target.value)}
              placeholder="City"
              className="rounded-xl px-4 py-2.5 text-sm focus:outline-none text-white"
              style={{ background: '#1E293B', border: '1px solid #334155' }}
            />
            <input value={form.state} onChange={e => set('state', e.target.value)}
              placeholder="State" maxLength={5}
              className="rounded-xl px-4 py-2.5 text-sm focus:outline-none text-white"
              style={{ background: '#1E293B', border: '1px solid #334155' }}
            />
          </div>
          {form.latitude && (
            <p className="text-xs text-neon-green flex items-center gap-1">
              <MapPin size={10} /> GPS captured: {form.latitude}, {form.longitude}
            </p>
          )}
        </div>

        {/* Notes */}
        <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
          placeholder="Additional notes (condition, aisle, extra details...)"
          rows={3}
          className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none text-white resize-none"
          style={{ background: '#1E293B', border: '1px solid #334155' }}
        />

        {/* Points preview */}
        <div className="rounded-xl p-3 space-y-1" style={{ background: 'rgba(74,222,128,0.05)', border: '1px solid rgba(74,222,128,0.15)' }}>
          <p className="text-neon-green font-semibold text-sm">Points you'll earn:</p>
          <div className="space-y-0.5 text-xs" style={{ color: '#CBD5E1' }}>
            <div className="flex justify-between"><span>For submitting</span><span className="text-neon-green font-bold">+2 pts</span></div>
            {(form.image_url || form.shelf_image_url || form.price_tag_image_url) && (
              <div className="flex justify-between"><span>Photo evidence</span><span className="text-neon-green font-bold">+5 pts</span></div>
            )}
            {form.receipt_image_url && (
              <div className="flex justify-between"><span>Receipt attached</span><span className="text-neon-green font-bold">+10 pts</span></div>
            )}
            {discountPct >= 50 && (
              <div className="flex justify-between"><span>≥50% discount (if approved)</span><span className="text-neon-green font-bold">+10 pts</span></div>
            )}
            <div className="flex justify-between font-bold border-t pt-1" style={{ borderColor: 'rgba(74,222,128,0.2)' }}>
              <span>If approved</span><span className="text-neon-green">+10 pts extra</span>
            </div>
          </div>
        </div>

        <button type="submit" disabled={submitting}
          className="btn-primary w-full py-3 font-bold text-base disabled:opacity-50">
          {submitting ? 'Submitting...' : '📤 Submit deal'}
        </button>
      </form>
    </div>
  );
}
