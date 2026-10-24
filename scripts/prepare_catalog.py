#!/usr/bin/env python3
"""One-time catalog builder for ThisBut.

Writes public/catalog/{id}.jpg (384 px, JPEG q80), data/catalog.json and
data/catalog_meta.json (ground-truth details for eval).

Source order:
  1. Hugging Face "tomytjandra/h-and-m-fashion-caption-12k" (datasets library)
  2. Hugging Face "ashraq/fashion-product-images-small"
  3. Fashionpedia (CC BY 4.0, hosted on S3): garments are cut out with their
     segmentation masks onto white, and captions are built from the human
     annotated attributes and parts (bow, ribbon, ruffle, sleeve length, ...).
     Used automatically when the Hub is unreachable.

Usage: python3 scripts/prepare_catalog.py [--n 3000] [--source hm|ashraq|fashionpedia]
"""
import argparse
import io
import json
import os
import random
import re
import sys
import urllib.request
import zipfile
from collections import Counter, defaultdict

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, "public", "catalog")
DATA_DIR = os.path.join(ROOT, "data")
CACHE = os.environ.get("FASHIONPEDIA_CACHE", os.path.join(ROOT, ".cache", "fashionpedia"))
SIZE = 384

CATEGORIES = ["Top", "Blouse", "Shirt", "T-shirt", "Dress", "Skirt", "Trousers", "Jeans", "Jacket", "Knitwear"]
PRICE_RANGES = {
    "Top": (15, 45), "Blouse": (25, 70), "Shirt": (25, 70), "T-shirt": (15, 35), "Dress": (35, 120),
    "Skirt": (25, 75), "Trousers": (30, 90), "Jeans": (35, 100), "Jacket": (50, 120), "Knitwear": (30, 95),
}
CATEGORY_KEYWORDS = [  # order matters: first hit wins
    ("Jeans", ["jeans", "denim trousers", "denim pants"]),
    ("Dress", ["dress"]),
    ("Skirt", ["skirt"]),
    ("Jacket", ["jacket", "blazer", "coat", "parka", "bomber"]),
    ("Knitwear", ["sweater", "jumper", "cardigan", "knit", "pullover"]),
    ("Trousers", ["trousers", "pants", "chinos", "joggers", "leggings"]),
    ("Blouse", ["blouse"]),
    ("Shirt", ["shirt"]),  # after t-shirt check below
    ("T-shirt", ["t-shirt", "tshirt", "tee"]),
    ("Top", ["top", "camisole", "vest", "tank", "bodysuit"]),
]
COLORS = ["black", "white", "grey", "beige", "brown", "red", "pink", "orange", "yellow", "green",
          "blue", "navy", "purple", "khaki", "cream", "burgundy", "turquoise"]
DETAIL_WORDS = ["bow", "ribbon", "tie", "ruffle", "frill", "lace", "button", "pocket", "zip", "hood", "collar"]


def category_from_text(t):
    t = t.lower()
    if re.search(r"\bt-?shirt|\btee\b", t):
        return "T-shirt"
    for cat, kws in CATEGORY_KEYWORDS:
        if any(re.search(r"\b" + re.escape(k), t) for k in kws):
            return cat
    return None


def color_from_text(t):
    t = t.lower().replace("gray", "grey")
    for c in ["navy", "burgundy", "turquoise", "khaki", "cream", "beige"] + COLORS:
        if re.search(r"\b" + c + r"\b", t):
            return c
    return "multi"


def short_name(caption, category, color):
    t = caption.lower()
    detail = next((d for d in DETAIL_WORDS if re.search(r"\b" + d, t)), None)
    words = [w.capitalize() for w in ([f"{detail}-detail"] if detail else []) + [color if color != "multi" else ""]]
    return " ".join([w for w in words if w] + [category])


def save_jpeg(img, path):
    img = img.convert("RGB")
    w, h = img.size
    side = max(w, h)
    canvas = Image.new("RGB", (side, side), (255, 255, 255))
    canvas.paste(img, ((side - w) // 2, (side - h) // 2))
    canvas.resize((SIZE, SIZE), Image.LANCZOS).save(path, "JPEG", quality=80, optimize=True)


# ---------------------------------------------------------------- HF sources
def from_hf(name, n, rng):
    from datasets import load_dataset  # noqa: WPS433

    ds = load_dataset(name, split="train")
    per_cat = n // len(CATEGORIES) + 1
    buckets = defaultdict(list)
    for i, row in enumerate(ds):
        if name.startswith("tomytjandra"):
            caption = row["text"]
            cat = category_from_text(caption)
            color = color_from_text(caption)
        else:
            caption = row["productDisplayName"] or ""
            cat = category_from_text(f'{row["articleType"]} {caption}')
            color = (row["baseColour"] or "multi").lower().replace("gray", "grey")
            caption = f"{color} {row['articleType']}, {caption}".strip()
        if not cat:
            continue
        has_bow = bool(re.search(r"\b(bow|ribbon|tie-neck|tie neck|pussy-bow|tie detail)", caption.lower()))
        buckets[cat].append((has_bow, i, caption, color))
    picked = []
    for cat in CATEGORIES:
        rows = buckets.get(cat, [])
        rng.shuffle(rows)
        rows.sort(key=lambda r: not r[0])  # keep every bow/ribbon item first
        picked += [(cat, *r) for r in rows[:per_cat]]
    items = []
    for k, (cat, has_bow, i, caption, color) in enumerate(picked[:n]):
        pid = f"p{k:04d}"
        save_jpeg(ds[i]["image"], os.path.join(IMG_DIR, f"{pid}.jpg"))
        items.append(dict(id=pid, name=short_name(caption, cat, color), category=cat, color=color,
                          caption=caption, meta={"parts": ["bow"] if has_bow else [], "source": name}))
    return items


# ---------------------------------------------------------- Fashionpedia
FP_BASE = "https://s3.amazonaws.com/ifashionist-dataset/"
FP_FILES = {"ann": "annotations/instances_attributes_train2020.json", "zip": "images/train2020.zip"}
GARMENTS = {0: "shirt/blouse", 1: "top", 2: "sweater", 3: "cardigan", 4: "jacket", 6: "pants", 8: "skirt", 9: "coat", 10: "dress"}
PARTS = {38: "bow", 41: "ribbon", 43: "ruffle", 39: "flower", 44: "sequins", 37: "beads", 40: "fringe", 45: "tassels",
         32: "pocket", 27: "hood", 28: "collar", 35: "zipper", 29: "lapel", 34: "buckle", 36: "applique"}
SLEEVE_LEN = {156: "sleeveless", 157: "short-sleeve", 158: "elbow-sleeve", 159: "three-quarter-sleeve", 160: "long-sleeve"}
GARMENT_LEN = {148: "micro", 149: "mini", 150: "above-the-knee", 151: "knee-length", 152: "below-the-knee",
               153: "midi", 154: "maxi", 155: "floor-length", 146: "cropped", 147: "hip-length"}
PATTERNS = {318: "abstract print", 319: "cartoon print", 320: "lettering print", 321: "camouflage", 322: "check",
            323: "polka dot", 325: "floral", 326: "geometric print", 327: "paisley", 328: "striped",
            329: "houndstooth", 332: "argyle", 333: "leopard print", 337: "zebra print", 340: "botanical print"}
FITS = {135: "fitted", 137: "loose", 138: "oversized", 129: "a-line", 127: "pencil", 132: "wide-leg", 118: "flared"}
NECKS = {183: "v-neck", 181: "crew neck", 182: "round neck", 197: "high neck", 198: "turtleneck", 202: "off-the-shoulder",
         189: "boat neck", 190: "scoop neck", 191: "square neck", 187: "sweetheart neckline", 203: "one-shoulder",
         194: "halter neck", 199: "cowl neck"}
DETAIL_PRIORITY = ["bow", "ribbon", "ruffle", "flower", "sequins", "beads", "fringe", "tassels", "hood", "zipper", "buckle"]


NO_DERIVATIVES = {2, 4, 11}  # by-nd, by-nc-nd, all rights reserved


def poly_area(p):
    xs, ys = p[0::2], p[1::2]
    return abs(sum(xs[i] * ys[i - 1] - xs[i - 1] * ys[i] for i in range(len(xs)))) / 2


MIN_SOLIDITY = 0.76


def hull_area(p):
    pts = sorted(set(zip(p[0::2], p[1::2])))
    if len(pts) < 3:
        return 0.0

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for pt in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], pt) <= 0:
            lower.pop()
        lower.append(pt)
    for pt in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], pt) <= 0:
            upper.pop()
        upper.append(pt)
    hull = lower[:-1] + upper[:-1]
    return poly_area([c for xy in hull for c in xy])


def ensure_fp():
    os.makedirs(CACHE, exist_ok=True)
    paths = {}
    for k, rel in FP_FILES.items():
        p = os.path.join(CACHE, os.path.basename(rel))
        if not os.path.exists(p):
            print(f"  downloading {FP_BASE + rel} (one time)")
            with urllib.request.urlopen(FP_BASE + rel, timeout=60) as r, open(p + ".part", "wb") as f:
                while chunk := r.read(1 << 22):
                    f.write(chunk)
            os.replace(p + ".part", p)
        paths[k] = p
    return paths


def name_color(rgb):
    import colorsys

    r, g, b = [x / 255 for x in rgb]
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    h *= 360
    if v < 0.2:
        return "black"
    if s < 0.12:
        return "white" if v > 0.82 else ("grey" if v > 0.3 else "black")
    if s < 0.3 and v > 0.7 and 20 <= h <= 60:
        return "beige"
    if h < 15 or h >= 345:
        return "burgundy" if v < 0.45 else ("pink" if s < 0.45 else "red")
    if h < 40:
        return "brown" if v < 0.6 else ("beige" if s < 0.4 else "orange")
    if h < 65:
        return "khaki" if v < 0.6 else "yellow"
    if h < 165:
        return "green"
    if h < 190:
        return "turquoise"
    if h < 255:
        return "navy" if v < 0.45 else "blue"
    if h < 290:
        return "purple"
    return "pink"


def dominant_color(crop, mask):
    small = crop.resize((48, 48))
    m = mask.resize((48, 48))
    px = [small.getpixel((x, y)) for y in range(48) for x in range(48) if m.getpixel((x, y)) > 128]
    if not px:
        return "multi"
    names = Counter(name_color(p) for p in px)
    top, cnt = names.most_common(1)[0]
    return top if cnt / len(px) > 0.35 else (top if len(names) < 4 else "multi")


def fp_category(cat_id, attrs, parts):
    if cat_id == 0:
        return "Shirt" if ("collar" in parts and 225 in attrs) else "Blouse"
    if cat_id == 1:
        return "T-shirt" if attrs & {0, 4, 5} else "Top"
    if cat_id in (2, 3):
        return "Knitwear"
    if cat_id in (4, 9):
        return "Jacket"
    if cat_id == 6:
        return "Jeans" if 36 in attrs else "Trousers"
    return {8: "Skirt", 10: "Dress"}[cat_id]


def inside(inner, outer, slack=0.1):
    x, y, w, h = inner
    cx, cy = x + w / 2, y + h / 2
    ox, oy, ow, oh = outer
    return ox - ow * slack <= cx <= ox + ow * (1 + slack) and oy - oh * slack <= cy <= oy + oh * (1 + slack)


def from_fashionpedia(n, rng):
    paths = ensure_fp()
    print("  loading annotations…")
    d = json.load(open(paths["ann"]))
    images = {im["id"]: im for im in d["images"]}
    by_img = defaultdict(list)
    for a in d["annotations"]:
        by_img[a["image_id"]].append(a)

    cands = defaultdict(list)
    for img_id, anns in by_img.items():
        garments = [a for a in anns if a["category_id"] in GARMENTS]
        counts = Counter(a["category_id"] for a in garments)
        for gmt in garments:
            if counts[gmt["category_id"]] > 1 or gmt.get("iscrowd") or not isinstance(gmt["segmentation"], list):
                continue
            x, y, w, h = gmt["bbox"]
            im = images[img_id]
            if im.get("license") in NO_DERIVATIVES:
                continue  # cut-outs are derivatives; respect ND / all-rights-reserved licenses
            if min(w, h) < 200 or gmt["area"] / (w * h) < 0.42:
                continue
            if x < 3 or y < 3 or x + w > im["width"] - 3 or y + h > im["height"] - 3:
                continue  # truncated by the photo frame
            areas = sorted((poly_area(p) for p in gmt["segmentation"] if len(p) >= 6), reverse=True)
            if not areas or areas[0] < 0.85 * sum(areas):
                continue  # fragmented mask = garment occluded by arms/hair/bags
            biggest = max((p for p in gmt["segmentation"] if len(p) >= 6), key=poly_area)
            solidity = areas[0] / max(1.0, hull_area(biggest))  # low = big bites out of the silhouette
            attrs = set(gmt["attribute_ids"])
            parts, sleeve = [], None
            for a in anns:
                if a is gmt or a["category_id"] < 27 or not inside(a["bbox"], gmt["bbox"], 0.02):
                    continue
                if a["category_id"] in PARTS:
                    parts.append(PARTS[a["category_id"]])
                if a["category_id"] == 31:  # sleeve
                    for s in a["attribute_ids"]:
                        sleeve = SLEEVE_LEN.get(s, sleeve)
                if a["category_id"] == 33:  # neckline attrs
                    attrs |= set(a["attribute_ids"])
            # Other garments (tops over skirts etc.) overlapping the bbox should not steal parts:
            others = [o for o in garments if o is not gmt]
            parts = sorted(set(parts))
            if gmt["category_id"] in (0, 1, 2, 3, 10) and sleeve is None:
                sleeve = next((SLEEVE_LEN[s] for s in attrs if s in SLEEVE_LEN), None)
            cat = fp_category(gmt["category_id"], attrs, parts)
            cands[cat].append(dict(img=images[img_id], ann=gmt, attrs=attrs, parts=parts, sleeve=sleeve,
                                   n_others=len(others), solidity=solidity))

    per_cat = n // len(CATEGORIES)
    picked = []
    for cat in CATEGORIES:
        rows = cands[cat]
        rng.shuffle(rows)
        # bows/ribbons make silhouettes concave, so they get a looser solidity bar
        special = [r for r in rows if {"bow", "ribbon"} & set(r["parts"]) and r["solidity"] >= 0.6]
        rest = [r for r in rows if not ({"bow", "ribbon"} & set(r["parts"])) and r["solidity"] >= MIN_SOLIDITY]
        cands[cat] = special + rest
        rows = special[: per_cat // 3] + rest
        picked += rows[:per_cat]
        print(f"  {cat:9s} candidates={len(cands[cat]):6d} with bow/ribbon={len(special):4d} picked={min(per_cat, len(rows))}")
    # top up to n from the largest pools
    leftovers = [r for cat in CATEGORIES for r in cands[cat] if r not in picked]
    rng.shuffle(leftovers)
    picked += leftovers[: max(0, n - len(picked))]

    rng.shuffle(picked)  # interleave categories in id order
    zf = zipfile.ZipFile(paths["zip"])
    names = {os.path.basename(z): z for z in zf.namelist()}
    items = []
    for k, r in enumerate(picked):
        pid = f"p{k:04d}"
        im = Image.open(io.BytesIO(zf.read(names[r["img"]["file_name"]]))).convert("RGB")
        x, y, w, h = [int(v) for v in r["ann"]["bbox"]]
        mask = Image.new("L", im.size, 0)
        draw = ImageDraw.Draw(mask)
        for poly in r["ann"]["segmentation"]:
            if len(poly) >= 6:
                draw.polygon(poly, fill=255)
        box = (max(0, x), max(0, y), min(im.width, x + w), min(im.height, y + h))
        crop, cmask = im.crop(box), mask.crop(box)
        white = Image.new("RGB", crop.size, (255, 255, 255))
        cut = Image.composite(crop, white, cmask)
        pad = int(max(cut.size) * 0.06)
        padded = Image.new("RGB", (cut.width + 2 * pad, cut.height + 2 * pad), (255, 255, 255))
        padded.paste(cut, (pad, pad))
        save_jpeg(padded, os.path.join(IMG_DIR, f"{pid}.jpg"))

        cat = fp_category(r["ann"]["category_id"], r["attrs"], r["parts"])
        color = dominant_color(crop, cmask)
        pattern = next((PATTERNS[a] for a in r["attrs"] if a in PATTERNS), None)
        fit = next((FITS[a] for a in r["attrs"] if a in FITS), None)
        neck = next((NECKS[a] for a in r["attrs"] if a in NECKS), None)
        length = next((GARMENT_LEN[a] for a in r["attrs"] if a in GARMENT_LEN), None)
        details = [p for p in DETAIL_PRIORITY if p in r["parts"]]
        noun = cat.lower()
        lead = " ".join(w for w in [color if color != "multi" else "multicolor", pattern, fit,
                                    r["sleeve"] if cat not in ("Skirt", "Trousers", "Jeans") else None,
                                    length if cat in ("Dress", "Skirt") else None, noun] if w)
        tail = []
        if details:
            tail.append("with " + " and ".join(("a " + d) if d in ("bow", "ribbon", "ruffle", "flower", "hood", "zipper", "buckle") else d
                                                 for d in details[:2]))
        if neck and cat not in ("Skirt", "Trousers", "Jeans"):
            tail.append(neck)
        if "pocket" in r["parts"]:
            tail.append("pockets")
        caption = lead + ((" " + ", ".join(tail)) if tail else "")
        name_bits = []
        if details:
            name_bits.append(details[0].capitalize() + "-Detail")
        elif pattern:
            name_bits.append(pattern.split()[0].capitalize())
        name_bits.append(color.capitalize() if color != "multi" else "Multicolor")
        name_bits.append(cat)
        items.append(dict(id=pid, name=" ".join(name_bits), category=cat, color=color, caption=caption,
                          meta={"parts": r["parts"], "sleeve": r["sleeve"], "pattern": pattern, "length": length,
                                "source": "fashionpedia", "fp_image": r["img"]["file_name"],
                                "license": r["img"].get("license")}))
        if (k + 1) % 250 == 0:
            print(f"  wrote {k + 1}/{len(picked)}")
    return items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=3000)
    ap.add_argument("--source", choices=["hm", "ashraq", "fashionpedia"], default=None)
    ap.add_argument("--seed", type=int, default=13)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    os.makedirs(IMG_DIR, exist_ok=True)
    os.makedirs(DATA_DIR, exist_ok=True)
    for f in os.listdir(IMG_DIR):
        if f.endswith(".jpg"):
            os.remove(os.path.join(IMG_DIR, f))

    order = [args.source] if args.source else ["hm", "ashraq", "fashionpedia"]
    items, used = None, None
    for src in order:
        try:
            print(f"Source: {src}")
            if src == "hm":
                items = from_hf("tomytjandra/h-and-m-fashion-caption-12k", args.n, rng)
            elif src == "ashraq":
                items = from_hf("ashraq/fashion-product-images-small", args.n, rng)
            else:
                items = from_fashionpedia(args.n, rng)
            used = src
            break
        except Exception as e:  # noqa: BLE001
            print(f"  {src} failed: {type(e).__name__}: {str(e)[:200]}")
    if not items:
        sys.exit("No catalog source available")

    prng = random.Random(args.seed + 1)
    catalog, meta = [], {}
    for it in items:
        lo, hi = PRICE_RANGES[it["category"]]
        price = round(prng.uniform(lo, hi)) - 0.01
        catalog.append({"id": it["id"], "name": it["name"], "category": it["category"], "color": it["color"],
                        "price": price, "image": f"/catalog/{it['id']}.jpg", "caption": it["caption"]})
        meta[it["id"]] = it["meta"]
    with open(os.path.join(DATA_DIR, "catalog.json"), "w") as f:
        json.dump(catalog, f, indent=1)
    with open(os.path.join(DATA_DIR, "catalog_meta.json"), "w") as f:
        json.dump({"source": used, "items": meta}, f)

    print(f"\nWrote {len(catalog)} products from {used}")
    print("By category:", dict(Counter(c["category"] for c in catalog)))
    bow_tops = [c["id"] for c in catalog
                if c["category"] in ("Top", "Blouse", "Shirt", "T-shirt", "Knitwear")
                and re.search(r"\b(bow|ribbon|tie)", c["caption"].lower())]
    print(f"Tops with bows/ribbons/ties ({len(bow_tops)}): {bow_tops[:40]}")
    if len(bow_tops) < 5:
        sys.exit("ERROR: fewer than 5 bow/ribbon tops")


if __name__ == "__main__":
    main()
