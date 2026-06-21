import React from 'react';
import { SlidersHorizontal } from 'lucide-react';

const DISCOUNTS = [
  { value: '0',  label: 'All' },
  { value: '5',  label: '+5%' },
  { value: '10', label: '+10%' },
  { value: '15', label: '+15%' },
  { value: '20', label: '+20%' },
  { value: '30', label: '+30%' },
  { value: '50', label: '+50%' },
  { value: '70', label: '+70%' },
];

const FRESHNESS = [
  { value: '',       label: 'Any time' },
  { value: 'fresh',  label: '✓ Today' },
  { value: 'recent', label: 'This Week' },
  { value: 'aging',  label: 'Needs Recheck' },
];

const SORTS = [
  { value: 'freshness', label: 'Freshness' },
  { value: 'score',     label: 'Best score' },
  { value: 'discount',  label: 'Biggest discount' },
  { value: 'profit',    label: 'Most profit' },
  { value: 'newest',    label: 'Newest' },
  { value: 'price_asc', label: 'Price: low→high' },
  { value: 'price_desc','label': 'Price: high→low' },
];

export default function FilterBar({ filters, onChange, stores = [], categories = [] }) {
  const update = (key, value) => onChange({ ...filters, [key]: value });

  // Build store list: dynamic from props, fallback to "All" only
  const storeList = [
    { value: '', label: 'All Stores' },
    ...stores.map(s => ({ value: s.slug, label: s.name })),
  ];

  // Category list: dynamic from props
  const categoryList = [
    { value: '', label: 'All Categories' },
    ...categories.map(c => ({ value: c.slug, label: c.name })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-3 py-4">
      <div className="flex items-center gap-2 text-gray-300 flex-shrink-0">
        <SlidersHorizontal size={16} />
        <span className="text-sm font-medium">Filters:</span>
      </div>

      {/* Store filter — dynamic */}
      <div className="flex gap-1.5 flex-wrap">
        {storeList.map(s => (
          <button
            key={s.value}
            onClick={() => update('store', s.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filters.store === s.value
                ? 'bg-neon-green text-dark-900'
                : 'bg-dark-500 text-gray-300 hover:text-white hover:bg-dark-400'
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-dark-300 flex-shrink-0" />

      {/* Discount filter */}
      <div className="flex gap-1.5 flex-wrap">
        {DISCOUNTS.map(d => (
          <button
            key={d.value}
            onClick={() => update('min_discount', d.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filters.min_discount === d.value
                ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                : 'bg-dark-500 text-gray-300 hover:text-white hover:bg-dark-400'
            }`}>
            {d.label}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-dark-300 flex-shrink-0" />

      {/* Freshness filter */}
      <div className="flex gap-1.5 flex-wrap">
        {FRESHNESS.map(f => (
          <button
            key={f.value}
            onClick={() => update('freshness', f.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filters.freshness === f.value
                ? 'bg-neon-blue/20 text-neon-blue border border-neon-blue/40'
                : 'bg-dark-500 text-gray-300 hover:text-white hover:bg-dark-400'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Category dropdown — only shown when categories exist */}
      {categoryList.length > 1 && (
        <select
          value={filters.category || ''}
          onChange={e => update('category', e.target.value)}
          className="bg-dark-500 border border-dark-300 text-xs text-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-neon-green max-w-[160px]">
          {categoryList.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      )}

      {/* Sort */}
      <div className="ml-auto">
        <select
          value={filters.sort || 'freshness'}
          onChange={e => update('sort', e.target.value)}
          className="bg-dark-500 border border-dark-300 text-sm text-white rounded-xl px-3 py-2 focus:outline-none focus:border-neon-green">
          {SORTS.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
