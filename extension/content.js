// ThisBut content script: a "This, but…" button on hovered product photos, and product collection
// (Shopify /products.json when available, otherwise the product images on the current page).
(() => {
  if (window.__thisbut) return;
  window.__thisbut = true;

  const MIN_SIDE = 140;
  let current = null;

  // --- floating button (shadow DOM so site CSS can't touch it) ---
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;z-index:2147483647;top:0;left:0;display:none;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>
    button{all:initial;cursor:pointer;background:#ff6fb5;color:#fff;padding:10px 14px;box-shadow:0 6px 18px rgba(0,0,0,.18);
      font:italic 900 12px/1 "Arial Black","Avenir Next Heavy","Helvetica Neue",sans-serif;letter-spacing:.06em;text-transform:uppercase;
      display:inline-flex;align-items:center;gap:6px;white-space:nowrap;transition:background .12s ease,transform .12s ease}
    button:hover{background:#111;transform:translateY(-1px)} span.star{font-style:normal}
  </style><button type="button" title="Find this with your edits — ThisBut"><span class="star">✦</span>This, but…</button>`;
  const btn = root.querySelector("button");
  (document.body || document.documentElement).appendChild(host);

  function bestSrc(img) {
    const src = img.currentSrc || img.src || "";
    if (!/^https?:/.test(src)) return "";
    return src;
  }

  function productTitle(img) {
    const card = img.closest("a, li, article, [class*=product i], [class*=card i]");
    const fromCard = card?.querySelector("h1,h2,h3,h4,[class*=title i],[class*=name i]")?.textContent?.trim();
    const og = document.querySelector('meta[property="og:title"]')?.content;
    const h1 = document.querySelector("h1")?.textContent?.trim();
    return (fromCard || img.alt || h1 || og || document.title || "").replace(/\s+/g, " ").slice(0, 200);
  }

  function imgAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === host) return null;
      const img = el.tagName === "IMG" ? el : el.querySelector?.(":scope > img, :scope > picture > img");
      if (img && img.tagName === "IMG") {
        const r = img.getBoundingClientRect();
        if (r.width >= MIN_SIDE && r.height >= MIN_SIDE && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && bestSrc(img)) return img;
      }
    }
    return null;
  }

  function place(img) {
    const r = img.getBoundingClientRect();
    host.style.left = `${Math.max(4, r.right - 150)}px`;
    host.style.top = `${Math.max(4, r.top + 10)}px`;
    host.style.display = "block";
  }

  let raf = 0;
  document.addEventListener(
    "mousemove",
    (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (e.composedPath().includes(host)) return;
        const img = imgAt(e.clientX, e.clientY);
        if (img) {
          current = img;
          place(img);
        } else if (current) {
          const r = current.getBoundingClientRect();
          const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
          if (!inside) {
            current = null;
            host.style.display = "none";
          }
        }
      });
    },
    { passive: true },
  );
  window.addEventListener("scroll", () => current && place(current), { passive: true });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!current) return;
    chrome.runtime.sendMessage({ type: "thisbut:source", imageUrl: bestSrc(current), title: productTitle(current), pageUrl: location.href });
  });

  // --- products visible on this page (the side panel adds the whole-store catalog) ---
  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function pageProducts(max) {
    const seen = new Set();
    const out = [];
    for (const img of document.images) {
      const r = img.getBoundingClientRect();
      const src = bestSrc(img);
      const w = Math.max(r.width, img.naturalWidth ? Math.min(img.naturalWidth, 600) : 0);
      const h = Math.max(r.height, img.naturalHeight ? Math.min(img.naturalHeight, 600) : 0);
      if (!src || w < 120 || h < 120 || seen.has(src)) continue;
      seen.add(src);
      const link = img.closest("a[href]");
      const card = img.closest("li, article, [class*=product i], [class*=card i], [class*=item i]") || link || img.parentElement;
      const text = (card?.innerText || "").replace(/\s+/g, " ");
      const m = text.match(/(?:\$|€|£)\s?(\d{1,4}(?:[.,]\d{2})?)/);
      out.push({
        id: hash(src),
        title: (card?.querySelector("h2,h3,h4,[class*=title i],[class*=name i]")?.textContent || img.alt || "").trim().slice(0, 200),
        price: m ? parseFloat(m[1].replace(",", ".")) : null,
        image: src,
        url: link ? link.href : location.href,
      });
      if (out.length >= max) break;
    }
    return out;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === "thisbut:ping") {
      reply({ ok: true });
      return false;
    }
    if (msg?.type === "thisbut:rect") {
      // Locate the clicked photo so the panel can crop it from a screenshot if the image can't be downloaded.
      const key = (u) => {
        try {
          const x = new URL(u, location.href);
          return x.host + x.pathname;
        } catch {
          return u;
        }
      };
      const want = key(msg.imageUrl);
      const img = [...document.images].find((i) => key(bestSrc(i)) === want || key(i.src) === want);
      if (!img) {
        reply({ found: false });
        return false;
      }
      img.scrollIntoView({ block: "center", inline: "center" });
      host.style.display = "none";
      setTimeout(() => {
        const r = img.getBoundingClientRect();
        reply({ found: true, x: r.left, y: r.top, w: r.width, h: r.height, dpr: window.devicePixelRatio || 1 });
      }, 350);
      return true;
    }
    if (msg?.type !== "thisbut:collect") return false;
    try {
      reply({ kind: "page", origin: location.origin, pageUrl: location.href, items: pageProducts(Math.min(msg.max || 120, 200)) });
    } catch (e) {
      reply({ error: String(e) });
    }
    return false;
  });
})();
