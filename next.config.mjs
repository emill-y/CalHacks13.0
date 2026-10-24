/** @type {import('next').NextConfig} */
const nextConfig = {
  // CLIP (onnxruntime-node) and sharp are native; keep them out of the bundle and run as a Node server.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp"],
  images: { unoptimized: true },
};

export default nextConfig;
