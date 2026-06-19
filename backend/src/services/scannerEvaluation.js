/**
 * evaluate() — unified BUY/MAYBE/SKIP scoring for in-store scanner
 *
 * Accepts both Keepa (Amazon) and eBay market data.
 * Resale price hierarchy: Amazon buy_box → Amazon current → eBay median → Amazon 90d avg → eBay avg
 * "Price stability" bonus: if Amazon 90d avg is within 10% of current → stable market → +5 score
 */
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
  sales_rank,
  confidence = 0,
  // eBay
  ebay_avg_price,
  ebay_median_price,
  ebay_sold_count,
}) {
  const storePrice = parseFloat(in_store_price) || 0;
  if (storePrice <= 0) {
    return {
      error: 'in_store_price required',
      recommendation: 'SKIP',
      net_profit: 0, roi_percent: 0, opportunity_score: 0,
    };
  }

  const effectiveMarket = parseFloat(effective_market_price) || 0;
  const buyBox    = parseFloat(amazon_buy_box_price)  || 0;
  const current   = parseFloat(amazon_current_price)  || 0;
  const avg90     = parseFloat(amazon_90d_avg_price)  || 0;
  const ebayMedian= parseFloat(ebay_median_price)     || 0;
  const ebayAvg   = parseFloat(ebay_avg_price)        || 0;

  // Determine best resale price — effective_market_price first, then explicit fields
  let resalePrice = 0;
  let resaleSource = 'none';
  if (effectiveMarket > 0) { resalePrice = effectiveMarket; resaleSource = effective_market_source || 'keepa'; }
  else if (buyBox > 0)     { resalePrice = buyBox;          resaleSource = 'amazon_buy_box'; }
  else if (current > 0)    { resalePrice = current;         resaleSource = 'amazon_current'; }
  else if (ebayMedian > 0) { resalePrice = ebayMedian;      resaleSource = 'ebay_median'; }
  else if (avg90 > 0)      { resalePrice = avg90;           resaleSource = 'amazon_90d_avg'; }
  else if (ebayAvg > 0)    { resalePrice = ebayAvg;         resaleSource = 'ebay_avg'; }

  if (resalePrice <= 0) {
    const hasEbay = ebayAvg > 0 || ebayMedian > 0;
    return {
      error: 'Not enough market pricing data',
      recommendation: 'SKIP',
      net_profit: 0, roi_percent: 0, opportunity_score: 0,
      resale_price: 0,
      has_ebay_data: hasEbay,
    };
  }

  // Fees: Amazon 15% OR eBay 12.9% (use lower when eBay is resale source)
  const feeRate = resaleSource.startsWith('ebay') ? 0.129 : 0.15;
  const fees = parseFloat((resalePrice * feeRate).toFixed(2));
  const shipping = 10;
  const netProfit = parseFloat((resalePrice - fees - shipping - storePrice).toFixed(2));
  const roi = storePrice > 0 ? parseFloat(((netProfit / storePrice) * 100).toFixed(1)) : 0;

  // Price stability signal (Amazon only): if avg90 within 10% of current → stable market
  let priceStable = false;
  if (current > 0 && avg90 > 0) {
    const diff = Math.abs(current - avg90) / avg90;
    priceStable = diff <= 0.10;
  }

  // Opportunity score (0–100)
  let score = 0;

  // ROI contribution (0–40)
  if (roi >= 100) score += 40;
  else if (roi >= 50) score += 30;
  else if (roi >= 25) score += 15;
  else if (roi > 0) score += 5;

  // Profit contribution (0–25)
  if (netProfit >= 20) score += 25;
  else if (netProfit >= 10) score += 18;
  else if (netProfit >= 5) score += 8;

  // Keepa confidence (0–20)
  if (confidence >= 80) score += 20;
  else if (confidence >= 60) score += 15;
  else if (confidence >= 40) score += 8;

  // Sales rank (0–15); Keepa uses -1 for "no data" — only score when rank is a real positive value
  if (sales_rank && parseInt(sales_rank) > 0) {
    if (sales_rank < 1000) score += 15;
    else if (sales_rank < 10000) score += 10;
    else if (sales_rank < 100000) score += 5;
  }

  // eBay demand signal (0–10)
  const ebayCount = parseInt(ebay_sold_count) || 0;
  if (ebayCount > 100) score += 10;
  else if (ebayCount > 20) score += 6;
  else if (ebayCount > 5) score += 3;

  // Price stability bonus (0–5)
  if (priceStable) score += 5;

  score = Math.min(100, Math.max(0, score));

  // BUY/MAYBE/SKIP — slightly relaxed when eBay confirms demand
  const ebayBoost = ebayCount > 10;
  let recommendation;
  if (netProfit >= 10 && roi >= 50 && (confidence >= 60 || (ebayBoost && confidence >= 40))) {
    recommendation = 'BUY';
  } else if (netProfit >= 5 && roi >= 25) {
    recommendation = 'MAYBE';
  } else {
    recommendation = 'SKIP';
  }

  return {
    in_store_price: storePrice,
    resale_price: resalePrice,
    resale_source: resaleSource,
    fees_estimate: fees,
    fee_rate_percent: Math.round(feeRate * 100),
    shipping_estimate: shipping,
    net_profit: netProfit,
    roi_percent: roi,
    opportunity_score: score,
    recommendation,
    confidence: parseInt(confidence) || 0,
    sales_rank: sales_rank ? parseInt(sales_rank) : null,
    price_stable: priceStable,
    has_ebay_data: ebayAvg > 0 || ebayMedian > 0,
    ebay_sold_count: ebayCount || null,
  };
}

module.exports = { evaluate };
