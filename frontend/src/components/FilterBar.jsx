import React from 'react';
import { SlidersHorizontal } from 'lucide-react';

const STORES = [
  { value: '', label: 'Todas' },
  { value: 'best-buy', label: 'Best Buy' },
  { value: 'target', label: 'Target' },
  { value: 'walmart', label: 'Walmart' },
  { value: 'home-depot', label: 'Home Depot' },
  { value: 'lowes', label: "Lowe's" },
  { value: 'gamestop', label: 'GameStop' },
  { value: 'office-depot', label: 'Office Depot' },
  { value: 'staples', label: 'Staples' },
  { value: 'macys', label: "Macy's" },
];

const DISCOUNTS = [
  { value: '20', label: '+20%' },
  { value: '30', label: '+30%' },
  { value: '40', label: '+40%' },
  { value: '50', label: '+50%' },
  { value: '70', label: '+70%' },
];

const SORTS = [
  { value: 'score', label: 'Mejor score' },
  { value: 'discount', label: 'Mayor descuento' },
  { value: 'savings', label: 'Mayor ahorro' },
  { value: 'profit', label: 'Mayor ganancia' },
  { value: 'newest', label: 'Más recientes' },
];

export default function FilterBar({ filters, onChange }) {
  const update = (key, value) => onChange({ ...filters, [key]: value });

  return (
    <div className="flex flex-wrap items-center gap-3 py-4">
      <div className="flex items-center gap-2" style={{ color: '#CBD5E1' }}>
        <SlidersHorizontal size={16} />
        <span className="text-sm font-medium">Filtros:</span>
      </div>

      {/* Store filter */}
      <div className="flex gap-2 flex-wrap">
        {STORES.map(s => (
          <button
            key={s.value}
            onClick={() => update('store', s.value)}
            style={filters.store !== s.value ? { color: '#CBD5E1' } : {}}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filters.store === s.value
                ? 'bg-neon-green text-dark-900'
                : 'bg-dark-500 hover:text-white hover:bg-dark-400'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-dark-300" />

      {/* Discount filter */}
      <div className="flex gap-2">
        {DISCOUNTS.map(d => (
          <button
            key={d.value}
            onClick={() => update('min_discount', d.value)}
            style={filters.min_discount !== d.value ? { color: '#CBD5E1' } : {}}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filters.min_discount === d.value
                ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                : 'bg-dark-500 hover:text-white hover:bg-dark-400'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="ml-auto">
        <select
          value={filters.sort || 'score'}
          onChange={e => update('sort', e.target.value)}
          className="bg-dark-500 border border-dark-300 text-sm text-white rounded-xl px-3 py-2 focus:outline-none focus:border-neon-green"
        >
          {SORTS.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
