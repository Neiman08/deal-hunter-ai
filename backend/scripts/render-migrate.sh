#!/bin/bash
# Runs all DB migrations in order before starting the server.
# Must be executed from backend/ directory.
# Each incremental migration uses || true so a single failure doesn't abort startup.
set -e

echo "=== [render-migrate] Running migrations ==="

# Base schema — must succeed
node src/db/migrate.js

# Incremental migrations — failures are non-fatal (idempotent, IF NOT EXISTS)
node src/db/migrate-categories.js    || echo "[render-migrate] migrate-categories skipped"
node src/db/add-missing-stores.js    || echo "[render-migrate] add-missing-stores skipped"
node src/db/add-effective-price-columns.js || echo "[render-migrate] add-effective-price-columns skipped"
node src/db/seed-illinois-stores.js  || echo "[render-migrate] seed-illinois-stores skipped"
node src/db/v5-phase1-migration.js   || echo "[render-migrate] v5-phase1 skipped"
node src/db/v5-fase1-community.js    || echo "[render-migrate] v5-fase1-community skipped"
node src/db/fix-macys-urls.js        || echo "[render-migrate] fix-macys-urls skipped"
node src/db/migrate-phase-e.js       || echo "[render-migrate] migrate-phase-e skipped"
node src/db/migrate-keepa.js         || echo "[render-migrate] migrate-keepa skipped"
node src/db/add_bestbuy_sku.js       || echo "[render-migrate] add_bestbuy_sku skipped"
node src/db/add-beta-plan.js         || echo "[render-migrate] add-beta-plan skipped"
node src/db/add-scanner-unknown.js   || echo "[render-migrate] add-scanner-unknown skipped"
node src/db/add-quality-gate.js      || echo "[render-migrate] add-quality-gate skipped"
node src/db/quality-classify.js      || echo "[render-migrate] quality-classify skipped"

echo "=== [render-migrate] All migrations complete ==="
