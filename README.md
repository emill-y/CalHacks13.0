# ThisBut

**Shop by editing what you see.** Show a photo + an edit (“this shirt, but without the ribbon”). Every result is verified
against every edit; unmatched edits become **Wishes** that merchants see as **Demand Gaps**.

_Full docs are filled in during Phase 6._

## Dataset credit

The demo catalog is built by `scripts/prepare_catalog.py`. It first tries the Hugging Face datasets
`tomytjandra/h-and-m-fashion-caption-12k` and `ashraq/fashion-product-images-small`. When the Hub isn't reachable
(as in the sandbox this was built in), it falls back to **[Fashionpedia](https://fashionpedia.github.io/home/)**
(Jia et al., ECCV 2020; annotations CC BY 4.0, images from Flickr under their original Creative Commons licenses).
Garments are cut out with their human-annotated segmentation masks, and captions come from the annotated attributes
(bow, ribbon, sleeve length, pattern…). Images under no-derivatives or all-rights-reserved licenses are skipped.
Per-item source and license ids are in `data/catalog_meta.json`. **Used for demo purposes only.**
