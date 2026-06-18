import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search as SearchIcon, X, Loader, SlidersHorizontal, Store, Tag } from 'lucide-react';
import api from '../utils/api';
import DealCard from '../components/DealCard';

// Categories are hardcoded — DB has 19 but no /api/categories endpoint exists yet.
// Slugs match DB. TODO: replace with /api/categories when endpoint is created.
const QUICK_CATS = [
  { label: 'Electronics', category: 'electronics' },
  { label: 'Appliances', category: 'appliances' },
  { label: 'Clothing', category: 'clothing' },
  { label: 'Jewelry', category: 'jewelry' },
];

export default function Search() {
  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState('keyword'); // 'keyword' | 'upc'
  const [filters, setFilters] = useState({ store: '', category: '', min_discount: 0 });
  const [showFilters, setShowFilters] = useState(false);

  const [stores, setStores] = useState([]); // loaded from /api/stores
  const [storesLoading, setStoresLoading] = useState(true);

  const [results, setResults] = useState(null); // null = not searched yet
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);

  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const suggestTimer = useRef(null);
  const inputRef = useRef(null);
  const suggestRef = useRef(null);

  // ── Load stores from API ──────────────────────────────────────────────────
  useEffect(() => {
    api.get('/stores')
      .then(r => setStores(r.data.stores || []))
      .catch(() => setStores([]))  // on error: empty list, no fake fallback
      .finally(() => setStoresLoading(false));
  }, []);

  // ── Autocomplete ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (searchMode !== 'keyword' || query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    clearTimeout(suggestTimer.current);
    suggestTimer.current = setTimeout(async () => {
      setSuggestLoading(true);
      try {
        const r = await api.get('/search/suggestions', { params: { q: query } });
        setSuggestions(r.data.suggestions || []);
        setShowSuggestions(true);
      } catch {
        setSuggestions([]);
      } finally {
        setSuggestLoading(false);
      }
    }, 300);
    return () => clearTimeout(suggestTimer.current);
  }, [query, searchMode]);

  // Close suggestions on outside click
  useEffect(() => {
    function handleClick(e) {
      if (suggestRef.current && !suggestRef.current.contains(e.target) &&
          inputRef.current && !inputRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // ── Search ────────────────────────────────────────────────────────────────
  async function handleSearch(e, overrides = {}) {
    e?.preventDefault();
    const term = overrides.query !== undefined ? overrides.query : query;
    const mode = overrides.mode || searchMode;
    const f = { ...filters, ...overrides.filters };

    setShowSuggestions(false);

    if (mode === 'upc') {
      if (!term.trim()) return;
      setLoading(true);
      setError('');
      try {
        const r = await api.get(`/search/upc/${encodeURIComponent(term.trim())}`);
        const deals = r.data.all_deals || (r.data.product ? [r.data.product] : []);
        setResults(deals);
        setTotal(deals.length);
      } catch (err) {
        if (err.response?.status === 404) {
          setResults([]);
          setTotal(0);
        } else {
          setError('Error searching UPC. Check your connection.');
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    // keyword / store / category mode
    const hasSearchTerm = term.trim() || f.store || f.category;
    if (!hasSearchTerm) return;

    setLoading(true);
    setError('');
    try {
      const params = { limit: 40 };
      if (term.trim()) params.q = term.trim();
      if (f.store) params.store = f.store;
      if (f.category) params.category = f.category;
      if (f.min_discount > 0) params.min_discount = f.min_discount;

      const r = await api.get('/search', { params });
      setResults(r.data.results || []);
      setTotal(r.data.count || 0);
    } catch (err) {
      if (err.response?.status === 400) {
        setError('Enter a search term, store, or category.');
      } else {
        setError('Search error. Check your connection.');
      }
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function handleSuggestionClick(s) {
    setQuery(s.name);
    setShowSuggestions(false);
    handleSearch(null, { query: s.name });
  }

  function handleQuickStore(store) {
    setFilters(f => ({ ...f, store }));
    setQuery('');
    setResults(null);
    handleSearch(null, { query: '', filters: { store, category: '', min_discount: 0 } });
  }

  function handleQuickCategory(category) {
    setFilters(f => ({ ...f, category }));
    setQuery('');
    setResults(null);
    handleSearch(null, { query: '', filters: { store: '', category, min_discount: 0 } });
  }

  function clearSearch() {
    setQuery('');
    setResults(null);
    setError('');
    setSuggestions([]);
    setFilters({ store: '', category: '', min_discount: 0 });
  }

  const activeFiltersCount = [filters.store, filters.category, filters.min_discount > 0].filter(Boolean).length;

  return (
    <div className="p-4 lg:p-6 space-y-5 animate-fade-in">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-black mb-1 text-white">Search Deals</h1>
        <p className="text-gray-400 text-sm">Search by name, brand, store, category, UPC or SKU</p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2">
        {[
          { id: 'keyword', label: 'Keyword' },
          { id: 'upc', label: 'UPC / SKU' },
        ].map(m => (
          <button
            key={m.id}
            onClick={() => { setSearchMode(m.id); setResults(null); setError(''); }}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              searchMode === m.id
                ? 'bg-neon-green/15 text-neon-green border border-neon-green/30'
                : 'bg-dark-700 text-gray-400 hover:text-white border border-dark-600'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Search form */}
      <div className="space-y-3">
        <form onSubmit={handleSearch} className="relative">
          <div className="relative">
            <SearchIcon size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              onKeyDown={e => e.key === 'Escape' && setShowSuggestions(false)}
              placeholder={
                searchMode === 'upc'
                  ? 'Enter UPC or SKU (e.g. gs-344870, 6620073)'
                  : 'Search product name, brand… (e.g. Samsung, Post-it, Sony)'
              }
              className="w-full bg-dark-700 border border-dark-600 rounded-2xl pl-12 pr-32 py-4 text-white placeholder-gray-500 focus:outline-none focus:border-neon-green/50 text-base transition-all"
              autoComplete="off"
            />
            {query && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-24 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
              >
                <X size={16} />
              </button>
            )}
            <button
              type="submit"
              disabled={loading}
              className="absolute right-3 top-1/2 -translate-y-1/2 btn-primary py-2 px-5 text-sm"
            >
              {loading ? <Loader size={16} className="animate-spin" /> : 'Search'}
            </button>
          </div>

          {/* Autocomplete dropdown */}
          {showSuggestions && (suggestions.length > 0 || suggestLoading) && (
            <div
              ref={suggestRef}
              className="absolute top-full left-0 right-0 mt-1 bg-dark-800 border border-dark-600 rounded-xl shadow-xl z-20 overflow-hidden"
            >
              {suggestLoading ? (
                <div className="px-4 py-3 text-gray-400 text-sm flex items-center gap-2">
                  <Loader size={13} className="animate-spin" /> Searching…
                </div>
              ) : (
                suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onMouseDown={() => handleSuggestionClick(s)}
                    className="w-full text-left px-4 py-2.5 hover:bg-dark-700 flex items-center gap-3 border-b border-dark-700 last:border-0"
                  >
                    <SearchIcon size={13} className="text-gray-500 flex-shrink-0" />
                    <div>
                      <p className="text-white text-sm">{s.name}</p>
                      {s.brand && <p className="text-gray-400 text-xs">{s.brand}</p>}
                    </div>
                    {s.store_slug && (
                      <span className="ml-auto text-xs text-gray-500">{s.store_slug}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </form>

        {/* Filters row */}
        {searchMode === 'keyword' && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs border transition-all ${
                showFilters || activeFiltersCount > 0
                  ? 'bg-neon-green/10 text-neon-green border-neon-green/30'
                  : 'text-gray-400 border-dark-600 hover:text-white hover:border-dark-500'
              }`}
            >
              <SlidersHorizontal size={13} />
              Filters {activeFiltersCount > 0 && `(${activeFiltersCount})`}
            </button>

            {/* Active filter chips */}
            {filters.store && (
              <span className="flex items-center gap-1 px-2.5 py-1 bg-neon-blue/10 text-neon-blue border border-neon-blue/20 rounded-xl text-xs">
                <Store size={11} /> {filters.store}
                <button onClick={() => setFilters(f => ({ ...f, store: '' }))} className="ml-1 hover:text-white"><X size={10} /></button>
              </span>
            )}
            {filters.category && (
              <span className="flex items-center gap-1 px-2.5 py-1 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-xl text-xs">
                <Tag size={11} /> {filters.category}
                <button onClick={() => setFilters(f => ({ ...f, category: '' }))} className="ml-1 hover:text-white"><X size={10} /></button>
              </span>
            )}
            {filters.min_discount > 0 && (
              <span className="flex items-center gap-1 px-2.5 py-1 bg-red-500/10 text-red-400 border border-red-500/20 rounded-xl text-xs">
                -{filters.min_discount}%+ off
                <button onClick={() => setFilters(f => ({ ...f, min_discount: 0 }))} className="ml-1 hover:text-white"><X size={10} /></button>
              </span>
            )}
          </div>
        )}

        {/* Filters panel */}
        {showFilters && searchMode === 'keyword' && (
          <div className="bg-dark-800 border border-dark-700 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-gray-400 text-xs mb-1.5 block">Store</label>
              <select
                value={filters.store}
                onChange={e => setFilters(f => ({ ...f, store: e.target.value }))}
                disabled={storesLoading}
                className="w-full bg-dark-900 border border-dark-700 text-white text-sm rounded-xl px-3 py-2 disabled:opacity-50"
              >
                <option value="">{storesLoading ? 'Loading…' : 'All stores'}</option>
                {stores.map(s => (
                  <option key={s.slug} value={s.slug}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-gray-400 text-xs mb-1.5 block">Category</label>
              <select
                value={filters.category}
                onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
                className="w-full bg-dark-900 border border-dark-700 text-white text-sm rounded-xl px-3 py-2"
              >
                <option value="">All categories</option>
                <option value="electronics">Electronics</option>
                <option value="appliances">Appliances</option>
                <option value="clothing">Clothing & Accessories</option>
                <option value="handbags">Handbags & Accessories</option>
                <option value="jewelry">Jewelry</option>
              </select>
            </div>
            <div>
              <label className="text-gray-400 text-xs mb-1.5 flex justify-between">
                <span>Min Discount</span>
                <span className="text-white font-medium">{filters.min_discount > 0 ? `${filters.min_discount}%+` : 'Any'}</span>
              </label>
              <input
                type="range" min={0} max={80} step={5} value={filters.min_discount}
                onChange={e => setFilters(f => ({ ...f, min_discount: parseInt(e.target.value) }))}
                className="w-full accent-neon-green h-1.5 mt-2"
              />
            </div>
          </div>
        )}
      </div>

      {/* Quick chips — only before first search */}
      {results === null && !error && (
        <div className="space-y-3">
          {stores.length > 0 && (
            <div>
              <p className="text-gray-500 text-xs uppercase tracking-wider font-mono mb-2">Browse by store</p>
              <div className="flex flex-wrap gap-2">
                {stores
                  .filter(s => parseInt(s.active_deals) > 0)
                  .map(s => (
                    <button
                      key={s.slug}
                      onClick={() => handleQuickStore(s.slug)}
                      className="px-3 py-1.5 bg-dark-700 hover:bg-dark-600 border border-dark-600 hover:border-neon-blue/30 rounded-xl text-sm text-gray-400 hover:text-white transition-all flex items-center gap-1.5"
                    >
                      <Store size={12} className="text-neon-blue" /> {s.name}
                    </button>
                  ))
                }
              </div>
            </div>
          )}
          <div>
            <p className="text-gray-500 text-xs uppercase tracking-wider font-mono mb-2">Browse by category</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_CATS.map(({ label, category }) => (
                <button
                  key={category}
                  onClick={() => handleQuickCategory(category)}
                  className="px-3 py-1.5 bg-dark-700 hover:bg-dark-600 border border-dark-600 hover:border-purple-500/30 rounded-xl text-sm text-gray-400 hover:text-white transition-all flex items-center gap-1.5"
                >
                  <Tag size={12} className="text-purple-400" /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="py-4 px-5 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card animate-pulse h-48 bg-dark-700" />
          ))}
        </div>
      )}

      {/* Results */}
      {!loading && results !== null && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-gray-400 text-sm">
              <span className="text-white font-bold">{results.length}</span> result{results.length !== 1 ? 's' : ''}
              {(filters.store || filters.category) && (
                <span className="text-gray-500">
                  {filters.store && ` · ${filters.store}`}
                  {filters.category && ` · ${filters.category}`}
                </span>
              )}
            </p>
            {results.length > 0 && (
              <button onClick={clearSearch} className="text-xs text-gray-400 hover:text-white flex items-center gap-1">
                <X size={12} /> Clear
              </button>
            )}
          </div>

          {results.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {results.map((deal, i) => (
                <DealCard key={deal.id || i} deal={deal} />
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <p className="text-4xl mb-4">🔍</p>
              <p className="text-gray-300 font-semibold">No results found</p>
              <p className="text-gray-500 text-sm mt-1">
                Try a different term, check spelling, or browse by store
              </p>
              <button onClick={clearSearch} className="btn-ghost text-sm mt-4 px-4 py-2">
                Clear search
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
