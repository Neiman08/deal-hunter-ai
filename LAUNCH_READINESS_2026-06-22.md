# Deal Hunter AI — Launch Readiness Report
**Fecha:** 2026-06-22 | **Auditor:** Claude Code | **Alcance:** Sistema completo

---

## Score General: 38 / 100 — NO LISTO PARA PRODUCCIÓN

```
┌─────────────────────────────────┬───────┬──────────────────────────────────┐
│ Módulo                          │ Score │ Estado                           │
├─────────────────────────────────┼───────┼──────────────────────────────────┤
│ Autenticación & Seguridad       │  8/10 │ ✅ Sólido                        │
│ Base de datos (esquema/índices) │  7/10 │ ✅ Bien estructurado             │
│ Backend API                     │  6/10 │ ⚠️  Incompleto (Stripe/email)    │
│ Frontend / UX                   │  5/10 │ ⚠️  Scope excesivo, BB sin imgs  │
│ Discovery engine                │  5/10 │ ⚠️  Solo OD funciona sin proxy   │
│ Infraestructura / Deploy        │  5/10 │ ⚠️  .env es development local    │
│ Calidad de datos / Deals        │  4/10 │ ❌ 97.8% Regular, fraude Macy's  │
│ Freshness de datos              │  3/10 │ ❌ 0 deals actualizados hoy (BB) │
│ Alertas & Notificaciones        │  2/10 │ ❌ Sin SMTP/Twilio, no scheduled │
│ Monetización                    │  2/10 │ ❌ Stripe sin configurar         │
│ Comunidad / Social              │  1/10 │ ❌ 0 actividad real              │
│ Usuarios reales                 │  0/10 │ ❌ 0 clientes, 14 cuentas demo   │
└─────────────────────────────────┴───────┴──────────────────────────────────┘
```

---

## 🔴 BLOQUEADORES CRÍTICOS (impiden lanzar)

### C-1: Macy's marketplace — fraude de precios visible al usuario

**Severidad:** DESTRUCTOR DE CONFIANZA

Los "Elite Deals" de Macy's son vendedores de Marketplace que inflan el precio original para mostrar descuentos falsos:

| Producto | Precio venta | Precio "original" | Descuento | Tier mostrado |
|---------|-------------|------------------|-----------|---------------|
| Laundry Organizer (2 estantes) | $66.61 | $832.59 | 92% | Elite Deal |
| Power Recliner Chair | $422.60 | $4,225.99 | 90% | Elite Deal |
| Office Chair | $228.80 | $2,287.99 | 90% | Elite Deal |
| Dining Table | $277.40 | $2,773.99 | 90% | Elite Deal |

Datos reales:
- 28/212 deals tienen `regular_price > 5× deal_price` (extremo)
- 89/212 tienen `regular_price > 2× deal_price`
- Avg descuento Macy's: 51.5% → irreal para el sector

**Un usuario que compre un "organizador de lavandería a $66 con 92% de descuento" para revender a $800 perderá dinero y nunca volverá a la plataforma.**

Acción inmediata requerida: filtrar deals donde `regular_price > deal_price * 4` o marcarlos con flag de advertencia. Considerar excluir Macy's Marketplace de los resultados por defecto.

---

### C-2: Monetización no configurada (Stripe sin llaves)

El código de Stripe está completo (`routes/subscriptions.js`, webhook, checkout, planes definidos). Pero en `.env` no existe ninguna de estas variables:
- `STRIPE_SECRET_KEY` — ausente
- `STRIPE_PRO_PRICE_ID` — ausente
- `STRIPE_ELITE_PRICE_ID` — ausente

**Estado actual:** Al intentar upgrade, el código entra al bloque `demo: true` y simula el pago sin cobrar nada. Cualquier usuario que haga click en "Upgrade to Pro" recibe el upgrade gratis.

Ingresos actuales: **$0**. Ingresos potenciales si se lanza sin arreglar esto: también **$0**, aunque miles de usuarios upgraden.

---

### C-3: Notificaciones completamente mudas

El alert engine (`alertEngine.js`) está bien construido pero:
1. **No está en ningún cron/setInterval** en `index.js`. Nunca se ejecuta.
2. **Sin SMTP**: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` ausentes en `.env`
3. **Sin Twilio**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` ausentes

Si un usuario crea una alerta de "laptop con 40% descuento", jamás recibirá una notificación aunque el deal exista. La función principal del producto (alertas) está silenciada.

---

### C-4: Cero usuarios reales

```
Total users: 16
  demo@dealhunter.ai     → plan pro  (fake)
  admin@dealhunter.ai    → plan elite (tú)
  marcus.webb@demo.dh    → free (fake)
  [11 más @demo.dh]      → free (fake)
  test_1781...@example   → free (testing)
  test_1782...@example   → free (testing)

Favoritos guardados: 0
Watchlist items:     0
Alertas creadas:     0
Deal posts:          0
```

Sin un solo usuario real que haya encontrado valor en el producto, lanzar es premature. No es un fallo técnico — es el riesgo de negocio número uno.

---

## 🟠 RIESGOS ALTOS (degradan severamente la experiencia)

### H-1: Best Buy — 0 imágenes en 604 productos

```
Best Buy: 604 productos activos, image_url = NULL en 604/604 (0%)
```

La interfaz muestra el fallback "no image" para **todos** los productos de Best Buy. En un producto de deals, la imagen es lo primero que el usuario ve. Best Buy es la segunda tienda más importante (604 productos, 24.3% descuento promedio, 33 deals no-Regular).

Fix disponible: registrar `BESTBUY_API_KEY` gratuita en `developer.bestbuy.com` y ejecutar `scripts/bb-api-discovery.js --backfill --save`. Costo $0.

---

### H-2: Calidad de datos — 97.8% son "Regular" (no hay deals reales)

```
opportunity_tier  | count | avg_discount | avg_profit
------------------+-------+--------------+-----------
Regular           | 5,533 |    6.0%      |   -$87
Good Deal         |    68 |   54.4%      |  $108
Excellent Deal    |    27 |   74.8%      |  $134
Elite Deal        |    27 |   85.5%      | $1,237 (inflados Macy's)
```

El problema principal es Office Depot: 4,567 deals con descuento promedio de 1.6%, todos categorizados como Regular. Son tóner, bolígrafos y material de oficina sin descuento que llenan la pantalla.

La UI ya filtra por `min_discount=20%` por defecto, pero el chart de stats sigue usando esos datos y muestra métricas confusas.

---

### H-3: Freshness crítica — datos estancados

```
Office Depot: último update 2026-06-19 (hace 3 días)
GameStop:     último update 2026-06-18 (hace 4 días)
Best Buy:     último update 2026-06-21 (hace 1 día)
Target:       último update 2026-06-17 (hace 5 días)
Macy's:       ✅ actualizado hoy (discovery activo)
```

Los price_changes en DB son solo 16 en total. El ScanJob que debería actualizar precios está bloqueado por `PROXY_KILL_SWITCH=true`. Los deals muestran precios que pueden haber cambiado hace 3-5 días.

Un usuario que vea "Sony TV $399 (50% off)" y vaya a la tienda a encontrarlo a $799 destruye la credibilidad.

---

### H-4: NODE_ENV=development en producción local

En `.env`:
```
NODE_ENV=development
```

Efectos:
- Stack traces completos en respuestas de error (expone internos)
- Rate limiting desactivado en tests (`skip: req.env === 'test'`)
- PM2 puede no aplicar optimizaciones de cluster
- Workers se comportan diferente (IS_WORKER check depende del env)

El `render.yaml` sí tiene `NODE_ENV=production` para Render, pero localmente (donde está corriendo ahora) está en development.

---

### H-5: Alerts.jsx — lista de tiendas hardcoded e incompleta

```jsx
const STORES = ['walmart', 'home-depot', 'target', 'best-buy', 'lowes'];
```

El sistema tiene deals activos de: OD, BB, GameStop, Macy's, Staples. Pero el formulario de alertas solo permite crear alertas para Walmart, Home Depot, Target, Best Buy y Lowe's — ninguno de los cuales tiene datos frescos hoy excepto Best Buy.

---

## 🟡 RIESGOS MEDIOS

### M-1: Scope de UI excesivo para un producto pre-traction

39 páginas en el frontend:

```
Dashboard, Search, DealDetail, MapView, Scanner, Alerts, Watchlist,
Recommendations, ProHunter, Analytics, Referrals, Pricing, Feed,
CollaboratorDashboard, CollaboratorSubmit, CollaboratorSubmissions,
CollaboratorLeaderboard, Teams, TeamDetail, Admin, BusinessHome,
University (10 cursos), AICoach, HallOfFame, Notifications, TeamCRM,
BusinessStats, ScannerDebug, Community, ...
```

Muchas de estas páginas (University, TeamCRM, BusinessStats, HallOfFame, AI Coach) tienen **0 actividad** y están respaldadas por **datos 100% seeded/fake**. Diluyen el foco del producto y aumentan el surface de mantenimiento.

Un nuevo usuario que entre al producto ve demasiado. El core path (ver deals → escanear producto → crear alerta) está compitiendo con 38 páginas más.

---

### M-2: Price history casi vacía

16 `price_changes` en total (todos del 2026-06-21 al 22). El componente `DealDetail` muestra un gráfico de "price history (90 days)" — pero en la práctica el chart está vacío para 99.9% de los productos. Esto hace que uno de los features más atractivos del producto (ver si el precio bajó) sea una promesa vacía.

---

### M-3: Rate limiting en memoria (no Redis)

```js
// ─── In-memory IP rate store (replace with Redis in production) ───
const ipStore = new Map();
```

En producción multi-instancia (Render puede escalar), cada instancia tiene su propio Map. Un usuario puede enviar 10× más requests que el límite saltando entre instancias. Aceptable en alpha, problemático en producción real.

---

### M-4: Dependency excesiva en un solo proveedor de proxy

BrightData es el único proxy configurado. Si:
- Los fondos se agotan
- BrightData cambia sus credenciales
- El sistema de facturación falla

...discovery se detiene completamente para BB, GameStop y Staples. No hay fallback.

---

### M-5: 59 tablas en DB para un producto con 0 usuarios

El schema es de nivel enterprise. Tablas como `contributor_earnings`, `payout_requests`, `business_missions`, `hunt_badges`, `university_certificates` no tienen un solo dato real. El overhead de mantenimiento en migraciones y joins será un lastre.

---

## 🟢 FORTALEZAS REALES

| Área | Detalle |
|------|---------|
| **OD Discovery sin proxy** | 92,603 URLs accesibles, 4,747 candidatos físicos por ciclo. Validado hoy: 20/20 products guardados sin BrightData |
| **Seguridad backend** | Helmet, CORS, JWT, bcrypt(12), rate limiting, sanitización, audit_logs — nivel production |
| **Índices en DB** | `idx_deals_active_score`, `idx_deals_tier`, `idx_deals_store`, `idx_deals_profit` — queries rápidos |
| **Opportunity Engine** | Scoring real (0-100) con discount, history, resale margin, brand multiplier, category demand |
| **UX del DealCard** | Freshness indicators, score ring animado, price trend, badges — mejor que competidores directos |
| **Monetización diseñada** | Free/Pro $19/Elite $49 con trial de 7 días. Bien pensado. Solo falta activar Stripe |
| **Deployment config** | `render.yaml` completo con web + worker separados. Dockerfile presente |
| **Alert engine** | Código bien construido — watchlist + user_alerts, dedup via alert_triggers, WhatsApp para Elite |
| **Scanner UPC** | Camera scanner con QuaggaJS. Feature diferenciador para el target de resellers |
| **PROXY_KILL_SWITCH** | Mecanismo de control de costos funcionando |

---

## Plan hacia producción

### FASE 0 — Semana 1: Arreglar antes de que cualquier usuario vea la app (3-5 días)

**P0.1 — Eliminar o marcar deals con precios inflados de Macy's**
```sql
-- Identificar (28 deals)
SELECT id FROM deals WHERE store_id = (SELECT id FROM stores WHERE slug='macys')
  AND regular_price > deal_price * 4 AND is_active = true;
-- Acción: marcar como is_error_price=true o is_active=false
-- Alternativa: excluir Macy's discovery hasta revisar la fuente de datos
```

**P0.2 — Activar Stripe**
1. Crear cuenta Stripe → obtener `STRIPE_SECRET_KEY`
2. Crear 2 productos en Stripe → obtener `STRIPE_PRO_PRICE_ID`, `STRIPE_ELITE_PRICE_ID`
3. Agregar al `.env` y al `render.yaml` en Render env vars
4. Activar el webhook endpoint `/api/subscriptions/webhook`

**P0.3 — Configurar email (SMTP o Resend)**
- Opción A: Resend.com (freemium, más moderno) — 3,000 emails/mes gratis
- Opción B: Gmail SMTP con app password
- Agregar `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` al `.env`

**P0.4 — Poner el Alert Engine en el cron**
En `index.js`, agregar después de `startWorkerMonitor()`:
```js
const cron = require('node-cron');
const { checkAllAlerts } = require('./services/alertEngine');
cron.schedule('*/15 * * * *', () => checkAllAlerts().catch(logger.error));
```

**P0.5 — NODE_ENV=production en local y Render**
```bash
# .env local:
NODE_ENV=production
# render.yaml ya lo tiene correcto
```

**P0.6 — BB images backfill**
1. Registrar en `developer.bestbuy.com` → 5 min
2. `BESTBUY_API_KEY=xxx` en `.env`
3. `node scripts/bb-api-discovery.js --backfill --save`
4. 313 imágenes recuperadas, costo $0

**P0.7 — Corregir Alerts.jsx STORES list**
Agregar: `'office-depot'`, `'gamestop'`, `'macys'`, `'staples'` a la lista. Esto es una línea de código.

---

### FASE 1 — Semana 2: MVP enfocado (primeros 10 usuarios reales)

**P1.1 — Narrow scope del producto visible**
Ocultar del nav principal (no eliminar) las páginas sin tracción:
- TeamCRM, BusinessStats, University, HallOfFame, AICoach, CollaboratorLeaderboard
- Mantener visible: Dashboard, Search, Scanner, Alerts, Pricing, DealDetail

**P1.2 — OD sin proxy en producción**
El cambio ya está en código (`PROXY_KILL_SWITCH=true` → OD corre sin proxy). En Render:
- El worker ya tiene `PROXY_ENABLED=false` en render.yaml
- OD discovery debería funcionar sin cambios adicionales

**P1.3 — BB API discovery (con key del P0.6)**
Programar `bb-api-discovery.js` como parte del ciclo de discovery. Costo $0, 50k requests/día.

**P1.4 — Reactivar proxy para BB/GameStop (presupuesto controlado)**
- Aprobar máximo $10/mes de BrightData
- BB discovery: 1 ciclo/día (no 30min) para preservar presupuesto
- GameStop: 1 ciclo cada 2 días

**P1.5 — Data freshness: ScanJob con proxy mínimo o sin proxy**
Evaluar si BB scan job puede correr con BB API en vez de Playwright para actualizaciones de precio.

---

### FASE 2 — Mes 2: Crecimiento con primeros ingresos

**P2.1 — Primer usuario de pago**
Target: 1 usuario Pro ($19/mes). Esto valida que el funnel de pago funciona end-to-end.

**P2.2 — Twilio WhatsApp para Elite**
Activar `TWILIO_ACCOUNT_SID` y `TWILIO_AUTH_TOKEN`. El código ya está construido.

**P2.3 — Push notifications**
Implementar el canal de push (web push API o Firebase) — actualmente listado como feature pero no implementado.

**P2.4 — Oportunidad de nicho**
Enfocar marketing en resellers de Amazon FBA — son el usuario con más dolor. El Scanner UPC es el feature que más les atrae. Crear landing page específica.

**P2.5 — Price history real**
Necesita que el ScanJob corra regularmente. Con 30 días de datos reales, el "90-day price chart" en DealDetail se vuelve el feature más convincente.

---

## Resumen ejecutivo

### Lo que funciona bien hoy
- OD discovery sin proxy: 92k URLs, 20 products/test sin error
- Seguridad backend: production-grade
- UX del deal card: mejor que competidores directos
- Opportunity scoring: algoritmo sólido
- Infraestructura de deploy: render.yaml listo

### Lo que debe arreglarse antes de lanzar
1. **Macy's datos falsos** — destruirá la confianza. Fix: 1 SQL query
2. **Stripe sin llaves** — no hay ingresos posibles. Fix: 30 min de configuración
3. **Email/alertas mudas** — la promesa central del producto no funciona. Fix: configurar SMTP
4. **Alert engine sin schedule** — el motor está construido pero apagado. Fix: 3 líneas de código
5. **BB sin imágenes** — segunda tienda sin fotos. Fix: API key gratuita + 1 script

### El riesgo real no es técnico
El sistema tiene ~18 meses de desarrollo equivalente. El código es bueno. El riesgo es **foco y tracción**: con 39 páginas, 59 tablas, y 0 usuarios reales, el producto tiene el scope de una startup Serie A pero la validación de una idea de semana 1.

La recomendación es: **arreglar los 7 bloqueadores críticos, lanzar a 10 usuarios reales, y medir cuál de los 39 features les importa**. No construir más hasta saber eso.

---

*Auditoría basada en lectura directa de código fuente, DB queries y worker logs. Sin modificaciones al código.*
