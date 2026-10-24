// ThisBut store-catalog discovery, run from the side panel (an extension page, so no CORS limits).
// Tries, in order: Shopify /products.json → WooCommerce Store API → sitemap + schema.org Product pages.
// Returns { kind, items: [{ id, title, price, image, url, color }] } or null if no catalog was found.

/* exported collectStoreCatalog */

const APPAREL = /\b(dress|top|tank|cami|corset|blouse|shirt|tee|t-shirt|skirt|skort|pant|trouser|jean|denim|short|jacket|coat|blazer|sweater|knit|cardigan|hoodie|sweatshirt|jumpsuit|romper|bodysuit|legging|vest|halter|crop|clothing|apparel|women|men)s?\b/;
const NON_APPAREL = /\b(bag|shoe|boot|sandal|sneaker|heel|ring|necklace|bracelet|earring|jewel|watch|sunglass|perfume|beauty|candle|gift-card|giftcard|home|decor)s?\b/;
const STOP = new Set(["the", "and", "with", "for", "new", "women", "womens", "mens", "shop", "collections", "products", "product", "item", "html", "www", "com"]);

async function getText(url, ms = 12000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), credentials: "omit", redirect: "follow" });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
async function getJson(url, ms = 12000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), credentials: "omit", headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  if (!(r.headers.get("content-type") || "").includes("json")) throw new Error("not json");
  return r.json();
}
function abs(u, base) {
  try {
    return new URL(u, base).href;
  } catch {
    return null;
  }
}
function num(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ---------- 1. Shopify ----------
async function shopify(origin, max, onStatus) {
  const out = [];
  for (let page = 1; out.length < max && page <= 10; page++) {
    let data;
    try {
      data = await getJson(`${origin}/products.json?limit=250&page=${page}`);
    } catch {
      break;
    }
    if (!Array.isArray(data.products) || !data.products.length) break;
    for (const p of data.products) {
      const img = p.images?.[0]?.src;
      if (!img) continue;
      const u = new URL(img, origin);
      u.searchParams.set("width", "600");
      const colorOpt = (p.options || []).find((o) => /colou?r/i.test(o.name));
      out.push({
        id: String(p.id),
        title: p.title || "",
        price: num(p.variants?.[0]?.price),
        image: u.href,
        url: `${origin}/products/${p.handle}`,
        color: colorOpt?.values?.[0],
      });
      if (out.length >= max) break;
    }
    onStatus(`Shopify catalog: ${out.length} products…`);
  }
  return out;
}

// ---------- 2. WooCommerce Store API ----------
async function woocommerce(origin, max, onStatus) {
  const out = [];
  for (let page = 1; out.length < max && page <= 10; page++) {
    let data;
    try {
      data = await getJson(`${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
    } catch {
      break;
    }
    if (!Array.isArray(data) || !data.length) break;
    for (const p of data) {
      const img = p.images?.[0]?.src;
      if (!img) continue;
      const minor = Number(p.prices?.currency_minor_unit ?? 2);
      const raw = num(p.prices?.price);
      out.push({
        id: String(p.id),
        title: (p.name || "").replace(/<[^>]+>/g, ""),
        price: raw === null ? null : raw / 10 ** minor,
        image: img,
        url: p.permalink,
      });
      if (out.length >= max) break;
    }
    onStatus(`WooCommerce catalog: ${out.length} products…`);
  }
  return out;
}

// ---------- 3. Sitemap + schema.org Product ----------
function keywordsFrom(pageUrl, title) {
  const words = `${title || ""} ${new URL(pageUrl).pathname}`.toLowerCase().split(/[^a-z0-9]+/);
  return [...new Set(words.filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)))];
}

async function sitemapUrls(origin, onStatus) {
  const queue = [];
  try {
    const robots = await getText(`${origin}/robots.txt`, 8000);
    for (const m of robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)) queue.push(m[1]);
  } catch {}
  if (!queue.length) queue.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`);

  const seenMaps = new Set();
  const urls = new Map(); // loc -> image (from image sitemaps, if present)
  let files = 0;
  while (queue.length && files < 14 && urls.size < 20000) {
    // Prefer product sitemaps when an index lists many.
    queue.sort((a, b) => Number(/product/i.test(b)) - Number(/product/i.test(a)));
    const sm = queue.shift();
    if (seenMaps.has(sm)) continue;
    seenMaps.add(sm);
    let xml;
    try {
      xml = await getText(sm, 15000);
    } catch {
      continue;
    }
    files++;
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const children = [...doc.getElementsByTagNameNS("*", "sitemap")].map((n) => n.getElementsByTagNameNS("*", "loc")[0]?.textContent?.trim()).filter(Boolean);
    if (children.length) {
      const productish = children.filter((c) => /product/i.test(c));
      queue.push(...(productish.length ? productish : children));
      continue;
    }
    for (const u of doc.getElementsByTagNameNS("*", "url")) {
      const loc = u.getElementsByTagNameNS("*", "loc")[0]?.textContent?.trim();
      if (!loc) continue;
      const imgNode = u.getElementsByTagNameNS("*", "image")[0];
      const img = imgNode?.getElementsByTagNameNS("*", "loc")[0]?.textContent?.trim() || null;
      urls.set(loc, img);
    }
    onStatus(`Reading sitemap: ${urls.size} URLs…`);
  }
  return urls;
}

function rankUrls(urls, keywords) {
  const scored = [];
  for (const [loc, img] of urls) {
    const l = loc.toLowerCase();
    let s = 0;
    for (const k of keywords) if (l.includes(k)) s += 1;
    if (APPAREL.test(l)) s += 0.5;
    if (NON_APPAREL.test(l)) s -= 3;
    if (/\/(products?|p|item|dp)\/|-p\d+|\d{5,}/.test(l)) s += 0.5; // looks like a product page
    if (/\/(blog|pages|policies|account|cart|search|help|about|stores?)\b/.test(l)) s -= 5;
    scored.push({ loc, img, s });
  }
  return scored.sort((a, b) => b.s - a.s);
}

function findProducts(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n) => findProducts(n, out));
  const t = [].concat(node["@type"] || []).map(String);
  if (t.includes("Product") || t.includes("ProductGroup")) out.push(node);
  if (node["@graph"]) findProducts(node["@graph"], out);
  if (node.mainEntity) findProducts(node.mainEntity, out);
}

function priceOf(p) {
  const offers = [].concat(p.offers || [], ...(p.hasVariant || []).map((v) => v.offers || []));
  for (const o of offers) {
    const v = num(o.price ?? o.lowPrice ?? o.priceSpecification?.price);
    if (v) return v;
  }
  return null;
}
function imageOf(img) {
  const first = [].concat(img || [])[0];
  return typeof first === "string" ? first : first?.url || first?.contentUrl || null;
}

async function productFromPage(url, fallbackImg) {
  const html = await getText(url, 12000);
  const doc = new DOMParser().parseFromString(html, "text/html");
  const found = [];
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      findProducts(JSON.parse(s.textContent), found);
    } catch {}
  }
  const p = found[0];
  const meta = (k) => doc.querySelector(`meta[property="${k}"], meta[name="${k}"]`)?.getAttribute("content");
  const title = (p?.name || meta("og:title") || "").trim();
  const image = abs(imageOf(p?.image) || meta("og:image") || fallbackImg, url);
  const price = (p && priceOf(p)) || num(meta("product:price:amount") || meta("og:price:amount"));
  const isProduct = Boolean(p) || meta("og:type") === "product" || Boolean(meta("product:price:amount"));
  if (!isProduct || !image || !title) return null;
  const color = p?.color || undefined;
  return { id: url, title, price, image, url, color: typeof color === "string" ? color : undefined };
}

async function pool(xs, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (i < xs.length) await fn(xs[i++]);
  }));
}

async function sitemapCatalog(origin, pageUrl, title, max, onStatus) {
  const urls = await sitemapUrls(origin, onStatus);
  if (!urls.size) return [];
  const ranked = rankUrls(urls, keywordsFrom(pageUrl, title)).filter((r) => r.s > -1);
  const candidates = ranked.slice(0, Math.min(ranked.length, Math.round(max * 1.6)));
  const out = [];
  let tried = 0;
  let failures = 0;
  const deadline = Date.now() + 90_000;
  await pool(candidates, 8, async (c) => {
    if (out.length >= max || Date.now() > deadline || (tried >= 20 && failures / tried > 0.9)) return;
    tried++;
    try {
      const prod = await productFromPage(c.loc, c.img);
      if (prod) out.push(prod);
      else failures++;
    } catch {
      failures++;
    }
    if (tried % 5 === 0) onStatus(`Reading product pages: ${out.length} products (${tried}/${candidates.length})…`);
  });
  return out.slice(0, max);
}

// ---------- entry ----------
async function collectStoreCatalog({ origin, pageUrl, title, max = 400, onStatus = () => {} }) {
  onStatus("Looking for this store’s catalog…");
  const tries = [
    ["shopify", () => shopify(origin, max, onStatus)],
    ["woocommerce", () => woocommerce(origin, max, onStatus)],
    ["sitemap", () => sitemapCatalog(origin, pageUrl, title, max, onStatus)],
  ];
  for (const [kind, run] of tries) {
    try {
      const items = await run();
      if (items.length >= 8) return { kind, items };
    } catch {}
  }
  return null;
}
