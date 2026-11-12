import * as THREE from 'three';
import type { IsoWorldKit, MaterialPreset } from '../types/isodsl';
import { computeHeightField, heightFieldToNormalRGBA } from './imageMaps';

export interface ProceduralTexturePair {
  albedo: THREE.CanvasTexture;
  normal: THREE.DataTexture;
  roughness: number;
}

const textureCache = new Map<string, ProceduralTexturePair>();

function parseRgbTuple(rgbStr: string | undefined): [number, number, number] | null {
  if (!rgbStr) return null;
  const m = rgbStr.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function hash2D(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function drawBrickPattern(
  ctx: CanvasRenderingContext2D,
  size: number,
  baseRgb: [number, number, number],
  mortarRgb: string,
  rows: number,
  cols: number,
  seed: number
): void {
  ctx.fillStyle = mortarRgb;
  ctx.fillRect(0, 0, size, size);
  const cellH = size / rows;
  const cellW = size / cols;
  const gap = Math.max(2, Math.round(size * 0.015));

  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 1 ? cellW * 0.5 : 0;
    for (let c = -1; c <= cols; c++) {
      const n = (hash2D(c + 10, r + 10, seed) - 0.5) * 26;
      const cr = Math.min(255, Math.max(0, Math.round(baseRgb[0] + n)));
      const cg = Math.min(255, Math.max(0, Math.round(baseRgb[1] + n)));
      const cb = Math.min(255, Math.max(0, Math.round(baseRgb[2] + n)));
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      const x = c * cellW + offset + gap * 0.5;
      const y = r * cellH + gap * 0.5;
      ctx.fillRect(x, y, cellW - gap, cellH - gap);
    }
  }
}

function drawTimberPlaster(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = '#d6c7ad';
  ctx.fillRect(0, 0, size, size);

  // Granulado leve de reboco
  for (let i = 0; i < 650; i++) {
    const x = hash2D(i, 1, 7) * size;
    const y = hash2D(i, 2, 7) * size;
    const shade = 195 + Math.round(hash2D(i, 3, 7) * 32);
    ctx.fillStyle = `rgba(${shade}, ${shade - 10}, ${shade - 24}, 0.35)`;
    ctx.fillRect(x, y, 3, 3);
  }

  // Vigas enxaimel (timber framing)
  const beam = Math.round(size * 0.1);
  ctx.fillStyle = '#4e3422';
  ctx.fillRect(0, 0, size, beam);
  ctx.fillRect(0, size - beam, size, beam);
  ctx.fillRect(0, 0, beam, size);
  ctx.fillRect(size - beam, 0, beam, size);
  ctx.fillRect(size * 0.5 - beam * 0.45, 0, beam * 0.9, size);

  // Diagonal estrutural
  ctx.lineWidth = beam * 0.7;
  ctx.strokeStyle = '#4a301e';
  ctx.beginPath();
  ctx.moveTo(beam * 0.5, size - beam * 0.5);
  ctx.lineTo(size * 0.5, beam * 0.5);
  ctx.stroke();
}

function drawWoodPlank(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = '#382214';
  ctx.fillRect(0, 0, size, size);
  const planks = 6;
  const h = size / planks;
  for (let i = 0; i < planks; i++) {
    const shade = Math.round((hash2D(i, 4, 19) - 0.5) * 24);
    ctx.fillStyle = `rgb(${120 + shade}, ${78 + Math.round(shade * 0.7)}, ${45 + Math.round(shade * 0.5)})`;
    ctx.fillRect(0, i * h + 2, size, h - 4);
    ctx.strokeStyle = 'rgba(42, 22, 10, 0.35)';
    ctx.lineWidth = 1.5;
    for (let g = 0; g < 4; g++) {
      const gy = i * h + 6 + g * (h / 5);
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(size, gy + (hash2D(i, g, 9) - 0.5) * 4);
      ctx.stroke();
    }
  }
}

function drawTreeBark(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = '#3b2619';
  ctx.fillRect(0, 0, size, size);

  // Sulcos verticais profundos + placas de casca rugosa
  const strips = 18;
  const colW = size / strips;
  for (let i = 0; i < strips; i++) {
    const x = i * colW;
    const tone = Math.round((hash2D(i, 7, 41) - 0.5) * 28);
    ctx.fillStyle = `rgb(${84 + tone}, ${56 + Math.round(tone * 0.72)}, ${37 + Math.round(tone * 0.5)})`;
    ctx.fillRect(x + 1, 0, Math.max(2, colW - 3), size);

    // Fissuras escuras entre placas verticais
    ctx.strokeStyle = 'rgba(26, 15, 9, 0.72)';
    ctx.lineWidth = Math.max(1.5, colW * 0.22);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    for (let y = 0; y <= size; y += size / 6) {
      const wobble = (hash2D(i, y, 63) - 0.5) * colW * 0.35;
      ctx.lineTo(x + wobble, y);
    }
    ctx.stroke();

    // Nós horizontais de casca e toques sutis de musgo
    const knotY = hash2D(i, 3, 91) * size;
    ctx.fillStyle = 'rgba(42, 26, 16, 0.55)';
    ctx.fillRect(x + 2, knotY, Math.max(2, colW - 4), size * 0.05);
    if (hash2D(i, 9, 55) > 0.65) {
      ctx.fillStyle = 'rgba(72, 92, 46, 0.32)';
      ctx.fillRect(x + 1, (knotY + size * 0.4) % size, colW * 0.7, size * 0.09);
    }
  }
}

function drawFoliageCanopy(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = '#294b2a';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 420; i++) {
    const x = hash2D(i, 17, 121) * size;
    const y = hash2D(i, 29, 121) * size;
    const radius = 3 + hash2D(i, 41, 121) * 12;
    const tone = Math.round(hash2D(i, 53, 121) * 38);
    ctx.fillStyle = `rgba(${38 + tone}, ${86 + tone}, ${42 + Math.round(tone * 0.55)}, 0.72)`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(156, 190, 77, 0.22)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 36; i++) {
    const x = hash2D(i, 67, 91) * size;
    const y = hash2D(i, 79, 91) * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (hash2D(i, 89, 91) - 0.5) * 18, y - 8 - hash2D(i, 97, 91) * 16);
    ctx.stroke();
  }
}

function drawRoadDirt(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = '#8c6942';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 650; i++) {
    const x = hash2D(i, 11, 201) * size;
    const y = hash2D(i, 23, 201) * size;
    const tone = Math.round((hash2D(i, 37, 201) - 0.5) * 34);
    ctx.fillStyle = `rgba(${140 + tone}, ${101 + Math.round(tone * 0.7)}, ${61 + Math.round(tone * 0.45)}, 0.48)`;
    ctx.beginPath();
    ctx.arc(x, y, 1.5 + hash2D(i, 43, 201) * 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(71, 45, 25, 0.28)';
  for (let i = 0; i < 14; i++) {
    const y = hash2D(i, 61, 201) * size;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y + (hash2D(i, 73, 201) - 0.5) * 16);
    ctx.stroke();
  }
}

function drawWaterSurface(ctx: CanvasRenderingContext2D, size: number): void {
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#245f78');
  grad.addColorStop(0.5, '#3b9bb0');
  grad.addColorStop(1, '#1d526e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(184, 235, 226, 0.48)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 26; i++) {
    const y = hash2D(i, 31, 301) * size;
    const x = hash2D(i, 47, 301) * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + size * 0.08, y - 4, x + size * 0.16, y);
    ctx.stroke();
  }
}

function drawEmberGlow(ctx: CanvasRenderingContext2D, size: number): void {
  const grad = ctx.createRadialGradient(
    size * 0.5,
    size * 0.5,
    size * 0.08,
    size * 0.5,
    size * 0.5,
    size * 0.7
  );
  grad.addColorStop(0, '#fff0a8');
  grad.addColorStop(0.42, '#ff8d24');
  grad.addColorStop(0.82, '#b8320e');
  grad.addColorStop(1, '#3b150b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 180; i++) {
    const x = hash2D(i, 5, 77) * size;
    const y = hash2D(i, 13, 77) * size;
    const r = 2 + hash2D(i, 29, 77) * 5;
    const hot = hash2D(i, 41, 77) > 0.45;
    ctx.fillStyle = hot ? 'rgba(255, 224, 128, 0.55)' : 'rgba(54, 18, 8, 0.42)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMossEarth(
  ctx: CanvasRenderingContext2D,
  size: number,
  baseRgb: [number, number, number] = [73, 95, 54]
): void {
  ctx.fillStyle = `rgb(${baseRgb[0]},${baseRgb[1]},${baseRgb[2]})`;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const x = hash2D(i, 11, 31) * size;
    const y = hash2D(i, 23, 31) * size;
    const r = 2 + hash2D(i, 37, 31) * 5;
    const delta = Math.round((hash2D(i, 5, 2) - 0.45) * 32);
    const cr = Math.min(255, Math.max(0, baseRgb[0] + delta));
    const cg = Math.min(255, Math.max(0, baseRgb[1] + delta));
    const cb = Math.min(255, Math.max(0, baseRgb[2] + Math.round(delta * 0.7)));
    ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, 0.48)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Gera e cacheia pares de texturas PBR tileáveis (Albedo + Normal Map derivado via Sobel),
 * adaptando automaticamente a paleta quando um IsoWorldKit absorvido é fornecido.
 */
export function getProceduralMaterialTextures(
  preset: MaterialPreset,
  kit?: IsoWorldKit | null
): ProceduralTexturePair {
  const stoneTint = parseRgbTuple(kit?.swatches.stone?.averageColor);
  const foliageTint = parseRgbTuple(kit?.swatches.foliage?.averageColor);
  const grassTint = parseRgbTuple(kit?.swatches.grass?.averageColor);

  const tintKey =
    preset === 'stone_brick' && stoneTint
      ? `${preset}:${stoneTint.join(',')}`
      : preset === 'moss_earth' && (foliageTint || grassTint)
      ? `${preset}:${(foliageTint ?? grassTint)!.join(',')}`
      : preset;

  const existing = textureCache.get(tintKey);
  if (existing) return existing;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  let roughness = 0.88;
  switch (preset) {
    case 'stone_brick': {
      const rgb: [number, number, number] = stoneTint ?? [118, 120, 126];
      const mortar = `rgb(${Math.max(25, Math.round(rgb[0] * 0.52))},${Math.max(25, Math.round(rgb[1] * 0.52))},${Math.max(25, Math.round(rgb[2] * 0.52))})`;
      drawBrickPattern(ctx, size, rgb, mortar, 8, 4, 11);
      roughness = 0.88;
      break;
    }
    case 'cobblestone':
      drawBrickPattern(ctx, size, [104, 100, 96], '#3c3a37', 10, 8, 22);
      roughness = 0.84;
      break;
    case 'timber_plaster':
      drawTimberPlaster(ctx, size);
      roughness = 0.85;
      break;
    case 'roof_slate':
      drawBrickPattern(ctx, size, [72, 82, 98], '#2b323d', 12, 6, 33);
      roughness = 0.72;
      break;
    case 'roof_teal':
      drawBrickPattern(ctx, size, [54, 118, 138], '#1f4959', 12, 6, 44);
      roughness = 0.68;
      break;
    case 'roof_terracotta':
      drawBrickPattern(ctx, size, [168, 82, 52], '#6e2e1b', 14, 7, 48);
      roughness = 0.78;
      break;
    case 'thatch':
      drawBrickPattern(ctx, size, [186, 152, 78], '#8c6d2c', 16, 4, 55);
      roughness = 0.92;
      break;
    case 'wood_plank':
      drawWoodPlank(ctx, size);
      roughness = 0.78;
      break;
    case 'tree_bark':
      drawTreeBark(ctx, size);
      roughness = 0.93;
      break;
    case 'foliage_canopy':
      drawFoliageCanopy(ctx, size);
      roughness = 0.96;
      break;
    case 'road_dirt':
      drawRoadDirt(ctx, size);
      roughness = 0.98;
      break;
    case 'water_surface':
      drawWaterSurface(ctx, size);
      roughness = 0.18;
      break;
    case 'moss_earth': {
      const rgb: [number, number, number] = foliageTint ?? grassTint ?? [73, 95, 54];
      drawMossEarth(ctx, size, rgb);
      roughness = 0.94;
      break;
    }
    case 'ember_glow':
      drawEmberGlow(ctx, size);
      roughness = 0.42;
      break;
  }

  const albedo = new THREE.CanvasTexture(canvas);
  albedo.wrapS = THREE.RepeatWrapping;
  albedo.wrapT = THREE.RepeatWrapping;
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.needsUpdate = true;

  const imageData = ctx.getImageData(0, 0, size, size);
  const hf = computeHeightField(imageData.data, size, size, {
    smoothRadius: 1,
    invertHeight: false,
    contrast: 1.1,
  });
  const normalRgba = heightFieldToNormalRGBA(
    hf.macroHeight,
    hf.rawLuminance,
    size,
    size,
    2.4,
    0.7
  );
  const normal = new THREE.DataTexture(normalRgba, size, size, THREE.RGBAFormat);
  normal.wrapS = THREE.RepeatWrapping;
  normal.wrapT = THREE.RepeatWrapping;
  normal.magFilter = THREE.LinearFilter;
  normal.minFilter = THREE.LinearMipmapLinearFilter;
  normal.generateMipmaps = true;
  normal.flipY = true;
  normal.needsUpdate = true;

  const pair = { albedo, normal, roughness };
  textureCache.set(tintKey, pair);
  return pair;
}

export const MATERIAL_PRESET_LABELS: Record<MaterialPreset, string> = {
  stone_brick: 'Pedra / Alvenaria',
  cobblestone: 'Calçamento',
  timber_plaster: 'Enxaimel & Reboco',
  roof_slate: 'Telha Ardósia',
  roof_teal: 'Telha Azul Medieval',
  roof_terracotta: 'Telha Terracota / Barro',
  thatch: 'Palha / Colmo',
  wood_plank: 'Madeira / Tábuas',
  tree_bark: 'Casca de Árvore',
  foliage_canopy: 'Folhagem Procedural',
  road_dirt: 'Terra de Estrada',
  water_surface: 'Superfície de Água',
  moss_earth: 'Terra & Musgo',
  ember_glow: 'Brasas & Chamas',
};
