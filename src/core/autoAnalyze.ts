import {
  PROJECTION_PRESETS,
  createDefaultWorldGrammar,
  createDefaultReconstructionConfig,
  type IsoDSLScene,
  type ProjectionPreset,
  type PropDef,
  type StructureDef,
  type TerrainFeatureDef,
} from '../types/isodsl';
import { isWaterPixel } from './imageMaps';

type SemanticCell = 'water' | 'road' | 'foliage' | 'stone' | 'ember' | 'ground';

function classifyCell(r: number, g: number, b: number): SemanticCell {
  if (isWaterPixel(r, g, b)) return 'water';

  // Fogo / braseiro / velas em ambiente interno
  if (r > 215 && g > 115 && b < 105 && r > g * 1.15) {
    return 'ember';
  }

  // Copas de árvores e arbustos: verde saturado/escuro dominante sobre vermelho e azul
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Estradas de terra: devem ser separadas antes da leitura de folhagem para
  // que o reconstrutor crie uma faixa caminhável, e não um ruído de relevo.
  if (r > g * 1.07 && g > b * 1.04 && lum > 0.28 && lum < 0.78) {
    return 'road';
  }

  if (g > b * 1.35 && g >= r * 0.98 && (lum < 0.48 || (g > r * 1.18 && sat > 0.38))) {
    return 'foliage';
  }

  // Pedra / telhado cinza ou estrutura arquitetônica neutra com contraste
  if (sat < 0.14 && lum > 0.42 && lum < 0.78) {
    return 'stone';
  }

  return 'ground';
}

interface CellCluster {
  cells: [number, number][];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  cx: number;
  cy: number;
}

function extractClusters(
  grid: SemanticCell[],
  gw: number,
  gh: number,
  target: SemanticCell
): CellCluster[] {
  const visited = new Uint8Array(gw * gh);
  const clusters: CellCluster[] = [];

  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const start = y * gw + x;
      if (visited[start] || grid[start] !== target) continue;

      const queue: [number, number][] = [[x, y]];
      visited[start] = 1;
      const cells: [number, number][] = [];
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let sumX = 0;
      let sumY = 0;

      while (queue.length > 0) {
        const [cx, cy] = queue.pop()!;
        cells.push([cx, cy]);
        sumX += cx;
        sumY += cy;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        const neighbors: [number, number][] = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
          const nIdx = ny * gw + nx;
          if (!visited[nIdx] && grid[nIdx] === target) {
            visited[nIdx] = 1;
            queue.push([nx, ny]);
          }
        }
      }

      clusters.push({
        cells,
        minX,
        maxX,
        minY,
        maxY,
        cx: sumX / cells.length,
        cy: sumY / cells.length,
      });
    }
  }

  return clusters;
}

/**
 * Analisa automaticamente qualquer imagem 2D (top-down ou isométrica) e traduz
 * em instruções IsoDSL v1.0: proporção real do terreno, água 3D, árvores/arbustos e estruturas.
 */
export function analyzeImageToIsoDSL(
  rgba: Uint8ClampedArray,
  imgWidth: number,
  imgHeight: number,
  options?: {
    name?: string;
    preset?: ProjectionPreset;
    orthoScale?: number;
  }
): IsoDSLScene {
  const aspect = imgWidth / Math.max(1, imgHeight);
  const presetKey = options?.preset ?? 'top_down';
  const preset = PROJECTION_PRESETS[presetKey];

  // Grade semântica 44xN proporcional à imagem
  const gw = Math.max(24, Math.min(48, Math.round(40 * Math.min(1.4, aspect))));
  const gh = Math.max(24, Math.min(64, Math.round(gw / aspect)));
  const grid: SemanticCell[] = new Array(gw * gh);

  let waterCount = 0;
  let foliageCount = 0;
  let roadCount = 0;
  let warmWoodCount = 0;
  let darkBorderCount = 0;
  let borderSamples = 0;

  for (let gy = 0; gy < gh; gy++) {
    const py = Math.min(imgHeight - 1, Math.floor(((gy + 0.5) / gh) * imgHeight));
    for (let gx = 0; gx < gw; gx++) {
      const px = Math.min(imgWidth - 1, Math.floor(((gx + 0.5) / gw) * imgWidth));
      const idx = (py * imgWidth + px) * 4;
      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];
      const cell = classifyCell(r, g, b);
      grid[gy * gw + gx] = cell;
      if (cell === 'water') waterCount++;
      if (cell === 'foliage') foliageCount++;
      if (cell === 'road') roadCount++;
      if (r > g * 1.12 && g > b * 1.15 && r > 90) warmWoodCount++;
      if (gx === 0 || gx === gw - 1 || gy === 0 || gy === gh - 1) {
        borderSamples++;
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        if (lum < 0.28) darkBorderCount++;
      }
    }
  }

  const totalCells = gw * gh;
  const waterRatio = waterCount / totalCells;
  const foliageRatio = foliageCount / totalCells;
  const roadRatio = roadCount / totalCells;
  const warmWoodRatio = warmWoodCount / totalCells;
  const darkBorderRatio = darkBorderCount / Math.max(1, borderSamples);
  const hasWater = waterRatio > 0.025;
  const isInterior =
    !hasWater &&
    foliageRatio < 0.025 &&
    (darkBorderRatio > 0.25 || warmWoodRatio > 0.42);

  // Escala em metros adaptada para sala/taverna interna (~16-18m) vs terreno aberto (22-32m)
  const orthoScale =
    options?.orthoScale ??
    (isInterior ? (aspect < 1 ? 18 : 16) : aspect < 1 ? 32 : 22);
  const worldDepth = orthoScale;
  const worldWidth = Number((orthoScale * aspect).toFixed(3));

  const toWorldX = (gx: number) =>
    Number((((gx + 0.5) / gw - 0.5) * worldWidth).toFixed(2));
  const toWorldZ = (gy: number) =>
    Number((((gy + 0.5) / gh - 0.5) * worldDepth).toFixed(2));

  const terrainFeatures: TerrainFeatureDef[] = [];
  const clusterToFeature = (
    cluster: CellCluster,
    kind: 'water' | 'road',
    index: number
  ): TerrainFeatureDef => {
    const spanX = cluster.maxX - cluster.minX + 1;
    const spanY = cluster.maxY - cluster.minY + 1;
    const cellW = worldWidth / gw;
    const cellD = worldDepth / gh;
    const cx = toWorldX(cluster.cx);
    const cz = toWorldZ(cluster.cy);
    const length = Math.max(spanX * cellW, spanY * cellD);
    const thickness = Math.max(0.55, Math.min(spanX * cellW, spanY * cellD) * 0.9);
    const elongated = length > thickness * 1.65;

    if (elongated) {
      const horizontal = spanX * cellW >= spanY * cellD;
      const halfLength = (horizontal ? spanX * cellW : spanY * cellD) * 0.52;
      return {
        id: `auto_${kind}_${index + 1}`,
        kind,
        points: horizontal
          ? [[cx - halfLength, cz], [cx + halfLength, cz]]
          : [[cx, cz - halfLength], [cx, cz + halfLength]],
        width: Number(Math.max(kind === 'water' ? 1.1 : 0.9, thickness).toFixed(2)),
        elevation: kind === 'water' ? 0.21 : 0.52,
        material: kind === 'water' ? 'water_surface' : 'road_dirt',
        visible: true,
      };
    }

    const x0 = Number(((cluster.minX / gw - 0.5) * worldWidth).toFixed(2));
    const x1 = Number((((cluster.maxX + 1) / gw - 0.5) * worldWidth).toFixed(2));
    const z0 = Number(((cluster.minY / gh - 0.5) * worldDepth).toFixed(2));
    const z1 = Number((((cluster.maxY + 1) / gh - 0.5) * worldDepth).toFixed(2));
    return {
      id: `auto_${kind}_${index + 1}`,
      kind,
      points: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]],
      elevation: kind === 'water' ? 0.21 : 0.52,
      material: kind === 'water' ? 'water_surface' : 'road_dirt',
      visible: true,
    };
  };

  if (createDefaultReconstructionConfig().detectTerrainFeatures) {
    extractClusters(grid, gw, gh, 'water')
      .filter((c) => c.cells.length >= 2)
      .slice(0, 12)
      .forEach((c, i) => terrainFeatures.push(clusterToFeature(c, 'water', i)));
    extractClusters(grid, gw, gh, 'road')
      .filter((c) => c.cells.length >= 2)
      .slice(0, 18)
      .forEach((c, i) => terrainFeatures.push(clusterToFeature(c, 'road', i)));
  }

  // 1. Clusters de vegetação -> múltiplos modelos, em vez de um único proxy
  // por mancha. A densidade é derivada da área e a espécie varia de forma
  // determinística para evitar florestas visualmente repetitivas.
  const foliageClusters = extractClusters(grid, gw, gh, 'foliage')
    .filter((c) => c.cells.length >= 2)
    .sort((a, b) => b.cells.length - a.cells.length)
    .slice(0, 36);

  const props: PropDef[] = [];
  foliageClusters.forEach((cluster, idx) => {
    const isTree = cluster.cells.length >= 9;
    const spanW = ((cluster.maxX - cluster.minX + 1) / gw) * worldWidth;
    const spanD = ((cluster.maxY - cluster.minY + 1) / gh) * worldDepth;
    const approxRadius = Math.max(0.7, Math.min(2.6, Math.sqrt(spanW * spanD) * 0.45));

    const instanceCount = isTree
      ? Math.min(14, Math.max(1, Math.round(cluster.cells.length / 10)))
      : Math.min(10, Math.max(1, Math.round(cluster.cells.length / 6)));
    for (let instance = 0; instance < instanceCount; instance++) {
      const cell = cluster.cells[Math.floor(((instance + 0.5) / instanceCount) * cluster.cells.length) % cluster.cells.length];
      const species = isTree && (instance + idx) % 4 === 0 ? 'pine_tree' : isTree ? 'deciduous_tree' : 'bush';
      props.push({
        id: `auto_foliage_${idx + 1}_${instance + 1}`,
        name: species === 'bush' ? `Arbusto ${idx + 1}.${instance + 1}` : `Árvore ${idx + 1}.${instance + 1}`,
        generator: species,
        position: [toWorldX(cell[0]), 0.35, toWorldZ(cell[1])],
        rotationYDeg: (idx * 47 + instance * 83) % 360,
        scale: Number((isTree ? approxRadius * (0.82 + ((instance + idx) % 5) * 0.08) : Math.min(1.3, approxRadius * 0.85)).toFixed(2)),
        textureMode: 'procedural',
        fallbackMaterial: 'foliage_canopy',
        visible: true,
      });
    }
  });

  // 1b. Em ambiente interno, detecta focos de chama/lareira
  if (isInterior) {
    const emberClusters = extractClusters(grid, gw, gh, 'ember')
      .filter((c) => c.cells.length >= 2)
      .sort((a, b) => b.cells.length - a.cells.length)
      .slice(0, 6);
    emberClusters.forEach((cluster, idx) => {
      const isHearth = idx === 0 && cluster.cy < gh * 0.35 && cluster.cells.length >= 5;
      props.push({
        id: `auto_ember_${idx + 1}`,
        name: isHearth ? 'Lareira Detectada' : `Braseiro ${idx + 1}`,
        generator: isHearth ? 'fireplace' : 'brazier',
        position: [toWorldX(cluster.cx), 0.08, toWorldZ(cluster.cy)],
        rotationYDeg: 0,
        scale: isHearth ? 1.35 : 0.85,
        textureMode: 'procedural',
        fallbackMaterial: 'stone_brick',
        visible: true,
      });
    });
  }

  // 2. Clusters de pedra -> estruturas baixas (muros/ruínas) apenas se relevantes
  const stoneClusters = extractClusters(grid, gw, gh, 'stone')
    .filter((c) => c.cells.length >= 10 && c.cells.length < gw * gh * 0.35)
    .slice(0, 8);

  const structures: StructureDef[] = stoneClusters.map((c, idx) => {
    const x0 = Number((((c.minX / gw) - 0.5) * worldWidth).toFixed(2));
    const x1 = Number(((((c.maxX + 1) / gw) - 0.5) * worldWidth).toFixed(2));
    const z0 = Number((((c.minY / gh) - 0.5) * worldDepth).toFixed(2));
    const z1 = Number(((((c.maxY + 1) / gh) - 0.5) * worldDepth).toFixed(2));

    return {
      id: `auto_stone_${idx + 1}`,
      name: `Estrutura Pedra ${idx + 1}`,
      semanticTag: 'wall',
      footprint: [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
      ],
      baseElevation: 0.35,
      floors: 1,
      floorHeight: 1.8,
      roofType: 'parapet',
      roofPitchDeg: 30,
      roofOverhang: 0,
      hideRoof: false,
      textureMode: 'procedural',
      fallbackMaterial: 'stone_brick',
      roofMaterial: 'stone_brick',
      visible: true,
    };
  });

  return {
    schemaVersion: '1.0',
    meta: {
      name: options?.name ?? 'Mapa Auto-Traduzido',
      sourceLabel: 'auto-analyzed-image',
      aspectRatio: aspect,
      createdAt: new Date().toISOString(),
    },
    projection: {
      ...preset,
      orthoScale,
      offsetX: 0,
      offsetY: 0,
    },
      terrain: {
      width: worldWidth,
      depth: worldDepth,
      subdivisions: 112,
      displacementScale: isInterior ? 0.16 : hasWater ? 1.4 : 1.1,
      normalStrength: isInterior ? 1.6 : 2.2,
      detailBlend: isInterior ? 0.45 : 0.55,
      smoothRadius: 2,
      invertHeight: false,
      heightMode: isInterior
        ? 'luminance'
        : hasWater || foliageClusters.length > 0
        ? 'semantic_outdoor'
        : 'luminance',
      textureMode: 'hybrid',
      fallbackMaterial: isInterior
        ? warmWoodRatio > 0.3
          ? 'wood_plank'
          : 'cobblestone'
        : 'moss_earth',
      waterEnabled: hasWater && !isInterior,
      waterElevation: 0.21,
    },
    reconstruction: {
      ...createDefaultReconstructionConfig(),
      semanticFidelity: Number(Math.min(1, 0.62 + foliageRatio * 0.5 + roadRatio * 0.35).toFixed(2)),
    },
    terrainFeatures,
    structures,
    props,
    lighting: {
      sunAzimuthDeg: 48,
      sunElevationDeg: isInterior ? 65 : 58,
      sunIntensity: isInterior ? 1.3 : 1.9,
      ambientIntensity: isInterior ? 0.62 : 0.72,
      torchEnabled: true,
      torchIntensity: isInterior ? 4.2 : 2.0,
      torchColor: '#ff9e4a',
    },
    worldGrammar: {
      ...createDefaultWorldGrammar(),
      environmentMode: isInterior ? 'interior' : 'outdoor',
      enableForestScatter: !isInterior,
      enableRoadContinuation: !isInterior,
      enableWaterContinuation: !isInterior,
      enableBridges: !isInterior,
    },
  };
}
