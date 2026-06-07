import React, { useState, useCallback } from 'react';
import { Search as SearchIcon, X, Loader, SlidersHorizontal } from 'lucide-react';
import api from '../utils/api';
import DealCard from '../components/DealCard';

export default function Search() {
  const [query, setQuery] = useState('');
  const [upc, setUpc] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchMode, setSearchMode] = useState('keyword'); // 'keyword' | 'upc'

  async function handleSearch(e) {
    e?.preventDefault();
    const searchTerm = searchMode === 'upc' ? upc : query;
    if (!searchTerm.trim()) return;

    setLoading(true);
    setError('');

    try {
      let res;
      if (searchMode === 'upc') {
        res = await api.get(`/search/upc/${upc.trim()}`);
        setResults([res.data.product]);
      } else {
        res = await api.get('/search', { params: { q: query.trim() } });
        setResults(res.data.results);
      }
    } catch (err) {
      if (err.response?.status === 404) {
        setError('No products found for that search term.');
        setResults([]);
      } else {
        setError('Search error. Please check your connection.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black mb-1">Search Deals</h1>
        <p style={{ color: '#CBD5E1' }} className="text-sm">Search by name, SKU, UPC or category</p>
      </div>

      {/* Search modes */}
      <div className="flex gap-2">
        {[
          { id: 'keyword', label: '🔍 By name' },
          { id: 'upc', label: '📦 By UPC/SKU' },
        ].map(mode => (
          <button
            key={mode.id}
            onClick={() => setSearchMode(mode.id)}
            style={searchMode !== mode.id ? { color: '#CBD5E1' } : {}}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              searchMode === mode.id
                ? 'bg-neon-green/15 text-neon-green border border-neon-green/30'
                : 'bg-dark-500 hover:text-white border border-transparent'
            }`}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {/* Search form */}
      <form onSubmit={handleSearch} className="relative">
        <div className="relative">
          <SearchIcon
            size={20}
            className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: '#94A3B8' }}
          />
          <input
            type="text"
            value={searchMode === 'upc' ? upc : query}
            onChange={e => searchMode === 'upc' ? setUpc(e.target.value) : setQuery(e.target.value)}
            placeholder={
              searchMode === 'upc'
                ? 'Enter UPC or SKU (e.g. 047871190219)'
                : 'Search product (e.g. DeWalt drill, iPad, 65" TV...)'
            }
            className="w-full bg-dark-600 border border-dark-300 rounded-2xl pl-12 pr-32 py-4 text-white focus:outline-none focus:border-neon-green/50 text-lg transition-all"
          />
          {(query || upc) && (
            <button
              type="button"
              onClick={() => { setQuery(''); setUpc(''); setResults(null); }}
              className="absolute right-24 top-1/2 -translate-y-1/2 hover:text-white" style={{ color: '#94A3B8' }}
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
      </form>

      {/* Quick searches */}
      {!results && (
        <div>
          <p className="text-xs mb-3 font-mono uppercase tracking-wider" style={{ color: '#94A3B8' }}>Popular searches</p>
          <div className="flex flex-wrap gap-2">
            {['DeWalt', 'iPhone', 'iPad', 'Samsung TV', 'PlayStation', 'Milwaukee', 'Dyson', 'Roomba'].map(term => (
              <button
                key={term}
                onClick={() => { setQuery(term); setSearchMode('keyword'); }}
                className="px-3 py-1.5 bg-dark-600 hover:bg-dark-500 border border-dark-300 hover:border-neon-green/30 rounded-xl text-sm hover:text-white transition-all" style={{ color: '#CBD5E1' }}
              >
                {term}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="py-4 px-5 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Results */}
      {results !== null && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold">
              {results.length} result{results.length !== 1 ? 's' : ''}
            </h2>
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
              <p className="font-semibold" style={{ color: '#CBD5E1' }}>No results</p>
              <p className="text-sm mt-1" style={{ color: '#94A3B8' }}>
                Try a different term or check the UPC
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
