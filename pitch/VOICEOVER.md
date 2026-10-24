# ThisBut: pitch video voiceover (optional)

The video works silent with music. If you narrate, read this over `ThisBut_pitch_voiceover-bed.mp4` (same video,
music ducked). Timings match the cuts. Aim for a calm, confident pace (about 150 words per minute).

| Time | On screen | Say |
|---|---|---|
| 0:00 | “You found it. Almost.” | “You know the feeling. You find the perfect top…” |
| 0:03 | Bow blouse, bow circled | “…except for one thing. Love the top. Hate the bow.” |
| 0:06 | “Shoppers think in edits.” | “That’s how we actually shop: this, but different.” |
| 0:09 | Search bar, two result rows | “So you search ‘blouse without a bow’. Here’s the problem: AI search can’t hear ‘not’. With a bow, without a bow, five of the top eight results are the same.” |
| 0:17 | “So shoppers give up.” | “So people give up. And the store never even learns what they wanted.” |
| 0:21 | Logo reveal | “This is ThisBut. Show it. Say the change. Get only what passes.” |
| 0:27 | Real footage on Edikted | “This is real, on a live store. Hover any product photo and tap ‘This, but’.” |
| 0:31 | “with a logo” | “Say what you’d change: these sweatpants, but with a logo.” |
| 0:33 | Verifying (3× speed) | “It reads the store’s whole catalog, 350 products, and checks every candidate.” |
| 0:37 | Zoom on results | “Eight verified matches, about ten seconds. Every card shows its receipts: mint, wide-leg, has a logo. And your photo is discarded.” |
| 0:44 | Product page | “One tap, and you’re on the exact product, on the store’s own site.” |
| 0:51 | Shopify / WooCommerce / sitemap | “It works where people already shop: Shopify, WooCommerce, any store with a sitemap. No integration, no merchant setup.” |
| 0:58 | How it works | “Under the hood: Claude reads the photo and your words and turns them into a structured edit. CLIP ranks the whole catalog in milliseconds, and ‘not’ becomes a penalty instead of a keyword. Then Claude checks the top sixteen against every edit. Miss one, and it’s not a match.” |
| 1:12 | “No ‘close enough’…” | “No ‘close enough’ dressed up as a result.” |
| 1:16 | Proof grid + numbers | “And we measured it. Ten verified matches in thirteen seconds for our hardest query. Nine out of ten test queries with three or more matches. And 98.6 percent of matches confirmed by human-labeled data.” |
| 1:28 | Wish → Demand Gaps | “When nothing matches, that’s not a dead end. It’s demand. Shoppers save a wish, and merchants see exactly what people wanted and would pay for.” |
| 1:37 | “This fulfills 3 wishes” → toast | “When a store stocks it, every matching wish is checked and the shopper gets a ping. Lost searches become sales.” |
| 1:43 | Trust tiles | “And trust is the feature: your photo is used once and discarded, wishes are just text, merchants only see crowds, and the card number never leaves your browser.” |
| 1:51 | “From ‘almost’ to ‘add to bag’.” | “ThisBut takes shopping from ‘almost’…” |
| 1:55 | End card | “…to ‘add to bag’. Every store. Every edit. Verified.” |

## Which slide covers which judging criterion

You didn't share the rubric, so this assumes the common hackathon criteria.

| Criterion | Where it's covered (without saying “criterion X”) |
|---|---|
| Problem / need | 0:00–0:21: the “almost” moment; real evidence that AI search ignores “not”; lost demand stores can't see |
| Innovation / creativity | 0:21: search by *editing* what you see; verified results; wishes turn misses into demand data |
| Technical complexity | 0:58: Claude parse → CLIP retrieval with negation penalty → parallel Claude verification; whole-store indexing on any site |
| Working demo / completeness | 0:27–0:51: unedited real footage on a live store; extension, web app, merchant tools |
| Design / UX | Hover button in the store's own visual language; side panel; receipts on every card |
| Impact / business value | 1:28–1:43: demand gaps with estimated revenue, wish fulfillment, conversion from lost searches |
| Track fit: reimagining shopping | Discovery → verified match → the store's own product page → checkout; merchant insights |
| Trust / privacy / responsibility | 1:43: photo discarded, text-only wishes, k≥3 aggregates, card never stored or sent, demo data badged |
| Evidence / rigor | 1:16: eval numbers with ground truth from human labels |
