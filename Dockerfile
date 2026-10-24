# ThisBut — Node server image with the catalog images, embeddings and CLIP model baked in.

# 1) CLIP model (Xenova/clip-vit-base-patch32, fp32 ONNX). Default "mirror" reproduces the exact
#    weights data/embeddings.f32 was built with; set CLIP_SOURCE=hub to use the HF repo (then re-run npm run embed).
FROM python:3.12-slim AS model
ARG CLIP_SOURCE=mirror
WORKDIR /app
RUN pip install --no-cache-dir onnx==1.17.0 tokenizers==0.21.0
COPY scripts/fetch_model.py scripts/
RUN if [ "$CLIP_SOURCE" = "hub" ]; then python scripts/fetch_model.py; else python scripts/fetch_model.py --force-mirror; fi

# 2) Build the Next.js app
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

# 3) Runtime
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/data ./data
COPY --from=build /app/next.config.mjs ./
COPY --from=model /app/models ./models
RUN mkdir -p .data && chown -R node:node .data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "npx next start -H 0.0.0.0 -p ${PORT:-3000}"]
