/**
 * evaluate() — unified BUY/MAYBE/SKIP/INSUFFICIENT_DATA scoring for in-store scanner
 *
 * Resale price hierarchy: Amazon buy_box → Amazon current → eBay median → Amazon 90d avg
 *   → eBay avg → Amazon new → Amazon used → Recovery market offer → Recovery midpoint
 *
 * Fee breakdown returned:
 *   referral_fee    — Amazon category referral rate (8–15%)
 *   fba_fee         — estimated FBA pick/pack by size tier
 *   inbound_shipping— estimated inbound shipping by category weight tier
 *   prep_cost       — default $0.50 per unit
 *   total_fees      — sum of all above
 *
 * INSUFFICIENT_DATA: returned instead of SKIP when there is no market price.
 * SKIP: only returned when price IS available but profit/ROI don't meet threshold.
 */

// ── Category-based fee estimation ────────────────────────────────────────────

const CATEGORY_TIERS = [
  {
    tier: 'oversize',
    patterns: /television|large tv|65[- ]?inch|75[- ]?inch|85[- ]?inch|oled|qled|large screen|large appliance|washer|dryer|refrigerator/i,
    referral_rate: 0.08,
    fba_fee:       22.00,
    est_shipping:  20,
  },
  {
    tier: 'bulky',
    patterns: /vacuum|carpet cleaner|air purifier|blender|coffee maker|coffee machine|printer|game console|power tool|electric mower|generator|grill|pressure cooker/i,
    referral_rate: 0.15,
    fba_fee:       9.73,
    est_shipping:  12,
  },
  {
    tier: 'small',
    patterns: /phone|headphone|earphone|earbud|tablet|cable|charger|small appliance|toy|board game|book|dvd|blu.?ray|video game|flash drive|memory card/i,
    referral_rate: 0.15,
    fba_fee:       3.22,
    est_shipping:  4,
  },
];

function getCategoryTier(category = '', title = '') {
  const text = `${category} ${title}`.toLowerCase();
  for (const t of CATEGORY_TIERS) {
    if (t.patterns.test(text)) return t;
  }
  return { tier: 'standard', referral_rate: 0.15, fba_fee: 5.40, est_shipping: 8 };
}

// ── Main evaluate function ────────────────────────────────────────────────────

function evaluate({
  in_store_price,
  // Effective price (pre-computed best available — takes priority)
  effective_market_price,
  effective_market_source,
  pricing_confidence = 0,
  // Keepa / Amazon
  amazon_current_price,
  amazon_buy_box_price,
  amazon_90d_avg_price,
  amazon_new_price,
  amazon_used_price,
  sales_rank,
  confidence = 0,
  // eBay
  ebay_avg_price,
  ebay_median_price,
  ebay_sold_count,
  // Recovery market pricing (from upcitemdb)
  recovery_market_offer_price,
  recovery_market_midpoint,
  // Product metadata for fee estimation
  category = '',
  title = '',
  // Manual overrides
  shipping_override = null,
  prep_cost_override = null,
}) {
  const storePrice = parseFloat(in_store_price) || 0;
  if (storePrice <= 0) {
    return {
      error: 'in_store_price required',
      recommendation: 'SKIP',
      net_profit: 0, roi_percent: 0, opportunity_score: 0,
    };
  }

  const effectiveMarket       = parseFloat(effective_market_price)   || 0;
  const buyBox                = parseFloat(amazon_buy_box_price)     || 0;
  const current               = parseFloat(amazon_current_price)     || 0;
  const avg90                 = parseFloat(amazon_90d_avg_price)     || 0;
  const ebayMedian            = parseFloat(ebay_median_price)        || 0;
  const ebayAvg               = parseFloat(ebay_avg_price)           || 0;
  const newPrice              = parseFloat(amazon_new_price)         || 0;
  const usedPrice             = parseFloat(amazon_used_price)        || 0;
  const recoveryOffer         = parseFloat(recovery_market_offer_price) || 0;
  const recoveryMid           = parseFloat(recovery_market_midpoint) || 0;

  // Full resale price hierarchy (most reliable → least reliable)
  let resalePrice  = 0;
  let resaleSource = 'none';
  let baseConfidence = parseInt(pricing_confidence) || 0;

  if (effectiveMarket > 0) {
    resalePrice  = effectiveMarket;
    resaleSource = effective_market_source || 'keepa';
  } else if (buyBox > 0) {
    resalePrice  = buyBox;    resaleSource = 'amazon_buy_box';   baseConfidence = 90;
  } else if (current > 0) {
    resalePrice  = current;   resaleSource = 'amazon_current';   baseConfidence = 80;
  } else if (ebayMedian > 0) {
    resalePrice  = ebayMedian; resaleSource = 'ebay_median';     baseConfidence = 65;
  } else if (avg90 > 0) {
    resalePrice  = avg90;     resaleSource = 'amazon_90d_avg';   baseConfidence = 60;
  } else if (ebayAvg > 0) {
    resalePrice  = ebayAvg;   resaleSource = 'ebay_avg';         baseConfidence = 55;
  } else if (newPrice > 0) {
    resalePrice  = newPrice;  resaleSource = 'amazon_new';       baseConfidence = 30;
  } else if (usedPrice > 0) {
    resalePrice  = usedPrice; resaleSource = 'amazon_used';      baseConfidence = 20;
  } else if (recoveryOffer > 0) {
    resalePrice  = recoveryOffer; resaleSource = 'market_offer'; baseConfidence = 35;
  } else if (recoveryMid > 0) {
    resalePrice  = recoveryMid;  resaleSource = 'market_estimate'; baseConfidence = 15;
  }

  if (resalePrice <= 0) {
    return {
      recommendation:  'INSUFFICIENT_DATA',
      message:         'Producto identificado, pero no hay precio de reventa suficiente para calcular ganancia.',
      net_profit:      null,
      roi_percent:     null,
      opportunity_score: 0,
      resale_price:    null,
      resale_source:   'none',
      has_ebay_data:   ebayAvg > 0 || ebayMedian > 0,
    };
  }

  // ── Fee estimation ──────────────────────────────────────────────────────────
  const tier = getCategoryTier(category, title);
  const isEbaySource = resaleSource.startsWith('ebay');

  const referralRate   = isEbaySource ? 0.129 : tier.referral_rate;
  const referralFee    = parseFloat((resalePrice * referralRate).toFixed(2));
  const fbaFee         = isEbaySource ? 0 : tier.fba_fee;
  const inboundShip    = shipping_override != null
    ? parseFloat(shipping_override)
    : tier.est_shipping;
  const prepCost       = prep_cost_override != null ? parseFloat(prep_cost_override) : 0.50;

  const totalFees   = parseFloat((referralFee + fbaFee + inboundShip + prepCost).toFixed(2));
  const netProfit   = parseFloat((resalePrice - totalFees - storePrice).toFixed(2));
  const roi         = storePrice > 0 ? parseFloat(((netProfit / storePrice) * 100).toFixed(1)) : 0;

  // Price stability signal
  let priceStable = false;
  if (current > 0 && avg90 > 0) {
    priceStable = Math.abs(current - avg90) / avg90 <= 0.10;
  }

  // ── Opportunity score (0–100) ──────────────────────────────────────────────
  let score = 0;

  if (roi >= 100) score += 40;
  else if (roi >= 50) score += 30;
  else if (roi >= 25) score += 15;
  else if (roi > 0) score += 5;

  if (netProfit >= 20) score += 25;
  else if (netProfit >= 10) score += 18;
  else if (netProfit >= 5) score += 8;

  // Keepa confidence
  if (confidence >= 80) score += 20;
  else if (confidence >= 60) score += 15;
  else if (confidence >= 40) score += 8;

  // Sales rank
  if (sales_rank && parseInt(sales_rank) > 0) {
    if (sales_rank < 1000)   score += 15;
    else if (sales_rank < 10000)  score += 10;
    else if (sales_rank < 100000) score += 5;
  }

  // eBay demand
  const ebayCount = parseInt(ebay_sold_count) || 0;
  if (ebayCount > 100) score += 10;
  else if (ebayCount > 20) score += 6;
  else if (ebayCount > 5)  score += 3;

  if (priceStable) score += 5;

  score = Math.min(100, Math.max(0, score));

  // ── Recommendation ──────────────────────────────────────────────────────────
  // Lower thresholds slightly when pricing confidence is low (recovery/estimate sources)
  const lowConfidence = baseConfidence < 40;
  const ebayBoost = ebayCount > 10;

  let recommendation;
  if (netProfit >= 10 && roi >= 50 && !lowConfidence && (confidence >= 60 || (ebayBoost && confidence >= 40))) {
    recommendation = 'BUY';
  } else if (netProfit >= 5 && roi >= 25) {
    recommendation = 'MAYBE';
  } else {
    recommendation = 'SKIP';
  }

  return {
    in_store_price:   storePrice,
    resale_price:     resalePrice,
    resale_source:    resaleSource,
    pricing_confidence: baseConfidence,
    fees_breakdown: {
      referral_fee:     referralFee,
      referral_rate_pct: Math.round(referralRate * 100),
      fba_fee:          fbaFee,
      inbound_shipping: inboundShip,
      prep_cost:        prepCost,
      total_fees:       totalFees,
      category_tier:    tier.tier,
      shipping_is_override: shipping_override != null,
    },
    fees_estimate:    totalFees,
    net_profit:       netProfit,
    roi_percent:      roi,
    opportunity_score: score,
    recommendation,
    confidence:       parseInt(confidence) || 0,
    sales_rank:       sales_rank ? parseInt(sales_rank) : null,
    price_stable:     priceStable,
    has_ebay_data:    ebayAvg > 0 || ebayMedian > 0,
    ebay_sold_count:  ebayCount || null,
  };
}

module.exports = { evaluate };
