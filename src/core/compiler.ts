import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {
  MaterialPreset,
  PropDef,
  StructureDef,
  TerrainFeatureDef,
  TerrainConfig,
} from '../types/isodsl';

/**
 * Calcula área assinada no plano XZ para garantir orientação consistente dos footprints.
 */
export function signedAreaXZ(points: [number, number][]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i];
    const [x2, z2] = points[(i + 1) % points.length];
    area += x1 * z2 - x2 * z1;
  }
  return area * 0.5;
}

/**
 * Normaliza o footprint no sentido anti-horário no plano XZ (visto de cima, +Y para cima)
 * de modo que normais laterais apontem para fora.
 */
export function ensureCCWFootprintXZ(
  points: [number, number][]
): [number, number][] {
  if (points.length < 3) return points;
  // No sistema (X direita, Z para frente), área positiva no algoritmo shoelace (x1*z2 - x2*z1)
  // indica sentido horário visto de cima; inverter garante normal lateral para fora.
  return signedAreaXZ(points) > 0 ? [...points].reverse() : [...points];
}

export function getFootprintBounds(points: [number, number][]): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  cx: number;
  cz: number;
  width: number;
  depth: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    cx: (minX + maxX) * 0.5,
    cz: (minZ + maxZ) * 0.5,
    width: Math.max(0.2, maxX - minX),
    depth: Math.max(0.2, maxZ - minZ),
  };
}

/**
 * Constrói uma parede subdividida entre dois pontos [x0, z0] -> [x1, z1] de y0 até y1.
 * Subdivisão leve (ex.: 4x3) evita artefatos de projeção perspectiva mantendo poucos triângulos.
 */
function createSubdividedWallQuad(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y0: number,
  y1: number,
  segU = 3,
  segV = 2
): THREE.BufferGeometry {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz) || 1;
  // Normal para fora para segmento anti-horário visto de cima (X, Z)
  const nx = -dz / len;
  const nz = dx / len;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  for (let iy = 0; iy < segV; iy++) {
    const v0 = iy / segV;
    const v1 = (iy + 1) / segV;
    const py0 = y0 + (y1 - y0) * v0;
    const py1 = y0 + (y1 - y0) * v1;

    for (let ix = 0; ix < segU; ix++) {
      const u0 = ix / segU;
      const u1 = (ix + 1) / segU;
      const ax = x0 + dx * u0;
      const az = z0 + dz * u0;
      const bx = x0 + dx * u1;
      const bz = z0 + dz * u1;

      // Triângulo 1: (ax, py0), (bx, py0), (bx, py1)
      positions.push(ax, py0, az, bx, py0, bz, bx, py1, bz);
      // Triângulo 2: (ax, py0), (bx, py1), (ax, py1)
      positions.push(ax, py0, az, bx, py1, bz, ax, py1, az);

      for (let k = 0; k < 6; k++) {
        normals.push(nx, 0, nz);
      }
      uvs.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geom;
}

/**
 * Cria tampa poligonal horizontal em Y usando triangulação de ShapeGeometry sem booleanas.
 */
function createPolygonCap(
  ccwPoints: [number, number][],
  y: number,
  facingUp: boolean
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  ccwPoints.forEach(([x, z], idx) => {
    // Shape2D usa (x, y) mapeando shape.y -> -z após rotação -PI/2 em X
    if (idx === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  shape.closePath();

  const geom = new THREE.ShapeGeometry(shape);
  geom.rotateX(-Math.PI / 2);
  geom.translate(0, y, 0);
  const nonIndexed = geom.toNonIndexed();
  geom.dispose();

  if (!facingUp) {
    const pos = nonIndexed.getAttribute('position');
    for (let i = 0; i + 2 < pos.count; i += 3) {
      const x1 = pos.getX(i + 1);
      const y1 = pos.getY(i + 1);
      const z1 = pos.getZ(i + 1);
      pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
      pos.setXYZ(i + 2, x1, y1, z1);
    }
    pos.needsUpdate = true;
  }

  nonIndexed.computeVertexNormals();
  return nonIndexed;
}

export interface StructureDoorInfo {
  edgeIndex: number;
  hingePos: [number, number, number];
  latchPos: [number, number, number];
  centerXZ: [number, number];
  normalXZ: [number, number];
  tangentXZ: [number, number];
  wallAngle: number;
  doorWidth: number;
  doorHeight: number;
}

export interface StructureArchitectureBundle {
  wallsGeom: THREE.BufferGeometry;
  floorSlabsGeom: THREE.BufferGeometry | null;
  projectedGroundFloorGeom: THREE.BufferGeometry | null;
  trimGeom: THREE.BufferGeometry | null;
  glassGeom: THREE.BufferGeometry | null;
  doorGeom: THREE.BufferGeometry | null;
  doorInfo: StructureDoorInfo | null;
}

/**
 * Calcula a posição, dobradiça e dimensões exatas da porta frontal para alinhar
 * recorte de parede, folha animada e colisão do explorador.
 */
export function computeStructureDoorInfo(
  structure: StructureDef
): StructureDoorInfo | null {
  if (!structure.hasDoor || structure.footprint.length < 3) return null;
  const basePts = ensureCCWFootprintXZ(structure.footprint);
  const floorH = Math.max(0.2, structure.floorHeight);
  const minEdgeLen = structure.semanticTag === 'tower' ? 0.74 : 1.05;

  let doorEdgeIdx = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < basePts.length; i++) {
    const [x0, z0] = basePts[i];
    const [x1, z1] = basePts[(i + 1) % basePts.length];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const nz = dx / Math.max(0.01, len);
    const score = nz * 2 + len * 0.25;
    if (score > bestScore && len >= minEdgeLen) {
      bestScore = score;
      doorEdgeIdx = i;
    }
  }
  if (doorEdgeIdx < 0) return null;

  const [x0, z0] = basePts[doorEdgeIdx];
  const [x1, z1] = basePts[(doorEdgeIdx + 1) % basePts.length];
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz) || 1;
  const tx = dx / len;
  const tz = dz / len;
  const nx = -dz / len;
  const nz = dx / len;
  const mx = (x0 + x1) * 0.5;
  const mz = (z0 + z1) * 0.5;
  const wallAngle = Math.atan2(dz, dx);

  const doorWidth = Math.min(len * 0.82, Math.max(0.72, Math.min(1.12, len * 0.48)));
  const doorHeight = Math.min(1.86, floorH * 0.8);
  const y0 = structure.baseElevation;

  return {
    edgeIndex: doorEdgeIdx,
    hingePos: [mx - tx * (doorWidth * 0.5), y0, mz - tz * (doorWidth * 0.5)],
    latchPos: [mx + tx * (doorWidth * 0.5), y0, mz + tz * (doorWidth * 0.5)],
    centerXZ: [mx, mz],
    normalXZ: [nx, nz],
    tangentXZ: [tx, tz],
    wallAngle,
    doorWidth,
    doorHeight,
  };
}

/**
 * Expande um footprint 2D para fora a partir do centróide (útil para balanço do 2º andar medieval).
 */
export function expandFootprintXZ(
  points: [number, number][],
  delta: number
): [number, number][] {
  if (Math.abs(delta) < 1e-4 || points.length < 3) return points;
  let cx = 0;
  let cz = 0;
  for (const [x, z] of points) {
    cx += x;
    cz += z;
  }
  cx /= points.length;
  cz /= points.length;
  return points.map(([x, z]) => {
    const dx = x - cx;
    const dz = z - cz;
    const len = Math.hypot(dx, dz) || 1;
    return [x + (dx / len) * delta, z + (dz / len) * delta];
  });
}

function safeMergeAndDispose(
  parts: THREE.BufferGeometry[]
): THREE.BufferGeometry | null {
  if (parts.length === 0) return null;
  const allHaveUv = parts.every((p) => Boolean(p.getAttribute('uv')));
  if (!allHaveUv) {
    for (const p of parts) {
      if (p.getAttribute('uv')) p.deleteAttribute('uv');
    }
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

/**
 * Constrói o conjunto arquitetônico completo de fantasia medieval (sem booleanas):
 * - Paredes de múltiplos andares (com balanço/jetty opcional a partir do 2º andar)
 * - Pisos internos de madeira entre andares (para visualização quando hideRoof=true)
 * - Vigas enxaimel, contrafortes, porta emoldurada, janelas com venezianas e chaminé
 * - Vidros de janela com material emissivo quente
 */
export function buildStructureArchitectureBundle(
  structure: StructureDef
): StructureArchitectureBundle {
  const basePts = ensureCCWFootprintXZ(structure.footprint);
  if (basePts.length < 3) {
    return {
      wallsGeom: new THREE.BoxGeometry(1, 1, 1).toNonIndexed(),
      floorSlabsGeom: null,
      projectedGroundFloorGeom: null,
      trimGeom: null,
      glassGeom: null,
      doorGeom: null,
      doorInfo: null,
    };
  }

  const floors = Math.max(1, Math.round(structure.floors));
  const floorH = Math.max(0.2, structure.floorHeight);
  const totalHeight = floors * floorH;
  const y0 = structure.baseElevation;
  const y1 = y0 + totalHeight;

  const jetty = floors >= 2 ? Math.max(0, structure.upperFloorOverhang ?? 0) : 0;
  const upperPts = jetty > 0 ? expandFootprintXZ(basePts, jetty) : basePts;

  const wallParts: THREE.BufferGeometry[] = [];
  const floorParts: THREE.BufferGeometry[] = [];
  const projectedFloorParts: THREE.BufferGeometry[] = [];
  const trimParts: THREE.BufferGeometry[] = [];
  const glassParts: THREE.BufferGeometry[] = [];
  const doorParts: THREE.BufferGeometry[] = [];

  const doorInfo = computeStructureDoorInfo(structure);
  const hasPlayableInterior =
    structure.semanticTag === 'building' || structure.semanticTag === 'tower';
  const skirtDepth = hasPlayableInterior ? 0.58 : 0;

  // 1. Paredes por andar (com abertura física real na porta do térreo e saia de fundação)
  for (let f = 0; f < floors; f++) {
    const fy0 = y0 + f * floorH;
    const fy1 = fy0 + floorH;
    const fPts = f === 0 ? basePts : upperPts;

    for (let i = 0; i < fPts.length; i++) {
      const [x0, z0] = fPts[i];
      const [x1, z1] = fPts[(i + 1) % fPts.length];

      if (f === 0 && skirtDepth > 0) {
        wallParts.push(
          createSubdividedWallQuad(x0, z0, x1, z1, y0 - skirtDepth, y0, 2, 1)
        );
      }

      if (f === 0 && doorInfo && i === doorInfo.edgeIndex) {
        const hx = doorInfo.hingePos[0];
        const hz = doorInfo.hingePos[2];
        const lx = doorInfo.latchPos[0];
        const lz = doorInfo.latchPos[2];
        const doorTopY = Math.min(fy1 - 0.12, fy0 + doorInfo.doorHeight);

        if (Math.hypot(hx - x0, hz - z0) > 0.04) {
          wallParts.push(createSubdividedWallQuad(x0, z0, hx, hz, fy0, fy1, 1, 2));
        }
        if (Math.hypot(x1 - lx, z1 - lz) > 0.04) {
          wallParts.push(createSubdividedWallQuad(lx, lz, x1, z1, fy0, fy1, 1, 2));
        }
        if (fy1 - doorTopY > 0.06) {
          wallParts.push(
            createSubdividedWallQuad(hx, hz, lx, lz, doorTopY, fy1, 1, 1)
          );
        }
      } else {
        wallParts.push(createSubdividedWallQuad(x0, z0, x1, z1, fy0, fy1, 3, 2));
      }
    }
  }

  // Soffit (tampa inferior voltada para baixo) do balanço quando o 2º andar avança
  if (jetty > 0) {
    floorParts.push(createPolygonCap(upperPts, y0 + floorH, false));
  }

  // Pisos internos (térreo projetável ou em madeira/pedra + lajes dos andares superiores)
  const includeSlabs =
    structure.includeFloorSlabs ?? (hasPlayableInterior || floors >= 2);
  if (includeSlabs) {
    const floor1Y = y0 + 0.05;
    if (structure.floorStyle === 'projected') {
      projectedFloorParts.push(createPolygonCap(basePts, floor1Y, true));
    } else {
      floorParts.push(createPolygonCap(basePts, floor1Y, true));
    }
    for (let f = 1; f < floors; f++) {
      floorParts.push(createPolygonCap(upperPts, y0 + f * floorH + 0.03, true));
    }
  }

  // Fecha o topo apenas em estruturas planas sólidas (muros, pontes, plataformas);
  // edifícios com telhado ficam abertos por cima para revelar o interior ao ocultar/clipar telhado.
  const closeFlatTop =
    !structure.hideRoof &&
    (structure.roofType === 'flat' || !hasPlayableInterior);
  if (closeFlatTop) {
    wallParts.push(createPolygonCap(upperPts, y1, true));
  }

  // Mobiliário & escada procedural interna (Geometry Nodes) para interiores habitáveis
  if (hasPlayableInterior && includeSlabs) {
    const innerBounds = getFootprintBounds(basePts);
    const minSpan = Math.min(innerBounds.width, innerBounds.depth);
    const hasStairs = structure.hasStairs ?? floors >= 2;

    // Toda casa habitável com 2+ pisos recebe uma escada compacta. O lance
    // ocupa menos espaço em cabanas pequenas, mas continua sendo geometria
    // real e conecta cada piso sucessivo.
    if (hasStairs && floors >= 2 && minSpan >= 1.35) {
      const steps = Math.max(4, Math.min(7, Math.round(floorH / 0.42)));
      const stairWidth = Math.min(0.62, Math.max(0.42, minSpan * 0.3));
      const stairRun = Math.min(Math.max(1.0, innerBounds.depth * 0.52), 1.85);
      const stepDepth = stairRun / steps;
      const stairX = innerBounds.minX + Math.min(innerBounds.width * 0.3, 0.7);
      const stairZ = innerBounds.minZ + Math.max(0.18, innerBounds.depth * 0.12);
      for (let f = 0; f < floors - 1; f++) {
        for (let s = 0; s < steps; s++) {
          const stepH = (floorH * (s + 1)) / (steps + 1);
          const tread = new THREE.BoxGeometry(stairWidth, 0.12, stepDepth + 0.025).toNonIndexed();
          tread.translate(
            stairX,
            y0 + f * floorH + stepH,
            stairZ + s * stepDepth
          );
          trimParts.push(tread);
        }
      }
    }

    if (minSpan >= 1.85) {
      // Baú, mesa de estudos e cama medieval nos andares superiores
      if (floors >= 2) {
        for (let f = 1; f < floors; f++) {
          const fy = y0 + f * floorH + 0.03;
          const chest = new THREE.BoxGeometry(0.68, 0.42, 0.44).toNonIndexed();
          chest.translate(innerBounds.cx - innerBounds.width * 0.22, fy + 0.21, innerBounds.cz + innerBounds.depth * 0.18);
          const bedFrame = new THREE.BoxGeometry(1.1, 0.34, 0.72).toNonIndexed();
          bedFrame.translate(innerBounds.cx + innerBounds.width * 0.18, fy + 0.17, innerBounds.cz - innerBounds.depth * 0.16);
          const pillow = new THREE.BoxGeometry(0.28, 0.12, 0.56).toNonIndexed();
          pillow.translate(innerBounds.cx + innerBounds.width * 0.18 - 0.34, fy + 0.38, innerBounds.cz - innerBounds.depth * 0.16);
          trimParts.push(chest, bedFrame, pillow);
        }
      }

      // Lareira / fornalha interna sob a chaminé com brasas quentes
      if (structure.hasChimney || minSpan >= 2.55) {
        const hx = innerBounds.cx + innerBounds.width * 0.24;
        const hz = innerBounds.cz - innerBounds.depth * 0.18;
        const hearth = new THREE.BoxGeometry(0.74, 0.62, 0.56).toNonIndexed();
        hearth.translate(hx, y0 + 0.33, hz);
        const ember = new THREE.BoxGeometry(0.42, 0.24, 0.32).toNonIndexed();
        ember.translate(hx, y0 + 0.2, hz + 0.14);
        trimParts.push(hearth);
        glassParts.push(ember);
      }

      // Mesa medieval + 2 bancos no salão central para construções maiores
      if (structure.semanticTag === 'building' && minSpan >= 2.45) {
        const tx = innerBounds.cx - innerBounds.width * 0.08;
        const tz = innerBounds.cz + innerBounds.depth * 0.08;
        const tableTop = new THREE.BoxGeometry(1.05, 0.1, 0.66).toNonIndexed();
        tableTop.translate(tx, y0 + 0.66, tz);
        const legL = new THREE.BoxGeometry(0.14, 0.56, 0.48).toNonIndexed();
        legL.translate(tx - 0.38, y0 + 0.32, tz);
        const legR = new THREE.BoxGeometry(0.14, 0.56, 0.48).toNonIndexed();
        legR.translate(tx + 0.38, y0 + 0.32, tz);
        const benchN = new THREE.BoxGeometry(0.95, 0.28, 0.24).toNonIndexed();
        benchN.translate(tx, y0 + 0.2, tz - 0.48);
        const benchS = new THREE.BoxGeometry(0.95, 0.28, 0.24).toNonIndexed();
        benchS.translate(tx, y0 + 0.2, tz + 0.48);
        trimParts.push(tableTop, legL, legR, benchN, benchS);
      }
    }
  }

  // 2. Vigas, pilares de quina e base de pedra (IRCSS / Geometry Nodes sem booleanas)
  const wallStyle = structure.wallStyle ?? 'plain';
  if (wallStyle === 'timber_frame' || wallStyle === 'buttress') {
    const postSize = wallStyle === 'buttress' ? 0.34 : 0.16;
    for (let f = 0; f < floors; f++) {
      const fy0 = y0 + f * floorH;
      const fPts = f === 0 ? basePts : upperPts;
      for (const [vx, vz] of fPts) {
        const post = new THREE.BoxGeometry(postSize, floorH, postSize).toNonIndexed();
        post.translate(vx, fy0 + floorH * 0.5, vz);
        trimParts.push(post);
      }

      for (let i = 0; i < fPts.length; i++) {
        const [x0, z0] = fPts[i];
        const [x1, z1] = fPts[(i + 1) % fPts.length];
        const dx = x1 - x0;
        const dz = z1 - z0;
        const len = Math.hypot(dx, dz);
        if (len < 0.35) continue;
        const angle = Math.atan2(dz, dx);
        const mx = (x0 + x1) * 0.5;
        const mz = (z0 + z1) * 0.5;
        const nx = -dz / len;
        const nz = dx / len;

        if (wallStyle === 'timber_frame') {
          const beam = new THREE.BoxGeometry(len, 0.13, 0.14).toNonIndexed();
          beam.rotateY(-angle);
          beam.translate(mx, fy0 + floorH - 0.07, mz);
          trimParts.push(beam);

          // Cachorros de madeira (corbels) apoiando o balanço do 2º andar
          if (f === 1 && jetty > 0 && len >= 1.4) {
            const bracketCount = Math.max(2, Math.floor(len / 1.8));
            for (let b = 0; b < bracketCount; b++) {
              const bt = (b + 0.5) / bracketCount;
              const bx = x0 + dx * bt;
              const bz = z0 + dz * bt;
              const corbel = new THREE.BoxGeometry(0.14, 0.34, jetty + 0.18).toNonIndexed();
              corbel.rotateY(-angle);
              corbel.translate(bx - nx * (jetty * 0.35), fy0 - 0.17, bz - nz * (jetty * 0.35));
              trimParts.push(corbel);
            }
          }
        } else if (f === 0) {
          const plinth = new THREE.BoxGeometry(len + 0.12, 0.32, 0.22).toNonIndexed();
          plinth.rotateY(-angle);
          plinth.translate(mx, y0 + 0.16, mz);
          trimParts.push(plinth);
        }
      }
    }
  }

  // 3. Portal aberto com batentes laterais, verga, degrau + folha de porta articulada (pivotada na dobradiça)
  const doorEdgeIdx = doorInfo?.edgeIndex ?? -1;
  if (doorInfo) {
    const {
      centerXZ: [mx, mz],
      normalXZ: [nx, nz],
      tangentXZ: [tx, tz],
      wallAngle,
      doorWidth,
      doorHeight,
    } = doorInfo;

    const jambL = new THREE.BoxGeometry(0.12, doorHeight, 0.22).toNonIndexed();
    jambL.rotateY(-wallAngle);
    jambL.translate(
      mx - tx * (doorWidth * 0.5 + 0.05),
      y0 + doorHeight * 0.5,
      mz - tz * (doorWidth * 0.5 + 0.05)
    );
    const jambR = new THREE.BoxGeometry(0.12, doorHeight, 0.22).toNonIndexed();
    jambR.rotateY(-wallAngle);
    jambR.translate(
      mx + tx * (doorWidth * 0.5 + 0.05),
      y0 + doorHeight * 0.5,
      mz + tz * (doorWidth * 0.5 + 0.05)
    );
    const lintel = new THREE.BoxGeometry(doorWidth + 0.34, 0.16, 0.24).toNonIndexed();
    lintel.rotateY(-wallAngle);
    lintel.translate(mx + nx * 0.03, y0 + doorHeight + 0.07, mz + nz * 0.03);

    const step = new THREE.BoxGeometry(doorWidth + 0.36, 0.12, 0.44).toNonIndexed();
    step.rotateY(-wallAngle);
    step.translate(mx + nx * 0.14, y0 + 0.02, mz + nz * 0.14);

    trimParts.push(jambL, jambR, lintel, step);

    // Folha da porta no espaço local da dobradiça (0,0,0 -> +X por doorWidth)
    const leaf = new THREE.BoxGeometry(doorWidth - 0.04, doorHeight - 0.04, 0.09).toNonIndexed();
    leaf.translate(doorWidth * 0.5, doorHeight * 0.5, 0);
    const handle = new THREE.BoxGeometry(0.1, 0.16, 0.16).toNonIndexed();
    handle.translate(doorWidth * 0.84, doorHeight * 0.46, 0);
    doorParts.push(leaf, handle);
  }

  // 4. Janelas medievais por parede e andar (moldura + venezianas + vidro iluminado)
  const winCount = Math.min(4, Math.max(0, Math.round(structure.windowsPerWall ?? 0)));
  if (winCount > 0) {
    for (let f = 0; f < floors; f++) {
      const fy0 = y0 + f * floorH;
      const fPts = f === 0 ? basePts : upperPts;
      const winY = fy0 + floorH * 0.56;

      for (let i = 0; i < fPts.length; i++) {
        const [x0, z0] = fPts[i];
        const [x1, z1] = fPts[(i + 1) % fPts.length];
        const dx = x1 - x0;
        const dz = z1 - z0;
        const len = Math.hypot(dx, dz);
        if (len < 1.8) continue;

        const angle = Math.atan2(dz, dx);
        const nx = -dz / len;
        const nz = dx / len;
        const countOnEdge = Math.min(winCount, Math.max(1, Math.floor(len / 1.75)));

        for (let w = 0; w < countOnEdge; w++) {
          const t = (w + 1) / (countOnEdge + 1);
          // Evita sobrepor a porta central do térreo
          if (f === 0 && i === doorEdgeIdx && Math.abs(t - 0.5) < 0.25) continue;

          const wx = x0 + dx * t;
          const wz = z0 + dz * t;

          // Vidro quente iluminado
          const pane = new THREE.BoxGeometry(0.56, 0.68, 0.06).toNonIndexed();
          pane.rotateY(-angle);
          pane.translate(wx + nx * 0.05, winY, wz + nz * 0.05);
          glassParts.push(pane);

          // Peitoril + verga superior
          const sill = new THREE.BoxGeometry(0.76, 0.09, 0.18).toNonIndexed();
          sill.rotateY(-angle);
          sill.translate(wx + nx * 0.07, winY - 0.38, wz + nz * 0.07);
          trimParts.push(sill);

          const head = new THREE.BoxGeometry(0.74, 0.09, 0.16).toNonIndexed();
          head.rotateY(-angle);
          head.translate(wx + nx * 0.06, winY + 0.38, wz + nz * 0.06);
          trimParts.push(head);

          // Venezianas laterais abertas
          const shutterL = new THREE.BoxGeometry(0.16, 0.66, 0.08).toNonIndexed();
          shutterL.rotateY(-angle);
          shutterL.translate(
            wx - (dx / len) * 0.36 + nx * 0.06,
            winY,
            wz - (dz / len) * 0.36 + nz * 0.06
          );
          const shutterR = new THREE.BoxGeometry(0.16, 0.66, 0.08).toNonIndexed();
          shutterR.rotateY(-angle);
          shutterR.translate(
            wx + (dx / len) * 0.36 + nx * 0.06,
            winY,
            wz + (dz / len) * 0.36 + nz * 0.06
          );
          trimParts.push(shutterL, shutterR);
        }
      }
    }
  }

  // 5. Chaminé medieval de pedra subindo acima do telhado
  if (structure.hasChimney && !structure.hideRoof) {
    const b = getFootprintBounds(upperPts);
    const chimH = totalHeight + Math.max(1.2, Math.min(b.width, b.depth) * 0.45);
    const cx = b.cx + b.width * 0.26;
    const cz = b.cz - b.depth * 0.2;
    const stack = new THREE.BoxGeometry(0.56, chimH, 0.56).toNonIndexed();
    stack.translate(cx, y0 + chimH * 0.5, cz);
    const cap = new THREE.BoxGeometry(0.72, 0.14, 0.72).toNonIndexed();
    cap.translate(cx, y0 + chimH + 0.06, cz);
    trimParts.push(stack, cap);
  }

  return {
    wallsGeom: safeMergeAndDispose(wallParts) ?? new THREE.BoxGeometry(1, 1, 1).toNonIndexed(),
    floorSlabsGeom: safeMergeAndDispose(floorParts),
    projectedGroundFloorGeom: safeMergeAndDispose(projectedFloorParts),
    trimGeom: safeMergeAndDispose(trimParts),
    glassGeom: safeMergeAndDispose(glassParts),
    doorGeom: safeMergeAndDispose(doorParts),
    doorInfo,
  };
}

/**
 * Compila as paredes externas da estrutura a partir do footprint 2D (IRCSS / Aljullu).
 */
export function buildStructureWallsGeometry(
  structure: StructureDef
): THREE.BufferGeometry {
  const bundle = buildStructureArchitectureBundle(structure);
  bundle.floorSlabsGeom?.dispose();
  bundle.projectedGroundFloorGeom?.dispose();
  bundle.trimGeom?.dispose();
  bundle.glassGeom?.dispose();
  bundle.doorGeom?.dispose();
  return bundle.wallsGeom;
}

function pushTriangle(
  positions: number[],
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number]
): void {
  positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

/**
 * Gera telhados procedurais limpos (sem booleanas) adaptados ao bounding/footprint da estrutura.
 */
export function buildStructureRoofGeometry(
  structure: StructureDef
): THREE.BufferGeometry | null {
  if (structure.hideRoof || structure.roofType === 'flat') {
    return null;
  }

  const basePts = ensureCCWFootprintXZ(structure.footprint);
  if (basePts.length < 3) return null;

  const floors = Math.max(1, Math.round(structure.floors));
  const jetty = floors >= 2 ? Math.max(0, structure.upperFloorOverhang ?? 0) : 0;
  const pts = jetty > 0 ? expandFootprintXZ(basePts, jetty) : basePts;

  const bounds = getFootprintBounds(pts);
  const wallTop =
    structure.baseElevation + Math.max(0.2, floors * structure.floorHeight);
  const overhang = Math.max(0, structure.roofOverhang);
  const pitchRad = THREE.MathUtils.degToRad(
    Math.min(70, Math.max(10, structure.roofPitchDeg))
  );

  if (structure.roofType === 'cone') {
    const radius = Math.max(bounds.width, bounds.depth) * 0.5 + overhang;
    const height = Math.max(0.45, Math.tan(pitchRad) * radius);
    const cone = new THREE.ConeGeometry(radius, height, 14, 1).toNonIndexed();
    cone.translate(bounds.cx, wallTop + height * 0.5, bounds.cz);
    const spire = new THREE.ConeGeometry(0.11, 0.42, 6, 1).toNonIndexed();
    spire.translate(bounds.cx, wallTop + height + 0.16, bounds.cz);
    return safeMergeAndDispose([cone, spire]);
  }

  if (structure.roofType === 'parapet') {
    const wallThick = 0.25;
    const parapetH = 0.45;
    const parts: THREE.BufferGeometry[] = [];
    if (pts.length >= 5) {
      // Parapeito seguindo o polígono real de torres circulares/octogonais
      for (let i = 0; i < pts.length; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[(i + 1) % pts.length];
        const dx = bx - ax;
        const dz = bz - az;
        const len = Math.hypot(dx, dz);
        if (len < 0.15) continue;
        const angle = Math.atan2(dz, dx);
        const seg = new THREE.BoxGeometry(len + 0.08, parapetH, wallThick).toNonIndexed();
        seg.rotateY(-angle);
        seg.translate((ax + bx) * 0.5, wallTop + parapetH * 0.5, (az + bz) * 0.5);
        parts.push(seg);
      }
    } else {
      const { minX, maxX, minZ, maxZ } = bounds;
      const w = maxX - minX;
      const d = maxZ - minZ;

      const north = new THREE.BoxGeometry(w, parapetH, wallThick).toNonIndexed();
      north.translate(bounds.cx, wallTop + parapetH * 0.5, minZ + wallThick * 0.5);
      const south = new THREE.BoxGeometry(w, parapetH, wallThick).toNonIndexed();
      south.translate(bounds.cx, wallTop + parapetH * 0.5, maxZ - wallThick * 0.5);
      const west = new THREE.BoxGeometry(wallThick, parapetH, Math.max(0.1, d - wallThick * 2)).toNonIndexed();
      west.translate(minX + wallThick * 0.5, wallTop + parapetH * 0.5, bounds.cz);
      const east = new THREE.BoxGeometry(wallThick, parapetH, Math.max(0.1, d - wallThick * 2)).toNonIndexed();
      east.translate(maxX - wallThick * 0.5, wallTop + parapetH * 0.5, bounds.cz);
      parts.push(north, south, west, east);
    }
    return safeMergeAndDispose(parts);
  }

  // Gable (duas águas) e Hip (quatro águas) sobre o retângulo envolvente expandido pelo beiral
  const x0 = bounds.minX - overhang;
  const x1 = bounds.maxX + overhang;
  const z0 = bounds.minZ - overhang;
  const z1 = bounds.maxZ + overhang;
  const ew = x1 - x0;
  const ed = z1 - z0;

  const ridgeAlongX = ew >= ed;
  const span = ridgeAlongX ? ed * 0.5 : ew * 0.5;
  const roofH = Math.max(0.35, Math.tan(pitchRad) * span);
  const topY = wallTop + roofH;

  const positions: number[] = [];

  const fl: [number, number, number] = [x0, wallTop, z1];
  const fr: [number, number, number] = [x1, wallTop, z1];
  const br: [number, number, number] = [x1, wallTop, z0];
  const bl: [number, number, number] = [x0, wallTop, z0];

  if (structure.roofType === 'gable') {
    if (ridgeAlongX) {
      const rl: [number, number, number] = [x0, topY, bounds.cz];
      const rr: [number, number, number] = [x1, topY, bounds.cz];
      // Água frontal (+Z)
      pushTriangle(positions, fl, fr, rr);
      pushTriangle(positions, fl, rr, rl);
      // Água traseira (-Z)
      pushTriangle(positions, br, bl, rl);
      pushTriangle(positions, br, rl, rr);
      // Empenas laterais (oeste/leste)
      pushTriangle(positions, bl, fl, rl);
      pushTriangle(positions, fr, br, rr);
    } else {
      const rb: [number, number, number] = [bounds.cx, topY, z0];
      const rf: [number, number, number] = [bounds.cx, topY, z1];
      // Água esquerda (-X)
      pushTriangle(positions, bl, fl, rf);
      pushTriangle(positions, bl, rf, rb);
      // Água direita (+X)
      pushTriangle(positions, fr, br, rb);
      pushTriangle(positions, fr, rb, rf);
      // Empenas frontal/traseira
      pushTriangle(positions, fl, fr, rf);
      pushTriangle(positions, br, bl, rb);
    }
  } else {
    // Hip roof (quatro águas convergindo para cumeeira menor)
    const inset = Math.min(ew, ed) * 0.42;
    if (ridgeAlongX) {
      const rx0 = Math.min(bounds.cx, x0 + inset);
      const rx1 = Math.max(bounds.cx, x1 - inset);
      const rl: [number, number, number] = [rx0, topY, bounds.cz];
      const rr: [number, number, number] = [rx1, topY, bounds.cz];
      pushTriangle(positions, fl, fr, rr);
      pushTriangle(positions, fl, rr, rl);
      pushTriangle(positions, br, bl, rl);
      pushTriangle(positions, br, rl, rr);
      pushTriangle(positions, bl, fl, rl);
      pushTriangle(positions, fr, br, rr);
    } else {
      const rz0 = Math.min(bounds.cz, z0 + inset);
      const rz1 = Math.max(bounds.cz, z1 - inset);
      const rb: [number, number, number] = [bounds.cx, topY, rz0];
      const rf: [number, number, number] = [bounds.cx, topY, rz1];
      pushTriangle(positions, bl, fl, rf);
      pushTriangle(positions, bl, rf, rb);
      pushTriangle(positions, fr, br, rb);
      pushTriangle(positions, fr, rb, rf);
      pushTriangle(positions, fl, fr, rf);
      pushTriangle(positions, br, bl, rb);
    }
  }

  // Base inferior do telhado para não vazar luz por baixo do beiral
  pushTriangle(positions, bl, br, fr);
  pushTriangle(positions, bl, fr, fl);

  const slopeGeom = new THREE.BufferGeometry();
  slopeGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  slopeGeom.computeVertexNormals();

  // Viga de cumeeira medieval no topo do telhado para remate limpo sem emenda fina
  const ridgeLen =
    structure.roofType === 'gable'
      ? ridgeAlongX
        ? ew + 0.08
        : ed + 0.08
      : Math.max(0.4, (ridgeAlongX ? ew : ed) * 0.2);
  const ridgeCap = new THREE.BoxGeometry(
    ridgeAlongX ? ridgeLen : 0.18,
    0.16,
    ridgeAlongX ? 0.18 : ridgeLen
  ).toNonIndexed();
  ridgeCap.translate(bounds.cx, topY + 0.02, bounds.cz);

  return safeMergeAndDispose([slopeGeom, ridgeCap]);
}

export interface PropGeometryBundle {
  geometry: THREE.BufferGeometry;
  materials: MaterialPreset[];
}

function mergeGroupedPropParts(
  groups: { parts: THREE.BufferGeometry[]; material: MaterialPreset }[]
): PropGeometryBundle {
  const nonEmpty = groups.filter((g) => g.parts.length > 0);
  if (nonEmpty.length === 0) {
    return {
      geometry: new THREE.BoxGeometry(0.6, 0.6, 0.6).toNonIndexed(),
      materials: ['wood_plank'],
    };
  }
  if (nonEmpty.length === 1) {
    const merged = safeMergeAndDispose(nonEmpty[0].parts);
    return {
      geometry: merged ?? new THREE.BoxGeometry(0.6, 0.6, 0.6).toNonIndexed(),
      materials: [nonEmpty[0].material],
    };
  }

  const groupGeoms: THREE.BufferGeometry[] = [];
  const materials: MaterialPreset[] = [];
  for (const g of nonEmpty) {
    const mg = safeMergeAndDispose(g.parts);
    if (mg) {
      groupGeoms.push(mg);
      materials.push(g.material);
    }
  }
  const allHaveUv = groupGeoms.every((p) => Boolean(p.getAttribute('uv')));
  if (!allHaveUv) {
    for (const p of groupGeoms) {
      if (p.getAttribute('uv')) p.deleteAttribute('uv');
    }
  }
  const merged = mergeGeometries(groupGeoms, true);
  groupGeoms.forEach((p) => p.dispose());
  return {
    geometry: merged ?? new THREE.BoxGeometry(0.6, 0.6, 0.6).toNonIndexed(),
    materials,
  };
}

/**
 * Compila receitas multi-material para props de RPG (separa copa/folhagem e tronco com casca própria).
 */
export function buildPropGeometryBundle(prop: PropDef): PropGeometryBundle {
  const parts: THREE.BufferGeometry[] = [];

  switch (prop.generator) {
    case 'barrel': {
      const body = new THREE.CylinderGeometry(0.36, 0.32, 0.88, 10, 1).toNonIndexed();
      body.translate(0, 0.44, 0);
      const ringBottom = new THREE.CylinderGeometry(0.37, 0.37, 0.07, 10).toNonIndexed();
      ringBottom.translate(0, 0.18, 0);
      const ringTop = new THREE.CylinderGeometry(0.39, 0.39, 0.07, 10).toNonIndexed();
      ringTop.translate(0, 0.7, 0);
      return mergeGroupedPropParts([
        { parts: [body], material: prop.fallbackMaterial },
        { parts: [ringBottom, ringTop], material: 'roof_slate' },
      ]);
    }
    case 'crate': {
      const box = new THREE.BoxGeometry(0.85, 0.85, 0.85, 2, 2, 2).toNonIndexed();
      box.translate(0, 0.425, 0);
      const cap = new THREE.BoxGeometry(0.92, 0.1, 0.92).toNonIndexed();
      cap.translate(0, 0.8, 0);
      const base = new THREE.BoxGeometry(0.92, 0.1, 0.92).toNonIndexed();
      base.translate(0, 0.05, 0);
      parts.push(box, cap, base);
      break;
    }
    case 'pillar': {
      const plinth = new THREE.BoxGeometry(0.95, 0.35, 0.95).toNonIndexed();
      plinth.translate(0, 0.175, 0);
      const shaft = new THREE.CylinderGeometry(0.32, 0.36, 2.3, 10, 3).toNonIndexed();
      shaft.translate(0, 1.5, 0);
      const capital = new THREE.BoxGeometry(0.95, 0.32, 0.95).toNonIndexed();
      capital.translate(0, 2.8, 0);
      parts.push(plinth, shaft, capital);
      break;
    }
    case 'fallen_pillar': {
      const shaft = new THREE.CylinderGeometry(0.28, 0.32, 2.1, 10, 2).toNonIndexed();
      shaft.rotateZ(Math.PI / 2);
      shaft.translate(0, 0.28, 0);
      const cap = new THREE.BoxGeometry(0.28, 0.72, 0.72).toNonIndexed();
      cap.translate(-1.05, 0.34, 0);
      parts.push(shaft, cap);
      break;
    }
    case 'pine_tree': {
      const rootFlare = new THREE.CylinderGeometry(0.2, 0.34, 0.42, 7, 1, true).toNonIndexed();
      rootFlare.translate(0, 0.21, 0);
      const trunk = new THREE.CylinderGeometry(0.14, 0.22, 1.05, 7, 1, true).toNonIndexed();
      trunk.translate(0, 0.65, 0);

      const c1 = new THREE.ConeGeometry(1.15, 1.4, 8, 1).toNonIndexed();
      c1.translate(0, 1.45, 0);
      const c2 = new THREE.ConeGeometry(0.9, 1.25, 8, 1).toNonIndexed();
      c2.translate(0, 2.25, 0);
      const c3 = new THREE.ConeGeometry(0.6, 1.05, 8, 1).toNonIndexed();
      c3.translate(0, 2.95, 0);

      return mergeGroupedPropParts([
        { parts: [c1, c2, c3], material: prop.fallbackMaterial },
        { parts: [rootFlare, trunk], material: 'tree_bark' },
      ]);
    }
    case 'deciduous_tree': {
      const rootFlare = new THREE.CylinderGeometry(0.22, 0.38, 0.46, 6, 1, true).toNonIndexed();
      rootFlare.translate(0, 0.23, 0);
      const trunk = new THREE.CylinderGeometry(0.16, 0.24, 1.32, 6, 1, true).toNonIndexed();
      trunk.translate(0, 0.96, 0);
      const branchA = new THREE.CylinderGeometry(0.08, 0.13, 0.68, 5, 1, true).toNonIndexed();
      branchA.rotateZ(-0.55);
      branchA.rotateY(0.4);
      branchA.translate(0.26, 1.52, 0.14);
      const branchB = new THREE.CylinderGeometry(0.08, 0.12, 0.64, 5, 1, true).toNonIndexed();
      branchB.rotateZ(0.52);
      branchB.rotateY(-0.35);
      branchB.translate(-0.24, 1.56, -0.12);

      const crownMain = new THREE.IcosahedronGeometry(0.95, 1);
      crownMain.scale(1.1, 0.72, 1.1);
      crownMain.translate(0, 1.98, 0);
      const crownSideA = new THREE.IcosahedronGeometry(0.62, 1);
      crownSideA.scale(1.05, 0.78, 1.05);
      crownSideA.translate(0.52, 1.74, 0.3);
      const crownSideB = new THREE.IcosahedronGeometry(0.58, 1);
      crownSideB.scale(1.05, 0.75, 1.05);
      crownSideB.translate(-0.48, 1.78, -0.25);

      return mergeGroupedPropParts([
        { parts: [crownMain, crownSideA, crownSideB], material: prop.fallbackMaterial },
        { parts: [rootFlare, trunk, branchA, branchB], material: 'tree_bark' },
      ]);
    }
    case 'bush': {
      const b1 = new THREE.IcosahedronGeometry(0.58, 1);
      b1.scale(1.15, 0.7, 1.1);
      b1.translate(0, 0.35, 0);
      const b2 = new THREE.IcosahedronGeometry(0.42, 1);
      b2.scale(1.1, 0.68, 1.05);
      b2.translate(0.42, 0.28, 0.18);
      const b3 = new THREE.IcosahedronGeometry(0.38, 1);
      b3.scale(1.05, 0.65, 1.1);
      b3.translate(-0.36, 0.25, -0.2);
      parts.push(b1, b2, b3);
      break;
    }
    case 'rock': {
      const r1 = new THREE.DodecahedronGeometry(0.56, 0);
      r1.scale(1.32, 0.58, 1.05);
      r1.translate(0, 0.24, 0);
      const r2 = new THREE.DodecahedronGeometry(0.36, 0);
      r2.scale(1.15, 0.72, 0.95);
      r2.rotateY(0.7);
      r2.translate(0.34, 0.22, 0.22);
      const r3 = new THREE.DodecahedronGeometry(0.28, 0);
      r3.scale(1.05, 0.65, 1.1);
      r3.rotateY(-0.5);
      r3.translate(-0.38, 0.16, -0.18);
      parts.push(r1, r2, r3);
      break;
    }
    case 'boat': {
      const hull = new THREE.BoxGeometry(0.92, 0.34, 2.15).toNonIndexed();
      hull.translate(0, 0.18, 0);
      const bow = new THREE.ConeGeometry(0.48, 0.72, 4).toNonIndexed();
      bow.rotateX(-Math.PI / 2);
      bow.rotateZ(Math.PI / 4);
      bow.scale(1, 0.52, 1);
      bow.translate(0, 0.22, 1.32);
      const seatA = new THREE.BoxGeometry(0.86, 0.08, 0.24).toNonIndexed();
      seatA.translate(0, 0.36, -0.35);
      const seatB = new THREE.BoxGeometry(0.86, 0.08, 0.24).toNonIndexed();
      seatB.translate(0, 0.36, 0.42);
      parts.push(hull, bow, seatA, seatB);
      break;
    }
    case 'signpost': {
      const post = new THREE.CylinderGeometry(0.08, 0.1, 1.65, 6).toNonIndexed();
      post.translate(0, 0.825, 0);
      const arm1 = new THREE.BoxGeometry(0.85, 0.16, 0.08).toNonIndexed();
      arm1.translate(0.38, 1.48, 0);
      arm1.rotateY(THREE.MathUtils.degToRad(35));
      const arm2 = new THREE.BoxGeometry(0.82, 0.16, 0.08).toNonIndexed();
      arm2.translate(0.36, 1.26, 0);
      arm2.rotateY(THREE.MathUtils.degToRad(160));
      const arm3 = new THREE.BoxGeometry(0.78, 0.16, 0.08).toNonIndexed();
      arm3.translate(0.34, 1.04, 0);
      arm3.rotateY(THREE.MathUtils.degToRad(-95));
      parts.push(post, arm1, arm2, arm3);
      break;
    }
    case 'well': {
      const rim = new THREE.CylinderGeometry(0.68, 0.74, 0.72, 8, 1).toNonIndexed();
      rim.translate(0, 0.36, 0);
      const postL = new THREE.BoxGeometry(0.11, 1.5, 0.11).toNonIndexed();
      postL.translate(-0.56, 1.05, 0);
      const postR = new THREE.BoxGeometry(0.11, 1.5, 0.11).toNonIndexed();
      postR.translate(0.56, 1.05, 0);
      const beam = new THREE.CylinderGeometry(0.06, 0.06, 1.15, 6).toNonIndexed();
      beam.rotateZ(Math.PI / 2);
      beam.translate(0, 1.45, 0);
      const cap = new THREE.ConeGeometry(0.95, 0.75, 4).toNonIndexed();
      cap.rotateY(Math.PI / 4);
      cap.translate(0, 2.08, 0);
      return mergeGroupedPropParts([
        { parts: [rim], material: 'stone_brick' },
        { parts: [postL, postR, beam], material: 'wood_plank' },
        { parts: [cap], material: 'roof_teal' },
      ]);
    }
    case 'brazier': {
      const base = new THREE.CylinderGeometry(0.35, 0.48, 0.5, 8).toNonIndexed();
      base.translate(0, 0.25, 0);
      const bowl = new THREE.CylinderGeometry(0.55, 0.25, 0.38, 8).toNonIndexed();
      bowl.translate(0, 0.68, 0);
      const embers = new THREE.IcosahedronGeometry(0.34, 0);
      embers.scale(1.1, 0.55, 1.1);
      embers.translate(0, 0.84, 0);
      return mergeGroupedPropParts([
        { parts: [base, bowl], material: prop.fallbackMaterial },
        { parts: [embers], material: 'ember_glow' },
      ]);
    }
    case 'tavern_table': {
      const woodParts: THREE.BufferGeometry[] = [];
      const top = new THREE.CylinderGeometry(0.76, 0.76, 0.08, 10, 1).toNonIndexed();
      top.translate(0, 0.74, 0);
      const ped = new THREE.BoxGeometry(0.24, 0.68, 0.24).toNonIndexed();
      ped.translate(0, 0.36, 0);
      const footA = new THREE.BoxGeometry(0.78, 0.09, 0.16).toNonIndexed();
      footA.translate(0, 0.045, 0);
      const footB = new THREE.BoxGeometry(0.16, 0.09, 0.78).toNonIndexed();
      footB.translate(0, 0.045, 0);
      woodParts.push(top, ped, footA, footB);

      const seatAngles = [Math.PI * 0.22, Math.PI * 0.78, Math.PI * 1.22, Math.PI * 1.78];
      for (const a of seatAngles) {
        const sx = Math.cos(a) * 0.94;
        const sz = Math.sin(a) * 0.94;
        const seat = new THREE.BoxGeometry(0.34, 0.1, 0.34).toNonIndexed();
        seat.rotateY(-a);
        seat.translate(sx, 0.46, sz);
        const leg = new THREE.BoxGeometry(0.14, 0.42, 0.14).toNonIndexed();
        leg.rotateY(-a);
        leg.translate(sx, 0.21, sz);
        woodParts.push(seat, leg);
      }

      const mug1 = new THREE.BoxGeometry(0.18, 0.05, 0.18).toNonIndexed();
      mug1.translate(-0.28, 0.805, 0.2);
      const mug2 = new THREE.BoxGeometry(0.18, 0.05, 0.18).toNonIndexed();
      mug2.translate(0.26, 0.805, -0.22);
      const mug3 = new THREE.BoxGeometry(0.1, 0.14, 0.1).toNonIndexed();
      mug3.translate(0.18, 0.85, 0.26);

      const candle1 = new THREE.BoxGeometry(0.08, 0.14, 0.08).toNonIndexed();
      candle1.translate(-0.04, 0.85, 0.02);
      const candle2 = new THREE.BoxGeometry(0.07, 0.11, 0.07).toNonIndexed();
      candle2.translate(0.05, 0.835, -0.04);

      return mergeGroupedPropParts([
        { parts: woodParts, material: 'wood_plank' },
        { parts: [mug1, mug2, mug3], material: 'roof_slate' },
        { parts: [candle1, candle2], material: 'ember_glow' },
      ]);
    }
    case 'stool': {
      const seat = new THREE.CylinderGeometry(0.22, 0.21, 0.08, 8).toNonIndexed();
      seat.translate(0, 0.48, 0);
      const stoolParts: THREE.BufferGeometry[] = [seat];
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const leg = new THREE.BoxGeometry(0.07, 0.46, 0.07).toNonIndexed();
        leg.translate(Math.cos(a) * 0.13, 0.23, Math.sin(a) * 0.13);
        stoolParts.push(leg);
      }
      parts.push(...stoolParts);
      break;
    }
    case 'bar_counter': {
      const base = new THREE.BoxGeometry(1.88, 0.94, 0.48).toNonIndexed();
      base.translate(0, 0.47, 0);

      const top = new THREE.BoxGeometry(1.98, 0.1, 0.62).toNonIndexed();
      top.translate(0, 0.98, 0);
      const footrail = new THREE.BoxGeometry(1.92, 0.07, 0.07).toNonIndexed();
      footrail.translate(0, 0.14, 0.31);
      const keg = new THREE.CylinderGeometry(0.13, 0.13, 0.3, 6).toNonIndexed();
      keg.rotateZ(Math.PI / 2);
      keg.translate(-0.45, 1.16, 0);

      const cA = new THREE.BoxGeometry(0.08, 0.14, 0.08).toNonIndexed();
      cA.translate(0.32, 1.1, 0.08);
      const cB = new THREE.BoxGeometry(0.07, 0.11, 0.07).toNonIndexed();
      cB.translate(0.54, 1.08, -0.05);

      return mergeGroupedPropParts([
        { parts: [base], material: 'timber_plaster' },
        { parts: [top, footrail, keg], material: 'wood_plank' },
        { parts: [cA, cB], material: 'ember_glow' },
      ]);
    }
    case 'fireplace': {
      const hearth = new THREE.BoxGeometry(1.86, 0.2, 0.96).toNonIndexed();
      hearth.translate(0, 0.1, 0.12);
      const pierL = new THREE.BoxGeometry(0.38, 0.92, 0.72).toNonIndexed();
      pierL.translate(-0.68, 0.64, 0);
      const pierR = new THREE.BoxGeometry(0.38, 0.92, 0.72).toNonIndexed();
      pierR.translate(0.68, 0.64, 0);
      const back = new THREE.BoxGeometry(1.56, 0.94, 0.24).toNonIndexed();
      back.translate(0, 0.64, -0.24);
      const lintel = new THREE.BoxGeometry(1.82, 0.24, 0.76).toNonIndexed();
      lintel.translate(0, 1.2, 0);
      const hood = new THREE.CylinderGeometry(0.46, 0.98, 1.18, 4).toNonIndexed();
      hood.rotateY(Math.PI / 4);
      hood.scale(1.25, 1, 0.72);
      hood.translate(0, 1.9, -0.04);
      const flue = new THREE.BoxGeometry(0.76, 0.42, 0.54).toNonIndexed();
      flue.translate(0, 2.58, -0.08);

      const mantel = new THREE.BoxGeometry(1.96, 0.12, 0.84).toNonIndexed();
      mantel.translate(0, 1.35, 0.04);
      const logA = new THREE.BoxGeometry(0.64, 0.13, 0.13).toNonIndexed();
      logA.rotateY(0.28);
      logA.translate(-0.08, 0.26, 0.04);
      const logB = new THREE.BoxGeometry(0.58, 0.12, 0.12).toNonIndexed();
      logB.rotateY(-0.34);
      logB.translate(0.08, 0.3, 0.08);

      const emberBed = new THREE.BoxGeometry(0.84, 0.14, 0.4).toNonIndexed();
      emberBed.translate(0, 0.24, 0.04);
      const flame1 = new THREE.ConeGeometry(0.18, 0.46, 5).toNonIndexed();
      flame1.translate(0, 0.5, 0.05);
      const flame2 = new THREE.ConeGeometry(0.14, 0.36, 5).toNonIndexed();
      flame2.translate(-0.22, 0.44, 0.08);
      const flame3 = new THREE.ConeGeometry(0.14, 0.34, 5).toNonIndexed();
      flame3.translate(0.22, 0.43, 0.06);
      const candleL = new THREE.BoxGeometry(0.07, 0.15, 0.07).toNonIndexed();
      candleL.translate(-0.56, 1.48, 0.34);
      const candleR = new THREE.BoxGeometry(0.07, 0.15, 0.07).toNonIndexed();
      candleR.translate(0.56, 1.48, 0.34);

      return mergeGroupedPropParts([
        { parts: [hearth, pierL, pierR, back, lintel, hood, flue], material: 'stone_brick' },
        { parts: [mantel, logA, logB], material: 'wood_plank' },
        { parts: [emberBed, flame1, flame2, flame3, candleL, candleR], material: 'ember_glow' },
      ]);
    }
    case 'bookshelf': {
      const back = new THREE.BoxGeometry(1.45, 1.72, 0.08).toNonIndexed();
      back.translate(0, 0.86, -0.2);
      const sideL = new THREE.BoxGeometry(0.1, 1.72, 0.46).toNonIndexed();
      sideL.translate(-0.68, 0.86, 0);
      const sideR = new THREE.BoxGeometry(0.1, 1.72, 0.46).toNonIndexed();
      sideR.translate(0.68, 0.86, 0);
      const bottom = new THREE.BoxGeometry(1.45, 0.1, 0.46).toNonIndexed();
      bottom.translate(0, 0.05, 0);
      const top = new THREE.BoxGeometry(1.5, 0.1, 0.48).toNonIndexed();
      top.translate(0, 1.67, 0);
      const shelf1 = new THREE.BoxGeometry(1.28, 0.07, 0.42).toNonIndexed();
      shelf1.translate(0, 0.62, 0);
      const shelf2 = new THREE.BoxGeometry(1.28, 0.07, 0.42).toNonIndexed();
      shelf2.translate(0, 1.14, 0);

      const bottles1 = new THREE.BoxGeometry(0.46, 0.28, 0.24).toNonIndexed();
      bottles1.translate(-0.3, 0.8, 0.02);
      const bottles2 = new THREE.BoxGeometry(0.38, 0.32, 0.22).toNonIndexed();
      bottles2.translate(0.28, 0.82, 0);
      const bottles3 = new THREE.BoxGeometry(0.52, 0.3, 0.24).toNonIndexed();
      bottles3.translate(-0.18, 1.32, 0.02);
      const bottles4 = new THREE.BoxGeometry(0.32, 0.26, 0.22).toNonIndexed();
      bottles4.translate(0.36, 1.3, 0);

      return mergeGroupedPropParts([
        { parts: [back, sideL, sideR, bottom, top, shelf1, shelf2], material: 'wood_plank' },
        { parts: [bottles1, bottles2, bottles3, bottles4], material: 'roof_teal' },
      ]);
    }
    case 'wall_sconce': {
      const plate = new THREE.BoxGeometry(0.14, 0.28, 0.06).toNonIndexed();
      plate.translate(0, 1.62, -0.02);
      const arm = new THREE.BoxGeometry(0.08, 0.08, 0.28).toNonIndexed();
      arm.translate(0, 1.56, 0.12);
      const cap = new THREE.BoxGeometry(0.22, 0.08, 0.22).toNonIndexed();
      cap.translate(0, 1.76, 0.22);

      const glow = new THREE.BoxGeometry(0.16, 0.18, 0.16).toNonIndexed();
      glow.translate(0, 1.64, 0.22);

      return mergeGroupedPropParts([
        { parts: [plate, arm, cap], material: 'roof_slate' },
        { parts: [glow], material: 'ember_glow' },
      ]);
    }
    case 'card_25d': {
      // Cartões cruzados em X para props 2.5D ultraleves (4 triângulos ao todo)
      const p1 = new THREE.PlaneGeometry(1.4, 1.8).toNonIndexed();
      p1.translate(0, 0.9, 0);
      const p2 = new THREE.PlaneGeometry(1.4, 1.8).toNonIndexed();
      p2.rotateY(Math.PI / 2);
      p2.translate(0, 0.9, 0);
      parts.push(p1, p2);
      break;
    }
    case 'cloud': {
      // Nuvem volumétrica estilizada flutuando (aglomerado de icosaedros achatados)
      const c1 = new THREE.IcosahedronGeometry(1.5, 1);
      c1.scale(2.4, 0.65, 1.5);
      c1.translate(0, 0, 0);
      const c2 = new THREE.IcosahedronGeometry(1.2, 1);
      c2.scale(1.7, 0.6, 1.25);
      c2.translate(1.5, -0.08, 0.35);
      const c3 = new THREE.IcosahedronGeometry(1.15, 1);
      c3.scale(1.6, 0.55, 1.15);
      c3.translate(-1.4, -0.1, -0.28);
      const c4 = new THREE.IcosahedronGeometry(0.95, 1);
      c4.scale(1.3, 0.52, 1.05);
      c4.translate(0.35, 0.38, -0.32);
      parts.push(c1, c2, c3, c4);
      break;
    }
    case 'watermill': {
      // Roda d'água mecânica com eixo e aletas radiais
      const hub = new THREE.CylinderGeometry(0.35, 0.35, 0.7, 8).toNonIndexed();
      hub.rotateZ(Math.PI / 2);
      hub.translate(0, 1.2, 0);
      const rim = new THREE.TorusGeometry(1.15, 0.08, 6, 12).toNonIndexed();
      rim.rotateY(Math.PI / 2);
      rim.translate(0, 1.2, 0);
      const axle = new THREE.BoxGeometry(0.9, 0.12, 0.12).toNonIndexed();
      axle.translate(0, 1.2, 0);
      parts.push(hub, rim, axle);
      break;
    }
  }

  return mergeGroupedPropParts([{ parts, material: prop.fallbackMaterial }]);
}

/**
 * Compila receitas de primitivas em código (estilo img2obj + Nova3D) para props de RPG.
 */
export function buildPropGeometry(prop: PropDef): THREE.BufferGeometry {
  return buildPropGeometryBundle(prop).geometry;
}

/**
 * Constrói a malha base de terreno subdividida pronta para Displacement + Normal Map.
 */
export function buildTerrainBaseGeometry(
  terrain: TerrainConfig
): THREE.BufferGeometry {
  const segs = Math.min(192, Math.max(8, Math.round(terrain.subdivisions)));
  const plane = new THREE.PlaneGeometry(terrain.width, terrain.depth, segs, segs);
  plane.rotateX(-Math.PI / 2);
  return plane;
}

/**
 * Constrói uma região de terreno reconstruída sem câmera projetora.
 * Features com width são linhas centrais (estradas/rios); as demais são
 * polígonos semânticos fechados extraídos da imagem.
 */
export function buildTerrainFeatureGeometry(
  feature: TerrainFeatureDef
): THREE.BufferGeometry | null {
  if (!feature.visible || feature.points.length < 2) return null;

  if (feature.width && feature.width > 0 && feature.points.length >= 2) {
    const positions: number[] = [];
    const y = feature.elevation;
    const halfWidth = feature.width * 0.5;
    for (let i = 0; i < feature.points.length - 1; i++) {
      const [x0, z0] = feature.points[i];
      const [x1, z1] = feature.points[i + 1];
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) continue;
      const nx = (-dz / len) * halfWidth;
      const nz = (dx / len) * halfWidth;
      positions.push(
        x0 + nx, y, z0 + nz,
        x1 + nx, y, z1 + nz,
        x1 - nx, y, z1 - nz,
        x0 + nx, y, z0 + nz,
        x1 - nx, y, z1 - nz,
        x0 - nx, y, z0 - nz
      );
    }
    if (positions.length === 0) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();
    return geom;
  }

  const shape = new THREE.Shape();
  feature.points.forEach(([x, z], index) => {
    if (index === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  shape.closePath();
  const geom = new THREE.ShapeGeometry(shape).toNonIndexed();
  geom.rotateX(-Math.PI / 2);
  geom.translate(0, feature.elevation, 0);
  geom.computeVertexNormals();
  return geom;
}
