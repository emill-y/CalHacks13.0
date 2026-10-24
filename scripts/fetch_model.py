#!/usr/bin/env python3
"""One-time setup: place "Xenova/clip-vit-base-patch32" (fp32 ONNX) under models/.

transformers.js then loads it locally (env.localModelPath = ./models), so the
precompute script (scripts/embed.ts) and the server use byte-identical weights.

Source order:
  1. Hugging Face Hub: the Xenova repo itself (onnx/text_model.onnx, onnx/vision_model.onnx, ...).
  2. Mirror: the OpenAI CLIP ViT-B/32 ONNX export hosted on S3 by clip-as-service
     (same OpenAI weights as openai/clip-vit-base-patch32). Graph I/O is renamed to
     the HF/transformers.js convention (input_ids:int64 -> text_embeds,
     pixel_values -> image_embeds) and the tokenizer is rebuilt from OpenAI's BPE vocab.

Usage: python3 scripts/fetch_model.py [--force-mirror]
"""
import gzip
import json
import os
import sys
import tempfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "models", "Xenova", "clip-vit-base-patch32")
HF = "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/"
HF_FILES = [
    "config.json",
    "preprocessor_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "onnx/text_model.onnx",
    "onnx/vision_model.onnx",
]
MIRROR = "https://clip-as-service.s3.us-east-2.amazonaws.com/models-436c69702d61732d53657276696365/onnx/ViT-B-32/"
BPE_URL = "https://raw.githubusercontent.com/openai/CLIP/main/clip/bpe_simple_vocab_16e6.txt.gz"


def fetch(url, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    print(f"  GET {url}")
    tmp = dest + ".part"
    with urllib.request.urlopen(url, timeout=60) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    os.replace(tmp, dest)


def done():
    return all(os.path.exists(os.path.join(OUT, f)) for f in HF_FILES)


def from_hub():
    for f in HF_FILES:
        fetch(HF + f, os.path.join(OUT, f))
    write_source("huggingface:Xenova/clip-vit-base-patch32")


def write_source(src):
    with open(os.path.join(OUT, "SOURCE.json"), "w") as f:
        json.dump({"model": "Xenova/clip-vit-base-patch32", "dtype": "fp32", "source": src}, f, indent=2)


def patch_onnx(src, dest, kind):
    import onnx
    from onnx import TensorProto, helper

    m = onnx.load(src)
    g = m.graph
    if kind == "text":
        # int32 inputs -> int64 inputs + Cast, so transformers.js (int64 ids) can feed it
        for inp in list(g.input):
            old = inp.name
            internal = old + "_i32"
            for node in g.node:
                for i, n in enumerate(node.input):
                    if n == old:
                        node.input[i] = internal
            g.node.insert(0, helper.make_node("Cast", [old], [internal], to=TensorProto.INT32, name="cast_" + old))
            inp.type.tensor_type.elem_type = TensorProto.INT64
        out_name = "text_embeds"
    else:
        out_name = "image_embeds"
    old_out = g.output[0].name
    g.node.append(helper.make_node("Identity", [old_out], [out_name], name="rename_" + out_name))
    new_out = helper.make_tensor_value_info(out_name, TensorProto.FLOAT, ["batch_size", 512])
    del g.output[:]
    g.output.append(new_out)
    onnx.checker.check_model(m)
    onnx.save(m, dest)


def build_tokenizer(tmpdir):
    bpe = os.path.join(tmpdir, "bpe.txt.gz")
    fetch(BPE_URL, bpe)
    merges = gzip.open(bpe, "rt", encoding="utf-8").read().split("\n")
    merges = merges[1 : 49152 - 256 - 2 + 1]
    # bytes_to_unicode from OpenAI's simple_tokenizer.py
    bs = list(range(ord("!"), ord("~") + 1)) + list(range(ord("¡"), ord("¬") + 1)) + list(range(ord("®"), ord("ÿ") + 1))
    cs = bs[:]
    n = 0
    for b in range(256):
        if b not in bs:
            bs.append(b)
            cs.append(256 + n)
            n += 1
    base = [chr(c) for c in cs]
    vocab = base + [v + "</w>" for v in base] + ["".join(m.split()) for m in merges] + ["<|startoftext|>", "<|endoftext|>"]
    # Same pipeline transformers' CLIP slow->fast converter produces
    from tokenizers import Regex, Tokenizer, decoders, normalizers, pre_tokenizers, processors
    from tokenizers.models import BPE

    v = {t: i for i, t in enumerate(vocab)}
    tok = Tokenizer(BPE(vocab=v, merges=[tuple(m.split()) for m in merges], dropout=None,
                        continuing_subword_prefix="", end_of_word_suffix="</w>", fuse_unk=False,
                        unk_token="<|endoftext|>"))
    tok.normalizer = normalizers.Sequence([normalizers.NFC(), normalizers.Replace(Regex(r"\s+"), " "), normalizers.Lowercase()])
    tok.pre_tokenizer = pre_tokenizers.Sequence([
        pre_tokenizers.Split(Regex(r"""'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+"""), behavior="removed", invert=True),
        pre_tokenizers.ByteLevel(add_prefix_space=False),
    ])
    tok.decoder = decoders.ByteLevel()
    tok.post_processor = processors.RobertaProcessing(("<|endoftext|>", 49407), ("<|startoftext|>", 49406),
                                                      add_prefix_space=False, trim_offsets=False)
    tok.add_special_tokens(["<|startoftext|>", "<|endoftext|>"])
    ids = tok.encode("a photo of a cat").ids
    assert ids == [49406, 320, 1125, 539, 320, 2368, 49407], ids  # known CLIP ids
    tok.save(os.path.join(OUT, "tokenizer.json"))
    special = {"bos_token": "<|startoftext|>", "eos_token": "<|endoftext|>", "pad_token": "<|endoftext|>", "unk_token": "<|endoftext|>"}
    with open(os.path.join(OUT, "special_tokens_map.json"), "w") as f:
        json.dump(special, f, indent=2)
    with open(os.path.join(OUT, "tokenizer_config.json"), "w") as f:
        json.dump({**special, "tokenizer_class": "CLIPTokenizer", "model_max_length": 77, "do_lower_case": True,
                   "clean_up_tokenization_spaces": True, "add_prefix_space": False}, f, indent=2)


CONFIG = {
    "_name_or_path": "openai/clip-vit-base-patch32",
    "architectures": ["CLIPModel"],
    "model_type": "clip",
    "projection_dim": 512,
    "logit_scale_init_value": 2.6592,
    "text_config": {
        "model_type": "clip_text_model", "hidden_size": 512, "intermediate_size": 2048,
        "num_attention_heads": 8, "num_hidden_layers": 12, "max_position_embeddings": 77,
        "vocab_size": 49408, "projection_dim": 512, "bos_token_id": 0, "eos_token_id": 2, "pad_token_id": 1,
    },
    "vision_config": {
        "model_type": "clip_vision_model", "hidden_size": 768, "intermediate_size": 3072,
        "num_attention_heads": 12, "num_hidden_layers": 12, "image_size": 224, "patch_size": 32,
        "projection_dim": 512,
    },
}
PREPROCESSOR = {
    "crop_size": {"height": 224, "width": 224},
    "do_center_crop": True,
    "do_convert_rgb": True,
    "do_normalize": True,
    "do_rescale": True,
    "do_resize": True,
    "feature_extractor_type": "CLIPFeatureExtractor",
    "image_processor_type": "CLIPImageProcessor",
    "image_mean": [0.48145466, 0.4578275, 0.40821073],
    "image_std": [0.26862954, 0.26130258, 0.27577711],
    "resample": 3,
    "rescale_factor": 0.00392156862745098,
    "size": {"shortest_edge": 224},
}


def from_mirror():
    os.makedirs(os.path.join(OUT, "onnx"), exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        cache = os.environ.get("CLIP_MIRROR_CACHE", tmp)
        for name in ("textual.onnx", "visual.onnx"):
            p = os.path.join(cache, name)
            if not os.path.exists(p):
                fetch(MIRROR + name, p)
        print("  patching ONNX graphs")
        patch_onnx(os.path.join(cache, "textual.onnx"), os.path.join(OUT, "onnx", "text_model.onnx"), "text")
        patch_onnx(os.path.join(cache, "visual.onnx"), os.path.join(OUT, "onnx", "vision_model.onnx"), "vision")
        print("  building tokenizer")
        build_tokenizer(tmp)
    with open(os.path.join(OUT, "config.json"), "w") as f:
        json.dump(CONFIG, f, indent=2)
    with open(os.path.join(OUT, "preprocessor_config.json"), "w") as f:
        json.dump(PREPROCESSOR, f, indent=2)
    write_source("mirror:clip-as-service ViT-B-32 (OpenAI weights)")


def main():
    if done() and "--force-mirror" not in sys.argv:
        print(f"model already present at {OUT}")
        return
    if "--force-mirror" not in sys.argv:
        try:
            print("Trying Hugging Face Hub…")
            from_hub()
            print("OK (hub)")
            return
        except Exception as e:  # noqa: BLE001
            print(f"  hub unavailable: {e}")
    print("Falling back to S3 mirror…")
    from_mirror()
    print(f"OK (mirror) -> {OUT}")


if __name__ == "__main__":
    main()
