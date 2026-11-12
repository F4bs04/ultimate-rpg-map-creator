import { rgbaToDataUrl } from './imageMaps';

/**
 * Remove fundo uniforme das bordas via flood-fill BFS para transformar qualquer
 * sprite/asset (ex.: render do ComfyUI ou recorte) em um Card 2.5D com canal Alpha limpo.
 * Se a imagem já possuir transparência real nas bordas, preserva o alpha original.
 */
export function extractAlphaCutoutRGBA(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance = 38
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  const total = width * height;
  if (total === 0) return out;

  // Verifica se já existe canal alpha significativo
  let transparentCount = 0;
  for (let i = 0; i < total; i++) {
    if (rgba[i * 4 + 3] < 240) transparentCount++;
  }
  if (transparentCount > total * 0.05) {
    return out;
  }

  // Amostra cor média dos 4 cantos como cor de fundo (key)
  const corners = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    (total - 1) * 4,
  ];
  let kr = 0;
  let kg = 0;
  let kb = 0;
  for (const c of corners) {
    kr += rgba[c];
    kg += rgba[c + 1];
    kb += rgba[c + 2];
  }
  kr /= 4;
  kg /= 4;
  kb /= 4;

  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const isBg = (idx: number): boolean => {
    const p = idx * 4;
    const dist = Math.hypot(rgba[p] - kr, rgba[p + 1] - kg, rgba[p + 2] - kb);
    return dist <= tolerance;
  };

  const trySeed = (x: number, y: number) => {
    const idx = y * width + x;
    if (!visited[idx] && isBg(idx)) {
      visited[idx] = 1;
      queue[tail++] = idx;
    }
  };

  for (let x = 0; x < width; x++) {
    trySeed(x, 0);
    trySeed(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    trySeed(0, y);
    trySeed(width - 1, y);
  }

  while (head < tail) {
    const cur = queue[head++];
    out[cur * 4 + 3] = 0;
    const cx = cur % width;
    const cy = (cur - cx) / width;

    if (cx > 0) trySeed(cx - 1, cy);
    if (cx < width - 1) trySeed(cx + 1, cy);
    if (cy > 0) trySeed(cx, cy - 1);
    if (cy < height - 1) trySeed(cx, cy + 1);
  }

  return out;
}

export async function convertImageUrlToCutoutSprite(
  imageUrl: string,
  maxDim = 256,
  tolerance = 38
): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = imageUrl;
  });

  const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (w > maxDim || h > maxDim) {
    if (aspect >= 1) {
      w = maxDim;
      h = Math.max(8, Math.round(maxDim / aspect));
    } else {
      h = maxDim;
      w = Math.max(8, Math.round(maxDim * aspect));
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return imageUrl;

  ctx.drawImage(img, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const cutout = extractAlphaCutoutRGBA(imgData.data, w, h, tolerance);
  return rgbaToDataUrl(cutout, w, h);
}

