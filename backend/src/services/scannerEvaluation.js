function evaluate({ in_store_price, amazon_current_price, amazon_buy_box_price, amazon_90d_avg_price, sales_rank, confidence = 0 }) {
  const storePrice = parseFloat(in_store_price) || 0;
  if (storePrice <= 0) {
    return { error: 'in_store_price required', recommendation: 'SKIP', net_profit: 0, roi_percent: 0, opportunity_score: 0 };
  }

  // Best resale price: prefer buy box → current → 90d avg
  const resalePrice = parseFloat(amazon_buy_box_price || amazon_current_price || amazon_90d_avg_price) || 0;
  if (resalePrice <= 0) {
    return { error: 'No Amazon price available', recommendation: 'SKIP', net_profit: 0, roi_percent: 0, opportunity_score: 0, resale_price: 0 };
  }

  const fees = parseFloat((resalePrice * 0.15).toFixed(2));
  const shipping = 10;
  const netProfit = parseFloat((resalePrice - fees - shipping - storePrice).toFixed(2));
  const roi = storePrice > 0 ? parseFloat(((netProfit / storePrice) * 100).toFixed(1)) : 0;

  // Opportunity score (0–100)
  let score = 0;
  if (roi >= 100) score += 40;
  else if (roi >= 50) score += 30;
  else if (roi >= 25) score += 15;
  else if (roi > 0) score += 5;

  if (netProfit >= 20) score += 25;
  else if (netProfit >= 10) score += 18;
  else if (netProfit >= 5) score += 8;

  if (confidence >= 80) score += 20;
  else if (confidence >= 60) score += 15;
  else if (confidence >= 40) score += 8;

  if (sales_rank) {
    if (sales_rank < 1000) score += 15;
    else if (sales_rank < 10000) score += 10;
    else if (sales_rank < 100000) score += 5;
  }

  score = Math.min(100, Math.max(0, score));

  let recommendation;
  if (netProfit >= 10 && roi >= 50 && confidence >= 60) {
    recommendation = 'BUY';
  } else if (netProfit >= 5 && roi >= 25) {
    recommendation = 'MAYBE';
  } else {
    recommendation = 'SKIP';
  }

  return {
    in_store_price: storePrice,
    resale_price: resalePrice,
    resale_source: amazon_buy_box_price ? 'buy_box' : amazon_current_price ? 'current' : '90d_avg',
    fees_estimate: fees,
    shipping_estimate: shipping,
    net_profit: netProfit,
    roi_percent: roi,
    opportunity_score: score,
    recommendation,
    confidence: parseInt(confidence) || 0,
    sales_rank: sales_rank ? parseInt(sales_rank) : null,
  };
}

module.exports = { evaluate };
