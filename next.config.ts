import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp"],
  // The CLIP model + catalog live on disk and are read at runtime.
  outputFileTracingIncludes: {
    "/**": ["./data/**/*", "./models/**/*"],
  },
  images: { unoptimized: true },
};

export default nextConfig;
