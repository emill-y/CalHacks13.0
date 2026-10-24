"use client";

/** Normalized crop rectangle (0..1) relative to the displayed (object-contain) square. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MAX_SIDE = 768;

/**
 * Crop to the user-selected region and downscale to <= 768 px, in the browser.
 * Only these pixels ever leave the device.
 */
export async function prepareImage(file: File, crop: Crop | null): Promise<{ data: string; mediaType: string }> {
  const bmp = await createImageBitmap(file);
  let sx = 0,
    sy = 0,
    sw = bmp.width,
    sh = bmp.height;
  if (crop && crop.w > 0.02 && crop.h > 0.02) {
    // The preview box is square with object-contain: map box coords -> image coords.
    const side = Math.max(bmp.width, bmp.height);
    const ox = (side - bmp.width) / 2;
    const oy = (side - bmp.height) / 2;
    sx = Math.max(0, crop.x * side - ox);
    sy = Math.max(0, crop.y * side - oy);
    sw = Math.min(bmp.width - sx, crop.w * side);
    sh = Math.min(bmp.height - sy, crop.h * side);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const url = canvas.toDataURL("image/jpeg", 0.88);
  return { data: url.slice(url.indexOf(",") + 1), mediaType: "image/jpeg" };
}
