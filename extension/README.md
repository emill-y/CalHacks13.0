# ThisBut browser extension

Hover any product photo on any shopping site and click **This, but…** (or right-click an image → **This, but…**).
A side panel opens with that photo. Type your edit ("without the ribbon", "in black", "under $50") and get results
**from the store you're on**, each verified against every edit.

The panel finds the **whole store's catalog** on its own, trying in order:

1. **Shopify** stores (Edikted and thousands more): the public `/products.json`.
2. **WooCommerce** stores: the public Store API (`/wp-json/wc/store/v1/products`).
3. **Any other store**: the sitemap (`robots.txt` → product sitemaps) plus the schema.org `Product` data on each
   product page (name, photo, price). Product pages most related to what you clicked are read first (e.g. "halter",
   "top"), and blog/help pages, jewelry and shoes are skipped.
4. If none of those work (sites that render everything with JavaScript, or block bots), it falls back to **the
   products on the current page**.

Products visible on the current page are always merged in. Up to 400 products are indexed by default (⚙ to change).
The first search on a store takes ~20–90 s; after that the store is cached and searches take ~10 s.
A toggle switches to the built-in 3,000-item ThisBut catalog instead.

Clicking a result opens the product on the store's own site. When nothing matches, save a Wish.

## Install (Chrome, Edge, Brave, Arc)

1. Start the ThisBut server: `npm run dev` in the repo root, with `ANTHROPIC_API_KEY` in `.env.local`.
2. Open `chrome://extensions` (Edge: `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose this `extension/` folder.
4. Pin ThisBut from the puzzle-piece menu. Click its icon to open the side panel.
5. If the server isn't at `http://localhost:3000`, open ⚙ in the panel and set the URL (e.g. your Railway URL or
   cloudflared tunnel).

Requires Chrome 116+.

## Privacy

The clicked photo URL is sent to your ThisBut server, used once for the search, and not stored. Store catalogs
(product titles, prices, public photo URLs and their embeddings) are cached on the server in `.data/stores/`. Wishes
store only the edit text.

## Files

* `manifest.json`: MV3 manifest (side panel, context menu, content script on all http(s) pages).
* `content.js`: the hover button (shadow DOM, so the site's CSS can't break it), plus the products visible on the
  page (images with nearby titles and prices).
* `collector.js`: whole-store discovery (Shopify, then WooCommerce, then sitemap + JSON-LD), run from the side panel
  (an extension page, so cross-origin sitemaps and product pages are readable).
* `background.js`: context menu; opens the side panel with the selected photo.
* `sidepanel.html/css/js`: the UI. It talks to `/api/stores/index` (index a store) and `/api/search`.
