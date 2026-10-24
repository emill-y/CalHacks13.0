# Publishing ThisBut so anyone can use it

Three steps: **host the server → package the extension → submit it to the Chrome Web Store** (Edge Add-ons takes the
same zip). Allow about an hour of your time, then Google's review (usually a few days).

## 1. Host the server (Railway)

The extension needs a public HTTPS server. It runs the same Next.js app, with the CLIP model, catalog and Claude key.

```bash
npm i -g @railway/cli
railway login
railway init                    # new project
railway up                      # builds the Dockerfile (~5 min the first time)
railway domain                  # gives you https://<name>.up.railway.app
```

In the Railway dashboard → your service → **Settings**: pick an instance with **≥ 2 GB RAM**, and add a **Volume**
mounted at **`/app/.data`** so store catalogs and wishes survive redeploys.

**Variables** (Railway → Variables):

| Variable | Value | Why |
|---|---|---|
| `ANTHROPIC_API_KEY` | your key | required |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | default model |
| `DAILY_SEARCH_CAP` | `500` | global searches per day. Each search costs roughly $0.05 of Claude usage (estimate), so 500/day ≈ $25/day max |
| `RATE_SEARCH_PER_DEVICE_HOUR` | `40` | per-user hourly limit |
| `RATE_SEARCH_PER_IP_HOUR` | `80` | per-IP hourly limit |
| `ALLOWED_ORIGINS` | `chrome-extension://<your-extension-id>` | set after step 3, once you know the extension ID; only your extension (and the site itself) can call the API |
| `NEXT_PUBLIC_CHROME_STORE_URL` | your listing URL | shows an “Add to Chrome” button on `/extension` (set after approval, then redeploy) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | optional | shared storage + rate limits if you run more than one instance |

Also set a monthly spend limit on your key at console.anthropic.com → Settings → Limits.

Check it works: open `https://<your-domain>/api/health`. You should see `"ok": true`.

**Render instead:** New → Blueprint → pick this repo (`render.yaml`), choose a ≥ 2 GB plan, add the same variables,
and add a disk mounted at `/app/.data`.

## 2. Package the extension for your server

```bash
npm run ext:pack -- --server https://<your-domain> --version 1.0.0
```

This creates:
- `dist/thisbut-extension-1.0.0.zip`, which you upload to the store, and
- `dist/extension/`, which friends can use right away via `chrome://extensions` → Developer mode → **Load unpacked**.

## 3. Submit to the Chrome Web Store

1. Register at https://chrome.google.com/webstore/devconsole (one-time $5 fee).
2. **New item** → upload `dist/thisbut-extension-1.0.0.zip`. The dashboard now shows your **extension ID**: put
   `chrome-extension://<that id>` in `ALLOWED_ORIGINS` on Railway.
3. Fill in the listing using the text below. Images are in `extension/store-assets/`.
4. Visibility: choose **Unlisted** for a link-only beta, or **Public**. Submit for review.

For **Edge**, upload the same zip at https://partner.microsoft.com/dashboard/microsoftedge (free).

### Store listing

- **Name:** ThisBut — shop by editing what you see
- **Category:** Shopping
- **Short description (≤132):** Hover any product photo, click “This, but…”, say what you'd change. Every result is verified against every edit.
- **Detailed description:**

  > Found something you almost love? Hover any product photo on any shopping site and tap **✦ This, but…**, then say
  > what you'd change: "without the ribbon", "in black", "longer sleeves", "under $50".
  >
  > ThisBut searches the store you're already on, through its full catalog on Shopify and WooCommerce stores and any
  > store with a sitemap, and checks every result against every edit you asked for. Each result shows its receipts
  > (✓ kept, ✓ changed, ✗ missed), and nothing that misses an edit is ever labeled a match. Tap a result to open the
  > exact product on the store's own site.
  >
  > Nothing matches? Save a wish, and we'll tell you when it shows up.
  >
  > Privacy first: your picked photo is used once and discarded; wishes are saved as text only; no account needed.
  > ThisBut is an independent project and is not affiliated with the stores you use it on.
- **Screenshots (1280×800):** `screenshot-1-hover.png`, `screenshot-2-results.png`, `screenshot-3-receipts.png`, `screenshot-4-anywhere.png`
- **Small promo tile (440×280):** `promo-small-440x280.png` · **Marquee (1400×560):** `promo-marquee-1400x560.png` · **Icon:** `icon-128.png`
- **Homepage URL:** `https://<your-domain>/extension`
- **Privacy policy URL:** `https://<your-domain>/privacy`

### Privacy practices tab

**Single purpose:** “Find versions of a product photo the user selects, with the user's requested changes, in the
catalog of the store they are browsing, and verify each result against those changes.”

**Permission justifications:**

| Permission | Justification |
|---|---|
| `sidePanel` | The search UI (edit box, results) lives in the browser side panel next to the store page. |
| `contextMenus` | Adds “This, but…” to the right-click menu on images, so users can start a search from any product photo. |
| `storage` | Saves the user's settings and an anonymous random device ID locally. |
| `scripting` | Injects the content script into tabs that were already open when the extension was installed, so the hover button and product reading work without reloading. |
| `tabs` | Reads the active tab's URL and title to know which store to search, opens result product pages in a new tab, and captures the visible tab only as a fallback to read the selected product photo when the store blocks downloading it. |
| Host permission `<all_urls>` | Users shop on any store. The extension shows the hover button on product images, reads the current store's public product feed (`/products.json`, the WooCommerce Store API, or the sitemap and product pages) to search that store, and downloads the selected product photo. Nothing is read until the user clicks “This, but…”. |
| Remote code | **No.** All code ships in the package; the server only returns JSON search results. |

**Data usage** (check these boxes):
- **Website content:** yes. The selected product photo, product titles, prices and public product pages of the store
  being searched.
- Everything else (personally identifiable info, health, financial/payment, authentication, personal communications,
  location, web history, user activity): **no**.
- Certify: not sold to third parties; not used or transferred for purposes unrelated to the single purpose; not used
  to determine creditworthiness or for lending.

## After approval

1. Copy the listing URL into `NEXT_PUBLIC_CHROME_STORE_URL` on Railway and redeploy, so `/extension` gets an
   “Add to Chrome” button.
2. Updating: bump `--version`, run `npm run ext:pack`, then upload the new zip in the dashboard (Package → Upload new
   package).
