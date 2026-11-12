import type {
  AbsorbedSwatch,
  BorderPortal,
  EdgeSide,
  EdgeStrips,
  IsoWorldKit,
  SwatchCategory,
  WorldBiomeStats,
} from '../types/isodsl';
import {
  computeHeightField,
  heightFieldToNormalRGBA,
  isWaterPixel,
  rgbaToDataUrl,
  sampleHeightAtUV,
  type HeightFieldResult,
} from './imageMaps';

export interface SwatchPixelBuffer {
  rgba: Uint8ClampedArray;
  size: number;
}

const swatchPixelCache = new Map<string, SwatchPixelBuffer>();

export function getSwatchPixels(
  swatch: AbsorbedSwatch | undefined
): SwatchPixelBuffer | null {
  if (!swatch) return null;
  const key = `${swatch.category}:${swatch.sampleBox.join(',')}:${swatch.averageColor}`;
  return swatchPixelCache.get(key) ?? null;
}

export function setSwatchPixels(
  swatch: AbsorbedSwatch,
  rgba: Uint8ClampedArray,
  size: number
): void {
  const key = `${swatch.category}:${swatch.sampleBox.join(',')}:${swatch.averageColor}`;
  swatchPixelCache.set(key, { rgba, size });
}

/**
 * Amostra faixas de cor ao longo das 4 bordas da imagem âncora para suavizar
 * a transição entre o chunk central e os chunks procedurais vizinhos.
 */
export function extractEdgeStrips(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  samples = 48
): EdgeStrips {
  const insetX = Math.max(2, Math.min(10, Math.round(width * 0.018)));
  const insetY = Math.max(2, Math.min(10, Math.round(height * 0.018)));
  const sampleAvg = (cx: number, cy: number): [number, number, number] => {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let cnt = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const px = Math.min(width - 1, Math.max(0, cx + dx));
        const py = Math.min(height - 1, Math.max(0, cy + dy));
        const i = (py * width + px) * 4;
        sr += rgba[i];
        sg += rgba[i + 1];
        sb += rgba[i + 2];
        cnt++;
      }
    }
    return [Math.round(sr / cnt), Math.round(sg / cnt), Math.round(sb / cnt)];
  };

  const north: [number, number, number][] = [];
  const south: [number, number, number][] = [];
  const west: [number, number, number][] = [];
  const east: [number, number, number][] = [];

  for (let i = 0; i < samples; i++) {
    const t = samples > 1 ? i / (samples - 1) : 0.5;
    const x = Math.min(width - 1, Math.max(0, Math.round(t * (width - 1))));
    const y = Math.min(height - 1, Math.max(0, Math.round(t * (height - 1))));
    north.push(sampleAvg(x, Math.min(height - 1, insetY)));
    south.push(sampleAvg(x, Math.max(0, height - 1 - insetY)));
    west.push(sampleAvg(Math.min(width - 1, insetX), y));
    east.push(sampleAvg(Math.max(0, width - 1 - insetX), y));
  }

  return { north, south, west, east };
}

/**
 * Registra os perfis exatos de elevação [0..1] das 4 bordas do terreno central
 * dentro do IsoWorldKit para que os chunks vizinhos casem em altura sem degrau.
 */
export function attachEdgeHeightsToKit(
  kit: IsoWorldKit,
  heightField: Pick<HeightFieldResult, 'macroHeight' | 'width' | 'height'> | null | undefined,
  samples = 48
): IsoWorldKit {
  if (!heightField || !kit.edgeStrips) return kit;
  const smoothStrip = (arr: number[]): number[] =>
    arr.map((v, i) => {
      const prev = arr[Math.max(0, i - 1)];
      const next = arr[Math.min(arr.length - 1, i + 1)];
      return Number((prev * 0.25 + v * 0.5 + next * 0.25).toFixed(4));
    });

  const north: number[] = [];
  const south: number[] = [];
  const west: number[] = [];
  const east: number[] = [];
  const { macroHeight, width, height } = heightField;

  for (let i = 0; i < samples; i++) {
    const t = samples > 1 ? i / (samples - 1) : 0.5;
    north.push(sampleHeightAtUV(macroHeight, width, height, t, 1));
    south.push(sampleHeightAtUV(macroHeight, width, height, t, 0));
    west.push(sampleHeightAtUV(macroHeight, width, height, 0, 1 - t));
    east.push(sampleHeightAtUV(macroHeight, width, height, 1, 1 - t));
  }

  return {
    ...kit,
    edgeStrips: {
      ...kit.edgeStrips,
      heights: {
        north: smoothStrip(north),
        south: smoothStrip(south),
        west: smoothStrip(west),
        east: smoothStrip(east),
      },
    },
  };
}

export const SWATCH_CATEGORY_LABELS: Record<SwatchCategory, string> = {
  grass: 'Grama / Prado',
  dirt_road: 'Terra / Trilha',
  water: 'Água / Rio',
  foliage: 'Copa / Folhagem',
  stone: 'Pedra / Ruína',
};

function classifyPixelSwatch(r: number, g: number, b: number): SwatchCategory | null {
  if (isWaterPixel(r, g, b)) return 'water';

  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Pedra cinza neutra OU arenito claro (ruínas quentes)
  if (
    (sat < 0.14 && lum > 0.32 && lum < 0.85) ||
    (r > b * 1.12 && r >= g * 1.02 && lum > 0.67 && sat < 0.36)
  ) {
    return 'stone';
  }
  // Terra / estrada de barro quente
  if (r > g * 1.03 && g > b * 1.08 && sat > 0.16 && lum > 0.35 && lum <= 0.68) {
    return 'dirt_road';
  }
  // Copa densa escura / arbusto (cobre verde vibrante e verde sálvia)
  if (g > b * 1.15 && g >= r * 0.98 && lum < 0.54 && sat > 0.22) {
    return 'foliage';
  }
  // Grama iluminada
  if (g >= r * 0.92 && g > b * 1.08 && lum >= 0.46) {
    return 'grass';
  }

  return null;
}

/**
 * Remove gradientes macro de iluminação (High-Pass) e aplica cross-blend toroidal
 * em um patch quadrado [size x size] para torná-lo perfeitamente tileável sem costuras.
 */
export function makeSeamlessTileRGBA(
  patchRgba: Uint8ClampedArray,
  size: number
): Uint8ClampedArray {
  const total = size * size;
  const equalized = new Uint8ClampedArray(total * 4);

  // 1. Calcula luminância média do recorte
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    sumR += patchRgba[idx];
    sumG += patchRgba[idx + 1];
    sumB += patchRgba[idx + 2];
  }
  const meanLum = (0.299 * sumR + 0.587 * sumG + 0.114 * sumB) / Math.max(1, total);

  // Suavização macro simples (4 passos por média local 9x9 aproximada via grade)
  const block = Math.max(4, Math.floor(size / 8));
  const bw = Math.ceil(size / block);
  const blockMean = new Float32Array(bw * bw);
  const blockCnt = new Float32Array(bw * bw);

  for (let y = 0; y < size; y++) {
    const by = Math.floor(y / block);
    for (let x = 0; x < size; x++) {
      const bx = Math.floor(x / block);
      const idx = (y * size + x) * 4;
      const lum =
        0.299 * patchRgba[idx] +
        0.587 * patchRgba[idx + 1] +
        0.114 * patchRgba[idx + 2];
      blockMean[by * bw + bx] += lum;
      blockCnt[by * bw + bx]++;
    }
  }
  for (let i = 0; i < bw * bw; i++) {
    blockMean[i] = blockCnt[i] > 0 ? blockMean[i] / blockCnt[i] : meanLum;
  }

  // Equaliza variação de iluminação mantendo textura fina intacta
  for (let y = 0; y < size; y++) {
    const by = Math.min(bw - 1, Math.floor(y / block));
    for (let x = 0; x < size; x++) {
      const bx = Math.min(bw - 1, Math.floor(x / block));
      const localMean = blockMean[by * bw + bx];
      const delta = (meanLum - localMean) * 0.72;
      const idx = (y * size + x) * 4;
      equalized[idx] = Math.min(255, Math.max(0, Math.round(patchRgba[idx] + delta)));
      equalized[idx + 1] = Math.min(255, Math.max(0, Math.round(patchRgba[idx + 1] + delta)));
      equalized[idx + 2] = Math.min(255, Math.max(0, Math.round(patchRgba[idx + 2] + delta)));
      equalized[idx + 3] = 255;
    }
  }

  // 2. Cross-blend toroidal (desloca meio tile e mistura com máscara radial suave)
  const seamless = new Uint8ClampedArray(total * 4);
  const half = Math.floor(size / 2);

  for (let y = 0; y < size; y++) {
    // Distância normalizada do centro [0..1], 0 no centro, 1 nas bordas
    const dy = Math.abs((y / (size - 1)) * 2 - 1);
    for (let x = 0; x < size; x++) {
      const dx = Math.abs((x / (size - 1)) * 2 - 1);
      // Nas bordas (dx ou dy próximos de 1), mistura suavemente com a versão deslocada (que tem o centro limpo lá!)
      const edge = Math.max(dx, dy);
      const blend = Math.min(1, Math.max(0, (edge - 0.45) / 0.55));
      const smoothW = blend * blend * (3 - 2 * blend);

      const sx = (x + half) % size;
      const sy = (y + half) % size;

      const idxA = (y * size + x) * 4;
      const idxB = (sy * size + sx) * 4;

      seamless[idxA] = Math.round(equalized[idxA] * (1 - smoothW) + equalized[idxB] * smoothW);
      seamless[idxA + 1] = Math.round(
        equalized[idxA + 1] * (1 - smoothW) + equalized[idxB + 1] * smoothW
      );
      seamless[idxA + 2] = Math.round(
        equalized[idxA + 2] * (1 - smoothW) + equalized[idxB + 2] * smoothW
      );
      seamless[idxA + 3] = 255;
    }
  }

  return seamless;
}

function cropResampledSquare(
  rgba: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  x0: number,
  y0: number,
  cropSize: number,
  outSize: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(outSize * outSize * 4);
  for (let y = 0; y < outSize; y++) {
    const sy = Math.min(
      imgH - 1,
      Math.max(0, Math.floor(y0 + (y / outSize) * cropSize))
    );
    for (let x = 0; x < outSize; x++) {
      const sx = Math.min(
        imgW - 1,
        Math.max(0, Math.floor(x0 + (x / outSize) * cropSize))
      );
      const srcIdx = (sy * imgW + sx) * 4;
      const dstIdx = (y * outSize + x) * 4;
      out[dstIdx] = rgba[srcIdx];
      out[dstIdx + 1] = rgba[srcIdx + 1];
      out[dstIdx + 2] = rgba[srcIdx + 2];
      out[dstIdx + 3] = 255;
    }
  }
  return out;
}

/**
 * Detecta onde rios ('water') e trilhas ('road') tocam as 4 bordas da imagem
 * para que a expansão Médio/Grande dê continuidade sem cortes artificiais.
 */
export function detectBorderPortals(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): BorderPortal[] {
  const portals: BorderPortal[] = [];
  const margin = Math.max(2, Math.round(Math.min(width, height) * 0.035));

  const scanEdge = (
    side: EdgeSide,
    steps: number,
    sampleAt: (s: number) => 'water' | 'road' | null
  ) => {
    let runKind: 'water' | 'road' | null = null;
    let runStart = 0;

    const flush = (endIdx: number) => {
      if (!runKind) return;
      const len = endIdx - runStart;
      if (len >= Math.max(3, Math.round(steps * 0.035))) {
        const centerT = Number((((runStart + endIdx) * 0.5) / steps).toFixed(3));
        portals.push({
          side,
          t: centerT,
          kind: runKind,
          widthNorm: Number((len / steps).toFixed(3)),
        });
      }
      runKind = null;
    };

    for (let i = 0; i < steps; i++) {
      const k = sampleAt(i);
      if (k !== runKind) {
        flush(i);
        runKind = k;
        runStart = i;
      }
    }
    flush(steps);
  };

  const classifyEdgePixel = (x: number, y: number): 'water' | 'road' | null => {
    const idx = (y * width + x) * 4;
    const c = classifyPixelSwatch(rgba[idx], rgba[idx + 1], rgba[idx + 2]);
    if (c === 'water') return 'water';
    if (c === 'dirt_road') return 'road';
    return null;
  };

  scanEdge('north', width, (x) => classifyEdgePixel(x, margin));
  scanEdge('south', width, (x) => classifyEdgePixel(x, height - 1 - margin));
  scanEdge('west', height, (y) => classifyEdgePixel(margin, y));
  scanEdge('east', height, (y) => classifyEdgePixel(width - 1 - margin, y));

  return portals;
}

/**
 * Varre uma imagem e extrai Swatches tileáveis (com Normal Map derivado),
 * Portais de borda e Estatísticas de bioma formando um IsoWorldKit.
 */
export function extractWorldKitFromImage(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  label = 'Referência 1'
): IsoWorldKit {
  const categories: SwatchCategory[] = [
    'grass',
    'dirt_road',
    'water',
    'foliage',
    'stone',
  ];

  // Estatísticas globais
  const counts: Record<SwatchCategory, number> = {
    grass: 0,
    dirt_road: 0,
    water: 0,
    foliage: 0,
    stone: 0,
  };
  const totalPixels = width * height;
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const cat = classifyPixelSwatch(rgba[idx], rgba[idx + 1], rgba[idx + 2]);
    if (cat) counts[cat]++;
  }

  const biomeStats: WorldBiomeStats = {
    waterRatio: Number((counts.water / totalPixels).toFixed(3)),
    foliageRatio: Number((counts.foliage / totalPixels).toFixed(3)),
    roadRatio: Number((counts.dirt_road / totalPixels).toFixed(3)),
    stoneRatio: Number((counts.stone / totalPixels).toFixed(3)),
  };

  // Busca melhores janelas candidatas por categoria
  const patchSize = Math.max(12, Math.min(40, Math.floor(Math.min(width, height) * 0.12)));
  const stride = Math.max(4, Math.floor(patchSize * 0.4));
  const innerStep = Math.max(1, Math.floor(patchSize / 10));

  const bestCandidate: Partial<
    Record<SwatchCategory, { score: number; x0: number; y0: number; avgRgb: [number, number, number] }>
  > = {};

  for (let y0 = 0; y0 + patchSize <= height; y0 += stride) {
    for (let x0 = 0; x0 + patchSize <= width; x0 += stride) {
      const catCounts: Record<SwatchCategory, number> = {
        grass: 0,
        dirt_road: 0,
        water: 0,
        foliage: 0,
        stone: 0,
      };
      const sumRgb: Record<SwatchCategory, [number, number, number]> = {
        grass: [0, 0, 0],
        dirt_road: [0, 0, 0],
        water: [0, 0, 0],
        foliage: [0, 0, 0],
        stone: [0, 0, 0],
      };
      let samples = 0;

      for (let py = y0; py < y0 + patchSize; py += innerStep) {
        for (let px = x0; px < x0 + patchSize; px += innerStep) {
          const idx = (py * width + px) * 4;
          const r = rgba[idx];
          const g = rgba[idx + 1];
          const b = rgba[idx + 2];
          const cat = classifyPixelSwatch(r, g, b);
          if (cat) {
            catCounts[cat]++;
            sumRgb[cat][0] += r;
            sumRgb[cat][1] += g;
            sumRgb[cat][2] += b;
          }
          samples++;
        }
      }

      for (const cat of categories) {
        const purity = catCounts[cat] / Math.max(1, samples);
        if (purity < 0.25) continue;
        const prev = bestCandidate[cat];
        if (!prev || purity > prev.score) {
          const cnt = Math.max(1, catCounts[cat]);
          bestCandidate[cat] = {
            score: purity,
            x0,
            y0,
            avgRgb: [
              Math.round(sumRgb[cat][0] / cnt),
              Math.round(sumRgb[cat][1] / cnt),
              Math.round(sumRgb[cat][2] / cnt),
            ],
          };
        }
      }
    }
  }

  const outSize = 64;
  const swatches: Partial<Record<SwatchCategory, AbsorbedSwatch>> = {};

  for (const cat of categories) {
    const cand = bestCandidate[cat];
    if (!cand) continue;

    const cropped = cropResampledSquare(
      rgba,
      width,
      height,
      cand.x0,
      cand.y0,
      patchSize,
      outSize
    );

    // Purifica bordas de rios/trilhas estreitas substituindo pixels fora da categoria por amostras válidas do próprio patch
    const validIndices: number[] = [];
    for (let i = 0; i < outSize * outSize; i++) {
      const pIdx = i * 4;
      if (classifyPixelSwatch(cropped[pIdx], cropped[pIdx + 1], cropped[pIdx + 2]) === cat) {
        validIndices.push(pIdx);
      }
    }
    if (validIndices.length > 0 && validIndices.length < outSize * outSize) {
      let ptr = 0;
      for (let i = 0; i < outSize * outSize; i++) {
        const pIdx = i * 4;
        if (classifyPixelSwatch(cropped[pIdx], cropped[pIdx + 1], cropped[pIdx + 2]) !== cat) {
          const srcIdx = validIndices[ptr % validIndices.length];
          cropped[pIdx] = cropped[srcIdx];
          cropped[pIdx + 1] = cropped[srcIdx + 1];
          cropped[pIdx + 2] = cropped[srcIdx + 2];
          ptr++;
        }
      }
    }
    const seamless = makeSeamlessTileRGBA(cropped, outSize);
    const hf = computeHeightField(seamless, outSize, outSize, {
      smoothRadius: 1,
      invertHeight: false,
      contrast: 1.15,
    });
    const normalRgba = heightFieldToNormalRGBA(
      hf.macroHeight,
      hf.rawLuminance,
      outSize,
      outSize,
      2.2,
      0.7
    );

    const [ar, ag, ab] = cand.avgRgb;
    const sampleBox: [number, number, number, number] = [
      Number((cand.x0 / width).toFixed(3)),
      Number((cand.y0 / height).toFixed(3)),
      Number(((cand.x0 + patchSize) / width).toFixed(3)),
      Number(((cand.y0 + patchSize) / height).toFixed(3)),
    ];
    const avgColor = `rgb(${ar},${ag},${ab})`;
    const cacheKey = `${cat}:${sampleBox.join(',')}:${avgColor}`;
    swatchPixelCache.set(cacheKey, { rgba: seamless, size: outSize });

    swatches[cat] = {
      category: cat,
      label: SWATCH_CATEGORY_LABELS[cat],
      sampleBox,
      albedoDataUrl: rgbaToDataUrl(seamless, outSize, outSize),
      normalDataUrl: rgbaToDataUrl(normalRgba, outSize, outSize),
      averageColor: avgColor,
      confidence: Number(cand.score.toFixed(2)),
    };
  }

  return {
    id: `kit_${Date.now().toString(36)}`,
    name: `Kit: ${label}`,
    sourceCount: 1,
    swatches,
    portals: detectBorderPortals(rgba, width, height),
    biomeStats,
    edgeStrips: extractEdgeStrips(rgba, width, height),
  };
}

/**
 * Absorve uma nova imagem de referência (ou textura gerada via ComfyUI/Magnific)
 * para dentro de um IsoWorldKit existente, aprimorando swatches com maior confiança.
 */
export function mergeImageIntoWorldKit(
  existing: IsoWorldKit | undefined,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  label: string
): IsoWorldKit {
  const incoming = extractWorldKitFromImage(rgba, width, height, label);
  if (!existing) return incoming;

  const mergedSwatches: Partial<Record<SwatchCategory, AbsorbedSwatch>> = {
    ...existing.swatches,
  };
  (Object.keys(incoming.swatches) as SwatchCategory[]).forEach((cat) => {
    const inc = incoming.swatches[cat];
    const cur = mergedSwatches[cat];
    if (inc && (!cur || inc.confidence >= cur.confidence - 0.05)) {
      mergedSwatches[cat] = inc;
    }
  });

  return {
    ...existing,
    name: `${existing.name} + ${label}`,
    sourceCount: existing.sourceCount + 1,
    swatches: mergedSwatches,
  };
}
