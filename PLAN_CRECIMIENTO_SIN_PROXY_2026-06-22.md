# Plan de Crecimiento Sin BrightData — 2026-06-22

## Hallazgos Clave

### Estado actual de imágenes por tienda

| Tienda | Productos | Con imagen | Sin imagen | Estado |
|--------|-----------|-----------|-----------|--------|
| Office Depot | 6,698 | 6,476 (97%) | 222 | OK |
| Best Buy | 604 | **0 (0%)** | **604** | CRÍTICO |
| Macy's | 297 | 295 (99%) | 2 | OK |
| GameStop | 225 | 225 (100%) | 0 | OK |
| Staples | 40 | 40 (100%) | 0 | OK |
| Target | 22 | 0 (0%) | 22 | pausado |

### Estado de proxy por tienda

| Tienda | Método de discovery | Proxy requerido | Tipo de proxy |
|--------|---------------------|----------------|--------------|
| Office Depot | HTTP + sitemaps | Sí (HTTP) | ISP/residential vía `buildHttpProxyAgent` |
| Best Buy | Playwright | Sí (browser) | ISP proxy |
| Macy's discovery | Playwright | Sí (browser) | Residential — Akamai bloquea igual |
| Macy's scan job | Playwright + fetch en página | Sí (browser) | Residential |
| GameStop | Playwright | Sí (browser) | Residential o ISP según `PROXY_ENABLED` |
| Staples | Playwright | Sí (browser) | ISP proxy |
| Target/Walmart/HD | Playwright | Sí (browser) | Varios |

**Conclusión central:** Ningún store tiene un path 100% proxy-free hoy. La excepción potencial es Best Buy imágenes via API pública.

---

## Acciones Seguras (Costo Proxy = $0)

### ACCIÓN 1: Recuperar 313 imágenes de Best Buy via API pública

**Contexto:**
- 604 productos de BB, 0 tienen `image_url` (la columna `image_url` está en `products`, no en `deals`)
- 313 tienen `bestbuy_sku` numérico (e.g. 6588349, 6673095, 6646691)
- 291 no tienen `bestbuy_sku` y sus `product_url` tampoco contienen `/sku/NUMBER`
- El fix de `bestBuyDiscovery.js` (commit a8657d21) recuperará imágenes en el próximo ciclo de discovery, pero solo para productos que sean re-descubiertos

**Solución: BB Public REST API (developer.bestbuy.com)**

- Es una API JSON estándar, NO usa Akamai, NO requiere browser
- Requiere una API key gratuita (registro en developer.bestbuy.com)
- Rate limit: 5 requests/segundo, 50,000/día en tier gratuito
- Endpoint: `GET https://api.bestbuy.com/v1/products/{sku}.json?apiKey=KEY&show=sku,name,image`
- 313 productos × 1 call = 313 requests = $0, ~63 segundos a 5 req/s

**Script a crear:** `backend/scripts/backfill-bb-images.js`

```js
// Pseudocódigo del plan
const skus = await query(`
  SELECT bestbuy_sku FROM products p
  JOIN stores s ON p.store_id = s.id
  WHERE s.slug = 'best-buy' AND p.bestbuy_sku IS NOT NULL AND p.image_url IS NULL
`);

for (const { bestbuy_sku } of skus) {
  const res = await fetch(
    `https://api.bestbuy.com/v1/products/${bestbuy_sku}.json?apiKey=${KEY}&show=sku,name,image`
  );
  const { image } = await res.json();
  if (image) {
    await query(`UPDATE products SET image_url = $1 WHERE bestbuy_sku = $2`, [image, bestbuy_sku]);
  }
}
```

**Pasos:**
1. Registrar en developer.bestbuy.com → obtener API key gratuita
2. Agregar `BESTBUY_API_KEY=...` a `.env`
3. Crear y correr `scripts/backfill-bb-images.js` (script one-shot)
4. Verificar con `SELECT COUNT(*) FROM products WHERE store_id = ... AND image_url IS NOT NULL`

**Para los 291 sin bestbuy_sku:** esperar al próximo ciclo de discovery con el fix de imágenes activo. Cuando se re-descubran, ahora sí se capturará la imagen.

---

### ACCIÓN 2: Verificar que el fix de imágenes de BB aplica a productos existentes

El fix en `bestBuyDiscovery.js` mejora la extracción de imágenes en nuevas ejecuciones.
El upsert de discovery actualiza productos existentes solo si los re-descubre.

**Verificar:** ¿El upsert de `bestBuyDiscovery.js` actualiza `image_url` en productos ya existentes, o solo crea nuevos?

Si no actualiza existentes → agregar `image_url` al campo UPDATE del upsert.

Buscar en `bestBuyDiscovery.js`:
```js
// La cláusula ON CONFLICT ... DO UPDATE debería incluir image_url
// Si dice: SET name = EXCLUDED.name, deal_price = ...
// Verificar que image_url = EXCLUDED.image_url esté en la lista
```

---

### ACCIÓN 3: Auditar 222 imágenes faltantes de Office Depot

OD tiene 222 productos sin `image_url`. Son probablemente:
- Productos descontinuados (URLs 404)
- Productos donde el parser falló en extraer la imagen del `SKUPAGE_INITIAL_STATE`

**Acción:** Query para identificarlos + verificar si sus `product_url` siguen activos.
Costo proxy: 0 (solo DB query para identificar, HTTP fetch para verificar).

---

### ACCIÓN 4: Scoring de calidad — más Hot/Warm sin agregar datos

El dashboard actual muestra 97.8% "Regular". El filtro `discount_percent >= 20` ya está aplicado a las métricas (commit a8657d21), pero el `opportunity_tier` en DB sigue siendo "Regular" para casi todo.

**Acciones seguras (no requieren proxy):**
- Revisar la lógica de `opportunity_score` en `scraperBase.js` — ¿tiene pesos demasiado restrictivos?
- Aumentar `opportunity_tier = 'Warm'` para productos con `discount_percent >= 30` aunque `estimated_profit` sea bajo
- No requiere scraping nuevo — es reclasificación de datos existentes

---

## Acciones con Proxy Mínimo (Bajo Costo)

### ACCIÓN 5: Best Buy Discovery — siguiente ciclo con PROXY_KILL_SWITCH=false

Cuando se decida reactivar proxy:
- El fix de imágenes (commit a8657d21) ya está en código → primeros productos re-descubiertos tendrán imagen
- BB usa ISP proxy (más barato que residential)
- 1 ciclo de BB discovery ≈ 15-20 proxy requests estimados

**No hacer hasta que:**
- Se tenga BB_API_KEY configurado (ACCIÓN 1 completada)
- Se confirme que el upsert actualiza `image_url` en existentes (ACCIÓN 2)

### ACCIÓN 6: Office Depot — ya funciona, expandir categorías

OD usa HTTP proxy + sitemaps. Es el método más eficiente disponible.
Ya tiene 6,698 productos. Puede expandir pero genera mucho volumen de deals "Regular".

**Recomendación:** No expandir hasta que el scoring de calidad esté afinado (ACCIÓN 4).

---

## Lo que NO tiene path proxy-free

| Tienda | Razón | Recomendación |
|--------|-------|---------------|
| **Macy's discovery** | Akamai bloquea incluso con residential proxy + stealth browser | Pausado indefinidamente. Estrategia futura: HTTP-only con Macy's JSON API si existe |
| **Macy's scan job** | Requiere browser para hacer fetch() desde dentro de página | Pausar en ACTIVE_STORES hasta diseñar alternativa |
| **GameStop discovery** | Browser + proxy (residential o ISP) | Tiene 225 productos con imágenes. Pausado. Puede activar con proxy presupuestado |
| **Staples discovery** | Browser + ISP proxy | 40 productos, todos con imagen. Pausado. Bajo ROI activar |
| **Target** | Browser + proxy | 22 productos sin imagen. Bajo ROI |

---

## Prioridades Recomendadas

```
SEMANA 1 (costo $0):
  ✅ Completado: fix imágenes BB en bestBuyDiscovery.js
  ✅ Completado: filtro discount_percent >= 20 en métricas
  📋 ACCIÓN 1: Registrar BB API key + backfill 313 imágenes
  📋 ACCIÓN 2: Verificar que upsert de BB actualiza image_url
  📋 ACCIÓN 4: Revisar lógica de opportunity_score

SEMANA 2 (costo mínimo, solo si se aprueba proxy):
  📋 ACCIÓN 5: 1 ciclo BB discovery con PROXY_KILL_SWITCH=false
  📋 Verificar imágenes recuperadas

BLOQUEADOS (sin solución clara):
  ❌ Macy's discovery — Akamai sin solución
  ❌ GameStop sin proxy — no tiene JSON endpoint accesible
  ❌ Staples sin proxy — no tiene JSON endpoint accesible
```

---

## Riesgos

1. **BB API key**: La API gratuita de BestBuy developer portal puede tardar horas en ser aprobada o podría estar deprecada. Verificar estado del portal primero.
2. **BB CDN URL format**: La API devuelve URLs del tipo `c4.neweggimages.com` o similar — verificar que son URLs de BB directamente accesibles (sin proxy).
3. **OD 222 faltantes**: Pueden ser productos eliminados de OD. Correr cleanup para marcar `is_active = false` los que tienen 404.
4. **Scoring**: Cambios en `opportunity_tier` afectan el dashboard inmediatamente. Hacer en staging o con query manual antes de modificar código.

---

## Estado del sistema al momento de este plan

- `PROXY_KILL_SWITCH=true` — activo, ningún proxy spending posible
- `PAUSED_STORES` = macys, target, walmart (en código, defaulting)
- Discovery ciclos: activos cada 30 min para BB, OD, GameStop, Staples (pero todos pausados o con kill switch)
- ScanJob: activo pero kill switch lo bloquea completamente
- DB: 7,888 productos totales, 604 BB sin imagen
