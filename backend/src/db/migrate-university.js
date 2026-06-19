const { query } = require('../config/database');
const logger = require('../utils/logger');

const COURSES = [
  {
    slug: 'how-to-use-deal-hunter',
    title: 'How to Use Deal Hunter AI',
    description: 'Master the platform from day one. Learn to navigate the dashboard, read deal scores, and start finding opportunities.',
    category: 'platform',
    level_required: 1,
    xp_reward: 50,
    badge_reward: 'platform_master',
    order_index: 1,
    lessons: [
      {
        slug: 'welcome',
        title: 'Welcome to Deal Hunter AI',
        content: `Deal Hunter AI is your all-in-one tool for finding retail arbitrage opportunities.

The platform connects you with thousands of deals from stores like Office Depot, Staples, Target, Walmart, and more — in real time.

**What you can do:**
- Browse deals by store, category, and ROI
- Use the Scanner to check any product barcode
- Submit your own field discoveries
- Confirm deals from the community and earn XP
- Build a team and climb the leaderboard

Start by exploring the Dashboard to see today's best deals. Then come back here to learn how to use the Scanner.`,
        duration_minutes: 3,
        order_index: 1,
      },
      {
        slug: 'dashboard-overview',
        title: 'Navigating the Dashboard',
        content: `The Dashboard is your home base for Deal Hunter AI.

**Key sections:**
- **Deal Feed** — live deals ranked by opportunity score
- **Stats Bar** — total active deals, average discount, and top stores
- **Map View** — see deals near you by location
- **Search** — find deals by keyword, UPC, or SKU

**Deal Score (0–100):**
- 90–100: Exceptional deal — high priority
- 70–89: Strong — good ROI
- 50–69: Moderate — worth checking
- Below 50: Low priority

Tip: Sort by "Opportunity Score" to see the best deals first. You can also filter by store or discount percentage.`,
        duration_minutes: 5,
        order_index: 2,
      },
      {
        slug: 'your-first-hunt',
        title: 'Your First Deal Hunt',
        content: `Ready to find your first deal? Here's a simple workflow:

**Step 1: Check the Dashboard**
Look for deals with an opportunity score above 70 near your location.

**Step 2: Head to the store**
Bring your phone and the Deal Hunter app. Navigate to the store in the Map view.

**Step 3: Scan the barcode**
Open the Scanner tab, scan the product barcode. You'll see:
- Current Amazon price (live)
- Your potential profit
- ROI percentage
- Keepa price history

**Step 4: Decide and submit**
If ROI > 30%, it's worth buying. Submit the deal to earn XP and help the community.

**Step 5: Earn rewards**
When 3+ community members confirm your deal, you earn points redeemable for cash rewards.`,
        duration_minutes: 7,
        order_index: 3,
      },
    ],
  },
  {
    slug: 'how-to-use-scanner',
    title: 'How to Use the Scanner',
    description: 'Master the barcode scanner to evaluate any product in seconds. Understand Keepa data, ROI calculations, and when to buy.',
    category: 'tools',
    level_required: 1,
    xp_reward: 75,
    badge_reward: 'scanner_pro',
    order_index: 2,
    lessons: [
      {
        slug: 'what-is-scanner',
        title: 'What Is the Scanner?',
        content: `The Scanner is one of the most powerful tools in Deal Hunter AI.

When you scan a product barcode (UPC), the Scanner instantly:
- Searches our internal database of known deals
- Queries Keepa for Amazon price history
- Checks eBay sold listings for market value
- Calculates your estimated profit and ROI
- Gives you a recommendation: Buy, Pass, or Verify

**Why this matters:**
Without a scanner, you're guessing. With the Scanner, you know — in seconds — whether a product is worth buying before you put it in your cart.

The Scanner works offline for cached products and online for live Keepa data.`,
        duration_minutes: 4,
        order_index: 1,
      },
      {
        slug: 'scanning-a-barcode',
        title: 'Scanning a Barcode',
        content: `**How to scan:**
1. Open the Scanner tab in the app
2. Type or paste a barcode (UPC/SKU) in the search field
3. Tap Search or press Enter
4. Wait 1–3 seconds for live data

**What you see:**

**Product Info** — Name, brand, image, and store it was found in.

**Market Price Panel** — Three sources:
- 🟢 Live Price (Buy Box / Current Amazon) — most accurate
- 🟡 Estimated Price (90d or 180d average) — used when live price unavailable
- 🔵 eBay Estimate — from recent sold listings

**Profit Calculator:**
Enter the price you found in the store. The app calculates:
- Net profit after Amazon fees (roughly 15% + FBA)
- ROI percentage
- Opportunity score

**Tips:**
- A ROI > 30% is generally good
- ROI > 50% = outstanding deal
- Always check if Amazon is in stock before buying`,
        duration_minutes: 6,
        order_index: 2,
      },
      {
        slug: 'reading-scan-results',
        title: 'Reading Scan Results',
        content: `Understanding your scan results is key to making smart buying decisions.

**Opportunity Labels:**
- 🔥 Exceptional — buy immediately
- ⚡ Great Deal — strong buy
- ✅ Good Deal — worth buying
- 👀 Check It — verify manually
- ⚠️ Pass — not profitable

**Keepa Panel:**
- **Buy Box Price** — what Amazon is currently selling it for
- **Current Price** — active listing price
- **90-day Average** — price trend over 3 months
- **Sales Rank** — lower = sells faster (under 100,000 in most categories is good)

**When to trust the data:**
- 🟢 Live data = trust immediately
- 🟡 Estimated data = verify before buying large quantities
- 🔵 eBay data = use as fallback when Amazon data is unavailable

**Red flags:**
- Sales rank above 1,000,000 (slow moving)
- Price drops significantly in recent months (race to the bottom)
- Amazon itself is the seller at a low price (hard to compete)`,
        duration_minutes: 8,
        order_index: 3,
      },
    ],
  },
  {
    slug: 'finding-deals-in-stores',
    title: 'How to Find Deals in Stores',
    description: 'Proven strategies for finding profitable clearance and sale items at retail stores. Where to look, when to go, and what to buy.',
    category: 'strategy',
    level_required: 1,
    xp_reward: 60,
    badge_reward: null,
    order_index: 3,
    lessons: [
      {
        slug: 'best-stores-for-arbitrage',
        title: 'Best Stores for Arbitrage',
        content: `Not all stores are equal for retail arbitrage. Here are the top hunting grounds:

**Tier 1 — Most Profitable:**
- **Office Depot / OfficeMax** — frequent deep clearance (50–90% off), especially electronics and supplies
- **Staples** — tech accessories, ink cartridges, office furniture clearance
- **Target** — seasonal clearance (toys, electronics, home goods) — especially Jan, June, Oct
- **Walmart** — rolling clearance in all departments, markdown schedule varies by store

**Tier 2 — Good Secondary Sources:**
- **Home Depot / Lowe's** — tools, hardware, seasonal items
- **Best Buy** — open-box deals, clearance electronics
- **Kohl's** — clothing, home goods, toys during sales + Kohl's Cash events
- **Macy's** — home goods and clothing clearance

**Tips:**
- Check Deal Hunter AI before going — we show real-time clearance data
- Monday and Tuesday are often best for fresh markdowns
- Back-to-school and after-holiday seasons have the best clearance`,
        duration_minutes: 5,
        order_index: 1,
      },
      {
        slug: 'clearance-vs-sale',
        title: 'Clearance vs. Regular Sale',
        content: `Understanding the difference between clearance and regular sales is critical.

**Regular Sale:**
- Time-limited promotion (7–14 days)
- Product comes back to full price
- Usually only 10–30% off
- Multiple stores have inventory

**Clearance:**
- Product is being discontinued or removed
- Price will not go back up — it keeps dropping
- Can be 50–90% off
- Once it's gone, it's gone
- Best opportunity for arbitrage

**How to identify clearance:**
- Yellow or red clearance tags (varies by store)
- Shelves with mixed quantities and disorganized stock
- "As marked" or "Final sale" signs
- End-of-aisle displays with random product mix

**Clearance markdown cycles:**
- Target: 30% → 50% → 70% → 90% (over 3–5 weeks)
- Walmart: varies, but usually 25% → 50% → clearance price
- Office Depot: can jump straight to 70–90% off

Pro tip: Use Deal Hunter AI's Scanner to check each item. The clearance price shows in-store, and we show you what it sells for on Amazon.`,
        duration_minutes: 6,
        order_index: 2,
      },
      {
        slug: 'best-times-to-hunt',
        title: 'Best Times and Seasons to Hunt',
        content: `Timing your store visits can dramatically increase your success rate.

**Best days to visit:**
- **Monday–Tuesday** — stores process weekend returns and apply new markdowns
- **Early morning** — before other resellers pick the shelves clean
- **Mid-week** — less competition, better stock

**Best seasons:**
- **January** — post-holiday clearance is massive. Electronics, toys, decorations all get deep discounts
- **June–July** — summer clearance begins. Outdoor, patio, lawn & garden equipment
- **September** — back-to-school ends, supplies get cleared
- **November (pre-Black Friday)** — stores clear old inventory
- **Day after holidays** — Christmas, Easter, Valentine's Day all have excellent clearance the next day

**Office Depot/Staples specific:**
- Check weekly ad every Sunday for "manager specials"
- End of fiscal quarter (March, June, September, December) often brings bigger clearance pushes

**Pro strategy:**
Visit the same stores on a regular schedule. You'll learn their markdown patterns and get first access to new clearance items before other resellers.`,
        duration_minutes: 7,
        order_index: 3,
      },
    ],
  },
  {
    slug: 'intro-to-keepa',
    title: 'Introduction to Keepa',
    description: 'Learn how to read Amazon price history with Keepa. Understand price charts, sales rank, and how to use data to make smarter buying decisions.',
    category: 'tools',
    level_required: 1,
    xp_reward: 80,
    badge_reward: 'keepa_reader',
    order_index: 4,
    lessons: [
      {
        slug: 'what-is-keepa',
        title: 'What Is Keepa?',
        content: `Keepa is an Amazon price tracker that records the price history of millions of products.

When you scan a product on Deal Hunter AI, we pull Keepa data to show you:
- What the product sold for in the last 90 and 180 days
- The current Buy Box price (what you'd be competing against)
- The Amazon sales rank (how fast it sells)
- Whether Amazon itself is selling it

**Why Keepa matters:**
A product might be $5 in the clearance bin. Keepa tells you if it usually sells for $30 on Amazon — or if it used to sell for $30 but now sells for $8 because the market crashed.

Without Keepa, you're flying blind. With Keepa, you have historical data to make confident buying decisions.

Deal Hunter AI integrates Keepa directly into the Scanner — no separate subscription needed for basic data.`,
        duration_minutes: 4,
        order_index: 1,
      },
      {
        slug: 'reading-price-charts',
        title: 'Reading Price History Charts',
        content: `Understanding price trends prevents you from buying at the wrong time.

**Key price types in Deal Hunter AI:**
- **Buy Box Price** — the price a buyer pays right now. This is your main benchmark.
- **Amazon Price** — Amazon's own listing (if they're a seller)
- **New Price** — lowest third-party new price
- **Used Price** — lowest used condition price

**What to look for:**

✅ **Stable price** — has been $25–$30 for 6 months → safe to buy at $8 clearance
✅ **Price just dropped** — was $40, now $20 → great window to buy before it normalizes
⚠️ **Downward trend** — was $30, now $15, trending toward $10 → avoid or be careful
❌ **Already at rock bottom** — $5 for 3 months → not much room to profit

**The 90-day average:**
Deal Hunter AI shows the 90-day average price. If the 90d average is higher than today's Amazon price, the product may be on temporary sale — wait before buying. If it's lower, the market is healthy.

**Sales rank:**
Shown as a number. Lower = sells faster.
- Under 10,000 in Electronics = very fast
- Under 100,000 in most categories = acceptable
- Over 500,000 = slow moving — risky unless margin is huge`,
        duration_minutes: 8,
        order_index: 2,
      },
      {
        slug: 'keepa-scores',
        title: 'Keepa Data Points in Deal Hunter AI',
        content: `Deal Hunter AI surfaces the most useful Keepa data points directly in the Scanner.

**Confidence levels:**
- 🟢 90% confidence = Buy Box or live Amazon price (very reliable)
- 🟡 60% = 90-day average (good estimate)
- 🟡 40% = 180-day average (rough estimate)
- 🔵 eBay data = when Keepa has no Amazon data

**Key fields:**
- **Offers Count** — number of sellers. If <5, less competition. If >50, very competitive.
- **Is Amazon In Stock** — if Amazon itself is selling, matching their price is tough
- **Sales Rank Category** — know which category to judge the rank properly

**Tips:**
- Always check offers count before buying large quantities
- If Amazon is the seller and in stock, your margin will be tight
- A product with 3 sellers and rank 15,000 is a much better opportunity than one with 40 sellers at rank 5,000

The Scanner color-codes confidence for you:
- Green badge = live data, high confidence
- Yellow badge = estimated, moderate confidence
- Blue badge = eBay data, use as reference only`,
        duration_minutes: 6,
        order_index: 3,
      },
    ],
  },
  {
    slug: 'selling-on-amazon',
    title: 'Selling on Amazon — The Basics',
    description: 'Everything you need to know to start selling on Amazon as a reseller. Account setup, fees, FBA vs FBM, and your first listing.',
    category: 'reselling',
    level_required: 1,
    xp_reward: 100,
    badge_reward: 'amazon_seller',
    order_index: 5,
    lessons: [
      {
        slug: 'amazon-seller-account',
        title: 'Setting Up Your Amazon Seller Account',
        content: `To sell on Amazon, you need a Seller Central account.

**Two account types:**
- **Individual** — $0.99 per item sold. Good for beginners selling < 40 items/month.
- **Professional** — $39.99/month flat. Required for Retail Arbitrage at scale (FBA, Buy Box eligibility).

**What you need to sign up:**
- Legal business name or your full name
- Bank account and credit card
- Government-issued ID
- Phone number for 2-factor auth
- Tax information (SSN or EIN)

**Go to:** sellercentral.amazon.com → Create account

**Important:**
- Only create ONE seller account. Having multiple accounts is against Amazon's TOS.
- Set up 2-factor authentication immediately.
- Keep your account health metrics clean (orders defect rate, late shipment rate).

Once approved, you can start listing products within 24–48 hours.`,
        duration_minutes: 6,
        order_index: 1,
      },
      {
        slug: 'understanding-amazon-fees',
        title: 'Understanding Amazon Fees',
        content: `Amazon takes a cut on every sale. Understanding fees is essential for profitable reselling.

**Main fee types:**

**Referral Fee (per sale):**
- Electronics: 8%
- Books: 15%
- Toys: 15%
- Grocery: 8–15%
- Most other categories: 15%

**FBA Fees (if using Fulfillment by Amazon):**
Charged per unit shipped. Example: a standard-size item weighing 1 lb = ~$3.22–$4.80 in fulfillment fees.

**Storage Fees (FBA only):**
- $0.75–$2.40 per cubic foot per month
- Long-term storage (12+ months) is much higher — avoid dead stock

**Calculating your profit:**
Profit = Sale Price − Cost − Referral Fee − FBA Fee − Storage Estimate

Example:
- Found item for $5 clearance
- Sells on Amazon for $29.99
- Referral fee (15%): $4.50
- FBA fee: $3.50
- **Net profit: ~$17**

Deal Hunter AI's Scanner calculates this automatically when you enter a found price.`,
        duration_minutes: 7,
        order_index: 2,
      },
      {
        slug: 'fba-vs-fbm',
        title: 'FBA vs. FBM — Which Should You Use?',
        content: `There are two ways to fulfill orders on Amazon:

**FBA (Fulfillment by Amazon):**
You ship your inventory to an Amazon warehouse. Amazon stores, picks, packs, and ships for you.

✅ Prime badge on listings = more sales
✅ You don't handle individual shipments
✅ Amazon handles customer service and returns
❌ Storage fees add up (don't let inventory sit)
❌ Prep requirements (labeling, packaging) must be followed exactly

**FBM (Fulfilled by Merchant):**
You ship directly to the customer when an order comes in.

✅ No storage fees
✅ More control over packaging
✅ Better for heavy/bulky items
❌ No Prime badge (lower conversion rate)
❌ You handle all shipments and customer service
❌ Must meet Amazon shipping speed requirements

**For retail arbitrage beginners:**
Start with FBA. The Prime badge dramatically increases conversion rates, and you don't need a shipping operation. As you scale, consider a mix of both.

**Rule of thumb:**
- Fast-moving items (rank < 100k): FBA
- Slow-moving or heavy items: FBM`,
        duration_minutes: 8,
        order_index: 3,
      },
    ],
  },
  {
    slug: 'selling-on-ebay',
    title: 'Selling on eBay — Getting Started',
    description: 'eBay is a great secondary market for retail arbitrage. Learn how to list products, price competitively, and ship efficiently.',
    category: 'reselling',
    level_required: 1,
    xp_reward: 75,
    badge_reward: null,
    order_index: 6,
    lessons: [
      {
        slug: 'getting-started-ebay',
        title: 'Getting Started on eBay',
        content: `eBay is the #2 marketplace for resellers after Amazon. It's often better for:
- Electronics with missing accessories or open box
- Discontinued products (no longer on Amazon)
- One-of-a-kind items or collectibles
- Products where Amazon competition is too fierce

**Setting up your eBay seller account:**
1. Go to ebay.com → Register → Business account
2. Add bank account (Managed Payments — eBay pays directly to bank)
3. Start with 10 free listings per month (new accounts)
4. Build feedback by selling a few small items first

**eBay vs Amazon fees:**
- eBay final value fee: ~12.9% + $0.30 per order
- No monthly fee for basic sellers
- Lower fees = can price slightly lower than Amazon and still profit

**When to use eBay:**
If the Amazon market for a product is oversaturated (50+ sellers, low margins), check eBay. Sometimes eBay buyers pay more for the same item due to fewer sellers.

Deal Hunter AI shows eBay median price in the Scanner as a 🔵 eBay Estimate.`,
        duration_minutes: 5,
        order_index: 1,
      },
      {
        slug: 'ebay-listing-best-practices',
        title: 'eBay Listing Best Practices',
        content: `A great listing is the difference between a quick sale and sitting on inventory.

**Title optimization:**
Include: Brand + Model + Key specs + Condition
Example: "HP OfficeJet 3830 All-in-One Wireless Printer — New In Box"

**Photos:**
- Take your own photos (don't just use manufacturer images)
- Show all sides, accessories, and any imperfections
- At least 4–6 photos
- Good lighting = more trust = more sales

**Pricing strategy:**
1. Search eBay → filter "Sold Listings" to see what actually sold
2. Price 5–10% below the average sold price to sell faster
3. Use "Best Offer" to capture buyers who want to negotiate

**Shipping:**
- Offer free shipping and bake it into the price (increases visibility)
- Use calculated shipping for heavy items
- Buy postage through eBay's platform for discounts

**Condition:**
Be honest. "New" means sealed. "Open Box" means tested but unused. Accurately describing condition avoids returns and protects your feedback score.`,
        duration_minutes: 6,
        order_index: 2,
      },
      {
        slug: 'ebay-shipping-returns',
        title: 'Shipping and Handling Returns on eBay',
        content: `Efficient shipping and handling returns professionally keeps your seller metrics high.

**Shipping basics:**
- Use USPS, UPS, or FedEx — compare rates with eBay's built-in rate calculator
- Buy shipping labels through eBay for 15–30% discounts
- Ship within 1–2 business days to maintain good metrics
- Use tracking on every shipment (required for seller protection)

**Packaging:**
- Use appropriate box size — eBay and carriers charge by dimensional weight
- Wrap fragile items in bubble wrap
- Include a packing slip with the order number

**Return policy:**
Offer 30-day returns to rank higher in search. Yes, you'll get some returns — but the increased sales more than make up for it.

**Handling returns:**
1. Buyer opens return request → accept immediately (don't fight it)
2. Inspect the item when returned
3. If item is returned in same condition → issue full refund
4. If buyer damaged it → escalate to eBay's Resolution Center

**Protecting yourself:**
- Always photograph items before shipping
- Keep shipping receipts for 60 days
- Document condition with photos at time of listing`,
        duration_minutes: 7,
        order_index: 3,
      },
    ],
  },
  {
    slug: 'retail-arbitrage-basics',
    title: 'Retail Arbitrage Fundamentals',
    description: 'Learn the core principles of retail arbitrage: profit margins, what products to buy, how to scale, and common mistakes to avoid.',
    category: 'strategy',
    level_required: 1,
    xp_reward: 90,
    badge_reward: 'arbitrage_pro',
    order_index: 7,
    lessons: [
      {
        slug: 'what-is-retail-arbitrage',
        title: 'What Is Retail Arbitrage?',
        content: `Retail Arbitrage (RA) is the practice of buying products at a low retail price and reselling them at a higher price on a different marketplace.

**The core principle:**
Buy low in physical stores → Sell high on Amazon, eBay, or other platforms.

**Why this works:**
- Physical stores have clearance and sales that create pricing gaps
- Amazon buyers often pay more for convenience
- Information asymmetry: not everyone shops stores to find deals
- Limited stock: clearance items won't be restocked

**Is it legal?**
Yes. The "First Sale Doctrine" allows you to resell any item you purchase legally. This is protected by US law.

**The math example:**
- Find a Bluetooth speaker at Office Depot clearance: $12
- It sells on Amazon for $45
- After fees (~$10): Net profit = ~$23 per unit
- Buy 10 units = $230 profit from one shopping trip

**Who does this:**
Thousands of people do retail arbitrage full-time and part-time. Some make $500/month as a side hustle. Others make $10,000+/month as a full business.`,
        duration_minutes: 5,
        order_index: 1,
      },
      {
        slug: 'calculating-profit',
        title: 'Calculating Your Profit Margin',
        content: `Knowing your numbers before you buy is non-negotiable.

**The formula:**
Net Profit = Sale Price − Cost − Amazon Referral Fee − FBA Fee

**Quick mental math:**
Assume roughly 33% of the sale price goes to Amazon (referral + FBA). So if you sell for $30, expect to net about $20 minus your cost.

More precise:
- 15% referral fee on most categories
- $3–5 FBA fee for standard-size items
- Your item cost

**ROI (Return on Investment):**
ROI = (Net Profit / Cost) × 100

Example:
- Cost: $10
- Net profit: $20
- ROI = 200%

**Deal Hunter AI does this automatically** in the Scanner. Enter your found price and it calculates profit and ROI for you.

**Minimum targets:**
- Beginners: aim for ROI > 50% (protect against surprises)
- Experienced: ROI > 30% is acceptable with good market data
- Avoid: ROI < 20% — leaves no room for returns or price drops

**Don't forget:**
- Prep costs (labels, bags, boxes)
- Mileage to the store
- Your time (especially when starting)`,
        duration_minutes: 7,
        order_index: 2,
      },
      {
        slug: 'common-mistakes',
        title: 'Common Mistakes to Avoid',
        content: `Learning from common mistakes can save you hundreds of dollars.

**Mistake 1: Buying without checking sales rank**
A product with a great price means nothing if it doesn't sell. Always check sales rank in the Scanner before buying.

**Mistake 2: Ignoring competition**
If Amazon is the seller + 30 other FBA sellers, your chances of winning the Buy Box are low. Check the offers count.

**Mistake 3: Buying too much of one item**
Start with 2–5 units of a new product. Once you sell through and confirm it's profitable, buy more. Never go all-in on an untested product.

**Mistake 4: Not accounting for all fees**
Beginners often forget storage fees, return rates (~10%), and prep costs. Use the Scanner to get accurate profit estimates.

**Mistake 5: Buying gated categories without ungating**
Some Amazon categories require approval: Toys (during Q4), Grocery, Beauty, Health. Check before buying inventory in these categories.

**Mistake 6: Chasing price instead of margin**
A $3 clearance item is only great if it sells for $15+. Focus on ROI %, not the absolute price.

**Mistake 7: Stopping after one bad buy**
Every reseller makes bad purchases sometimes. Track your overall portfolio ROI, not individual item success.`,
        duration_minutes: 8,
        order_index: 3,
      },
    ],
  },
  {
    slug: 'how-to-post-great-deals',
    title: 'How to Post Great Deals',
    description: 'Learn how to submit high-quality deals to the Deal Hunter community. Good submissions earn more XP, get verified faster, and help everyone.',
    category: 'community',
    level_required: 1,
    xp_reward: 60,
    badge_reward: null,
    order_index: 8,
    lessons: [
      {
        slug: 'what-makes-a-good-deal',
        title: 'What Makes a Good Deal?',
        content: `The best community deals share these characteristics:

**High ROI (> 30%)**
The deal needs to be actually profitable after Amazon fees. The Scanner will calculate this for you.

**Available stock**
A deal that's already sold out isn't helpful. Post while there's still inventory.

**Clear product identity**
Include UPC when possible. This lets other Hunters scan the same product and verify the price.

**Accurate store info**
Name the store, city, and section if possible ("Office Depot Austin TX, clearance aisle, bin 3").

**Photo (required for high-value deals)**
Deals with profit > $50 or ROI > 100% require a photo. It protects against fraud and builds community trust.

**What makes a BAD deal:**
- Already expired/sold out
- Seasonal price that's always this low
- Product you haven't physically seen in the store
- Price that can't be verified (missing UPC, no photo)
- Duplicate submission within 6 hours

Better deals get confirmed faster, earn you more XP, and build your trust score.`,
        duration_minutes: 5,
        order_index: 1,
      },
      {
        slug: 'how-to-take-deal-photos',
        title: 'How to Take Deal Photos',
        content: `A good photo increases your deal's credibility and confirmation rate.

**What to photograph:**
1. The price tag clearly showing the sale/clearance price
2. The product with the barcode visible
3. The shelf or bin showing available quantity
4. If possible, the store signage or aisle indicator

**Photo tips:**
- Good lighting — natural light or bright store lighting is fine
- Steady shot — no blurry images
- Include the price tag AND the product in the same frame when possible
- For high-ROI deals, take extra photos from multiple angles

**What NOT to do:**
- Don't use manufacturer photos (shows you don't have it in hand)
- Don't skip the price tag photo
- Don't submit stock images

**File size:**
Deal Hunter AI accepts photos up to 10MB. The app will handle compression.

**Privacy:**
Make sure your photos don't accidentally capture customer faces or personal info. Blur if necessary.

A photo doubles your deal's confirmation rate on average — it's worth the 30 extra seconds.`,
        duration_minutes: 4,
        order_index: 2,
      },
      {
        slug: 'writing-helpful-deal-notes',
        title: 'Writing Helpful Deal Notes',
        content: `A few words in your deal description can make the difference between a confirmed deal and an ignored one.

**What to include:**

**Location details:**
"Found at Target in the dollar spot section near checkout" — tells others exactly where to look.

**Stock level:**
"Saw about 15 units" or "Only 3 left" — helps others prioritize their trip.

**Condition:**
"All were sealed in box" or "A few had open packaging but contents intact" — manages expectations.

**Time-sensitive info:**
"Price shows as $12.99 in app but rang up as $4.99 at register" — cashier price overrides matter.

**Category context:**
"This is in the Toys category on Amazon — ungate before buying in Q4" — useful warnings.

**What NOT to write:**
- "Great deal!!!" (no info)
- "Buy this now!!!" (no data)
- "I made $50 on this" (unverified claim)

Keep it factual, brief, and useful. The community will thank you with confirmations — and confirmations mean XP.`,
        duration_minutes: 4,
        order_index: 3,
      },
    ],
  },
  {
    slug: 'how-to-grow-as-hunter',
    title: 'Growing as a Deal Hunter',
    description: 'Build your reputation, earn more XP, level up faster, and turn your hunter activity into consistent income.',
    category: 'growth',
    level_required: 1,
    xp_reward: 80,
    badge_reward: null,
    order_index: 9,
    lessons: [
      {
        slug: 'building-your-reputation',
        title: 'Building Your Reputation',
        content: `Your reputation in Deal Hunter AI is your most valuable asset. It's measured by:

**Trust Score (0–100):**
- Starts at 50 for all new users
- Increases when your deals are confirmed by others
- Increases when you accurately confirm other people's deals
- Decreases if your deals are rejected as inaccurate or fraudulent

**Why trust score matters:**
- Higher trust = more deal submission capacity
- Trust 70+ = deals auto-show to more Hunters for confirmation
- Trust 85+ = your reviews can unlock "verified" status faster

**How to build trust fast:**
1. Submit accurate deals with photos
2. Confirm deals you've personally verified in-store
3. Don't submit deals you haven't actually seen
4. Be specific in your descriptions

**Don't:**
- Submit fake deals to gain XP (anti-fraud detection will catch it)
- Confirm deals you haven't verified (hurts community accuracy)
- Create multiple accounts (permanently banned)

Building trust slowly and legitimately is the only path to long-term success on the platform.`,
        duration_minutes: 5,
        order_index: 1,
      },
      {
        slug: 'earning-xp-leveling-up',
        title: 'Earning XP and Leveling Up',
        content: `XP (Experience Points) determines your level and unlocks new platform features.

**Ways to earn XP:**

| Action | XP |
|---|---|
| Scanner lookup (unique per 5 min) | +1 XP |
| Complete daily scan mission (5 scans) | +30 XP |
| Complete weekly scan mission (20 scans) | +100 XP |
| Submit deal (pending verification) | Mission XP on complete |
| Community confirmation you give | +3 XP |
| Complete University lesson | Counted in missions |
| Complete University course | +50–200 XP |
| Complete weekly high-ROI mission | +200 XP |
| Refer new user | Mission XP on complete |

**Level thresholds:**
- Hunter: 0 XP
- Líder: 1,000 XP
- Director Regional: 5,000 XP
- Director Nacional: 20,000 XP

**Fastest path to Líder (1,000 XP):**
1. Complete daily missions every day → ~230 XP/week
2. Take 3 University courses → ~210 XP
3. Confirm 10 community deals → ~30 XP
4. Submit 3 verified deals → Mission XP

With consistent effort, you can reach Líder in 4–6 weeks.`,
        duration_minutes: 7,
        order_index: 2,
      },
      {
        slug: 'joining-creating-team',
        title: 'Joining or Creating a Team',
        content: `Teams multiply your reach and earning potential.

**Why join a team:**
- Team missions unlock bonus XP for everyone
- Share knowledge about store locations and deal types
- Coordinate hunts to cover more stores
- Mentor newer Hunters for mentor bonus XP (coming soon)

**How to join a team:**
1. Go to Teams in the navigation
2. Browse teams by city or search by name
3. Request to join — team leader approves

**How to create a team (requires Líder level — 1,000 XP):**
1. Navigate to Teams → Create Team
2. Choose a team name and city
3. Set your team's focus (electronics, grocery, etc.)
4. Invite other Hunters

**Team tips:**
- Active teams with 5+ members earn more from coordinated scanning
- Share your best store routes with teammates
- Assign different team members to different stores to maximize coverage

**Team ranking:**
Teams are ranked by combined XP and deal submissions. Top teams get featured on the leaderboard and earn exclusive badges.

Building a strong team is the fastest way to scale your points and reach Director levels.`,
        duration_minutes: 6,
        order_index: 3,
      },
    ],
  },
  {
    slug: 'leadership-and-teams',
    title: 'Leadership and Teams',
    description: 'Level up from Hunter to Líder and beyond. Learn how to lead a team, recruit effectively, manage performance, and build a regional network.',
    category: 'leadership',
    level_required: 1,
    xp_reward: 120,
    badge_reward: 'team_leader',
    order_index: 10,
    lessons: [
      {
        slug: 'what-is-a-director',
        title: 'What Is a Director?',
        content: `Deal Hunter AI has four levels, and the top two are Director titles.

**Director Regional (5,000 XP):**
- Manages a city or region's Hunter network
- Access to regional performance dashboard (coming soon)
- Exclusive Director Regional badge
- Ability to run regional campaigns and challenges
- Bonus XP from team accomplishments
- Monthly regional leaderboard

**Director Nacional (20,000 XP):**
- Manages multiple regional teams
- Access to national metrics dashboard
- Can create national campaigns (coming soon)
- Highest-tier badge and recognition
- Early access to new features
- Invited to Deal Hunter AI business meetings (coming soon)

**How to reach Director Regional (5,000 XP):**
This takes serious commitment — typically 3–6 months of consistent activity:
1. Hit daily and weekly missions consistently
2. Build a team of 5–10 active Hunters
3. Complete University courses for bonus XP
4. Refer multiple active users
5. Maintain high trust score

**It's a long game — but worth it.**
Directors are the backbone of the Deal Hunter community. They shape how their city hunts.`,
        duration_minutes: 5,
        order_index: 1,
      },
      {
        slug: 'recruiting-team-members',
        title: 'Recruiting Team Members',
        content: `Great teams start with the right people. Here's how to recruit effectively.

**Who to recruit:**

The best team members are:
- Already shopping at stores regularly (moms, students, anyone near retail areas)
- Willing to learn and use the app consistently
- Honest — they submit only real deals they've seen

**Where to find recruits:**
- Facebook groups: "retail arbitrage," "online selling," your city's buy/sell groups
- Reddit: r/flipping, r/Flipping, local subreddits
- Instagram/TikTok: reseller communities
- Word of mouth: friends and family who shop a lot

**How to pitch it:**
"I use this app called Deal Hunter AI that shows when stores have huge clearance deals. You can scan barcodes to see what stuff sells for on Amazon. If you find good deals, you submit them and earn points that turn into cash rewards."

**Your referral link:**
Every Hunter gets a personal referral link (in Business Home). Share this link to get credit when people sign up.

**Onboarding new members:**
- Help them take the University courses (especially Scanner and RA Basics)
- Do their first store visit together if possible
- Set clear expectations: 1–2 store visits per week, submit real deals only

Quality over quantity. One reliable team member beats five inactive ones.`,
        duration_minutes: 7,
        order_index: 2,
      },
      {
        slug: 'managing-team-performance',
        title: 'Managing Team Performance',
        content: `Once you have a team, keeping them active and motivated is your job as a leader.

**Set expectations early:**
- Define what "active" means for your team (e.g., 1 deal per week minimum)
- Create a group chat (WhatsApp, Telegram) for sharing finds
- Celebrate wins publicly — shout out good finds in the group

**Track performance:**
In the Teams section, you can see each member's contribution:
- Deals submitted
- XP earned
- Confirmation activity

**Motivate with challenges:**
Create your own team challenges:
- "First to find a deal with ROI > 100% this week"
- "Most scans this weekend"
- "Who can find the best Office Depot clearance this month"

**Handle inactive members:**
- First, reach out privately — life happens
- If inactive for 30+ days with no communication, remove them to keep the team lean
- Don't hesitate to recruit replacements

**Share knowledge:**
- Post your best store routes in the team chat
- Alert the team when you see a markdown cycle starting
- Share what's selling fast on Amazon this week

A leader's job is to make everyone on the team more successful. The more your team produces, the more XP you all earn — including you.`,
        duration_minutes: 8,
        order_index: 3,
      },
    ],
  },
];

const UNIV_MISSIONS = [
  {
    slug: 'complete_3_lessons_weekly',
    title: 'Study Session',
    description: 'Complete 3 University lessons this week',
    type: 'weekly',
    action: 'complete_lesson',
    target: 3,
    xp: 75,
  },
  {
    slug: 'complete_1_course_monthly',
    title: 'Graduate',
    description: 'Complete a full University course this month',
    type: 'monthly',
    action: 'complete_course',
    target: 1,
    xp: 150,
  },
];

async function migrateUniversity() {
  // ── university_courses ─────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS university_courses (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug           VARCHAR(100) UNIQUE NOT NULL,
      title          VARCHAR(200) NOT NULL,
      description    TEXT,
      category       VARCHAR(60),
      level_required INTEGER NOT NULL DEFAULT 1,
      xp_reward      INTEGER NOT NULL DEFAULT 50,
      badge_reward   VARCHAR(80),
      order_index    INTEGER DEFAULT 0,
      is_active      BOOLEAN DEFAULT true,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_ucourses_active ON university_courses(is_active, order_index)`);

  // ── university_lessons ─────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS university_lessons (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      course_id        UUID NOT NULL REFERENCES university_courses(id) ON DELETE CASCADE,
      slug             VARCHAR(100) NOT NULL,
      title            VARCHAR(200) NOT NULL,
      content          TEXT,
      video_url        VARCHAR(500),
      duration_minutes INTEGER DEFAULT 5,
      order_index      INTEGER DEFAULT 0,
      is_active        BOOLEAN DEFAULT true,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      updated_at       TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (course_id, slug)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_ulessons_course ON university_lessons(course_id, order_index)`);

  // ── university_progress ────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS university_progress (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id      UUID NOT NULL REFERENCES university_courses(id) ON DELETE CASCADE,
      lesson_id      UUID NOT NULL REFERENCES university_lessons(id) ON DELETE CASCADE,
      status         VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK (status IN ('in_progress','completed')),
      completed_at   TIMESTAMPTZ,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, lesson_id)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_uprog_user   ON university_progress(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_uprog_course ON university_progress(user_id, course_id)`);

  // ── university_certificates ────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS university_certificates (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id        UUID NOT NULL REFERENCES university_courses(id) ON DELETE CASCADE,
      certificate_code VARCHAR(40) UNIQUE NOT NULL,
      issued_at        TIMESTAMPTZ DEFAULT NOW(),
      metadata         JSONB,
      UNIQUE (user_id, course_id)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_ucert_user ON university_certificates(user_id)`);

  // ── ai_coach_logs ──────────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS ai_coach_logs (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      prompt           TEXT,
      response         TEXT,
      intent           VARCHAR(80),
      context_snapshot JSONB,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_aicoachlogs_user ON ai_coach_logs(user_id, created_at DESC)`);

  // ── ai_coach_suggestions ──────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS ai_coach_suggestions (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      suggestion_type VARCHAR(60),
      title           VARCHAR(200),
      message         TEXT,
      priority        INTEGER DEFAULT 5,
      is_read         BOOLEAN DEFAULT false,
      action_url      VARCHAR(300),
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      expires_at      TIMESTAMPTZ
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_aicoachsugg_user ON ai_coach_suggestions(user_id, is_read, created_at DESC)`);

  // ── Seed courses + lessons (idempotent) ───────────────────────────────────
  for (const course of COURSES) {
    await query(`
      INSERT INTO university_courses (slug, title, description, category, level_required, xp_reward, badge_reward, order_index)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (slug) DO NOTHING
    `, [course.slug, course.title, course.description, course.category,
        course.level_required, course.xp_reward, course.badge_reward || null, course.order_index]);

    for (const lesson of course.lessons) {
      await query(`
        INSERT INTO university_lessons (course_id, slug, title, content, duration_minutes, order_index)
        VALUES (
          (SELECT id FROM university_courses WHERE slug = $1),
          $2, $3, $4, $5, $6
        ) ON CONFLICT (course_id, slug) DO NOTHING
      `, [course.slug, lesson.slug, lesson.title, lesson.content,
          lesson.duration_minutes, lesson.order_index]);
    }
  }

  // ── Seed university missions ───────────────────────────────────────────────
  for (const m of UNIV_MISSIONS) {
    await query(`
      INSERT INTO business_missions (slug, title, description, type, action, target, xp_reward)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (slug) DO NOTHING
    `, [m.slug, m.title, m.description, m.type, m.action, m.target, m.xp]);
  }

  logger.info('[migrate-university] University + Coach tables + seed complete ✓');
}

module.exports = { migrateUniversity };
