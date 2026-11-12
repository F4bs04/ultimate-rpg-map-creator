import {
  type BorderPortal,
  type IsoDSLScene,
  type IsoWorldKit,
  type PropDef,
  type StructureDef,
  type SwatchCategory,
  type WorldGrammarConfig,
  type WorldScale,
} from '../types/isodsl';
import { computeHeightField, heightFieldToNormalRGBA, rgbaToDataUrl } from './imageMaps';
import { solveChunkBiomeWFC, type ChunkBiome } from './wfcSolver';
import { getSwatchPixels, type SwatchPixelBuffer } from './worldKit';

export type { ChunkBiome };

export interface PathSegment2D {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  width: number;
  kind: 'road' | 'water';
}

export interface GeneratedChunkData {
  gx: number;
  gz: number;
  isAnchor: boolean;
  isOuterLOD: boolean;
  biome: ChunkBiome;
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  subdivisions: number;
  heightField?: Float32Array;
  heightWidth?: number;
  heightHeight?: number;
  albedoRgba?: Uint8ClampedArray;
  normalRgba?: Uint8ClampedArray;
  albedoDataUrl?: string;
  normalDataUrl?: string;
  segments: PathSegment2D[];
}

export interface GeneratedWorldExpansion {
  gridRadius: number;
  chunks: GeneratedChunkData[];
  worldStructures: StructureDef[];
  worldProps: PropDef[];
  summary: {
    chunkCount: number;
    roadSegments: number;
    riverSegments: number;
    poiCount: number;
    instancedPropCount: number;
  };
}

/** PRNG determinístico Mulberry32 */
export function createSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2D(ix: number, iz: number, seed: number): number {
  const n = Math.sin(ix * 127.1 + iz * 311.7 + seed * 17.3) * 43758.5453123;
  return n - Math.floor(n);
}

/** Ruído contínuo em coordenadas do mundo para garantir emenda suave de relevo entre chunks */
export function fbm2D(x: number, z: number, seed: number): number {
  const sample = (fx: number, fz: number) => {
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const ux = tx * tx * (3 - 2 * tx);
    const uz = tz * tz * (3 - 2 * tz);
    const a = hash2D(ix, iz, seed);
    const b = hash2D(ix + 1, iz, seed);
    const c = hash2D(ix, iz + 1, seed);
    const d = hash2D(ix + 1, iz + 1, seed);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  };
  return sample(x * 0.06, z * 0.06) * 0.65 + sample(x * 0.16, z * 0.16) * 0.35;
}

function parseRgbString(
  rgbStr: string | undefined,
  fallback: [number, number, number]
): [number, number, number] {
  if (!rgbStr) return fallback;
  const m = rgbStr.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return fallback;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function sampleTiledSwatchRGB(
  buf: SwatchPixelBuffer | null,
  fallbackRgb: [number, number, number],
  wx: number,
  wz: number,
  tileMeters = 8.5
): [number, number, number] {
  if (!buf) return fallbackRgb;
  const u = ((wx / tileMeters) % 1 + 1) % 1;
  const v = ((wz / tileMeters) % 1 + 1) % 1;
  const fu = u * buf.size;
  const fv = v * buf.size;
  const x0 = Math.floor(fu) % buf.size;
  const y0 = Math.floor(fv) % buf.size;
  const x1 = (x0 + 1) % buf.size;
  const y1 = (y0 + 1) % buf.size;
  const tx = fu - Math.floor(fu);
  const ty = fv - Math.floor(fv);

  const get = (x: number, y: number, ch: number) =>
    buf.rgba[(y * buf.size + x) * 4 + ch];
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  return [
    lerp(lerp(get(x0, y0, 0), get(x1, y0, 0), tx), lerp(get(x0, y1, 0), get(x1, y1, 0), tx), ty),
    lerp(lerp(get(x0, y0, 1), get(x1, y0, 1), tx), lerp(get(x0, y1, 1), get(x1, y1, 1), tx), ty),
    lerp(lerp(get(x0, y0, 2), get(x1, y0, 2), tx), lerp(get(x0, y1, 2), get(x1, y1, 2), tx), ty),
  ];
}

function sampleEdgeStrip(
  strip: [number, number, number][] | undefined,
  t: number
): [number, number, number] | null {
  if (!strip || strip.length === 0) return null;
  const f = Math.min(1, Math.max(0, t)) * (strip.length - 1);
  const i0 = Math.floor(f);
  const i1 = Math.min(strip.length - 1, i0 + 1);
  const frac = f - i0;
  return [
    strip[i0][0] + (strip[i1][0] - strip[i0][0]) * frac,
    strip[i0][1] + (strip[i1][1] - strip[i0][1]) * frac,
    strip[i0][2] + (strip[i1][2] - strip[i0][2]) * frac,
  ];
}

function distToSegment2D(
  px: number,
  pz: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number
): number {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-6) return Math.hypot(px - x0, pz - z0);
  const t = Math.min(1, Math.max(0, ((px - x0) * dx + (pz - z0) * dz) / lenSq));
  return Math.hypot(px - (x0 + dx * t), pz - (z0 + dz * t));
}

export function getScaleGridRadius(scale: WorldScale): number {
  if (scale === 'medium') return 2; // 5x5 = 25 chunks (Mundo Aberto Médio)
  if (scale === 'large') return 4; // 9x9 = 81 chunks (Mundo Aberto Grande)
  return 1; // 3x3 = 9 chunks até no modo Pequeno para horizonte aberto
}

/**
 * Propaga um portal de rio ou estrada do chunk âncora (0,0) através dos chunks vizinhos
 * aplicando curvatura orgânica (meandro + aleatoriedade controlada).
 */
function tracePortalPath(
  portal: BorderPortal,
  gridRadius: number,
  chunkW: number,
  chunkD: number,
  grammar: WorldGrammarConfig,
  rng: () => number
): { gx: number; gz: number; seg: PathSegment2D }[] {
  const results: { gx: number; gz: number; seg: PathSegment2D }[] = [];
  if (gridRadius === 0) return results;

  const widthMeters =
    portal.kind === 'water'
      ? Math.max(2.4, portal.widthNorm * chunkW * 0.9)
      : Math.max(1.8, portal.widthNorm * chunkW * 0.75);

  let curX = 0;
  let curZ = 0;
  let dirX = 0;
  let dirZ = 0;
  let gx = 0;
  let gz = 0;

  switch (portal.side) {
    case 'north':
      curX = (portal.t - 0.5) * chunkW;
      curZ = -chunkD * 0.5;
      dirZ = -1;
      gz = -1;
      break;
    case 'south':
      curX = (portal.t - 0.5) * chunkW;
      curZ = chunkD * 0.5;
      dirZ = 1;
      gz = 1;
      break;
    case 'west':
      curX = -chunkW * 0.5;
      curZ = (portal.t - 0.5) * chunkD;
      dirX = -1;
      gx = -1;
      break;
    case 'east':
      curX = chunkW * 0.5;
      curZ = (portal.t - 0.5) * chunkD;
      dirX = 1;
      gx = 1;
      break;
  }

  let curGx = gx;
  let curGz = gz;
  const maxSteps = gridRadius * 2 + 2;

  for (let step = 0; step < maxSteps; step++) {
    if (Math.abs(curGx) > gridRadius || Math.abs(curGz) > gridRadius) break;

    const meander =
      (rng() - 0.5) *
      grammar.meanderStrength *
      (0.4 + grammar.randomness * 0.8) *
      Math.min(chunkW, chunkD) *
      0.45;

    const nextX =
      dirX !== 0
        ? curX + dirX * chunkW
        : Math.max(
            (curGx - 0.42) * chunkW,
            Math.min((curGx + 0.42) * chunkW, curX + meander)
          );
    const nextZ =
      dirZ !== 0
        ? curZ + dirZ * chunkD
        : Math.max(
            (curGz - 0.42) * chunkD,
            Math.min((curGz + 0.42) * chunkD, curZ + meander)
          );

    const midX = (curX + nextX) * 0.5 + (dirZ !== 0 ? meander * 0.55 : 0);
    const midZ = (curZ + nextZ) * 0.5 + (dirX !== 0 ? meander * 0.55 : 0);

    results.push({
      gx: curGx,
      gz: curGz,
      seg: {
        x0: curX,
        z0: curZ,
        x1: midX,
        z1: midZ,
        width: widthMeters,
        kind: portal.kind,
      },
    });
    results.push({
      gx: curGx,
      gz: curGz,
      seg: {
        x0: midX,
        z0: midZ,
        x1: nextX,
        z1: nextZ,
        width: widthMeters,
        kind: portal.kind,
      },
    });

    curX = nextX;
    curZ = nextZ;
    curGx += dirX;
    curGz += dirZ;
  }

  return results;
}

function buildInteriorWorldExpansion(
  scene: IsoDSLScene,
  rng: () => number
): GeneratedWorldExpansion {
  const grammar = scene.worldGrammar;
  const radius = grammar.scale === 'small' ? 0 : grammar.scale === 'medium' ? 1 : 2;
  const chunkW = scene.terrain.width;
  const chunkD = scene.terrain.depth;

  const chunks: GeneratedChunkData[] = [];
  const worldStructures: StructureDef[] = [];
  const worldProps: PropDef[] = [];
  let poiCount = 0;

  for (let gz = -radius; gz <= radius; gz++) {
    for (let gx = -radius; gx <= radius; gx++) {
      const isAnchor = gx === 0 && gz === 0;
      const centerX = gx * chunkW;
      const centerZ = gz * chunkD;
      const chunk: GeneratedChunkData = {
        gx,
        gz,
        isAnchor,
        isOuterLOD: Math.max(Math.abs(gx), Math.abs(gz)) >= 2,
        biome: isAnchor ? 'anchor' : 'ruins_outpost',
        centerX,
        centerZ,
        width: chunkW,
        depth: chunkD,
        subdivisions: isAnchor ? scene.terrain.subdivisions : 12,
        segments: [],
      };

      if (!isAnchor) {
        const texRes = 64;
        const rgba = new Uint8ClampedArray(texRes * texRes * 4);
        const heightField = new Float32Array(texRes * texRes);
        const isStoneWing = (Math.abs(gx + gz) % 2) === 1;
        for (let py = 0; py < texRes; py++) {
          for (let px = 0; px < texRes; px++) {
            const idx = py * texRes + px;
            const grain = ((px ^ py) & 3) * 4;
            const o = idx * 4;
            if (isStoneWing) {
              rgba[o] = 68 + grain;
              rgba[o + 1] = 60 + grain;
              rgba[o + 2] = 56 + grain;
            } else {
              rgba[o] = 104 + grain;
              rgba[o + 1] = 64 + Math.round(grain * 0.7);
              rgba[o + 2] = 36 + Math.round(grain * 0.4);
            }
            rgba[o + 3] = 255;
            heightField[idx] = 0.5;
          }
        }
        const normalRgba = heightFieldToNormalRGBA(heightField, heightField, texRes, texRes, 0.8, 0.25);
        chunk.heightField = heightField;
        chunk.heightWidth = texRes;
        chunk.heightHeight = texRes;
        chunk.albedoRgba = rgba;
        chunk.normalRgba = normalRgba;
        chunk.albedoDataUrl = rgbaToDataUrl(rgba, texRes, texRes);
        chunk.normalDataUrl = rgbaToDataUrl(normalRgba, texRes, texRes);

        const hw = chunkW * 0.48;
        const hd = chunkD * 0.48;
        worldStructures.push({
          id: `win_n_${gx}_${gz}`,
          name: `Divisória Ala (${gx},${gz})`,
          semanticTag: 'wall',
          footprint: [
            [centerX - hw, centerZ - hd],
            [centerX + hw, centerZ - hd],
            [centerX + hw, centerZ - hd + 0.26],
            [centerX - hw, centerZ - hd + 0.26],
          ],
          baseElevation: 0.04,
          floors: 1,
          floorHeight: 2.35,
          wallStyle: isStoneWing ? 'buttress' : 'timber_frame',
          hasDoor: true,
          roofType: 'flat',
          roofPitchDeg: 10,
          roofOverhang: 0,
          hideRoof: false,
          textureMode: 'procedural',
          fallbackMaterial: isStoneWing ? 'stone_brick' : 'timber_plaster',
          roofMaterial: 'wood_plank',
          visible: true,
        });
        poiCount++;

        const roomRoll = rng();
        if (roomRoll < 0.55) {
          worldProps.push({
            id: `wprop_tbl_${gx}_${gz}`,
            name: 'tavern_table_wing',
            generator: 'tavern_table',
            position: [Number(centerX.toFixed(2)), 0.08, Number(centerZ.toFixed(2))],
            rotationYDeg: Math.round(rng() * 180),
            scale: 1.0,
            textureMode: 'procedural',
            fallbackMaterial: 'wood_plank',
            visible: true,
          });
        } else {
          worldProps.push({
            id: `wprop_br_${gx}_${gz}`,
            name: 'brazier_wing',
            generator: 'brazier',
            position: [Number(centerX.toFixed(2)), 0.08, Number(centerZ.toFixed(2))],
            rotationYDeg: 0,
            scale: 1.05,
            textureMode: 'procedural',
            fallbackMaterial: 'stone_brick',
            visible: true,
          });
        }
        worldProps.push({
          id: `wprop_bar_${gx}_${gz}`,
          name: 'barrel_wing',
          generator: 'barrel',
          position: [Number((centerX - hw * 0.68).toFixed(2)), 0.08, Number((centerZ - hd * 0.55).toFixed(2))],
          rotationYDeg: Math.round(rng() * 360),
          scale: 0.95,
          textureMode: 'procedural',
          fallbackMaterial: 'wood_plank',
          visible: true,
        });
        worldProps.push({
          id: `wprop_cr_${gx}_${gz}`,
          name: 'crate_wing',
          generator: 'crate',
          position: [Number((centerX + hw * 0.65).toFixed(2)), 0.08, Number((centerZ - hd * 0.52).toFixed(2))],
          rotationYDeg: Math.round(rng() * 90),
          scale: 0.9,
          textureMode: 'procedural',
          fallbackMaterial: 'wood_plank',
          visible: true,
        });
      }
      chunks.push(chunk);
    }
  }

  return {
    gridRadius: radius,
    chunks,
    worldStructures,
    worldProps,
    summary: {
      chunkCount: chunks.length,
      roadSegments: 0,
      riverSegments: 0,
      poiCount,
      instancedPropCount: worldProps.length,
    },
  };
}

/**
 * Compila toda a expansão procedural do mundo (WFC + Splines de Portais + Texturização por
 * Swatches absorvidos + Scatter Poisson-Disk) a partir do IsoDSL, IsoWorldKit e escala.
 */
export function buildMultiScaleWorld(
  scene: IsoDSLScene,
  kit: IsoWorldKit | undefined
): GeneratedWorldExpansion {
  const grammar = scene.worldGrammar;
  const rng = createSeededRng(grammar.seed);

  if (grammar.environmentMode === 'interior') {
    return buildInteriorWorldExpansion(scene, rng);
  }

  const radius = getScaleGridRadius(grammar.scale);
  const chunkW = scene.terrain.width;
  const chunkD = scene.terrain.depth;

  const keyOf = (gx: number, gz: number) => `${gx},${gz}`;

  // 1. Propaga caminhos a partir dos portais e fixa células percorridas antes do WFC
  const portals: BorderPortal[] =
    kit && kit.portals.length > 0
      ? kit.portals
      : [
          { side: 'west', t: 0.45, kind: 'road', widthNorm: 0.1 },
          { side: 'east', t: 0.55, kind: 'road', widthNorm: 0.1 },
        ];

  const segmentsByChunk = new Map<string, PathSegment2D[]>();
  const pinnedBiomes = new Map<string, ChunkBiome>();
  pinnedBiomes.set('0,0', 'anchor');

  let roadSegments = 0;
  let riverSegments = 0;

  for (const portal of portals) {
    if (portal.kind === 'water' && grammar.enableWaterContinuation === false) continue;
    if (portal.kind === 'road' && grammar.enableRoadContinuation === false) continue;

    const traced = tracePortalPath(portal, radius, chunkW, chunkD, grammar, rng);
    for (const item of traced) {
      const k = keyOf(item.gx, item.gz);
      const arr = segmentsByChunk.get(k) ?? [];
      arr.push(item.seg);
      segmentsByChunk.set(k, arr);

      if (item.seg.kind === 'water') {
        riverSegments++;
        pinnedBiomes.set(k, 'river_valley');
      } else {
        roadSegments++;
        if (pinnedBiomes.get(k) !== 'river_valley') {
          pinnedBiomes.set(k, 'crossroads');
        }
      }
    }
  }

  if (radius >= 2) {
    const ringZ = -2 * chunkD;
    for (let gx = -2; gx <= 2; gx++) {
      const k = keyOf(gx, -2);
      const arr = segmentsByChunk.get(k) ?? [];
      arr.push({
        x0: (gx - 0.5) * chunkW,
        z0: ringZ + (rng() - 0.5) * 2.5 * grammar.randomness,
        x1: (gx + 0.5) * chunkW,
        z1: ringZ + (rng() - 0.5) * 2.5 * grammar.randomness,
        width: 2.3,
        kind: 'road',
      });
      segmentsByChunk.set(k, arr);
      if (pinnedBiomes.get(k) !== 'river_valley') {
        pinnedBiomes.set(k, 'crossroads');
      }
      roadSegments++;
    }
  }

  // 2. Resolve grade de biomas com Wave Function Collapse (WFC)
  const solvedBiomes = solveChunkBiomeWFC({
    gridRadius: radius,
    pinnedCells: pinnedBiomes,
    grammar,
    kit,
    rng,
  });

  const chunks: GeneratedChunkData[] = [];
  for (let gz = -radius; gz <= radius; gz++) {
    for (let gx = -radius; gx <= radius; gx++) {
      const k = keyOf(gx, gz);
      const isAnchor = gx === 0 && gz === 0;
      const distRing = Math.max(Math.abs(gx), Math.abs(gz));
      const isOuterLOD = distRing >= 2;
      const subdiv = isAnchor
        ? scene.terrain.subdivisions
        : distRing >= 3
        ? 8
        : distRing === 2
        ? 14
        : 26;
      chunks.push({
        gx,
        gz,
        isAnchor,
        isOuterLOD,
        biome: solvedBiomes.get(k) ?? 'clearing',
        centerX: gx * chunkW,
        centerZ: gz * chunkD,
        width: chunkW,
        depth: chunkD,
        subdivisions: subdiv,
        segments: segmentsByChunk.get(k) ?? [],
      });
    }
  }

  // 3. Buffers reais dos Swatches absorvidos (para replicar pinceladas e paleta originais!)
  const grassBuf = getSwatchPixels(kit?.swatches.grass);
  const roadBuf = getSwatchPixels(kit?.swatches.dirt_road);
  const waterBuf = getSwatchPixels(kit?.swatches.water);
  const foliageBuf = getSwatchPixels(kit?.swatches.foliage);

  const grassRgb = parseRgbString(kit?.swatches.grass?.averageColor, [122, 165, 74]);
  const roadRgb = parseRgbString(kit?.swatches.dirt_road?.averageColor, [168, 124, 78]);
  const waterRgb = parseRgbString(kit?.swatches.water?.averageColor, [38, 118, 146]);
  const foliageRgb = parseRgbString(kit?.swatches.foliage?.averageColor, [52, 112, 46]);

  const worldStructures: StructureDef[] = [];
  const worldProps: PropDef[] = [];

  const getChunkElevation = (
    wx: number,
    wz: number,
    segments: PathSegment2D[],
    biome: ChunkBiome = 'clearing'
  ): {
    heightNorm: number;
    surface: SwatchCategory;
    roadBlend: number;
    waterBlend: number;
  } => {
    const baseNoise = fbm2D(wx, wz, grammar.seed);
    let heightNorm = 0.48 + baseNoise * 0.28;
    const surface: SwatchCategory =
      biome === 'dense_forest' || baseNoise > 0.62 ? 'foliage' : 'grass';
    let roadBlend = 0;
    let waterBlend = 0;

    for (const seg of segments) {
      const d = distToSegment2D(wx, wz, seg.x0, seg.z0, seg.x1, seg.z1);
      const halfW = seg.width * 0.5;
      if (seg.kind === 'water') {
        if (d < halfW) {
          return { heightNorm: 0.08, surface: 'water', roadBlend: 0, waterBlend: 1 };
        }
        if (d < halfW + 1.8) {
          const t = (d - halfW) / 1.8;
          heightNorm = 0.1 + t * (heightNorm - 0.1);
          waterBlend = Math.max(waterBlend, 1 - t);
        }
      } else if (d < halfW + 0.9) {
        const b = d < halfW ? 1 : 1 - (d - halfW) / 0.9;
        roadBlend = Math.max(roadBlend, b);
        heightNorm = 0.46 + baseNoise * 0.06;
      }
    }
    return {
      heightNorm,
      surface: waterBlend > 0.55 ? 'water' : roadBlend > 0.5 ? 'dirt_road' : surface,
      roadBlend,
      waterBlend,
    };
  };

  let poiCount = 0;
  const chunkScale = Math.max(1.0, Math.min(2.4, Math.min(chunkW, chunkD) / 22));
  const defaultRoofMat =
    scene.structures.find((s) => s.roofType !== 'flat')?.roofMaterial ??
    'roof_slate';
  const minTreeDist = Math.max(1.2, (grammar.minTreeSpacing ?? 2.8) * chunkScale * 0.8);
  const treeBuckets = new Map<string, [number, number][]>();
  const treeBucketSize = Math.max(1.5, minTreeDist);
  const treeBucketKey = (x: number, z: number) =>
    `${Math.floor(x / treeBucketSize)},${Math.floor(z / treeBucketSize)}`;
  const isTreeTooClose = (x: number, z: number): boolean => {
    const bx = Math.floor(x / treeBucketSize);
    const bz = Math.floor(z / treeBucketSize);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nearby = treeBuckets.get(`${bx + dx},${bz + dz}`) ?? [];
        if (nearby.some(([tx, tz]) => Math.hypot(x - tx, z - tz) < minTreeDist)) {
          return true;
        }
      }
    }
    return false;
  };
  const registerTree = (x: number, z: number) => {
    const key = treeBucketKey(x, z);
    const bucket = treeBuckets.get(key) ?? [];
    bucket.push([x, z]);
    treeBuckets.set(key, bucket);
  };
  const overlapsStructure = (x: number, z: number): boolean =>
    worldStructures.some((structure) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const [sx, sz] of structure.footprint) {
        minX = Math.min(minX, sx);
        maxX = Math.max(maxX, sx);
        minZ = Math.min(minZ, sz);
        maxZ = Math.max(maxZ, sz);
      }
      return x > minX - 1.2 && x < maxX + 1.2 && z > minZ - 1.2 && z < maxZ + 1.2;
    });

  const featherDist = Math.max(4.5, Math.min(chunkW, chunkD) * 0.22);
  const halfAnchorW = chunkW * 0.5;
  const halfAnchorD = chunkD * 0.5;

  for (const chunk of chunks) {
    if (chunk.isAnchor) continue;
    const distRing = Math.max(Math.abs(chunk.gx), Math.abs(chunk.gz));
    const texRes = distRing >= 3 ? 60 : chunk.isOuterLOD ? 88 : 144;
    const rgba = new Uint8ClampedArray(texRes * texRes * 4);
    const heightField = new Float32Array(texRes * texRes);

    for (let py = 0; py < texRes; py++) {
      const wz = chunk.centerZ + ((py + 0.5) / texRes - 0.5) * chunk.depth;
      for (let px = 0; px < texRes; px++) {
        const wx = chunk.centerX + ((px + 0.5) / texRes - 0.5) * chunk.width;
        const { heightNorm, surface, roadBlend, waterBlend } = getChunkElevation(
          wx,
          wz,
          chunk.segments,
          chunk.biome
        );
        const cellIdx = py * texRes + px;

        const baseGrass = sampleTiledSwatchRGB(
          surface === 'foliage' ? foliageBuf ?? grassBuf : grassBuf,
          surface === 'foliage' ? foliageRgb : grassRgb,
          wx,
          wz,
          9.0
        );
        const roadSample = sampleTiledSwatchRGB(roadBuf, roadRgb, wx, wz, 7.0);
        const waterSample = sampleTiledSwatchRGB(waterBuf, waterRgb, wx, wz, 6.0);

        let r = baseGrass[0] * (1 - roadBlend) + roadSample[0] * roadBlend;
        let g = baseGrass[1] * (1 - roadBlend) + roadSample[1] * roadBlend;
        let b = baseGrass[2] * (1 - roadBlend) + roadSample[2] * roadBlend;

        if (waterBlend > 0) {
          r = r * (1 - waterBlend) + waterSample[0] * waterBlend;
          g = g * (1 - waterBlend) + waterSample[1] * waterBlend;
          b = b * (1 - waterBlend) + waterSample[2] * waterBlend;
        }

        // Suavização na borda do chunk âncora (0,0) usando edgeStrips reais da imagem original
        let finalHeight = heightNorm;
        if (kit?.edgeStrips && waterBlend < 0.25 && roadBlend < 0.35) {
          const dxOut = Math.max(0, Math.abs(wx) - halfAnchorW);
          const dzOut = Math.max(0, Math.abs(wz) - halfAnchorD);
          const distFromAnchor = Math.hypot(dxOut, dzOut);
          if (distFromAnchor < featherDist) {
            const t = distFromAnchor / featherDist;
            const wBlend = (1 - t * t * (3 - 2 * t)) * 0.78;
            let edgeColor: [number, number, number] | null = null;
            if (dxOut >= dzOut) {
              const tv = (wz + halfAnchorD) / chunkD;
              edgeColor = sampleEdgeStrip(
                wx < 0 ? kit.edgeStrips.west : kit.edgeStrips.east,
                tv
              );
            } else {
              const tu = (wx + halfAnchorW) / chunkW;
              edgeColor = sampleEdgeStrip(
                wz < 0 ? kit.edgeStrips.north : kit.edgeStrips.south,
                tu
              );
            }
            if (edgeColor) {
              r = r * (1 - wBlend) + edgeColor[0] * wBlend;
              g = g * (1 - wBlend) + edgeColor[1] * wBlend;
              b = b * (1 - wBlend) + edgeColor[2] * wBlend;
            }
            // Altura também converge suavemente para o nível base das margens do âncora
            finalHeight = finalHeight * (1 - wBlend * 0.65) + 0.54 * (wBlend * 0.65);
          }
        }

        heightField[cellIdx] = finalHeight;
        const o = cellIdx * 4;
        rgba[o] = Math.min(255, Math.max(0, Math.round(r)));
        rgba[o + 1] = Math.min(255, Math.max(0, Math.round(g)));
        rgba[o + 2] = Math.min(255, Math.max(0, Math.round(b)));
        rgba[o + 3] = 255;
      }
    }

    const hf = computeHeightField(rgba, texRes, texRes, {
      smoothRadius: 1,
      invertHeight: false,
      contrast: 1.0,
    });
    const normalRgba = heightFieldToNormalRGBA(
      heightField,
      hf.rawLuminance,
      texRes,
      texRes,
      1.8,
      0.6
    );

    chunk.heightField = heightField;
    chunk.heightWidth = texRes;
    chunk.heightHeight = texRes;
    chunk.albedoRgba = rgba;
    chunk.normalRgba = normalRgba;
    chunk.albedoDataUrl = rgbaToDataUrl(rgba, texRes, texRes);
    chunk.normalDataUrl = rgbaToDataUrl(normalRgba, texRes, texRes);

    // 4a. Pontes automáticas onde estrada e água se cruzam no mesmo chunk
    const waterSegs = chunk.segments.filter((s) => s.kind === 'water');
    const roadSegs = chunk.segments.filter((s) => s.kind === 'road');
    if (grammar.enableBridges && waterSegs.length > 0 && roadSegs.length > 0) {
      const ws = waterSegs[0];
      const bx = (ws.x0 + ws.x1) * 0.5;
      const bz = (ws.z0 + ws.z1) * 0.5;
      const bw = 1.6 * chunkScale;
      const bd = 2.4 * chunkScale;
      worldStructures.push({
        id: `w_bridge_${chunk.gx}_${chunk.gz}`,
        name: `Ponte (${chunk.gx},${chunk.gz})`,
        semanticTag: 'bridge',
        footprint: [
          [bx - bw, bz - bd],
          [bx + bw, bz - bd],
          [bx + bw, bz + bd],
          [bx - bw, bz + bd],
        ],
        baseElevation: scene.terrain.waterElevation + 0.08,
        floors: 1,
        floorHeight: 0.45,
        wallStyle: 'timber_frame',
        hasDoor: false,
        roofType: 'flat',
        roofPitchDeg: 15,
        roofOverhang: 0,
        hideRoof: false,
        textureMode: 'procedural',
        fallbackMaterial: 'wood_plank',
        roofMaterial: 'wood_plank',
        visible: true,
      });
      poiCount++;
    }

    // 4b. POIs arquitetônicos medievais orientados pelo bioma resolvido via WFC
    const effectivePoiChance =
      chunk.biome === 'ruins_outpost'
        ? Math.min(0.95, grammar.poiChance + 0.45)
        : chunk.biome === 'dense_forest'
        ? grammar.poiChance * 0.35
        : grammar.poiChance;

    if (
      grammar.enableArchitecturalPOIs !== false &&
      distRing <= 2 &&
      rng() < effectivePoiChance
    ) {
      const px = chunk.centerX + (rng() - 0.5) * chunk.width * 0.45;
      const pz = chunk.centerZ + (rng() - 0.5) * chunk.depth * 0.45;
        const { surface, heightNorm } = getChunkElevation(
          px,
          pz,
          chunk.segments,
          chunk.biome
        );
      if (surface !== 'water' && surface !== 'dirt_road') {
        const poiRoll = rng();
        const yBase = Number((heightNorm * scene.terrain.displacementScale).toFixed(2));
        if (poiRoll < 0.32) {
          const tr = 1.4 * chunkScale;
          const towerFootprint: [number, number][] = [];
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            towerFootprint.push([
              Number((px + Math.cos(a) * tr).toFixed(2)),
              Number((pz - Math.sin(a) * tr).toFixed(2)),
            ]);
          }
          worldStructures.push({
            id: `w_tower_${chunk.gx}_${chunk.gz}`,
            name: `Torre Vigia (${chunk.gx},${chunk.gz})`,
            semanticTag: 'tower',
            footprint: towerFootprint,
            baseElevation: yBase,
            floors: 2,
            floorHeight: 2.1,
            wallStyle: 'buttress',
            includeFloorSlabs: true,
            windowsPerWall: 1,
            hasDoor: true,
            roofType: 'cone',
            roofPitchDeg: 45,
            roofOverhang: 0.35,
            hideRoof: false,
            textureMode: 'procedural',
            fallbackMaterial: 'stone_brick',
            roofMaterial: defaultRoofMat,
            visible: true,
          });
        } else if (poiRoll < 0.75) {
          const hw = (2.0 + rng() * 0.9 * grammar.randomness) * chunkScale;
          const hd = (1.6 + rng() * 0.6 * grammar.randomness) * chunkScale;
          const twoFloors = rng() < 0.48;
          worldStructures.push({
            id: `w_house_${chunk.gx}_${chunk.gz}`,
            name: twoFloors
              ? `Estalagem (${chunk.gx},${chunk.gz})`
              : `Cabana (${chunk.gx},${chunk.gz})`,
            semanticTag: 'building',
            footprint: [
              [px - hw, pz - hd],
              [px + hw, pz - hd],
              [px + hw, pz + hd],
              [px - hw, pz + hd],
            ],
            baseElevation: yBase,
            floors: twoFloors ? 2 : 1,
            floorHeight: 2.35,
            wallStyle: 'timber_frame',
            upperFloorOverhang: twoFloors ? 0.24 : 0,
            includeFloorSlabs: true,
            windowsPerWall: 2,
            hasDoor: true,
            hasChimney: true,
            roofType: 'gable',
            roofPitchDeg: 36,
            roofOverhang: 0.38,
            hideRoof: false,
            textureMode: 'procedural',
            fallbackMaterial: 'timber_plaster',
            roofMaterial: defaultRoofMat,
            visible: true,
          });
        } else {
          const rw = 2.4 * chunkScale;
          const rd = 0.55 * chunkScale;
          worldStructures.push({
            id: `w_ruin_${chunk.gx}_${chunk.gz}`,
            name: `Ruína (${chunk.gx},${chunk.gz})`,
            semanticTag: 'wall',
            footprint: [
              [px - rw, pz - rd],
              [px + rw, pz - rd],
              [px + rw, pz + rd],
              [px - rw, pz + rd],
            ],
            baseElevation: yBase,
            floors: 1,
            floorHeight: 1.5,
            wallStyle: 'buttress',
            hasDoor: false,
            roofType: 'parapet',
            roofPitchDeg: 25,
            roofOverhang: 0,
            hideRoof: false,
            textureMode: 'procedural',
            fallbackMaterial: 'stone_brick',
            roofMaterial: 'stone_brick',
            visible: true,
          });
        }
        poiCount++;
      }
    }

    // 4c. Scatter estilo Geometry Nodes com espaçamento mínimo Poisson-Disk entre árvores
    if (grammar.enableForestScatter === false) continue;
    const densityMult =
      (chunk.biome === 'dense_forest' ? 1.45 : chunk.biome === 'clearing' ? 0.65 : 1.0) *
      grammar.treeDensity;
    const baseSpacing =
      distRing >= 3
        ? 9.2
        : chunk.isOuterLOD
        ? 6.4
        : 4.1 / Math.max(0.4, Math.sqrt(densityMult));
    const spacing = Math.max(baseSpacing, baseSpacing * chunkScale * 0.9);
    const cols = Math.max(2, Math.floor(chunk.width / spacing));
    const rows = Math.max(2, Math.floor(chunk.depth / spacing));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (rng() > 0.58 * Math.min(1.5, densityMult)) continue;

        const jx = (rng() - 0.5) * spacing * (0.45 + 0.5 * grammar.randomness);
        const jz = (rng() - 0.5) * spacing * (0.45 + 0.5 * grammar.randomness);
        const wx = chunk.centerX + ((c + 0.5) / cols - 0.5) * chunk.width + jx;
        const wz = chunk.centerZ + ((r + 0.5) / rows - 0.5) * chunk.depth + jz;

        const { heightNorm, surface } = getChunkElevation(
          wx,
          wz,
          chunk.segments,
          chunk.biome
        );
         if (surface === 'dirt_road' || overlapsStructure(wx, wz)) continue;

        const yWorld = Number((heightNorm * scene.terrain.displacementScale).toFixed(2));
        let generator: PropDef['generator'];
        let fallbackMat: PropDef['fallbackMaterial'] = 'moss_earth';
        let scale = 1.0;

        if (surface === 'water') {
          if (rng() > 0.18) continue;
          generator = 'rock';
          fallbackMat = 'stone_brick';
          scale = 0.55 + rng() * 0.45 * grammar.randomness;
        } else {
          const pRoll = rng();
          if (pRoll < (chunk.biome === 'dense_forest' ? 0.68 : 0.55)) {
            // Checa espaçamento mínimo entre árvores (Poisson-Disk)
            let tooClose = false;
             tooClose = isTreeTooClose(wx, wz);
            if (tooClose) {
              generator = 'bush';
              scale = 0.75 + rng() * 0.5;
            } else {
              generator =
                chunk.biome === 'dense_forest' && rng() < 0.42
                  ? 'pine_tree'
                  : 'deciduous_tree';
              scale = (1.15 + rng() * 1.1 * (0.5 + grammar.randomness)) * Math.min(1.8, chunkScale * 0.85);
               registerTree(wx, wz);
            }
           } else if (pRoll < 0.85) {
            generator = 'bush';
            scale = (0.75 + rng() * 0.65) * Math.min(1.6, chunkScale * 0.8);
          } else {
            generator = 'rock';
            fallbackMat = 'stone_brick';
            scale = (0.6 + rng() * 0.7) * Math.min(1.6, chunkScale * 0.8);
          }
        }

        worldProps.push({
          id: `wp_${chunk.gx}_${chunk.gz}_${r}_${c}`,
          name: `${generator}_${chunk.gx}_${chunk.gz}`,
          generator,
          position: [Number(wx.toFixed(2)), yWorld, Number(wz.toFixed(2))],
          rotationYDeg: Math.round(rng() * 360),
          scale: Number(scale.toFixed(2)),
           textureMode: 'procedural',
           fallbackMaterial:
             generator === 'deciduous_tree' ||
             generator === 'pine_tree' ||
             generator === 'bush'
               ? 'foliage_canopy'
               : fallbackMat,
          visible: true,
        });
      }
    }
  }

  return {
    gridRadius: radius,
    chunks,
    worldStructures,
    worldProps,
    summary: {
      chunkCount: chunks.length,
      roadSegments,
      riverSegments,
      poiCount,
      instancedPropCount: worldProps.length,
    },
  };
}
