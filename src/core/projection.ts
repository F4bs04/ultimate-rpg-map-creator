import * as THREE from 'three';
import type { ProjectionConfig, TextureMode } from '../types/isodsl';

/**
 * Constrói a câmera projetora (Ortográfica Isométrica/Top-Down ou Perspectiva)
 * que representa o ponto de vista original da imagem 2D.
 */
export function createProjectorCamera(
  config: ProjectionConfig,
  aspect: number
): THREE.OrthographicCamera | THREE.PerspectiveCamera {
  const safeAspect = Math.max(0.1, aspect);
  const pitchRad = THREE.MathUtils.degToRad(
    Math.min(89.9, Math.max(1, config.pitchDeg))
  );
  const yawRad = THREE.MathUtils.degToRad(config.yawDeg);

  const target = new THREE.Vector3(config.offsetX, 0, config.offsetY);

  let camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;
  let dist = 70;

  if (config.type === 'orthographic') {
    const halfH = Math.max(0.5, config.orthoScale / 2);
    const halfW = halfH * safeAspect;
    camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 300);
  } else {
    const fov = Math.min(100, Math.max(10, config.fovDeg));
    const halfH = Math.max(0.5, config.orthoScale / 2);
    dist = halfH / Math.tan(THREE.MathUtils.degToRad(fov / 2));
    camera = new THREE.PerspectiveCamera(fov, safeAspect, 0.1, 400);
  }

  const horiz = Math.cos(pitchRad) * dist;
  camera.position.set(
    target.x + Math.sin(yawRad) * horiz,
    target.y + Math.sin(pitchRad) * dist,
    target.z + Math.cos(yawRad) * horiz
  );
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  return camera;
}

function projectWorldToUV(
  worldPos: THREE.Vector3,
  vpMatrix: THREE.Matrix4
): [number, number] {
  const ndc = worldPos.clone().applyMatrix4(vpMatrix);
  return [ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5];
}

function computeBoxTiledUV(
  worldPos: THREE.Vector3,
  faceNormal: THREE.Vector3,
  tileScale: number
): [number, number] {
  const ax = Math.abs(faceNormal.x);
  const ay = Math.abs(faceNormal.y);
  const az = Math.abs(faceNormal.z);

  if (ay >= ax && ay >= az) {
    return [worldPos.x * tileScale, worldPos.z * tileScale];
  }
  if (ax >= az) {
    return [worldPos.z * tileScale, worldPos.y * tileScale];
  }
  return [worldPos.x * tileScale, worldPos.y * tileScale];
}

export interface BakeUVOptions {
  textureMode: TextureMode;
  backfaceThreshold?: number;
  proceduralTileScale?: number;
}

export type SurfacePartKind = 'terrain' | 'wall' | 'roof' | 'prop';

/**
 * Resolve o modo de textura ideal por tipo de geometria:
 * evita que projeção 2D estique ou distorça telhados inclinados, topos de torres,
 * rochas e props volumétricos 3D (ou paredes em mapas Top-Down), mantendo PBR limpo
 * sobreposto ao terreno projetado no modo 'hybrid'. Preserva 'projected' quando explícito.
 */
export function resolveSurfaceTextureMode(
  requestedMode: TextureMode,
  partKind: SurfacePartKind,
  projectionPitchDeg: number,
  generatorOrTag?: string
): TextureMode {
  if (requestedMode === 'projected') return 'projected';
  if (requestedMode === 'procedural') return 'procedural';

  if (partKind === 'terrain') return 'hybrid';
  if (partKind === 'roof') return 'procedural';
  if (partKind === 'prop') {
    return generatorOrTag === 'card_25d' ? 'hybrid' : 'procedural';
  }
  // Em mapas Top-Down (pitch >= 68°), paredes verticais não têm textura lateral na imagem 2D
  if (partKind === 'wall' && projectionPitchDeg >= 68) {
    return 'procedural';
  }
  return 'hybrid';
}

/**
 * Projeta UVs da câmera virtual diretamente sobre a geometria (compatível com MeshStandardMaterial
 * e GLTFExporter). No modo 'hybrid', separa faces visíveis (grupo 0: arte original projetada)
 * de faces ocultas (grupo 1: UV planar PBR procedural sem esticamento).
 */
export function bakeProjectedUVs(
  sourceGeometry: THREE.BufferGeometry,
  meshWorldMatrix: THREE.Matrix4,
  projectorCamera: THREE.Camera,
  options: BakeUVOptions
): THREE.BufferGeometry {
  const geom = sourceGeometry.index
    ? sourceGeometry.toNonIndexed()
    : sourceGeometry.clone();

  if (!geom.getAttribute('normal')) {
    geom.computeVertexNormals();
  }

  const posAttr = geom.getAttribute('position');
  const normAttr = geom.getAttribute('normal');
  const vertCount = posAttr.count;

  const vpMatrix = new THREE.Matrix4().multiplyMatrices(
    projectorCamera.projectionMatrix,
    projectorCamera.matrixWorldInverse
  );

  const camForward = new THREE.Vector3();
  projectorCamera.getWorldDirection(camForward);
  const orthoToCam = camForward.clone().negate().normalize();
  const isOrtho = projectorCamera instanceof THREE.OrthographicCamera;

  const threshold = options.backfaceThreshold ?? 0.35;
  const tileScale = options.proceduralTileScale ?? 0.38;

  // Reconstrução procedural não deve descartar as faces voltadas para a câmera.
  // O caminho antigo tratava "procedural" como o conjunto de faces traseiras do
  // modo híbrido, o que fazia árvores, telhados e estruturas desaparecerem em
  // determinadas orientações. Aqui apenas geramos UVs triplanares leves e
  // preservamos a geometria/grupos originais.
  if (options.textureMode === 'procedural') {
    const uvValues: number[] = [];
    for (let i = 0; i < vertCount; i++) {
      const local = new THREE.Vector3().fromBufferAttribute(posAttr, i);
      const world = local.clone().applyMatrix4(meshWorldMatrix);
      const normal = new THREE.Vector3(
        normAttr.getX(i),
        normAttr.getY(i),
        normAttr.getZ(i)
      ).transformDirection(meshWorldMatrix);
      const [u, v] = computeBoxTiledUV(world, normal, tileScale);
      uvValues.push(u, v);
    }
    outGeometryWithProceduralUV(geom, uvValues);
    return geom;
  }

  const frontPos: number[] = [];
  const frontNorm: number[] = [];
  const frontUV: number[] = [];

  const backPos: number[] = [];
  const backNorm: number[] = [];
  const backUV: number[] = [];

  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const w0 = new THREE.Vector3();
  const w1 = new THREE.Vector3();
  const w2 = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const faceN = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const toCam = new THREE.Vector3();

  for (let i = 0; i < vertCount; i += 3) {
    v0.fromBufferAttribute(posAttr, i);
    v1.fromBufferAttribute(posAttr, i + 1);
    v2.fromBufferAttribute(posAttr, i + 2);

    w0.copy(v0).applyMatrix4(meshWorldMatrix);
    w1.copy(v1).applyMatrix4(meshWorldMatrix);
    w2.copy(v2).applyMatrix4(meshWorldMatrix);

    e1.subVectors(w1, w0);
    e2.subVectors(w2, w0);
    faceN.crossVectors(e1, e2);
    if (faceN.lengthSq() > 1e-10) {
      faceN.normalize();
    } else {
      faceN.set(0, 1, 0);
    }

    if (isOrtho) {
      toCam.copy(orthoToCam);
    } else {
      centroid.copy(w0).add(w1).add(w2).multiplyScalar(1 / 3);
      toCam.subVectors(projectorCamera.position, centroid).normalize();
    }

    const useProjected =
      options.textureMode === 'projected' ||
      (options.textureMode === 'hybrid' && faceN.dot(toCam) >= threshold);

    const targetPos = useProjected ? frontPos : backPos;
    const targetNorm = useProjected ? frontNorm : backNorm;
    const targetUV = useProjected ? frontUV : backUV;

    const verts = [v0, v1, v2];
    const worlds = [w0, w1, w2];

    for (let k = 0; k < 3; k++) {
      const localV = verts[k];
      const worldV = worlds[k];
      targetPos.push(localV.x, localV.y, localV.z);
      targetNorm.push(
        normAttr.getX(i + k),
        normAttr.getY(i + k),
        normAttr.getZ(i + k)
      );

      const [u, v] = useProjected
        ? projectWorldToUV(worldV, vpMatrix)
        : computeBoxTiledUV(worldV, faceN, tileScale);
      targetUV.push(u, v);
    }
  }

  const out = new THREE.BufferGeometry();
  out.clearGroups();

  if (options.textureMode === 'projected') {
    out.setAttribute('position', new THREE.Float32BufferAttribute(frontPos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(frontNorm, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(frontUV, 2));
    out.addGroup(0, frontPos.length / 3, 0);
    return out;
  }

  // Modo 'hybrid': concatena frente (material 0) + costas (material 1)
  const combinedPos = frontPos.concat(backPos);
  const combinedNorm = frontNorm.concat(backNorm);
  const combinedUV = frontUV.concat(backUV);

  out.setAttribute('position', new THREE.Float32BufferAttribute(combinedPos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(combinedNorm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(combinedUV, 2));

  const frontCount = frontPos.length / 3;
  const backCount = backPos.length / 3;
  if (frontCount > 0) {
    out.addGroup(0, frontCount, 0);
  }
  if (backCount > 0) {
    out.addGroup(frontCount, backCount, 1);
  }
  return out;
}

function outGeometryWithProceduralUV(
  geom: THREE.BufferGeometry,
  uvValues: number[]
): void {
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvValues, 2));
}
