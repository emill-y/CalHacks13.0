# ThisBut browser extension

Hover any product photo on any shopping site and click **This, but…** (or right-click an image → **This, but…**).
A side panel opens with that photo. Type your edit ("without the ribbon", "in black", "under $50") and get results
**from the store you're on**, each verified against every edit.

* **Shopify stores** (e.g. Edikted): the store's public `/products.json` catalog is indexed (up to 400 products by
  default, cached after the first time, so the first search takes ~10–40 s and later ones ~10 s).
* **Any other site:** the product images on the current page are indexed.
* **ThisBut catalog:** switch the scope to search the built-in 3,000-item demo catalog instead.

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
* `content.js`: the hover button (shadow DOM, so the site's CSS can't break it), plus product collection
  (Shopify `/products.json` first, then page images with nearby titles and prices).
* `background.js`: context menu; opens the side panel with the selected photo.
* `sidepanel.html/css/js`: the UI. It talks to `/api/stores/index` (index a store) and `/api/search`.
