import type {
  AbsorbedSwatch,
  IsoWorldKit,
  SwatchCategory,
} from '../types/isodsl';
import {
  computeHeightField,
  heightFieldToNormalRGBA,
  rgbaToDataUrl,
} from './imageMaps';
import {
  getSwatchPixels,
  makeSeamlessTileRGBA,
  setSwatchPixels,
  SWATCH_CATEGORY_LABELS,
} from './worldKit';

function parseRgb(
  rgbStr: string | undefined,
  fallback: [number, number, number]
): [number, number, number] {
  if (!rgbStr) return fallback;
  const m = rgbStr.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return fallback;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function periodicHash(ix: number, iy: number, period: number, seed: number): number {
  const wx = ((ix % period) + period) % period;
  const wy = ((iy % period) + period) % period;
  const n = Math.sin(wx * 127.1 + wy * 311.7 + seed * 53.7) * 43758.5453123;
  return n - Math.floor(n);
}

/** Ruído periódico 2D para gerar texturas 100% tileáveis sem costuras */
function periodicNoise(u: number, v: number, freq: number, seed: number): number {
  const fx = u * freq;
  const fy = v * freq;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const ux = tx * tx * (3 - 2 * tx);
  const uy = ty * ty * (3 - 2 * ty);

  const a = periodicHash(ix, iy, freq, seed);
  const b = periodicHash(ix + 1, iy, freq, seed);
  const c = periodicHash(ix, iy + 1, freq, seed);
  const d = periodicHash(ix + 1, iy + 1, freq, seed);

  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function sampleBufferBilinear(
  src: Uint8ClampedArray,
  srcSize: number,
  u: number,
  v: number
): [number, number, number] {
  const fu = (((u % 1) + 1) % 1) * srcSize;
  const fv = (((v % 1) + 1) % 1) * srcSize;
  const x0 = Math.floor(fu) % srcSize;
  const y0 = Math.floor(fv) % srcSize;
  const x1 = (x0 + 1) % srcSize;
  const y1 = (y0 + 1) % srcSize;
  const tx = fu - Math.floor(fu);
  const ty = fv - Math.floor(fv);

  const get = (x: number, y: number, ch: number) => src[(y * srcSize + x) * 4 + ch];
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  return [
    lerp(lerp(get(x0, y0, 0), get(x1, y0, 0), tx), lerp(get(x0, y1, 0), get(x1, y1, 0), tx), ty),
    lerp(lerp(get(x0, y0, 1), get(x1, y0, 1), tx), lerp(get(x0, y1, 1), get(x1, y1, 1), tx), ty),
    lerp(lerp(get(x0, y0, 2), get(x1, y0, 2), tx), lerp(get(x0, y1, 2), get(x1, y1, 2), tx), ty),
  ];
}

/**
 * Ferramenta Geradora Procedural Painterly: cria uma textura tileável 128x128 suave e detalhada
 * combinando a paleta absorvida do swatch original com pinceladas multi-oitava sem costura.
 */
export function generatePainterlySwatchRGBA(
  category: SwatchCategory,
  baseRgb: [number, number, number],
  sampledPatch: { rgba: Uint8ClampedArray; size: number } | null,
  size = 128,
  seed = 17
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;

      // Multi-oitava periódica (zero costuras nas bordas)
      const nLow = periodicNoise(u, v, 6, seed);
      const nMid = periodicNoise(u, v, 14, seed + 11);
      const nHigh = periodicNoise(u, v, 28, seed + 29);

      let strokeDelta = 0;
      if (category === 'grass' || category === 'foliage') {
        // Pinceladas orgânicas de relva/folhagem
        const blade = periodicNoise(u * 2.0, v * 0.7, 16, seed + 41);
        strokeDelta = (nLow - 0.5) * 18 + (blade - 0.5) * 16 + (nHigh - 0.5) * 8;
      } else if (category === 'dirt_road') {
        // Sulcos suaves e pedrinhas sutis
        const pebble = nHigh > 0.78 ? 10 : nHigh < 0.18 ? -10 : 0;
        strokeDelta = (nLow - 0.5) * 14 + (nMid - 0.5) * 12 + pebble;
      } else if (category === 'water') {
        // Ondulações e cáusticas suaves
        const ripple = Math.sin((u * 3 + nLow * 0.6) * Math.PI * 2) * 0.5 + 0.5;
        strokeDelta = (ripple - 0.5) * 18 + (nMid - 0.5) * 10;
      } else {
        // Pedra / arenito em blocos suaves
        const blockY = Math.floor((v * 4) % 4);
        const shiftU = (u + (blockY % 2 === 1 ? 0.25 : 0)) % 1;
        const mortarX = Math.abs(((shiftU * 4) % 1) - 0.5) > 0.45;
        const mortarY = Math.abs(((v * 4) % 1) - 0.5) > 0.45;
        strokeDelta =
          mortarX || mortarY
            ? -22
            : (nLow - 0.5) * 14 + (nMid - 0.5) * 10;
      }

      let r = baseRgb[0];
      let g = baseRgb[1];
      let b = baseRgb[2];

      if (sampledPatch) {
        const s = sampleBufferBilinear(sampledPatch.rgba, sampledPatch.size, u, v);
        r = r * 0.55 + s[0] * 0.45;
        g = g * 0.55 + s[1] * 0.45;
        b = b * 0.55 + s[2] * 0.45;
      }

      const idx = (y * size + x) * 4;
      out[idx] = Math.min(255, Math.max(0, Math.round(r + strokeDelta)));
      out[idx + 1] = Math.min(255, Math.max(0, Math.round(g + strokeDelta)));
      out[idx + 2] = Math.min(255, Math.max(0, Math.round(b + strokeDelta * 0.85)));
      out[idx + 3] = 255;
    }
  }

  return out;
}

/**
 * Executa a ferramenta interna de síntese Painterly 128px sobre todos os swatches do Kit,
 * garantindo texturas suaves, ricas e 100% tileáveis.
 */
export function synthesizePainterlyWorldKit(
  kit: IsoWorldKit,
  seed = 17
): IsoWorldKit {
  const categories: SwatchCategory[] = [
    'grass',
    'dirt_road',
    'water',
    'foliage',
    'stone',
  ];
  const defaults: Record<SwatchCategory, [number, number, number]> = {
    grass: [152, 184, 118],
    dirt_road: [188, 162, 122],
    water: [122, 162, 184],
    foliage: [92, 134, 78],
    stone: [212, 190, 152],
  };

  const outSize = 128;
  const nextSwatches: Partial<Record<SwatchCategory, AbsorbedSwatch>> = {
    ...kit.swatches,
  };

  categories.forEach((cat, idx) => {
    const existing = kit.swatches[cat];
    const baseRgb = parseRgb(existing?.averageColor, defaults[cat]);
    const sampled = getSwatchPixels(existing);
    const rgba = generatePainterlySwatchRGBA(
      cat,
      baseRgb,
      sampled,
      outSize,
      seed + idx * 31
    );

    const hf = computeHeightField(rgba, outSize, outSize, {
      smoothRadius: 1,
      invertHeight: false,
      contrast: 1.1,
    });
    const normalRgba = heightFieldToNormalRGBA(
      hf.macroHeight,
      hf.rawLuminance,
      outSize,
      outSize,
      2.0,
      0.75
    );

    const updated: AbsorbedSwatch = existing
      ? {
          ...existing,
          albedoDataUrl: rgbaToDataUrl(rgba, outSize, outSize),
          normalDataUrl: rgbaToDataUrl(normalRgba, outSize, outSize),
        }
      : {
          category: cat,
          label: SWATCH_CATEGORY_LABELS[cat],
          sampleBox: [0, 0, 1, 1],
          albedoDataUrl: rgbaToDataUrl(rgba, outSize, outSize),
          normalDataUrl: rgbaToDataUrl(normalRgba, outSize, outSize),
          averageColor: `rgb(${baseRgb[0]},${baseRgb[1]},${baseRgb[2]})`,
          confidence: 0.7,
        };

    setSwatchPixels(updated, rgba, outSize);
    nextSwatches[cat] = updated;
  });

  return {
    ...kit,
    swatches: nextSwatches,
  };
}

/**
 * Aplica uma textura externa (gerada no ComfyUI, Magnific ou PNG importado) diretamente em um slot do Kit.
 */
export function applyCustomSwatchBuffer(
  kit: IsoWorldKit,
  category: SwatchCategory,
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): IsoWorldKit {
  const outSize = 128;
  const resampled = new Uint8ClampedArray(outSize * outSize * 4);
  let sr = 0;
  let sg = 0;
  let sb = 0;

  for (let y = 0; y < outSize; y++) {
    const sy = Math.min(height - 1, Math.floor((y / outSize) * height));
    for (let x = 0; x < outSize; x++) {
      const sx = Math.min(width - 1, Math.floor((x / outSize) * width));
      const si = (sy * width + sx) * 4;
      const di = (y * outSize + x) * 4;
      resampled[di] = rgba[si];
      resampled[di + 1] = rgba[si + 1];
      resampled[di + 2] = rgba[si + 2];
      resampled[di + 3] = 255;
      sr += rgba[si];
      sg += rgba[si + 1];
      sb += rgba[si + 2];
    }
  }

  const seamless = makeSeamlessTileRGBA(resampled, outSize);
  const hf = computeHeightField(seamless, outSize, outSize, {
    smoothRadius: 1,
    invertHeight: false,
    contrast: 1.1,
  });
  const normalRgba = heightFieldToNormalRGBA(
    hf.macroHeight,
    hf.rawLuminance,
    outSize,
    outSize,
    2.2,
    0.75
  );

  const n = outSize * outSize;
  const avgColor = `rgb(${Math.round(sr / n)},${Math.round(sg / n)},${Math.round(sb / n)})`;
  const swatch: AbsorbedSwatch = {
    category,
    label: SWATCH_CATEGORY_LABELS[category],
    sampleBox: [0, 0, 1, 1],
    albedoDataUrl: rgbaToDataUrl(seamless, outSize, outSize),
    normalDataUrl: rgbaToDataUrl(normalRgba, outSize, outSize),
    averageColor: avgColor,
    confidence: 1.0,
  };
  setSwatchPixels(swatch, seamless, outSize);

  return {
    ...kit,
    swatches: {
      ...kit.swatches,
      [category]: swatch,
    },
  };
}

export function buildComfyTexturePrompt(
  category: SwatchCategory,
  swatch: AbsorbedSwatch | undefined,
  sceneName: string
): string {
  const colorHint = swatch?.averageColor ?? 'natural RPG palette';
  const map: Record<SwatchCategory, string> = {
    grass: `seamless top-down hand-painted RPG battlemap meadow grass texture, soft painterly brushstrokes matching ${colorHint}, flat even lighting, no shadows, tileable, game asset (${sceneName})`,
    dirt_road: `seamless top-down hand-painted RPG dirt footpath texture with fine pebbles, matching ${colorHint}, flat even lighting, no cast shadows, tileable`,
    water: `seamless top-down painted shallow stream water texture with subtle caustics, matching ${colorHint}, flat lighting, tileable`,
    foliage: `seamless top-down stylized painted tree canopy leaves texture, matching ${colorHint}, tileable game texture`,
    stone: `seamless top-down painted ancient weathered stone blocks floor and wall texture, matching ${colorHint}, flat lighting, tileable`,
  };
  return map[category];
}

/**
 * Conecta com API local do ComfyUI (ex.: http://127.0.0.1:8188) enviando workflow básico
 * para gerar uma textura tileável sob medida a partir do prompt do Kit.
 */
export async function generateTextureViaComfyUI(options: {
  endpoint: string;
  checkpointName: string;
  prompt: string;
  seed: number;
}): Promise<string> {
  const base = options.endpoint.replace(/\/+$/, '');
  const workflow = {
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed: options.seed,
        steps: 18,
        cfg: 6.5,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    '4': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: options.checkpointName },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width: 512, height: 512, batch_size: 1 },
    },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: { text: options.prompt, clip: ['4', 1] },
    },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: 'perspective, 3d render, cast shadows, blurry, text, watermark, characters',
        clip: ['4', 1],
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['3', 0], vae: ['4', 2] },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'isoforge_tex', images: ['8', 0] },
    },
  };

  const enqueueRes = await fetch(`${base}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });
  if (!enqueueRes.ok) {
    throw new Error(`ComfyUI retornou HTTP ${enqueueRes.status}`);
  }
  const { prompt_id } = (await enqueueRes.json()) as { prompt_id: string };

  for (let attempt = 0; attempt < 45; attempt++) {
    await new Promise((r) => setTimeout(r, 1200));
    const histRes = await fetch(`${base}/history/${prompt_id}`);
    if (!histRes.ok) continue;
    const hist = (await histRes.json()) as Record<
      string,
      { outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }> }
    >;
    const entry = hist[prompt_id];
    const imgInfo = entry?.outputs?.['9']?.images?.[0];
    if (imgInfo) {
      const qs = new URLSearchParams({
        filename: imgInfo.filename,
        subfolder: imgInfo.subfolder,
        type: imgInfo.type,
      });
      return `${base}/view?${qs.toString()}`;
    }
  }
  throw new Error('Timeout aguardando geração de textura no ComfyUI');
}

