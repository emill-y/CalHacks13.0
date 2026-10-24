// ThisBut side panel: takes the product photo the shopper picked on any site, indexes the store's catalog
// (via the content script) on the ThisBut server, and runs the verified "This, but…" search against it.

const $ = (id) => document.getElementById(id);
const EXAMPLES = ["without the ribbon", "in black", "longer sleeves", "under $50"];
const DEFAULTS = { serverUrl: self.THISBUT_CONFIG?.serverUrl || "http://localhost:3000", maxItems: 400 };

const KIND_LABEL = {
  shopify: "Shopify catalog",
  woocommerce: "WooCommerce catalog",
  sitemap: "Store catalog",
  catalog: "Store catalog",
  page: "Products on this page",
};

const state = {
  tabId: null,
  tabUrl: "",
  source: null, // { imageUrl, title, pageUrl }
  store: null, // { storeId, count, kind, origin }
  lastSpec: null,
  busy: false,
};
let settings = { ...DEFAULTS };

// ---------- helpers ----------
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
}
const show = (id, on = true) => ($(id).hidden = !on);
const server = (p) => settings.serverUrl.replace(/\/+$/, "") + p;
const price = (n) => (typeof n === "number" && n >= 0 ? `$${n.toFixed(2)}` : "");
const hostOf = (u) => {
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return "";
  }
};

async function deviceId() {
  const { deviceId: id } = await chrome.storage.local.get("deviceId");
  if (id) return id;
  const fresh = crypto.randomUUID();
  await chrome.storage.local.set({ deviceId: fresh });
  return fresh;
}

async function readNdjson(res, onEvent) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
}

function setError(msg) {
  $("error").textContent = msg || "";
  show("error", Boolean(msg));
}

// ---------- settings ----------
async function loadSettings() {
  settings = { ...DEFAULTS, ...(await chrome.storage.local.get(["serverUrl", "maxItems"])) };
  $("serverUrl").value = settings.serverUrl;
  $("maxItems").value = settings.maxItems;
}
async function checkHealth() {
  try {
    const r = await fetch(server("/api/health"));
    const j = await r.json();
    $("health").textContent = j.apiKey ? `Connected · ${j.products} products · ${j.model}` : "Connected, but ANTHROPIC_API_KEY is not set on the server";
    return j;
  } catch {
    $("health").textContent = `Can’t reach ${settings.serverUrl} — is the ThisBut server running?`;
    return null;
  }
}
$("settingsBtn").onclick = () => {
  show("settings", $("settings").hidden);
  checkHealth();
};
$("saveSettings").onclick = async () => {
  const serverUrl = $("serverUrl").value.trim() || DEFAULTS.serverUrl;
  const maxItems = Math.min(600, Math.max(20, Number($("maxItems").value) || DEFAULTS.maxItems));
  await chrome.storage.local.set({ serverUrl, maxItems });
  await loadSettings();
  await checkHealth();
  refreshStoreStatus();
};

// ---------- source (the clicked product photo) ----------
async function loadActiveTab() {
  // ?tab=<id> pins the panel to a tab (used when the panel is opened as a normal page, e.g. in tests)
  const pinned = Number(new URLSearchParams(location.search).get("tab"));
  const [tab] = pinned ? [await chrome.tabs.get(pinned)] : await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  state.tabId = tab.id;
  state.tabUrl = tab.url || "";
  const key = `src:${tab.id}`;
  const got = await chrome.storage.session.get(key);
  setSource(got[key] || null);
  refreshStoreStatus();
}

function setSource(src) {
  state.source = src;
  state.lastSpec = null;
  show("empty", !src);
  show("sourceCard", Boolean(src));
  show("editForm", Boolean(src));
  if (!src) {
    show("storeStatus", false);
    return;
  }
  $("sourceImg").src = src.imageUrl;
  $("sourceTitle").textContent = src.title || "Selected product";
  $("sourceHost").textContent = hostOf(src.pageUrl);
  show("results", false);
  setError("");
  $("edit").focus();
}

$("clearSource").onclick = async () => {
  if (state.tabId) await chrome.storage.session.remove(`src:${state.tabId}`);
  setSource(null);
};

chrome.storage.session.onChanged.addListener((changes) => {
  const key = `src:${state.tabId}`;
  if (changes[key]) setSource(changes[key].newValue || null);
});
chrome.tabs.onActivated.addListener(loadActiveTab);
chrome.tabs.onUpdated.addListener((id, info) => id === state.tabId && info.status === "complete" && loadActiveTab());

// ---------- store indexing ----------

async function sendToTab(msg) {
  try {
    return await chrome.tabs.sendMessage(state.tabId, msg);
  } catch {
    // Tab was open before the extension was installed: inject the content script, then retry.
    await chrome.scripting.executeScript({ target: { tabId: state.tabId }, files: ["content.js"] });
    return chrome.tabs.sendMessage(state.tabId, msg);
  }
}

async function refreshStoreStatus() {
  state.store = null;
  if (!state.source) {
    show("storeStatus", false);
    return;
  }
  show("storeStatus", true);
  $("storeStatus").textContent = "Checking this store…";
  try {
    const origin = new URL(state.source.pageUrl || state.tabUrl).origin;
    // Prefer a whole-store catalog cached for this host, else one for this page.
    for (const kind of ["catalog", "page"]) {
      const q = new URLSearchParams({ origin, kind, pageUrl: state.source.pageUrl || state.tabUrl });
      const r = await fetch(server(`/api/stores/index?${q}`));
      const j = await r.json();
      if (j.indexed && j.count > 0) {
        state.store = { storeId: j.storeId, count: j.count, kind: j.kind || kind, origin };
        $("storeStatus").replaceChildren(
          `${KIND_LABEL[j.kind] || KIND_LABEL[kind]}: ${j.count} items indexed · `,
          el("button", { class: "link small", onclick: () => indexStore(true) }, "refresh"),
        );
        return;
      }
    }
    $("storeStatus").textContent = "This store isn’t indexed yet — it will be indexed on your first search (≈20–90 s the first time, then cached).";
  } catch {
    $("storeStatus").textContent = `Can’t reach the ThisBut server at ${settings.serverUrl}. Open ⚙ to set it.`;
  }
}

async function indexStore(force = false) {
  if (state.store && !force) return state.store;
  const status = (t) => ($("storeStatus").textContent = t);
  const pageUrl = state.source?.pageUrl || state.tabUrl;
  const origin = new URL(pageUrl).origin;

  // Products visible on this page (always included, so what the shopper sees is searchable).
  status("Collecting products on this page…");
  let pageItems = [];
  try {
    const got = await sendToTab({ type: "thisbut:collect", max: 120 });
    pageItems = got?.items || [];
  } catch {}

  // The whole store: Shopify → WooCommerce → sitemap + product pages.
  const catalog = await collectStoreCatalog({ origin, pageUrl, title: state.source?.title, max: settings.maxItems, onStatus: status });
  const seen = new Set();
  const key = (u) => {
    try {
      const x = new URL(u);
      return x.host + x.pathname; // same photo at a different size (?width=…) is the same product
    } catch {
      return u;
    }
  };
  const merge = (xs) => xs.filter((i) => i.image && !seen.has(key(i.image)) && seen.add(key(i.image)));
  const collected = catalog
    ? { kind: catalog.kind, origin, pageUrl, items: [...merge(catalog.items), ...merge(pageItems)] }
    : { kind: "page", origin, pageUrl, items: merge(pageItems) };
  if (!collected.items.length) throw new Error("No product photos found on this page or in this store’s catalog.");
  status(`${KIND_LABEL[collected.kind]}: indexing ${collected.items.length} products…`);
  show("indexBar", true);
  const res = await fetch(server("/api/stores/index"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(collected),
  });
  if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `Indexing failed (${res.status})`);
  let result = null;
  await readNdjson(res, (ev) => {
    if (ev.stage === "index") $("indexBar").firstElementChild.style.width = `${Math.round((100 * ev.done) / Math.max(1, ev.total))}%`;
    if (ev.stage === "error") throw new Error(ev.error);
    if (ev.stage === "done") result = ev;
  });
  show("indexBar", false);
  if (!result) throw new Error("Indexing ended unexpectedly");
  state.store = { storeId: result.storeId, count: result.count, kind: collected.kind, origin: collected.origin };
  $("storeStatus").replaceChildren(
    `${KIND_LABEL[collected.kind]}: ${result.count} clothing items indexed (${result.skipped} skipped) · `,
    el("button", { class: "link small", onclick: () => indexStore(true) }, "refresh"),
  );
  return state.store;
}

// ---------- grab the clicked photo in the browser ----------
// Store CDNs often refuse server-side downloads (403). The browser can see the image, so fetch it here,
// or as a last resort crop it out of a screenshot of the visible tab.
async function toJpegBase64(bitmap, crop) {
  const sx = crop ? crop.x : 0, sy = crop ? crop.y : 0;
  const sw = crop ? crop.w : bitmap.width, sh = crop ? crop.h : bitmap.height;
  const scale = Math.min(1, 768 / Math.max(sw, sh));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(sw * scale)), Math.max(1, Math.round(sh * scale)));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.88 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function grabSourceImage() {
  const url = state.source.imageUrl;
  try {
    const r = await fetch(url, { credentials: "include" });
    if (r.ok) {
      const blob = await r.blob();
      if (blob.type.startsWith("image/") || blob.size > 1000) return await toJpegBase64(await createImageBitmap(blob));
    }
  } catch {}
  try {
    const rect = await sendToTab({ type: "thisbut:rect", imageUrl: url });
    if (rect?.found && rect.w > 20 && rect.h > 20) {
      const tab = await chrome.tabs.get(state.tabId);
      const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      const bmp = await createImageBitmap(await (await fetch(shot)).blob());
      const d = rect.dpr;
      return await toJpegBase64(bmp, { x: Math.max(0, rect.x * d), y: Math.max(0, rect.y * d), w: Math.min(bmp.width, rect.w * d), h: Math.min(bmp.height, rect.h * d) });
    }
  } catch {}
  return null; // fall back to letting the server fetch the URL
}

// ---------- search ----------
EXAMPLES.forEach((ex) =>
  $("examples").append(
    el("button", { type: "button", onclick: () => ($("edit").value = $("edit").value.trim() ? `${$("edit").value.trim()}, ${ex}` : ex) }, ex),
  ),
);

function setStep(stage) {
  const order = ["parse", "retrieve", "verify"];
  const idx = order.indexOf(stage);
  document.querySelectorAll("#steps li").forEach((li, i) => {
    li.classList.toggle("done", i < idx || stage === "done");
    li.classList.toggle("active", i === idx);
  });
}

async function runSearch({ editText, priorSpec, spec }) {
  if (state.busy || !state.source) return;
  if (!editText.trim() && !spec) return setError("Tell us what to change, e.g. “without the ribbon”.");
  state.busy = true;
  $("findBtn").disabled = true;
  $("findBtn").textContent = "Finding…";
  setError("");
  show("results", false);
  try {
    const { storeId } = await indexStore();
    show("steps", true);
    setStep("parse");
    const imageData = await grabSourceImage();
    const res = await fetch(server("/api/search"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId: await deviceId(),
        image: imageData || undefined,
        mediaType: imageData ? "image/jpeg" : undefined,
        imageUrl: state.source.imageUrl,
        sourcePageUrl: state.source.pageUrl,
        sourceTitle: state.source.title,
        editText,
        priorSpec,
        spec,
        store: storeId,
      }),
    });
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `Search failed (${res.status})`);
    await readNdjson(res, (ev) => {
      if (ev.stage === "error") throw new Error(ev.error);
      setStep(ev.stage);
      if (ev.stage === "done") render(ev);
    });
  } catch (e) {
    setError(e.message === "Failed to fetch" ? `Can’t reach the ThisBut server at ${settings.serverUrl}.` : e.message);
  } finally {
    show("steps", false);
    show("indexBar", false);
    state.busy = false;
    $("findBtn").disabled = false;
    $("findBtn").textContent = "Find my version";
  }
}

$("editForm").onsubmit = (e) => {
  e.preventDefault();
  runSearch({ editText: $("edit").value });
};
$("edit").onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    runSearch({ editText: $("edit").value });
  }
};
$("refineForm").onsubmit = (e) => {
  e.preventDefault();
  const t = $("refine").value.trim();
  if (t && state.lastSpec) {
    $("refine").value = "";
    runSearch({ editText: t, priorSpec: state.lastSpec });
  }
};

// ---------- results ----------
const isKeep = (t) => /^keeps\b/i.test(t);

function productHref(p) {
  if (p.url) return p.url;
  return server(`/product/${p.id}`);
}
function productImg(p) {
  return p.image.startsWith("/") ? server(p.image) : p.image;
}

function card(r) {
  const p = r.product;
  const missed = r.checks.filter((c) => !c.pass && !isKeep(c.text));
  const reason = el("div", { class: "muted small" });
  const open = () => chrome.tabs.create({ url: productHref(p) });
  const isMatch = r.allPass && !r.unverified;
  return el(
    "div",
    { class: "card" },
    el(
      "div",
      { class: "photo", onclick: open },
      el("img", { src: productImg(p), alt: p.caption || p.name, loading: "lazy" }),
      r.unverified ? null : el("span", { class: `badge ${isMatch ? "" : "close"}` }, isMatch ? "✓ Match" : "Close"),
    ),
    el(
      "div",
      { class: "body" },
      el("div", { class: "name", title: p.name }, p.name),
      el("div", { class: "price" }, price(p.price)),
      !r.allPass && !r.unverified && missed.length ? el("div", { class: "misses" }, `Misses: ${missed.map((m) => m.text).join("; ")}`) : null,
      el(
        "div",
        { class: "checks" },
        r.checks.map((c) =>
          el(
            "button",
            {
              class: `chk ${c.pass ? "pass" : isKeep(c.text) ? "soft" : "miss"}`,
              title: c.reason,
              onclick: () => (reason.textContent = `“${c.reason}”`),
            },
            `${c.pass ? "✓" : isKeep(c.text) ? "≈" : "✗"} ${c.text.replace(/^keeps\s+/i, "").replace(/\s*\(close shades OK\)/i, "")}`,
          ),
        ),
      ),
      reason,
      el("button", { onclick: open }, "Shop it ↗"),
    ),
  );
}

function specChips(spec) {
  const chips = [
    ...spec.remove.map((v) => ({ t: `no ${v}`, rm: (s) => (s.remove = s.remove.filter((x) => x !== v)) })),
    ...Object.entries(spec.change).map(([k, v]) => ({ t: `${k}: ${v}`, rm: (s) => delete s.change[k] })),
    ...spec.add.map((v) => ({ t: `+ ${v}`, rm: (s) => (s.add = s.add.filter((x) => x !== v)) })),
    ...(spec.maxPrice ? [{ t: `under $${spec.maxPrice}`, rm: (s) => delete s.maxPrice }] : []),
    ...spec.keep.map((v) => ({ t: `keep ${v}`, keep: true, rm: (s) => (s.keep = s.keep.filter((x) => x !== v)) })),
  ];
  return chips.map((c) =>
    el("span", { class: `spec ${c.keep ? "keep" : ""}` }, c.t, " ",
      el("button", { class: "link", title: "Remove this edit", onclick: () => {
        const s = structuredClone(spec);
        c.rm(s);
        runSearch({ editText: "", spec: s });
      } }, "×"),
    ),
  );
}

function render(done) {
  state.lastSpec = done.spec;
  const matches = done.results.filter((r) => r.allPass && !r.unverified);
  const close = done.results.filter((r) => !(r.allPass && !r.unverified));
  $("specChips").replaceChildren(...specChips(done.spec));
  $("discarded").textContent = done.photoDiscarded ? "Photo discarded ✓" : "";
  $("timing").textContent = `${(done.timings.total / 1000).toFixed(1)} s`;
  show("unverified", !done.verified);
  $("matchCount").textContent = matches.length ? `(${matches.length})` : "";
  $("matches").replaceChildren(...(matches.length ? matches.map(card) : [el("p", { class: "muted small" }, "Nothing passed every edit yet.")]));
  $("closeTitle").textContent = done.verified ? "Close, but…" : "Similar items (unverified)";
  show("closeTitle", close.length > 0);
  $("close").replaceChildren(...close.map(card));
  renderWish(done);
  show("results", true);
}

function renderWish(done) {
  const box = $("wish");
  box.replaceChildren();
  if (done.fullMatchCount >= 3) return;
  const pay = el("input", { inputmode: "numeric", placeholder: "__" });
  const btn = el("button", { class: "primary" }, "Save my wish");
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const res = await fetch(server("/api/wishes"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deviceId: await deviceId(),
          spec: done.spec,
          nearestProductId: done.nearestProductId,
          maxPay: pay.value ? Number(pay.value.replace(/\D/g, "")) : undefined,
        }),
      });
      if (!res.ok) throw new Error("Could not save wish");
      box.replaceChildren(el("p", { class: "small" }, `✓ Saved “${done.spec.label}”. Stores see it as anonymous demand — never your photo.`));
    } catch (e) {
      btn.disabled = false;
      setError(e.message);
    }
  };
  box.append(
    el("div", { class: "wish" },
      el("h3", {}, "Not quite there? I’d buy this."),
      el("div", { class: "small" }, `Save “${done.spec.label}” as a wish.`),
      el("div", { class: "row" }, el("span", { class: "small" }, "up to $"), pay, btn),
    ),
  );
}

// ---------- boot ----------
(async () => {
  await loadSettings();
  await loadActiveTab();
  const h = await checkHealth();
  if (!h) setError(`Can’t reach the ThisBut server at ${settings.serverUrl}. Start it with “npm run dev”, or set the URL in ⚙.`);
})();
