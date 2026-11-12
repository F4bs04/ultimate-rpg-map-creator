import type { IsoDSLScene, PropDef, StructureDef } from '../types/isodsl';
import {
  computeStructureDoorInfo,
  ensureCCWFootprintXZ,
  type StructureDoorInfo,
} from './compiler';
import { sampleHeightAtUV, type HeightFieldResult } from './imageMaps';
import type { GeneratedChunkData } from './worldBuilder';

/**
 * Ray-casting 2D no plano XZ para detectar se o explorador entrou em uma estrutura.
 */
export function isPointInPolygonXZ(
  x: number,
  z: number,
  polygon: [number, number][]
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    const intersects =
      zi > z !== zj > z &&
      x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-9) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distSqPointToSegmentXZ(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): number {
  const vx = bx - ax;
  const vz = bz - az;
  const wx = px - ax;
  const wz = pz - az;
  const lenSq = vx * vx + vz * vz;
  const t = lenSq > 1e-8 ? Math.max(0, Math.min(1, (wx * vx + wz * vz) / lenSq)) : 0;
  const cx = ax + t * vx;
  const cz = az + t * vz;
  return (px - cx) * (px - cx) + (pz - cz) * (pz - cz);
}

function isNearOrInsidePolygonXZ(
  x: number,
  z: number,
  polygon: [number, number][],
  margin: number
): boolean {
  if (isPointInPolygonXZ(x, z, polygon)) return true;
  if (margin <= 0 || polygon.length < 2) return false;
  const mSq = margin * margin;
  for (let i = 0; i < polygon.length; i++) {
    const [ax, az] = polygon[i];
    const [bx, bz] = polygon[(i + 1) % polygon.length];
    if (distSqPointToSegmentXZ(x, z, ax, az, bx, bz) <= mSq) {
      return true;
    }
  }
  return false;
}

function getBounds(pts: [number, number][]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

function boxesOverlapOrTouch(
  a: ReturnType<typeof getBounds>,
  b: ReturnType<typeof getBounds>,
  gap = 0.55
): boolean {
  return (
    a.minX - gap <= b.maxX &&
    a.maxX + gap >= b.minX &&
    a.minZ - gap <= b.maxZ &&
    a.maxZ + gap >= b.minZ
  );
}

/**
 * Encontra a estrutura com interior jogável ('building' | 'tower') onde o explorador se encontra
 * e expande para alas conectadas (ex.: estalagem + torre redonda anexa) para clip conjunto estilo BG3/Sims.
 */
export function findEnteredInteriorCluster(
  x: number,
  z: number,
  structures: StructureDef[],
  entryMargin = 0.15
): {
  primary: StructureDef | null;
  clusterIds: Set<string>;
} {
  const enclosed = structures.filter(
    (s) =>
      s.visible &&
      (s.semanticTag === 'building' || s.semanticTag === 'tower') &&
      s.footprint.length >= 3
  );

  const direct = enclosed.find((s) =>
    isNearOrInsidePolygonXZ(x, z, s.footprint, entryMargin)
  );
  if (!direct) {
    return { primary: null, clusterIds: new Set() };
  }

  const clusterIds = new Set<string>([direct.id]);
  const queue: StructureDef[] = [direct];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const cb = getBounds(cur.footprint);
    for (const candidate of enclosed) {
      if (clusterIds.has(candidate.id)) continue;
      if (boxesOverlapOrTouch(cb, getBounds(candidate.footprint), 0.55)) {
        clusterIds.add(candidate.id);
        queue.push(candidate);
      }
    }
  }

  return { primary: direct, clusterIds };
}

/**
 * Calcula a elevação exata dos pés do explorador:
 * - Dentro de construção: acompanha o piso do andar atual (Térreo / 2º Andar...)
 * - Sobre ponte/plataforma: caminha sobre o tabuleiro sem cair na água
 * - Terreno aberto: amostra bilinear do heightfield × displacementScale
 */
export function sampleWalkableElevation(
  x: number,
  z: number,
  scene: IsoDSLScene,
  heightField: HeightFieldResult | null,
  activeFloor: number,
  primaryStructure: StructureDef | null,
  allStructures: StructureDef[] = scene.structures,
  expandedChunks: GeneratedChunkData[] = []
): number {
  if (primaryStructure) {
    const floorIdx = Math.max(
      0,
      Math.min(Math.max(1, Math.round(primaryStructure.floors)) - 1, activeFloor - 1)
    );
    return primaryStructure.baseElevation + floorIdx * primaryStructure.floorHeight + 0.05;
  }

  for (const st of allStructures) {
    if (!st.visible) continue;
    if (st.semanticTag === 'bridge' || st.semanticTag === 'platform') {
      if (isPointInPolygonXZ(x, z, st.footprint)) {
        return st.baseElevation + st.floorHeight;
      }
    }
  }

  if (heightField && scene.terrain.width > 0 && scene.terrain.depth > 0) {
    const u = x / scene.terrain.width + 0.5;
    const v = 1 - (z / scene.terrain.depth + 0.5);
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
      const h = sampleHeightAtUV(
        heightField.macroHeight,
        heightField.width,
        heightField.height,
        u,
        v
      );
      return h * scene.terrain.displacementScale;
    }
  }

  for (const chunk of expandedChunks) {
    if (chunk.isAnchor || !chunk.heightField || !chunk.heightWidth || !chunk.heightHeight) {
      continue;
    }
    const u = (x - chunk.centerX) / chunk.width + 0.5;
    const v = 1 - ((z - chunk.centerZ) / chunk.depth + 0.5);
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
      const h = sampleHeightAtUV(
        chunk.heightField,
        chunk.heightWidth,
        chunk.heightHeight,
        u,
        v
      );
      return h * scene.terrain.displacementScale;
    }
  }

  return scene.terrain.waterEnabled ? Math.max(0.35, scene.terrain.waterElevation + 0.12) : 0.3;
}

export interface PropObstacleCircle {
  x: number;
  z: number;
  radius: number;
}

/**
 * Extrai obstáculos sólidos de móveis/props internos e externos (círculos para mesas, barris e
 * troncos; caixas orientadas em segmentos para balcões, lareiras e estantes) para colisão realista.
 */
export function extractPropCollisionObstacles(props: PropDef[]): {
  segments: WallSegment2D[];
  circles: PropObstacleCircle[];
} {
  const segments: WallSegment2D[] = [];
  const circles: PropObstacleCircle[] = [];

  const pushOrientedBox = (
    cx: number,
    cz: number,
    halfW: number,
    halfD: number,
    rotDeg: number
  ) => {
    const rad = (rotDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const corners: [number, number][] = [
      [-halfW, -halfD],
      [halfW, -halfD],
      [halfW, halfD],
      [-halfW, halfD],
    ].map(([lx, lz]) => [cx + lx * cos + lz * sin, cz - lx * sin + lz * cos]);
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 4];
      segments.push({ ax, az, bx, bz });
    }
  };

  for (const prop of props) {
    if (!prop.visible) continue;
    const [px, , pz] = prop.position;
    const s = Math.max(0.25, prop.scale);

    switch (prop.generator) {
      case 'bar_counter':
        pushOrientedBox(px, pz, 0.96 * s, 0.3 * s, prop.rotationYDeg);
        break;
      case 'fireplace':
        pushOrientedBox(px, pz, 0.92 * s, 0.44 * s, prop.rotationYDeg);
        break;
      case 'bookshelf':
        pushOrientedBox(px, pz, 0.72 * s, 0.25 * s, prop.rotationYDeg);
        break;
      case 'tavern_table':
        circles.push({ x: px, z: pz, radius: 0.92 * s });
        break;
      case 'well':
        circles.push({ x: px, z: pz, radius: 0.76 * s });
        break;
      case 'brazier':
        circles.push({ x: px, z: pz, radius: 0.48 * s });
        break;
      case 'barrel':
        circles.push({ x: px, z: pz, radius: 0.36 * s });
        break;
      case 'crate':
        circles.push({ x: px, z: pz, radius: 0.44 * s });
        break;
      case 'pillar':
        circles.push({ x: px, z: pz, radius: 0.44 * s });
        break;
      case 'rock':
        circles.push({ x: px, z: pz, radius: 0.56 * s });
        break;
      case 'deciduous_tree':
      case 'pine_tree':
        circles.push({ x: px, z: pz, radius: 0.28 * s });
        break;
      default:
        break;
    }
  }

  return { segments, circles };
}

/**
 * Encontra um ponto inicial aberto no terreno (evitando nascer dentro de edifícios, água funda ou móveis).
 */
export function findDefaultSpawnXZ(
  scene: IsoDSLScene,
  allStructures: StructureDef[],
  allProps: PropDef[] = scene.props
): [number, number] {
  const { circles } = extractPropCollisionObstacles(allProps);
  const candidates: [number, number][] =
    scene.worldGrammar.environmentMode === 'interior'
      ? [
          [0, 0],
          [scene.terrain.width * 0.04, -scene.terrain.depth * 0.04],
          [scene.terrain.width * 0.04, scene.terrain.depth * 0.16],
          [-scene.terrain.width * 0.04, scene.terrain.depth * 0.25],
          [0, scene.terrain.depth * 0.32],
        ]
      : [
          [0, 0],
          [scene.terrain.width * 0.14, scene.terrain.depth * 0.1],
          [0, scene.terrain.depth * 0.18],
          [-scene.terrain.width * 0.14, 0],
          [scene.terrain.width * 0.18, -scene.terrain.depth * 0.12],
        ];
  for (const [cx, cz] of candidates) {
    const insideStruct = allStructures.some(
      (s) =>
        s.visible &&
        (s.semanticTag === 'building' || s.semanticTag === 'tower' || s.semanticTag === 'wall') &&
        isNearOrInsidePolygonXZ(cx, cz, s.footprint, 0.65)
    );
    const hitsProp = circles.some(
      (c) => Math.hypot(cx - c.x, cz - c.z) < c.radius + 0.32
    );
    if (!insideStruct && !hitsProp) return [cx, cz];
  }
  return [0, scene.terrain.depth * 0.22];
}

export interface WallSegment2D {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

export interface NearbyDoorMatch {
  structure: StructureDef;
  doorInfo: StructureDoorInfo;
  isOpen: boolean;
  distance: number;
}

/**
 * Extrai segmentos de colisão de paredes externas das estruturas,
 * mantendo vãos de passagem abertos quando a porta está aberta e ligando alas conectadas.
 */
export function extractCollisionSegments(
  structures: StructureDef[],
  openDoorIds: Set<string>
): WallSegment2D[] {
  const segments: WallSegment2D[] = [];
  const collidable = structures.filter(
    (s) =>
      s.visible &&
      (s.semanticTag === 'building' ||
        s.semanticTag === 'tower' ||
        s.semanticTag === 'wall') &&
      s.footprint.length >= 3
  );
  const enclosed = collidable.filter(
    (s) => s.semanticTag === 'building' || s.semanticTag === 'tower'
  );
  const ccwById = new Map<string, [number, number][]>();
  for (const s of collidable) {
    ccwById.set(s.id, ensureCCWFootprintXZ(s.footprint));
  }

  for (const st of collidable) {
    const pts = ccwById.get(st.id)!;
    const doorInfo = computeStructureDoorInfo(st);
    const doorOpen = Boolean(doorInfo && openDoorIds.has(st.id));

    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[(i + 1) % pts.length];
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.08) continue;

      if (st.semanticTag === 'building' || st.semanticTag === 'tower') {
        const mx = (ax + bx) * 0.5;
        const mz = (az + bz) * 0.5;
        const nx = -dz / len;
        const nz = dx / len;
        const connectedSeam = enclosed.some((other) => {
          if (other.id === st.id) return false;
          const oPts = ccwById.get(other.id)!;
          return (
            isNearOrInsidePolygonXZ(mx + nx * 0.22, mz + nz * 0.22, oPts, 0.08) ||
            isPointInPolygonXZ(mx, mz, oPts)
          );
        });
        if (connectedSeam) continue;
      }

      if (doorInfo && i === doorInfo.edgeIndex && doorOpen) {
        const hx = doorInfo.hingePos[0];
        const hz = doorInfo.hingePos[2];
        const lx = doorInfo.latchPos[0];
        const lz = doorInfo.latchPos[2];
        if (Math.hypot(hx - ax, hz - az) > 0.05) {
          segments.push({ ax, az, bx: hx, bz: hz });
        }
        if (Math.hypot(bx - lx, bz - lz) > 0.05) {
          segments.push({ ax: lx, az: lz, bx, bz });
        }
      } else {
        segments.push({ ax, az, bx, bz });
      }
    }
  }
  return segments;
}

/**
 * Resolve deslocamento 2D do explorador impedindo que atravesse paredes sólidas
 * e deslizando suavemente em torno de quinas e batentes de portas abertas.
 */
export function resolveMovementWithCollisions(
  curX: number,
  curZ: number,
  targetX: number,
  targetZ: number,
  radius: number,
  segments: WallSegment2D[],
  propCircles: PropObstacleCircle[] = []
): [number, number] {
  const totalDx = targetX - curX;
  const totalDz = targetZ - curZ;
  const dist = Math.hypot(totalDx, totalDz);
  if (dist < 1e-6) return [curX, curZ];

  const maxStep = Math.max(0.08, radius * 0.5);
  const substeps = Math.max(1, Math.ceil(dist / maxStep));
  let px = curX;
  let pz = curZ;
  const rSq = radius * radius;

  for (let step = 0; step < substeps; step++) {
    px += totalDx / substeps;
    pz += totalDz / substeps;

    for (let iter = 0; iter < 3; iter++) {
      for (const seg of segments) {
        const vx = seg.bx - seg.ax;
        const vz = seg.bz - seg.az;
        const lenSq = vx * vx + vz * vz;
        const t =
          lenSq > 1e-8
            ? Math.max(0, Math.min(1, ((px - seg.ax) * vx + (pz - seg.az) * vz) / lenSq))
            : 0;
        const cx = seg.ax + t * vx;
        const cz = seg.az + t * vz;
        const ox = px - cx;
        const oz = pz - cz;
        const dSq = ox * ox + oz * oz;

        if (dSq < rSq) {
          const d = Math.sqrt(dSq);
          if (d > 1e-5) {
            const push = radius - d;
            px += (ox / d) * push;
            pz += (oz / d) * push;
          } else {
            const len = Math.sqrt(lenSq) || 1;
            px += (-vz / len) * radius;
            pz += (vx / len) * radius;
          }
        }
      }

      for (const c of propCircles) {
        const ox = px - c.x;
        const oz = pz - c.z;
        const minD = radius + c.radius;
        const dSq = ox * ox + oz * oz;
        if (dSq < minD * minD) {
          const d = Math.sqrt(dSq);
          if (d > 1e-5) {
            const push = minD - d;
            px += (ox / d) * push;
            pz += (oz / d) * push;
          } else {
            px += minD;
          }
        }
      }
    }
  }

  return [px, pz];
}

/**
 * Encontra a porta mais próxima do explorador dentro do raio de interação.
 */
export function findNearestInteractiveDoor(
  x: number,
  z: number,
  structures: StructureDef[],
  openDoorIds: Set<string>,
  maxDistance = 2.85
): NearbyDoorMatch | null {
  let best: NearbyDoorMatch | null = null;
  for (const st of structures) {
    if (!st.visible) continue;
    const doorInfo = computeStructureDoorInfo(st);
    if (!doorInfo) continue;
    const d = Math.hypot(x - doorInfo.centerXZ[0], z - doorInfo.centerXZ[1]);
    if (d <= maxDistance && (!best || d < best.distance)) {
      best = {
        structure: st,
        doorInfo,
        isOpen: openDoorIds.has(st.id),
        distance: d,
      };
    }
  }
  return best;
}
