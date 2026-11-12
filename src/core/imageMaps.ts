import type { HeightMode } from '../types/isodsl';

export interface HeightFieldOptions {
  smoothRadius: number;
  invertHeight: boolean;
  contrast?: number;
  heightMode?: HeightMode;
}

export interface HeightFieldResult {
  macroHeight: Float32Array;
  rawLuminance: Float32Array;
  width: number;
  height: number;
}

/**
 * Executa blur separável rápido O(W*H) em Float32Array usando soma de prefixos (sliding window).
 */
function boxBlurSeparable(
  src: Float32Array,
  width: number,
  height: number,
  radius: number
): Float32Array {
  const r = Math.max(0, Math.floor(radius));
  if (r === 0) return new Float32Array(src);

  const temp = new Float32Array(width * height);
  const dst = new Float32Array(width * height);

  // Passada horizontal
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      const xStart = Math.max(0, x - r);
      const xEnd = Math.min(width - 1, x + r);
      for (let kx = xStart; kx <= xEnd; kx++) {
        sum += src[rowOffset + kx];
        count++;
      }
      temp[rowOffset + x] = sum / count;
    }
  }

  // Passada vertical
  for (let y = 0; y < height; y++) {
    const yStart = Math.max(0, y - r);
    const yEnd = Math.min(height - 1, y + r);
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let ky = yStart; ky <= yEnd; ky++) {
        sum += temp[ky * width + x];
        count++;
      }
      dst[y * width + x] = sum / count;
    }
  }

  return dst;
}

export function isWaterPixel(r: number, g: number, b: number): boolean {
  // Água azul/ciano vibrante OU riacho pastel (azul supera claramente vermelho e iguala/supera verde)
  return (
    (b > r * 1.18 && b > 82 && b >= g * 0.88) ||
    (b > r * 1.07 && b > g * 1.01 && b > 110) ||
    (b > 135 && g > 130 && r < 115)
  );
}

/**
 * Deriva um campo de altura normalizado [0..1] (para Displacement Map) e luminância bruta
 * (para detalhes finos do Normal Map) a partir de pixels RGBA.
 */
export function computeHeightField(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options: HeightFieldOptions
): HeightFieldResult {
  const total = width * height;
  const rawLuminance = new Float32Array(total);
  const semanticSource = new Float32Array(total);
  const useSemantic = options.heightMode === 'semantic_outdoor';

  let minL = 1;
  let maxL = 0;
  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const r = rgba[idx];
    const g = rgba[idx + 1];
    const b = rgba[idx + 2];
    const alpha = rgba[idx + 3] / 255;
    const lum = ((0.299 * r + 0.587 * g + 0.114 * b) / 255) * alpha;
    const val = options.invertHeight ? 1 - lum : lum;
    rawLuminance[i] = val;
    if (val < minL) minL = val;
    if (val > maxL) maxL = val;

    if (useSemantic) {
      if (isWaterPixel(r, g, b)) {
        // Leito do rio rebaixado para receber plano de água 3D
        semanticSource[i] = 0.08 + lum * 0.08;
      } else if (r > g * 1.05 && g > b * 1.15) {
        // Trilha / estrada de terra batida suave e plana
        semanticSource[i] = 0.44 + lum * 0.08;
      } else if (g >= r * 0.92 && g > b * 1.1) {
        // Gramado claro vs copa densa escura: evita que sombras de árvores afundem o terreno
        const isDeepCanopy = lum < 0.42;
        semanticSource[i] = isDeepCanopy ? 0.68 + (0.42 - lum) * 0.35 : 0.54 + lum * 0.18;
      } else {
        semanticSource[i] = 0.48 + lum * 0.2;
      }
    }
  }

  // Normaliza contraste para aproveitar melhor a faixa de deslocamento
  const span = Math.max(0.001, maxL - minL);
  const contrast = options.contrast ?? 1.05;
  for (let i = 0; i < total; i++) {
    const normalized = (rawLuminance[i] - minL) / span;
    const stretched = (normalized - 0.5) * contrast + 0.5;
    rawLuminance[i] = Math.min(1, Math.max(0, stretched));
  }

  const macroInput = useSemantic ? semanticSource : rawLuminance;

  // Duas passadas de box blur aproximam suavização gaussiana para o macro-relevo
  const r = Math.max(0, Math.min(16, Math.round(options.smoothRadius)));
  const pass1 = boxBlurSeparable(macroInput, width, height, r);
  const macroHeight =
    r > 0
      ? boxBlurSeparable(pass1, width, height, Math.max(1, Math.floor(r / 2)))
      : pass1;

  return {
    macroHeight,
    rawLuminance,
    width,
    height,
  };
}

/**
 * Converte Heightfield + micro-detalhes em um Tangent-Space Normal Map (padrão OpenGL / Three.js)
 * usando operador Sobel 3x3. Zero triângulos extras para micro-relevo.
 */
export function heightFieldToNormalRGBA(
  macroHeight: Float32Array,
  rawLuminance: Float32Array,
  width: number,
  height: number,
  strength: number,
  detailBlend: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const clampedBlend = Math.min(1, Math.max(0, detailBlend));

  const sampleCombined = (x: number, y: number): number => {
    const cx = Math.min(width - 1, Math.max(0, x));
    const cy = Math.min(height - 1, Math.max(0, y));
    const idx = cy * width + cx;
    return macroHeight[idx] * (1 - clampedBlend) + rawLuminance[idx] * clampedBlend;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tl = sampleCombined(x - 1, y - 1);
      const t = sampleCombined(x, y - 1);
      const tr = sampleCombined(x + 1, y - 1);
      const l = sampleCombined(x - 1, y);
      const r = sampleCombined(x + 1, y);
      const bl = sampleCombined(x - 1, y + 1);
      const b = sampleCombined(x, y + 1);
      const br = sampleCombined(x + 1, y + 1);

      // Gradiente horizontal (+X para direita) e vertical (+Y para cima no espaço UV OpenGL)
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (tl + 2 * t + tr) - (bl + 2 * b + br);

      let nx = -dx * strength;
      let ny = -dy * strength;
      let nz = 1.0;

      const invLen = 1 / Math.hypot(nx, ny, nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const outIdx = (y * width + x) * 4;
      out[outIdx] = Math.round((nx * 0.5 + 0.5) * 255);
      out[outIdx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[outIdx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      out[outIdx + 3] = 255;
    }
  }

  return out;
}

/**
 * Converte um campo de altura normalizado [0..1] para imagem RGBA em tons de cinza.
 */
export function heightFieldToGrayscaleRGBA(
  heightField: Float32Array,
  width: number,
  height: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = Math.round(Math.min(1, Math.max(0, heightField[i])) * 255);
    const idx = i * 4;
    out[idx] = v;
    out[idx + 1] = v;
    out[idx + 2] = v;
    out[idx + 3] = 255;
  }
  return out;
}

/**
 * Amostragem bilinear de altura em coordenadas UV [0..1] (convenção flipY = true do Three.js).
 */
export function sampleHeightAtUV(
  heightField: Float32Array,
  width: number,
  height: number,
  u: number,
  v: number
): number {
  const cu = Math.min(1, Math.max(0, u));
  const cv = Math.min(1, Math.max(0, v));

  const fx = cu * (width - 1);
  const fy = (1 - cv) * (height - 1);

  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);

  const tx = fx - x0;
  const ty = fy - y0;

  const h00 = heightField[y0 * width + x0];
  const h10 = heightField[y0 * width + x1];
  const h01 = heightField[y1 * width + x0];
  const h11 = heightField[y1 * width + x1];

  const top = h00 + (h10 - h00) * tx;
  const bottom = h01 + (h11 - h01) * tx;
  return top + (bottom - top) * ty;
}

/**
 * Converte buffer RGBA em DataURL PNG para thumbnails da UI e download.
 */
export function rgbaToDataUrl(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Lê uma imagem HTMLImageElement em resolução controlada para gerar Height/Normal maps rapidamente.
 */
export function extractImageAnalysisBuffer(
  img: HTMLImageElement,
  maxDim = 384
): { rgba: Uint8ClampedArray; width: number; height: number } {
  const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
  let width = img.naturalWidth;
  let height = img.naturalHeight;
  if (width > maxDim || height > maxDim) {
    if (aspect >= 1) {
      width = maxDim;
      height = Math.max(8, Math.round(maxDim / aspect));
    } else {
      height = maxDim;
      width = Math.max(8, Math.round(maxDim * aspect));
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { rgba: new Uint8ClampedArray(width * height * 4), width, height };
  }
  ctx.drawImage(img, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height);
  return { rgba: data.data, width, height };
}

