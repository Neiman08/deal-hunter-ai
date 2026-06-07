/**
 * ScannerDebug — consola de diagnóstico para los 3 scrapers
 * Walmart · Home Depot · Best Buy
 */
import { useState } from 'react';
import {
  Terminal, Search, CheckCircle, XCircle, AlertTriangle,
  ChevronDown, ChevronRight, Clock, ExternalLink, Key, Zap,
  Package, Tag, ShoppingBag,
} from 'lucide-react';
import api from '../utils/api';

// ─── Configuración por tienda ─────────────────────────────────────────────────
const STORES = [
  {
    id:          'walmart',
    label:       '🛒 Walmart',
    inputLabel:  'UPC',
    placeholder: 'Ej: 885911416443',
    endpoint:    (id) => `/scan/walmart/${id}`,
    color:       '#0071CE',
    examples: [
      { label: 'DeWalt Drill',  value: '885911416443' },
      { label: 'Dyson V11',     value: '885609012023' },
      { label: 'Milwaukee Kit', value: '045242551118' },
      { label: 'iRobot Roomba', value: '885155017058' },
    ],
    apiOptions: [
      {
        id: 'affiliate_api', label: 'Walmart Affiliate API',
        cost: 'GRATIS', costColor: 'text-neon-green', limit: '5,000 req/día',
        url: 'https://developer.walmart.com', envKey: 'WALMART_API_KEY',
        recommended: true,
        steps: [
          'Ve a developer.walmart.com',
          'Crea cuenta → Programs → Affiliates',
          'Solicita API key (aprobación 24–48h)',
          'Agrega en .env: WALMART_API_KEY=xxxx',
        ],
      },
      {
        id: 'bluecart', label: 'BlueCart API',
        cost: '~$75/mes', costColor: 'text-yellow-400', limit: '50,000 req/mes',
        url: 'https://www.bluecartapi.com', envKey: 'BLUECART_API_KEY',
        recommended: false,
        steps: ['Ve a bluecartapi.com', 'Crea cuenta y suscríbete', 'Agrega en .env: BLUECART_API_KEY=xxxx'],
      },
      {
        id: 'serpapi', label: 'SerpAPI',
        cost: '~$50/mes', costColor: 'text-yellow-400', limit: '5,000 req/mes',
        url: 'https://serpapi.com/walmart-search-api', envKey: 'SERPAPI_KEY',
        recommended: false,
        steps: ['Ve a serpapi.com', 'Crea cuenta', 'Agrega en .env: SERPAPI_KEY=xxxx'],
      },
    ],
    noKeyMessage: 'Walmart bloquea IPs de servidor. Necesitas una API key.',
  },
  {
    id:          'home-depot',
    label:       '🔨 Home Depot',
    inputLabel:  'SKU / Item #',
    placeholder: 'Ej: 206874295',
    endpoint:    (id, zip) => `/scan/home-depot/${id}${zip ? `?store_id=6906` : ''}`,
    color:       '#F96302',
    examples: [
      { label: 'DeWalt Saw',     value: 'DCK240C2' },
      { label: 'Milwaukee Combo', value: '2997-22' },
      { label: 'Makita Kit',     value: 'XSS02T' },
    ],
    apiOptions: [],
    noKeyMessage: 'Home Depot usa GraphQL pública — no requiere API key. Si falla, HD cambió su estructura HTML.',
  },
  {
    id:          'best-buy',
    label:       '🟦 Best Buy',
    inputLabel:  'SKU (7 dígitos)',
    placeholder: 'Ej: 6505727',
    endpoint:    (id, zip) => `/scan/best-buy/${id}${zip ? `?zip=${zip}` : ''}`,
    color:       '#003087',
    examples: [
      { label: 'LG OLED 65"',        value: '6505727' },
      { label: 'Sony WH-1000XM5',    value: '6505727' },
      { label: 'Apple AirPods Pro',  value: '6447033' },
      { label: 'Samsung Galaxy S24', value: '6570228' },
      { label: 'iRobot Roomba i3',   value: '6397375' },
    ],
    apiOptions: [
      {
        id: 'bestbuy_api', label: 'Best Buy API',
        cost: 'GRATIS', costColor: 'text-neon-green', limit: '50,000 req/día',
        url: 'https://developer.bestbuy.com', envKey: 'BESTBUY_API_KEY',
        recommended: true,
        steps: [
          'Ve a developer.bestbuy.com',
          'Click "Get API Key"',
          'Ingresa tu email',
          'Recibes la key en SEGUNDOS (sin aprobación)',
          'Agrega en .env: BESTBUY_API_KEY=xxxx',
          '50,000 requests/día GRATIS',
        ],
      },
    ],
    noKeyMessage: 'Best Buy tiene API gratuita. Setup en 30 segundos. Sin API key, M3/M4 intentan scraping directo (puede fallar si BB cambia su estructura HTML).',
  },
];

// ─── Campos extra que muestra Best Buy ───────────────────────────────────────
const BB_EXTRA_FIELDS = [
  { key: 'discountPercent',  label: 'Descuento', format: v => `${v}%` },
  { key: 'openBoxPrice',     label: 'Open Box',  format: v => v ? `$${v}` : '—' },
  { key: 'clearance',        label: 'Clearance', format: v => v ? '🔴 Sí' : 'No' },
  { key: 'dealOfTheDay',     label: 'Deal of Day', format: v => v ? '⚡ Sí' : 'No' },
  { key: 'onlineAvailable',  label: 'Online',    format: v => v ? '✅ Sí' : '❌ No' },
  { key: 'inStoreAvailable', label: 'In Store',  format: v => v ? '✅ Sí' : '❌ No' },
  { key: 'condition',        label: 'Condición', format: v => v },
  { key: 'categoryName',     label: 'Categoría', format: v => v || '—' },
];

// ─── Componente: bloque de un método de extracción ────────────────────────────
function MethodBlock({ attempt, index }) {
  const [open, setOpen] = useState(index === 0 || attempt.success);
  const d   = attempt.diagnostics || {};
  const ok  = attempt.success;
  const skp = d.skipped;

  const icon = ok  ? <CheckCircle size={14} className="text-neon-green flex-shrink-0" />
             : skp ? <div className="w-3.5 h-3.5 rounded-full border border-dark-600 flex-shrink-0" />
                   : <XCircle    size={14} className="text-red-400 flex-shrink-0" />;

  const borderColor = ok ? 'border-neon-green/30' : skp ? 'border-dark-700' : 'border-red-500/20';

  // Campos que ya se muestran en bloques dedicados — no los repitas en el genérico
  const SKIP_KEYS = new Set(['reason','solution','error_message','error_code',
    'http_status','skipped','note','html_snippet','graphql_errors',
    'patterns_tried','steps','patterns_partially_present']);

  return (
    <div className={`border rounded-xl overflow-hidden ${borderColor}`}>
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-dark-800/40 hover:bg-dark-800 transition-colors text-left">
        {icon}
        <div className="flex-1 min-w-0">
          <span className="text-white text-sm font-semibold font-mono">{attempt.method}</span>
          {d.http_status != null && (
            <span className={`ml-2 text-xs font-mono px-1.5 py-0.5 rounded ${
              d.http_status === 200 ? 'bg-neon-green/15 text-neon-green' : 'bg-red-500/15 text-red-400'
            }`}>
              HTTP {d.http_status}
            </span>
          )}
          {skp && <span className="ml-2 text-xs text-dark-500 italic">— no configurado</span>}
          {ok  && <span className="ml-2 text-xs text-neon-green">✅ éxito</span>}
        </div>
        {open
          ? <ChevronDown  size={13} className="text-dark-600 flex-shrink-0" />
          : <ChevronRight size={13} className="text-dark-600 flex-shrink-0" />}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-2 space-y-2.5 bg-dark-900/30 text-sm">
          {ok && (
            <p className="text-neon-green font-semibold flex items-center gap-1.5 text-xs">
              <CheckCircle size={12} /> Precio obtenido correctamente
            </p>
          )}

          {d.reason && (
            <div>
              <p className="text-dark-500 text-xs mb-1 uppercase tracking-wide">Razón del fallo</p>
              <p className="text-red-300 bg-red-500/8 border border-red-500/20 rounded-lg px-3 py-2 text-xs leading-relaxed">
                {d.reason}
              </p>
            </div>
          )}

          {d.solution && (
            <div className="bg-neon-blue/8 border border-neon-blue/20 rounded-lg px-3 py-2">
              <p className="text-neon-blue text-xs leading-relaxed whitespace-pre-line">💡 {d.solution}</p>
            </div>
          )}

          {d.error_message && (
            <div>
              <p className="text-dark-500 text-xs mb-1 uppercase tracking-wide">Error técnico</p>
              <p className="text-red-400 font-mono text-xs">
                {d.error_message}{d.error_code ? ` (${d.error_code})` : ''}
              </p>
            </div>
          )}

          {d.note && (
            <p className="text-dark-400 text-xs italic">{d.note}</p>
          )}

          {d.html_snippet && (
            <div>
              <p className="text-dark-500 text-xs mb-1 uppercase tracking-wide">Primeros 300 chars del HTML</p>
              <pre className="text-xs text-dark-400 bg-dark-800 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
                {d.html_snippet}
              </pre>
            </div>
          )}

          {d.graphql_errors && (
            <div>
              <p className="text-dark-500 text-xs mb-1 uppercase tracking-wide">GraphQL errors</p>
              <pre className="text-xs text-red-300 bg-dark-800 rounded-lg p-2 overflow-x-auto">
                {JSON.stringify(d.graphql_errors, null, 2)}
              </pre>
            </div>
          )}

          {/* Campos genéricos no cubiertos arriba */}
          {Object.entries(d)
            .filter(([k]) => !SKIP_KEYS.has(k))
            .map(([k, v]) => (
              <div key={k}>
                <p className="text-dark-600 text-xs uppercase tracking-wide mb-0.5">
                  {k.replace(/_/g, ' ')}
                </p>
                <pre className="text-xs text-dark-400 bg-dark-800 rounded px-2 py-1 overflow-x-auto">
                  {typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)}
                </pre>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ─── Componente: tarjeta de opción de API ─────────────────────────────────────
function ApiOptionCard({ opt }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`border rounded-xl overflow-hidden ${
      opt.recommended
        ? 'border-neon-green/30 bg-neon-green/5'
        : 'border-dark-700 bg-dark-800/30'
    }`}>
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:opacity-90 transition-opacity">
        <Key size={14} className={opt.recommended ? 'text-neon-green' : 'text-dark-400'} />
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white text-sm font-semibold">{opt.label}</span>
            {opt.recommended && (
              <span className="text-xs bg-neon-green text-dark-900 px-1.5 py-0.5 rounded-full font-bold">
                RECOMENDADA
              </span>
            )}
          </div>
          <p className="text-dark-400 text-xs">{opt.limit}</p>
        </div>
        <span className={`text-sm font-bold ${opt.costColor}`}>{opt.cost}</span>
        {open
          ? <ChevronDown  size={13} className="text-dark-500" />
          : <ChevronRight size={13} className="text-dark-500" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div>
            <p className="text-dark-500 text-xs mb-1">Variable de entorno</p>
            <code className="text-neon-green text-xs bg-dark-800 px-2 py-1 rounded font-mono">
              {opt.envKey}=tu_api_key
            </code>
          </div>
          <ol className="space-y-1">
            {opt.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-dark-300">
                <span className="text-dark-500 flex-shrink-0">{i + 1}.</span> {s}
              </li>
            ))}
          </ol>
          <a href={opt.url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-neon-blue text-xs hover:underline">
            <ExternalLink size={11} /> {opt.url}
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function ScannerDebug() {
  const [storeId,    setStoreId]    = useState('best-buy');
  const [identifier, setIdentifier] = useState('');
  const [zipCode,    setZipCode]    = useState('');
  const [loading,    setLoading]    = useState(false);
  const [result,     setResult]     = useState(null);

  const store = STORES.find(s => s.id === storeId) || STORES[0];

  async function runTest() {
    const id = identifier.trim();
    if (!id) return;
    setLoading(true);
    setResult(null);
    try {
      const endpoint = store.endpoint(id, zipCode.trim());
      const r = await api.get(endpoint);
      setResult({ ...r.data, _httpStatus: r.status });
    } catch (err) {
      setResult({
        ...(err.response?.data || { error: err.message }),
        _httpStatus: err.response?.status || 0,
      });
    } finally {
      setLoading(false);
    }
  }

  function loadExample(val) {
    setIdentifier(val);
    setResult(null);
  }

  // ¿Todas las keys están sin configurar?
  const noKeys = result && !result.success
    && result.configured_keys
    && !Object.values(result.configured_keys).some(Boolean);

  const isBB = storeId === 'best-buy';

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-3xl mx-auto">

      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-neon-green/15 flex items-center justify-center">
          <Terminal size={18} className="text-neon-green" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Scraper Debug Console</h1>
          <p className="text-dark-400 text-sm">
            Test en tiempo real · diagnóstico completo por método
          </p>
        </div>
      </div>

      {/* ── Store selector + input ── */}
      <div className="card space-y-4">

        {/* Store tabs */}
        <div className="flex gap-1 p-1 bg-dark-700 rounded-xl w-fit flex-wrap">
          {STORES.map(s => (
            <button key={s.id}
              onClick={() => { setStoreId(s.id); setResult(null); setIdentifier(''); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                storeId === s.id
                  ? 'bg-neon-green text-dark-900'
                  : 'text-dark-300 hover:text-white'
              }`}>
              {s.label}
            </button>
          ))}
        </div>

        {/* Input row */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500 text-xs">
              {store.inputLabel}
            </span>
            <input
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runTest()}
              placeholder={store.placeholder}
              className="w-full bg-dark-800 border border-dark-700 text-white text-sm rounded-xl pl-14 pr-4 py-3 placeholder-dark-500 focus:outline-none focus:border-neon-green/50 font-mono"
            />
          </div>
          <button onClick={runTest} disabled={loading || !identifier.trim()}
            className="btn-primary flex items-center gap-2 px-5 disabled:opacity-50 flex-shrink-0">
            {loading
              ? <span className="w-4 h-4 border-2 border-dark-900 border-t-transparent rounded-full animate-spin" />
              : <Search size={15} />}
            {loading ? 'Testing...' : 'Test'}
          </button>
        </div>

        {/* ZIP opcional (para store availability) */}
        {isBB && (
          <div className="flex items-center gap-3">
            <input
              value={zipCode}
              onChange={e => setZipCode(e.target.value)}
              placeholder="ZIP code (opcional, para disponibilidad por tienda)"
              className="flex-1 bg-dark-800 border border-dark-700 text-white text-xs rounded-xl px-3 py-2 placeholder-dark-500 focus:outline-none focus:border-neon-green/40 font-mono"
            />
            <span className="text-dark-500 text-xs flex-shrink-0">?zip=xxxxx</span>
          </div>
        )}

        {/* Quick examples */}
        <div className="flex flex-wrap gap-2">
          <span className="text-dark-600 text-xs self-center">Ejemplos:</span>
          {store.examples.map(ex => (
            <button key={ex.value}
              onClick={() => loadExample(ex.value)}
              className={`text-xs px-2.5 py-1.5 rounded-lg transition-colors font-mono ${
                identifier === ex.value
                  ? 'bg-neon-green/15 text-neon-green border border-neon-green/30'
                  : 'bg-dark-700 text-dark-300 hover:text-white'
              }`}>
              {ex.label} <span className="text-dark-500">({ex.value})</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Result ── */}
      {result && (
        <div className="space-y-4 animate-fade-in">

          {/* Success card */}
          {result.success && (
            <div className="card border-neon-green/30 bg-neon-green/5 space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle size={16} className="text-neon-green" />
                <span className="text-neon-green font-bold">Producto encontrado</span>
                <span className="ml-auto text-dark-400 text-xs flex items-center gap-1.5">
                  <Clock size={11} /> {result.elapsed_ms}ms
                  <span className="text-dark-600">·</span>
                  <span className="font-mono text-dark-300">{result.method_used}</span>
                </span>
              </div>

              {/* Core fields — siempre visibles */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {[
                  { label: 'Nombre',        value: result.product?.name },
                  { label: 'Marca',         value: result.product?.brand || '—' },
                  { label: 'Precio actual', value: `$${result.product?.currentPrice}`, green: true },
                  { label: 'Precio regular',value: `$${result.product?.regularPrice}` },
                  { label: 'Online',        value: result.product?.onlineAvailable ?? result.product?.inStock ? '✅ Sí' : '❌ No' },
                  { label: 'Stock qty',     value: result.product?.stockQty ?? result.product?.quantityLimit ?? '—' },
                ].map(f => (
                  <div key={f.label} className="bg-dark-800 rounded-xl p-2.5">
                    <p className="text-dark-400 text-xs mb-0.5">{f.label}</p>
                    <p className={`text-sm font-semibold truncate ${f.green ? 'text-neon-green' : 'text-white'}`}>
                      {f.value}
                    </p>
                  </div>
                ))}
              </div>

              {/* Best Buy extra fields */}
              {isBB && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 border-t border-dark-700 pt-3">
                  {BB_EXTRA_FIELDS.map(f => {
                    const val = result.product?.[f.key];
                    if (val === undefined || val === null) return null;
                    const formatted = f.format(val);
                    const isHighlight = (f.key === 'clearance' && val)
                      || (f.key === 'dealOfTheDay' && val)
                      || (f.key === 'openBoxPrice' && val);
                    return (
                      <div key={f.key} className={`rounded-xl p-2.5 ${
                        isHighlight ? 'bg-yellow-400/10 border border-yellow-400/20' : 'bg-dark-800'
                      }`}>
                        <p className="text-dark-500 text-xs mb-0.5">{f.label}</p>
                        <p className={`text-sm font-semibold ${
                          isHighlight ? 'text-yellow-400' : 'text-white'
                        }`}>
                          {formatted}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Store availability (Best Buy) */}
              {result.store_availability?.stores?.length > 0 && (
                <div className="border-t border-dark-700 pt-3">
                  <p className="text-dark-400 text-xs uppercase tracking-wider mb-2">
                    Disponibilidad por tienda ({result.store_availability.stores.length})
                  </p>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {result.store_availability.stores.map(s => (
                      <div key={s.storeId}
                        className="flex items-center justify-between px-3 py-2 bg-dark-800 rounded-xl text-xs">
                        <div>
                          <span className="text-white font-medium">{s.name}</span>
                          <span className="text-dark-400 ml-2">{s.city}, {s.state}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {s.distance != null && (
                            <span className="text-dark-400">{s.distance.toFixed(1)} mi</span>
                          )}
                          <span className={s.inStock ? 'text-neon-green font-semibold' : 'text-dark-500'}>
                            {s.inStock ? `✅ ${s.quantityOnHand > 0 ? s.quantityOnHand + ' units' : 'In stock'}` : '❌ Out'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.product?.productUrl && (
                <a href={result.product.productUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-neon-blue text-xs hover:underline">
                  <ExternalLink size={11} /> Ver en {store.label.replace(/^[^\s]+\s/, '')}
                </a>
              )}
            </div>
          )}

          {/* Failure card */}
          {!result.success && (
            <div className="card border-red-500/20 bg-red-500/5">
              <div className="flex items-center gap-2 mb-2">
                <XCircle size={16} className="text-red-400" />
                <span className="text-red-400 font-bold">Todos los métodos fallaron</span>
                {result.elapsed_ms && (
                  <span className="ml-auto text-dark-400 text-xs">{result.elapsed_ms}ms</span>
                )}
              </div>
              <p className="text-dark-300 text-sm">
                {result.error
                  || result.diagnostics?.reason
                  || 'No se pudo obtener precio con ninguno de los métodos disponibles.'}
              </p>
            </div>
          )}

          {/* Method attempts */}
          {result.attempts?.length > 0 && (
            <div className="space-y-2">
              <p className="text-dark-500 text-xs uppercase tracking-wider">
                Diagnóstico por método ({result.attempts.length})
              </p>
              {result.attempts.map((a, i) => (
                <MethodBlock key={i} attempt={a} index={i} />
              ))}
            </div>
          )}

          {/* Sin API keys → mostrar opciones de la tienda */}
          {noKeys && store.apiOptions.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-yellow-400">
                <Key size={16} />
                <p className="font-semibold text-sm">Sin API keys — opciones disponibles:</p>
              </div>
              {store.apiOptions.map(opt => (
                <ApiOptionCard key={opt.id} opt={opt} />
              ))}
            </div>
          )}

          {/* Next steps */}
          {result.next_steps?.length > 0 && !noKeys && (
            <div className="card border-neon-blue/20 bg-neon-blue/5">
              <p className="text-neon-blue font-semibold text-sm mb-2 flex items-center gap-2">
                <Zap size={14} /> Próximos pasos
              </p>
              <ul className="space-y-1">
                {result.next_steps.map((s, i) =>
                  s
                    ? <li key={i} className="text-dark-300 text-xs">{s}</li>
                    : <li key={i} className="h-1.5" />
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── Info panel cuando no hay resultado ── */}
      {!result && (
        <div className="space-y-4">
          {/* Aviso de tienda */}
          <div className={`rounded-xl border px-4 py-3 text-xs leading-relaxed ${
            isBB
              ? 'border-neon-green/20 bg-neon-green/5 text-neon-green'
              : storeId === 'home-depot'
              ? 'border-neon-blue/20 bg-neon-blue/5 text-neon-blue'
              : 'border-yellow-500/20 bg-yellow-500/5 text-yellow-400'
          }`}>
            <p className="font-semibold mb-1">
              {isBB
                ? '🟦 Best Buy — Primera tienda 100% funcional'
                : storeId === 'home-depot'
                ? '🔨 Home Depot — API GraphQL pública'
                : '🛒 Walmart — Requiere API key'}
            </p>
            <p className="text-current opacity-80">{store.noKeyMessage}</p>
          </div>

          {/* API options */}
          {store.apiOptions.length > 0 && (
            <div className="space-y-3">
              <p className="text-dark-400 text-xs font-medium flex items-center gap-2">
                <Key size={12} /> Opciones de API para {store.label}
              </p>
              {store.apiOptions.map(opt => (
                <ApiOptionCard key={opt.id} opt={opt} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
