import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  buildPropGeometryBundle,
  buildStructureArchitectureBundle,
  buildStructureRoofGeometry,
  buildTerrainFeatureGeometry,
  buildTerrainBaseGeometry,
  computeStructureDoorInfo,
} from '../core/compiler';
import {
  bakeTerrainDisplacementIntoGeometry,
  exportSceneToGLB,
  exportSingleChunkToGLB,
} from '../core/exporter';
import { getProceduralMaterialTextures } from '../core/proceduralTextures';
import { sampleHeightAtUV } from '../core/imageMaps';
import {
  bakeProjectedUVs,
  createProjectorCamera,
  resolveSurfaceTextureMode,
} from '../core/projection';
import {
  extractCollisionSegments,
  extractPropCollisionObstacles,
  findDefaultSpawnXZ,
  findEnteredInteriorCluster,
  findNearestInteractiveDoor,
  resolveMovementWithCollisions,
  sampleWalkableElevation,
  type PropObstacleCircle,
  type WallSegment2D,
} from '../core/worldNav';
import { useSceneStore } from '../store/useSceneStore';
import type {
  IsoWorldKit,
  MaterialPreset,
  PropDef,
  StructureDef,
  TextureMode,
} from '../types/isodsl';
import { getEffectiveTextureMode } from '../types/isodsl';

function disposeObjectTree(group: THREE.Object3D): void {
  const disposedMats = new Set<THREE.Material>();
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
      obj.geometry?.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => {
        if (!m || disposedMats.has(m)) return;
        disposedMats.add(m);
        if (m instanceof THREE.MeshStandardMaterial && m.userData?.ownsTextures) {
          m.map?.dispose();
          m.normalMap?.dispose();
        }
        m.dispose();
      });
    }
  });
}

function makeFallbackMaterial(
  preset: MaterialPreset,
  selected: boolean,
  kit?: IsoWorldKit | null
): THREE.MeshStandardMaterial {
  const pair = getProceduralMaterialTextures(preset, kit);
  const isEmber = preset === 'ember_glow';
  return new THREE.MeshStandardMaterial({
    map: pair.albedo,
    normalMap: pair.normal,
    normalScale: new THREE.Vector2(1.0, 1.0),
    roughness: pair.roughness,
    metalness: 0.05,
    emissive: selected
      ? new THREE.Color('#22d3ee')
      : isEmber
      ? new THREE.Color('#ff6a18')
      : new THREE.Color('#000000'),
    emissiveIntensity: selected ? (isEmber ? 1.45 : 0.16) : isEmber ? 1.18 : 0,
  });
}

function selectMeshMaterial(
  mode: TextureMode,
  projectedMat: THREE.Material,
  fallbackMat: THREE.Material
): THREE.Material | THREE.Material[] {
  if (mode === 'projected') return projectedMat;
  if (mode === 'procedural') return fallbackMat;
  return [projectedMat, fallbackMat];
}

function buildOpenWorldHorizonRing(
  widthSpan: number,
  depthSpan: number,
  seed: number,
  kit?: IsoWorldKit | null
): THREE.BufferGeometry {
  const segs = 64;
  const rings = 6;
  const outerRadius = Math.max(widthSpan, depthSpan) * 1.65;
  const baseElevation = 0.35;

  const m = kit?.swatches.grass?.averageColor?.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  const grassC = m
    ? new THREE.Color(Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255)
    : new THREE.Color('#6a934c');
  const peakC = new THREE.Color('#6c8499');
  const tempC = new THREE.Color();

  const positions: number[] = [];
  const colors: number[] = [];
  const grid: { x: number; y: number; z: number; c: THREE.Color }[][] = [];

  for (let ri = 0; ri <= rings; ri++) {
    const t = ri / rings;
    const row: { x: number; y: number; z: number; c: THREE.Color }[] = [];
    for (let si = 0; si <= segs; si++) {
      const theta = (si / segs) * Math.PI * 2;
      const ca = Math.cos(theta);
      const sa = Math.sin(theta);
      const boxEdgeR =
        1 /
        Math.max(
          Math.abs(ca) / Math.max(1, widthSpan * 0.5),
          Math.abs(sa) / Math.max(1, depthSpan * 0.5)
        );
      const r0 = boxEdgeR * 0.97;
      const radius = r0 + (outerRadius - r0) * Math.pow(t, 1.35);
      const x = ca * radius;
      const z = sa * radius;

      const waveA = Math.sin(theta * 5 + seed * 0.31) * 0.5 + 0.5;
      const waveB = Math.cos(theta * 11 - seed * 0.77) * 0.5 + 0.5;
      const ridgeH =
        t === 0
          ? 0
          : Math.pow(t, 1.45) *
            Math.max(10, Math.min(36, Math.max(widthSpan, depthSpan) * 0.085)) *
            (0.35 + waveA * 0.45 + waveB * 0.35);

      const y = baseElevation + ridgeH;
      tempC.copy(grassC).lerp(peakC, Math.min(0.92, Math.pow(t, 0.85)));
      row.push({ x, y, z, c: tempC.clone() });
    }
    grid.push(row);
  }

  for (let ri = 0; ri < rings; ri++) {
    for (let si = 0; si < segs; si++) {
      const a = grid[ri][si];
      const b = grid[ri + 1][si];
      const c = grid[ri + 1][si + 1];
      const d = grid[ri][si + 1];

      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      colors.push(
        a.c.r, a.c.g, a.c.b,
        b.c.r, b.c.g, b.c.b,
        c.c.r, c.c.g, c.c.b
      );
      positions.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
      colors.push(
        a.c.r, a.c.g, a.c.b,
        c.c.r, c.c.g, c.c.b,
        d.c.r, d.c.g, d.c.b
      );
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  return geom;
}

export const Viewport3D: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const sceneData = useSceneStore((s) => s.scene);
  const worldKit = useSceneStore((s) => s.worldKit);
  const worldExpansion = useSceneStore((s) => s.worldExpansion);
  const activeSpriteUrl = useSceneStore((s) => s.activeSpriteUrl);
  const focusChunkTarget = useSceneStore((s) => s.focusChunkTarget);
  const chunkExportRequest = useSceneStore((s) => s.chunkExportRequest);
  const includeColliders = useSceneStore((s) => s.includeColliders);
  const targetEngine = useSceneStore((s) => s.targetEngine);
  const sourceImageUrl = useSceneStore((s) => s.sourceImageUrl);
  const heightField = useSceneStore((s) => s.heightField);
  const heightMapDataUrl = useSceneStore((s) => s.heightMapDataUrl);
  const normalMapDataUrl = useSceneStore((s) => s.normalMapDataUrl);
  const viewMode = useSceneStore((s) => s.viewMode);
  const tool = useSceneStore((s) => s.tool);
  const activePropType = useSceneStore((s) => s.activePropType);
  const selectedItem = useSceneStore((s) => s.selectedItem);
  const explorerFloor = useSceneStore((s) => s.explorerFloor);
  const explorerInsideName = useSceneStore((s) => s.explorerInsideName);
  const explorerInsideMaxFloors = useSceneStore((s) => s.explorerInsideMaxFloors);
  const explorerFollowCamera = useSceneStore((s) => s.explorerFollowCamera);
  const explorerNearbyDoor = useSceneStore((s) => s.explorerNearbyDoor);
  const showGrid = useSceneStore((s) => s.showGrid);
  const showReferenceOverlay = useSceneStore((s) => s.showReferenceOverlay);
  const showProjectedImage = useSceneStore((s) => s.showProjectedImage);
  const overlayOpacity = useSceneStore((s) => s.overlayOpacity);
  const snapRequestCount = useSceneStore((s) => s.snapRequestCount);
  const exportTrigger = useSceneStore((s) => s.exportTrigger);

  const addStructure = useSceneStore((s) => s.addStructure);
  const addProp = useSceneStore((s) => s.addProp);
  const setSelectedItem = useSceneStore((s) => s.setSelectedItem);
  const setStats = useSceneStore((s) => s.setStats);
  const setTool = useSceneStore((s) => s.setTool);
  const setExplorerFloor = useSceneStore((s) => s.setExplorerFloor);
  const setExplorerFollowCamera = useSceneStore((s) => s.setExplorerFollowCamera);
  const requestToggleDoor = useSceneStore((s) => s.requestToggleDoor);

  const [drawStart, setDrawStart] = useState<[number, number] | null>(null);
  const [polyPoints, setPolyPoints] = useState<[number, number][]>([]);
  const [hoverPoint, setHoverPoint] = useState<[number, number] | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [texVersion, setTexVersion] = useState(0);

  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const explorerStateRef = useRef<{
    pos: THREE.Vector3;
    target: THREE.Vector3 | null;
    yaw: number;
    activeClusterKey: string;
    activePrimaryId: string | null;
    lastClipY: number;
    lastSceneSig: string;
    keys: Set<string>;
    lastTimeMs: number;
    openDoorIds: Set<string>;
    openDoorVersion: number;
    doorAngles: Map<string, number>;
    pendingDoorId: string | null;
    lastHandledToggleNonce: number;
    nearbyDoorKey: string;
    stallFrames: number;
    cachedCollisionKey: string;
    cachedSegments: WallSegment2D[];
    cachedPropCircles: PropObstacleCircle[];
  }>({
    pos: new THREE.Vector3(0, 0.5, 0),
    target: null,
    yaw: 0,
    activeClusterKey: '',
    activePrimaryId: null,
    lastClipY: 100,
    lastSceneSig: '',
    keys: new Set(),
    lastTimeMs: 0,
    openDoorIds: new Set(),
    openDoorVersion: 0,
    doorAngles: new Map(),
    pendingDoorId: null,
    lastHandledToggleNonce: 0,
    nearbyDoorKey: '',
    stallFrames: 0,
    cachedCollisionKey: '',
    cachedSegments: [],
    cachedPropCircles: [],
  });

  const threeRef = useRef<{
    renderer: THREE.WebGLRenderer;
    threeScene: THREE.Scene;
    orbitCamera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    worldGroup: THREE.Group;
    previewGroup: THREE.Group;
    explorerGroup: THREE.Group;
    targetRingMesh: THREE.Mesh;
    doorRingMesh: THREE.Mesh;
    interiorClipPlane: THREE.Plane;
    structureRenderMap: Map<
      string,
      {
        def: StructureDef;
        roofMesh: THREE.Mesh | null;
        doorMesh: THREE.Mesh | null;
        doorBaseAngle: number;
        mats: THREE.Material[];
      }
    >;
    gridHelper: THREE.GridHelper;
    sunLight: THREE.DirectionalLight;
    ambientLight: THREE.HemisphereLight;
    torchLight: THREE.PointLight;
    sourceTexture: THREE.Texture | null;
    heightTexture: THREE.Texture | null;
    normalTexture: THREE.Texture | null;
    projectorHelper: THREE.CameraHelper | null;
  } | null>(null);

  // Inicialização única do contexto WebGL/Three.js
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);

    const threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color('#8ab0cf');

    const orbitCamera = new THREE.PerspectiveCamera(44, width / height, 0.1, 2600);
    orbitCamera.position.set(22, 19, 22);

    const controls = new OrbitControls(orbitCamera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxDistance = 680;
    controls.maxPolarAngle = Math.PI * 0.49;

    const ambientLight = new THREE.HemisphereLight('#d6e6ff', '#2c2520', 0.65);
    threeScene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight('#fff5e4', 1.8);
    sunLight.position.set(18, 28, 16);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 2;
    sunLight.shadow.camera.far = 90;
    const sc = 22;
    sunLight.shadow.camera.left = -sc;
    sunLight.shadow.camera.right = sc;
    sunLight.shadow.camera.top = sc;
    sunLight.shadow.camera.bottom = -sc;
    sunLight.shadow.bias = -0.0005;
    threeScene.add(sunLight);

    const torchLight = new THREE.PointLight('#ff9640', 2.4, 16, 1.5);
    torchLight.position.set(0, 3.5, 0);
    threeScene.add(torchLight);

    const gridHelper = new THREE.GridHelper(32, 32, '#3b82f6', '#27272a');
    gridHelper.position.y = 0.015;
    threeScene.add(gridHelper);

    const worldGroup = new THREE.Group();
    threeScene.add(worldGroup);

    const previewGroup = new THREE.Group();
    threeScene.add(previewGroup);

    // Avatar em escala humana (~1.72m) para Modo Exploração
    const explorerGroup = new THREE.Group();
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.28, 1.18, 14),
      new THREE.MeshStandardMaterial({ color: '#38bdf8', roughness: 0.45, metalness: 0.12 })
    );
    torso.position.y = 0.61;
    torso.castShadow = true;
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.29, 0.18, 14),
      new THREE.MeshStandardMaterial({ color: '#1e3a8a', roughness: 0.55 })
    );
    collar.position.y = 1.08;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 14, 12),
      new THREE.MeshStandardMaterial({ color: '#f4c7a1', roughness: 0.55 })
    );
    head.position.y = 1.44;
    head.castShadow = true;
    const baseRing = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.56, 24),
      new THREE.MeshBasicMaterial({
        color: '#22d3ee',
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.88,
      })
    );
    baseRing.rotation.x = -Math.PI / 2;
    baseRing.position.y = 0.04;
    const facingCone = new THREE.Mesh(
      new THREE.ConeGeometry(0.14, 0.34, 4),
      new THREE.MeshBasicMaterial({ color: '#fde047' })
    );
    facingCone.rotation.x = Math.PI / 2;
    facingCone.position.set(0, 0.12, 0.56);
    explorerGroup.add(torso, collar, head, baseRing, facingCone);
    explorerGroup.visible = false;
    threeScene.add(explorerGroup);

    const targetRingMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.5, 24),
      new THREE.MeshBasicMaterial({
        color: '#38bdf8',
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      })
    );
    targetRingMesh.rotation.x = -Math.PI / 2;
    targetRingMesh.visible = false;
    threeScene.add(targetRingMesh);

    const doorRingMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.36, 0.52, 20),
      new THREE.MeshBasicMaterial({
        color: '#fbbf24',
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      })
    );
    doorRingMesh.rotation.x = -Math.PI / 2;
    doorRingMesh.visible = false;
    threeScene.add(doorRingMesh);

    const interiorClipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);
    const structureRenderMap = new Map<
      string,
      {
        def: StructureDef;
        roofMesh: THREE.Mesh | null;
        doorMesh: THREE.Mesh | null;
        doorBaseAngle: number;
        mats: THREE.Material[];
      }
    >();

    threeRef.current = {
      renderer,
      threeScene,
      orbitCamera,
      controls,
      worldGroup,
      previewGroup,
      explorerGroup,
      targetRingMesh,
      doorRingMesh,
      interiorClipPlane,
      structureRenderMap,
      gridHelper,
      sunLight,
      ambientLight,
      torchLight,
      sourceTexture: null,
      heightTexture: null,
      normalTexture: null,
      projectorHelper: null,
    };

    const camForwardXZ = new THREE.Vector3();
    const camRightXZ = new THREE.Vector3();
    const upVec = new THREE.Vector3(0, 1, 0);

    let rafId = 0;
    const renderLoop = (nowMs: number) => {
      rafId = requestAnimationFrame(renderLoop);
      const state = useSceneStore.getState();
      const ref = threeRef.current;
      if (!ref) return;

      const exp = explorerStateRef.current;
      const dt =
        exp.lastTimeMs > 0 ? Math.min(0.05, (nowMs - exp.lastTimeMs) / 1000) : 0.016;
      exp.lastTimeMs = nowMs;

      const allStructures = state.worldExpansion
        ? [...state.scene.structures, ...state.worldExpansion.worldStructures]
        : state.scene.structures;
      const allProps = state.worldExpansion
        ? [...state.scene.props, ...state.worldExpansion.worldProps]
        : state.scene.props;

      if (state.tool === 'explore') {
        const sceneSig = `${state.scene.meta.name}:${state.scene.terrain.width}:${state.scene.terrain.depth}:${state.scene.structures.length}:${state.scene.props.length}`;
        if (exp.lastSceneSig !== sceneSig) {
          exp.lastSceneSig = sceneSig;
          const [sx, sz] = findDefaultSpawnXZ(state.scene, allStructures, allProps);
          exp.pos.set(sx, 0.5, sz);
          exp.target = null;
          exp.activeClusterKey = '';
          exp.activePrimaryId = null;
          exp.openDoorIds.clear();
          exp.doorAngles.clear();
          exp.openDoorVersion++;
          exp.pendingDoorId = null;
          exp.nearbyDoorKey = '';
          exp.stallFrames = 0;
        }

        // Processa solicitação de abertura/fechamento de porta vinda da UI/Atalho
        if (
          state.doorToggleRequest &&
          state.doorToggleRequest.nonce !== exp.lastHandledToggleNonce
        ) {
          exp.lastHandledToggleNonce = state.doorToggleRequest.nonce;
          const dId = state.doorToggleRequest.id;
          if (exp.openDoorIds.has(dId)) exp.openDoorIds.delete(dId);
          else exp.openDoorIds.add(dId);
          exp.openDoorVersion++;
        }

        ref.explorerGroup.visible = true;
        const moveSpeed = Math.max(
          5.5,
          Math.min(11, state.scene.terrain.depth * 0.14)
        );
        const spanMult = state.worldExpansion
          ? state.worldExpansion.gridRadius * 2 + 1
          : 1;
        const limitX = state.scene.terrain.width * spanMult * 0.5 - 0.5;
        const limitZ = state.scene.terrain.depth * spanMult * 0.5 - 0.5;

        let moveX = 0;
        let moveZ = 0;

        // Suporte WASD / Setas relativo à câmera
        if (exp.keys.size > 0) {
          ref.orbitCamera.getWorldDirection(camForwardXZ);
          camForwardXZ.y = 0;
          if (camForwardXZ.lengthSq() < 1e-6) camForwardXZ.set(0, 0, -1);
          camForwardXZ.normalize();
          camRightXZ.crossVectors(camForwardXZ, upVec).normalize();

          let kx = 0;
          let kz = 0;
          if (exp.keys.has('w') || exp.keys.has('arrowup')) kz += 1;
          if (exp.keys.has('s') || exp.keys.has('arrowdown')) kz -= 1;
          if (exp.keys.has('d') || exp.keys.has('arrowright')) kx += 1;
          if (exp.keys.has('a') || exp.keys.has('arrowleft')) kx -= 1;
          const kLen = Math.hypot(kx, kz);
          if (kLen > 0) {
            exp.target = null;
            exp.pendingDoorId = null;
            exp.stallFrames = 0;
            const dirX = (camForwardXZ.x * kz + camRightXZ.x * kx) / kLen;
            const dirZ = (camForwardXZ.z * kz + camRightXZ.z * kx) / kLen;
            moveX = dirX * moveSpeed * dt;
            moveZ = dirZ * moveSpeed * dt;
          }
        } else if (exp.target) {
          const dx = exp.target.x - exp.pos.x;
          const dz = exp.target.z - exp.pos.z;
          const dist = Math.hypot(dx, dz);
          if (dist <= 0.16) {
            exp.pos.x = exp.target.x;
            exp.pos.z = exp.target.z;
            exp.target = null;
            exp.stallFrames = 0;
          } else {
            const step = Math.min(dist, moveSpeed * dt);
            moveX = (dx / dist) * step;
            moveZ = (dz / dist) * step;
          }
        }

        // Cache de segmentos de colisão de paredes + móveis/props internos e externos
        const colKey = `${sceneSig}:${allStructures.length}:${allProps.length}:${exp.openDoorVersion}`;
        if (exp.cachedCollisionKey !== colKey) {
          exp.cachedCollisionKey = colKey;
          const propObs = extractPropCollisionObstacles(allProps);
          exp.cachedSegments = [
            ...extractCollisionSegments(allStructures, exp.openDoorIds),
            ...propObs.segments,
          ];
          exp.cachedPropCircles = propObs.circles;
        }

        const prevX = exp.pos.x;
        const prevZ = exp.pos.z;
        const clampedNextX = Math.max(-limitX, Math.min(limitX, prevX + moveX));
        const clampedNextZ = Math.max(-limitZ, Math.min(limitZ, prevZ + moveZ));
        const [resolvedX, resolvedZ] = resolveMovementWithCollisions(
          prevX,
          prevZ,
          clampedNextX,
          clampedNextZ,
          0.25,
          exp.cachedSegments,
          exp.cachedPropCircles
        );
        exp.pos.x = resolvedX;
        exp.pos.z = resolvedZ;
        const actualDx = resolvedX - prevX;
        const actualDz = resolvedZ - prevZ;
        const movedDist = Math.hypot(actualDx, actualDz);

        if (exp.target && movedDist < 0.008 && Math.hypot(moveX, moveZ) > 0.02) {
          exp.stallFrames++;
          if (exp.stallFrames > 18) {
            exp.target = null;
            exp.stallFrames = 0;
          }
        } else {
          exp.stallFrames = 0;
        }

        if (movedDist > 1e-3) {
          exp.yaw = Math.atan2(actualDx, actualDz);
          if (state.explorerFollowCamera && state.viewMode === 'orbit') {
            ref.controls.target.x += actualDx;
            ref.controls.target.z += actualDz;
            ref.orbitCamera.position.x += actualDx;
            ref.orbitCamera.position.z += actualDz;
          }
        }

        // Detecção de porta pendente ao clicar de longe e proximidade interativa
        const nearDoor = findNearestInteractiveDoor(
          exp.pos.x,
          exp.pos.z,
          allStructures,
          exp.openDoorIds,
          2.85
        );
        if (exp.pendingDoorId && nearDoor?.structure.id === exp.pendingDoorId) {
          if (!exp.openDoorIds.has(exp.pendingDoorId)) {
            exp.openDoorIds.add(exp.pendingDoorId);
            exp.openDoorVersion++;
          }
          exp.pendingDoorId = null;
          exp.target = null;
        }

        const nextDoorKey = nearDoor
          ? `${nearDoor.structure.id}:${nearDoor.isOpen ? '1' : '0'}`
          : '';
        if (nextDoorKey !== exp.nearbyDoorKey) {
          exp.nearbyDoorKey = nextDoorKey;
          state.setExplorerNearbyDoor(
            nearDoor
              ? {
                  id: nearDoor.structure.id,
                  name: nearDoor.structure.name,
                  isOpen: nearDoor.isOpen,
                }
              : null
          );
        }

        // Animação suave de giro das dobradiças de porta (0° <-> 88°)
        for (const [id, entry] of ref.structureRenderMap) {
          if (!entry.doorMesh) continue;
          const targetAngle = exp.openDoorIds.has(id) ? 1.54 : 0;
          const cur = exp.doorAngles.get(id) ?? 0;
          const next = THREE.MathUtils.lerp(cur, targetAngle, Math.min(1, dt * 10));
          exp.doorAngles.set(id, next);
          entry.doorMesh.rotation.y = entry.doorBaseAngle + next;
        }

        // Detecção de entrada em estrutura + Clip de Interior (Baldur's Gate / The Sims)
        const { primary, clusterIds } = findEnteredInteriorCluster(
          exp.pos.x,
          exp.pos.z,
          allStructures,
          0.02
        );
        const groundY = sampleWalkableElevation(
          exp.pos.x,
          exp.pos.z,
          state.scene,
          state.heightField,
          state.explorerFloor,
          primary,
          allStructures,
          state.worldExpansion?.chunks ?? []
        );
        exp.pos.y = THREE.MathUtils.lerp(exp.pos.y, groundY, 0.38);

        ref.explorerGroup.position.copy(exp.pos);
        ref.explorerGroup.rotation.y = exp.yaw;

        if (exp.target) {
          ref.targetRingMesh.visible = true;
          ref.targetRingMesh.position.set(exp.target.x, exp.pos.y + 0.06, exp.target.z);
          const pulse = 0.92 + 0.16 * Math.sin(nowMs * 0.008);
          ref.targetRingMesh.scale.setScalar(pulse);
        } else {
          ref.targetRingMesh.visible = false;
        }

        if (nearDoor) {
          ref.doorRingMesh.visible = true;
          ref.doorRingMesh.position.set(
            nearDoor.doorInfo.centerXZ[0],
            nearDoor.structure.baseElevation + 0.08,
            nearDoor.doorInfo.centerXZ[1]
          );
          const dPulse = 0.95 + 0.14 * Math.sin(nowMs * 0.007);
          ref.doorRingMesh.scale.setScalar(dPulse);
        } else {
          ref.doorRingMesh.visible = false;
        }

        if (state.scene.lighting.torchEnabled) {
          ref.torchLight.position.set(exp.pos.x, exp.pos.y + 2.4, exp.pos.z);
        }

        if (exp.activePrimaryId !== (primary?.id ?? null)) {
          exp.activePrimaryId = primary?.id ?? null;
          state.setExplorerInside(primary?.name ?? null, primary?.floors ?? 1);
        }

        const clipY = primary
          ? primary.baseElevation +
            Math.max(
              0,
              Math.min(Math.max(1, Math.round(primary.floors)) - 1, state.explorerFloor - 1)
            ) *
              primary.floorHeight +
            Math.min(1.42, primary.floorHeight * 0.62)
          : 100;
        const clusterKey = Array.from(clusterIds).sort().join(',');
        if (
          clusterKey !== exp.activeClusterKey ||
          Math.abs(clipY - exp.lastClipY) > 1e-3
        ) {
          exp.activeClusterKey = clusterKey;
          exp.lastClipY = clipY;
          ref.interiorClipPlane.constant = clipY;

          for (const [id, entry] of ref.structureRenderMap) {
            const inside = clusterIds.has(id);
            if (entry.roofMesh) {
              entry.roofMesh.visible = inside ? false : !entry.def.hideRoof;
            }
            for (const m of entry.mats) {
              m.clippingPlanes = inside ? [ref.interiorClipPlane] : [];
              m.clipShadows = inside;
            }
          }
        }
      } else {
        if (ref.explorerGroup.visible) {
          ref.explorerGroup.visible = false;
          ref.targetRingMesh.visible = false;
          ref.doorRingMesh.visible = false;
          const hearth = state.scene.props.find(
            (p) => p.visible && (p.generator === 'fireplace' || p.generator === 'brazier')
          );
          if (state.scene.worldGrammar.environmentMode === 'interior' && hearth) {
            ref.torchLight.position.set(hearth.position[0], hearth.position[1] + 1.55, hearth.position[2] + 1.15);
          } else {
            ref.torchLight.position.set(0, 3.5, 0);
          }
          if (exp.nearbyDoorKey !== '') {
            exp.nearbyDoorKey = '';
            state.setExplorerNearbyDoor(null);
          }
          if (exp.activeClusterKey !== '' || exp.activePrimaryId !== null) {
            exp.activeClusterKey = '';
            exp.activePrimaryId = null;
            state.setExplorerInside(null, 1);
            for (const [, entry] of ref.structureRenderMap) {
              if (entry.roofMesh) {
                entry.roofMesh.visible = !entry.def.hideRoof;
              }
              for (const m of entry.mats) {
                m.clippingPlanes = [];
              }
            }
          }
        }
      }

      const w = container.clientWidth || 800;
      const h = container.clientHeight || 600;
      const aspect = w / h;

      if (state.viewMode === 'projector') {
        const projCam = createProjectorCamera(state.scene.projection, aspect);
        ref.renderer.render(ref.threeScene, projCam);
      } else {
        ref.controls.update();
        ref.renderer.render(ref.threeScene, ref.orbitCamera);
      }
    };
    renderLoop(0);

    const resizeObserver = new ResizeObserver(() => {
      if (!container || !threeRef.current) return;
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 600;
      threeRef.current.orbitCamera.aspect = w / h;
      threeRef.current.orbitCamera.updateProjectionMatrix();
      threeRef.current.renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      controls.dispose();
      disposeObjectTree(worldGroup);
      disposeObjectTree(previewGroup);
      disposeObjectTree(explorerGroup);
      disposeObjectTree(targetRingMesh);
      disposeObjectTree(doorRingMesh);
      threeRef.current?.sourceTexture?.dispose();
      threeRef.current?.heightTexture?.dispose();
      threeRef.current?.normalTexture?.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      threeRef.current = null;
    };
  }, []);

  // Carrega textura da imagem original
  useEffect(() => {
    const ref = threeRef.current;
    if (!ref || !sourceImageUrl) return;
    const loader = new THREE.TextureLoader();
    loader.load(sourceImageUrl, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.anisotropy = Math.min(8, ref.renderer.capabilities.getMaxAnisotropy());
      tex.needsUpdate = true;
      ref.sourceTexture?.dispose();
      ref.sourceTexture = tex;
      setTexVersion((v) => v + 1);
    });
  }, [sourceImageUrl]);

  // Carrega textura de Heightmap (Displacement)
  useEffect(() => {
    const ref = threeRef.current;
    if (!ref || !heightMapDataUrl) return;
    const loader = new THREE.TextureLoader();
    loader.load(heightMapDataUrl, (tex) => {
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      ref.heightTexture?.dispose();
      ref.heightTexture = tex;
      setTexVersion((v) => v + 1);
    });
  }, [heightMapDataUrl]);

  // Carrega textura de Normal Map
  useEffect(() => {
    const ref = threeRef.current;
    if (!ref || !normalMapDataUrl) return;
    const loader = new THREE.TextureLoader();
    loader.load(normalMapDataUrl, (tex) => {
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      ref.normalTexture?.dispose();
      ref.normalTexture = tex;
      setTexVersion((v) => v + 1);
    });
  }, [normalMapDataUrl]);

  // Sincroniza iluminação e visibilidade de grid
  useEffect(() => {
    const ref = threeRef.current;
    if (!ref) return;
    const l = sceneData.lighting;
    ref.gridHelper.visible = showGrid;

    const az = THREE.MathUtils.degToRad(l.sunAzimuthDeg);
    const el = THREE.MathUtils.degToRad(l.sunElevationDeg);
    const dist = 34;
    ref.sunLight.position.set(
      Math.cos(el) * Math.sin(az) * dist,
      Math.sin(el) * dist,
      Math.cos(el) * Math.cos(az) * dist
    );
    ref.sunLight.intensity = l.sunIntensity;
    ref.ambientLight.intensity = l.ambientIntensity;
    ref.torchLight.visible = l.torchEnabled;
    ref.torchLight.intensity = l.torchIntensity;
    ref.torchLight.color.set(l.torchColor);
  }, [sceneData.lighting, showGrid]);

  // Ajusta câmera Orbit para enxergar ângulo 3D favorecido (adaptado à escala Pequeno/Médio/Grande)
  useEffect(() => {
    const ref = threeRef.current;
    if (!ref || snapRequestCount === 0) return;
    const p = sceneData.projection;
    const effectivePitch = p.pitchDeg > 80 ? 58 : p.pitchDeg;
    const effectiveYaw = p.pitchDeg > 80 ? 28 : p.yawDeg;
    const pitchRad = THREE.MathUtils.degToRad(Math.min(89, Math.max(5, effectivePitch)));
    const yawRad = THREE.MathUtils.degToRad(effectiveYaw);
    const scaleMult =
      sceneData.worldGrammar.scale === 'large'
        ? 4.0
        : sceneData.worldGrammar.scale === 'medium'
        ? 2.6
        : 1.5;
    const dist = Math.max(14, p.orthoScale * scaleMult);
    const horiz = Math.cos(pitchRad) * dist;
    ref.orbitCamera.position.set(
      p.offsetX + Math.sin(yawRad) * horiz,
      Math.sin(pitchRad) * dist,
      p.offsetY + Math.cos(yawRad) * horiz
    );
    ref.controls.target.set(p.offsetX, 0, p.offsetY);
    ref.controls.update();
  }, [snapRequestCount]);

  // Compila cena procedural IsoDSL -> Three.js sempre que o DSL ou mapas mudarem
  useEffect(() => {
    const ref = threeRef.current;
    if (!ref) return;

    disposeObjectTree(ref.worldGroup);
    ref.worldGroup.clear();
    ref.structureRenderMap.clear();
    explorerStateRef.current.activeClusterKey = '';

    const aspect = sceneData.meta.aspectRatio || 1.6;
    const projector = createProjectorCamera(sceneData.projection, aspect);
    const identity = new THREE.Matrix4();
    const effectiveTerrainMode = getEffectiveTextureMode(
      sceneData,
      sceneData.terrain.textureMode
    );
    const visibleTerrainMode = showProjectedImage
      ? effectiveTerrainMode
      : 'procedural';
    const resolveVisibleTextureMode = (requested: TextureMode): TextureMode =>
      showProjectedImage
        ? getEffectiveTextureMode(sceneData, requested)
        : 'procedural';

    // 1. Terreno com Displacement assado na malha + Normal Map (alinha 1:1 com chunks vizinhos)
    const terrainRaw = buildTerrainBaseGeometry(sceneData.terrain);
    if (heightField) {
      bakeTerrainDisplacementIntoGeometry(
        terrainRaw,
        heightField,
        sceneData.terrain.displacementScale
      );
    }
    const terrainGeom = bakeProjectedUVs(terrainRaw, identity, projector, {
      textureMode: visibleTerrainMode,
      proceduralTileScale: 0.25,
    });
    terrainRaw.dispose();

    const terrainProjectedMat = new THREE.MeshStandardMaterial({
      map: showProjectedImage ? ref.sourceTexture : null,
      color: showProjectedImage && ref.sourceTexture ? '#ffffff' : '#3a4a35',
      normalMap: ref.normalTexture,
      normalScale: new THREE.Vector2(
        sceneData.terrain.normalStrength * 0.45,
        sceneData.terrain.normalStrength * 0.45
      ),
      displacementMap: heightField ? null : ref.heightTexture,
      displacementScale: heightField ? 0 : sceneData.terrain.displacementScale,
      roughness: 0.88,
      metalness: 0.04,
    });
    const terrainFallbackMat = makeFallbackMaterial(
      sceneData.terrain.fallbackMaterial,
      false,
      worldKit
    );
    terrainFallbackMat.displacementMap = heightField ? null : ref.heightTexture;
    terrainFallbackMat.displacementScale = heightField ? 0 : sceneData.terrain.displacementScale;

    const terrainMesh = new THREE.Mesh(
      terrainGeom,
      selectMeshMaterial(
        visibleTerrainMode,
        terrainProjectedMat,
        terrainFallbackMat
      )
    );
    terrainMesh.castShadow = true;
    terrainMesh.receiveShadow = true;
    terrainMesh.name = 'Terrain';
    terrainMesh.userData = { walkSurface: 'terrain' };
    ref.worldGroup.add(terrainMesh);

    // Atmosfera adaptada ao modo de ambiente: céu aberto vs interior íntimo (sem montanhas/árvores fora)
    const isInterior = sceneData.worldGrammar.environmentMode === 'interior';
    ref.threeScene.background = new THREE.Color(isInterior ? '#0d0907' : '#8ab0cf');

    const spanMult = worldExpansion ? worldExpansion.gridRadius * 2 + 1 : 3;
    const worldWidthSpan = sceneData.terrain.width * spanMult;
    const worldDepthSpan = sceneData.terrain.depth * spanMult;
    const fogNear = Math.max(48, Math.min(worldWidthSpan, worldDepthSpan) * 0.72);
    const fogFar = Math.max(160, Math.max(worldWidthSpan, worldDepthSpan) * 1.95);
    ref.threeScene.fog = new THREE.Fog(
      isInterior ? '#120c09' : '#8fb3cf',
      isInterior ? fogNear * 0.85 : fogNear,
      isInterior ? fogFar * 1.4 : fogFar
    );

    if (!isInterior) {
      const horizonGeom = buildOpenWorldHorizonRing(
        worldWidthSpan,
        worldDepthSpan,
        sceneData.worldGrammar.seed,
        worldKit
      );
      const horizonMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.96,
        metalness: 0.0,
        side: THREE.DoubleSide,
      });
      const horizonMesh = new THREE.Mesh(horizonGeom, horizonMat);
      horizonMesh.receiveShadow = false;
      horizonMesh.name = 'OpenWorld_Horizon';
      ref.worldGroup.add(horizonMesh);
    }

    const baseHalf = Math.max(22, Math.max(sceneData.terrain.width, sceneData.terrain.depth) * 0.58);
    const shadowHalf = Math.min(130, baseHalf * Math.min(2.2, Math.max(1, spanMult * 0.52)));
    ref.sunLight.shadow.camera.left = -shadowHalf;
    ref.sunLight.shadow.camera.right = shadowHalf;
    ref.sunLight.shadow.camera.top = shadowHalf;
    ref.sunLight.shadow.camera.bottom = -shadowHalf;
    ref.sunLight.shadow.camera.far = 260;
    ref.sunLight.shadow.camera.updateProjectionMatrix();
    ref.torchLight.distance = isInterior
      ? Math.max(22, sceneData.terrain.depth * 1.45)
      : Math.max(18, baseHalf * 0.65);

    const hearthProp = sceneData.props.find(
      (p) => p.visible && (p.generator === 'fireplace' || p.generator === 'brazier')
    );
    if (isInterior && hearthProp) {
      ref.torchLight.position.set(
        hearthProp.position[0],
        hearthProp.position[1] + 1.55,
        hearthProp.position[2] + 1.15
      );
    } else if (!isInterior) {
      ref.torchLight.position.set(0, 3.5, 0);
    }

    // Plano de água opcional estendido até o horizonte de mundo aberto
    const hasReconstructedWater =
      visibleTerrainMode === 'procedural' &&
      Boolean(sceneData.terrainFeatures?.some((feature) => feature.kind === 'water'));
    if (sceneData.terrain.waterEnabled && !hasReconstructedWater) {
      const waterGeom = new THREE.PlaneGeometry(
        worldWidthSpan * 2.8,
        worldDepthSpan * 2.8
      );
      waterGeom.rotateX(-Math.PI / 2);
      const waterMat = new THREE.MeshStandardMaterial({
        color: '#256c8f',
        roughness: 0.14,
        metalness: 0.12,
        transparent: true,
        opacity: 0.76,
      });
      const waterMesh = new THREE.Mesh(waterGeom, waterMat);
      waterMesh.position.y = sceneData.terrain.waterElevation;
      waterMesh.receiveShadow = true;
      ref.worldGroup.add(waterMesh);
    }

    // Faixas vetoriais de terreno reconstruído (rios/estradas) aparecem somente no modo
    // puramente procedural; no modo híbrido a imagem pintada já exibe estradas e margens nativas.
    for (const feature of effectiveTerrainMode === 'procedural' ? sceneData.terrainFeatures ?? [] : []) {
      const featureGeom = buildTerrainFeatureGeometry(feature);
      if (!featureGeom) continue;
      const preset =
        feature.material ??
        (feature.kind === 'water'
          ? 'water_surface'
          : feature.kind === 'road'
          ? 'road_dirt'
          : sceneData.terrain.fallbackMaterial);
      const featureMat = makeFallbackMaterial(preset, false, worldKit);
      featureMat.transparent = feature.kind === 'water';
      if (feature.kind === 'water') featureMat.opacity = 0.84;
      if (feature.kind === 'road' && feature.elevation < sceneData.terrain.displacementScale * 0.42) {
        featureGeom.translate(
          0,
          sceneData.terrain.displacementScale * 0.46 - feature.elevation,
          0
        );
      }
      const featureMesh = new THREE.Mesh(featureGeom, featureMat);
      featureMesh.name = `Reconstructed_${feature.kind}_${feature.id}`;
      featureMesh.receiveShadow = true;
      featureMesh.userData = {
        walkSurface: feature.kind === 'road' ? 'road' : 'water',
      };
      ref.worldGroup.add(featureMesh);
    }

    // Faixas vetoriais de portais WFC só são necessárias no modo puramente procedural;
    // no modo híbrido a própria textura/relevo do chunk + plano de água desenham estradas e rios sem costura.
    if (effectiveTerrainMode === 'procedural') {
      for (const chunk of worldExpansion?.chunks ?? []) {
        for (const segment of chunk.segments) {
          const segmentFeature = {
            id: `chunk_${chunk.gx}_${chunk.gz}_${segment.kind}_${segment.x0}_${segment.z0}`,
            kind: segment.kind,
            points: [[segment.x0, segment.z0], [segment.x1, segment.z1]] as [number, number][],
            width: segment.width,
            elevation:
              segment.kind === 'water'
                ? sceneData.terrain.waterElevation
                : sceneData.terrain.displacementScale * 0.46,
            material: segment.kind === 'water' ? 'water_surface' as const : 'road_dirt' as const,
            visible: true,
          };
          const segmentGeom = buildTerrainFeatureGeometry(segmentFeature);
          if (!segmentGeom) continue;
          const segmentMat = makeFallbackMaterial(
            segmentFeature.material,
            false,
            worldKit
          );
          segmentMat.transparent = segment.kind === 'water';
          if (segment.kind === 'water') segmentMat.opacity = 0.84;
          const segmentMesh = new THREE.Mesh(segmentGeom, segmentMat);
          segmentMesh.name = segmentFeature.id;
          segmentMesh.receiveShadow = true;
          ref.worldGroup.add(segmentMesh);
        }
      }
    }

    // 1b. Chunks expandidos (Médio 3x3 / Grande 7x7 com Swatches absorvidos e LOD)
    if (worldExpansion && worldExpansion.gridRadius > 0) {
      for (const chunk of worldExpansion.chunks) {
        if (chunk.isAnchor) continue;
        const cGeom = new THREE.PlaneGeometry(
          chunk.width,
          chunk.depth,
          chunk.subdivisions,
          chunk.subdivisions
        );
        cGeom.rotateX(-Math.PI / 2);
        if (chunk.heightField && chunk.heightWidth && chunk.heightHeight) {
          bakeTerrainDisplacementIntoGeometry(
            cGeom,
            {
              macroHeight: chunk.heightField,
              rawLuminance: chunk.heightField,
              width: chunk.heightWidth,
              height: chunk.heightHeight,
            },
            sceneData.terrain.displacementScale
          );
        }

        let cMat: THREE.MeshStandardMaterial;
        if (chunk.albedoRgba && chunk.heightWidth && chunk.heightHeight) {
          const albedoTex = new THREE.DataTexture(
            chunk.albedoRgba,
            chunk.heightWidth,
            chunk.heightHeight,
            THREE.RGBAFormat
          );
          albedoTex.flipY = true;
          albedoTex.colorSpace = THREE.SRGBColorSpace;
          albedoTex.magFilter = THREE.LinearFilter;
          albedoTex.minFilter = THREE.LinearMipmapLinearFilter;
          albedoTex.anisotropy = ref.renderer.capabilities.getMaxAnisotropy();
          albedoTex.generateMipmaps = true;
          albedoTex.needsUpdate = true;

          let normalTex: THREE.DataTexture | null = null;
          if (chunk.normalRgba) {
            normalTex = new THREE.DataTexture(
              chunk.normalRgba,
              chunk.heightWidth,
              chunk.heightHeight,
              THREE.RGBAFormat
            );
            normalTex.flipY = true;
            normalTex.magFilter = THREE.LinearFilter;
            normalTex.minFilter = THREE.LinearMipmapLinearFilter;
            normalTex.anisotropy = ref.renderer.capabilities.getMaxAnisotropy();
            normalTex.generateMipmaps = true;
            normalTex.needsUpdate = true;
          }

          cMat = new THREE.MeshStandardMaterial({
            map: albedoTex,
            normalMap: normalTex,
            normalScale: new THREE.Vector2(1.28, 1.28),
            roughness: 0.86,
            metalness: 0.03,
          });
          cMat.userData.ownsTextures = true;
        } else {
          cMat = makeFallbackMaterial(
            sceneData.terrain.fallbackMaterial,
            false,
            worldKit
          );
        }

        const cMesh = new THREE.Mesh(cGeom, cMat);
        cMesh.position.set(chunk.centerX, 0, chunk.centerZ);
        cMesh.receiveShadow = true;
        cMesh.name = `Chunk_${chunk.gx}_${chunk.gz}`;
        cMesh.userData = { walkSurface: 'terrain' };
        ref.worldGroup.add(cMesh);
      }
    }

    // 2. Estruturas procedurais (Âncora + POIs gerados no mundo: pontes, torres, cabanas, ruínas)
    const sharedMatCache = new Map<string, THREE.MeshStandardMaterial>();
    const getSharedFallback = (preset: MaterialPreset, doubleSide = false) => {
      const key = `${preset}:${doubleSide ? '2' : '1'}`;
      let mat = sharedMatCache.get(key);
      if (!mat) {
        mat = makeFallbackMaterial(preset, false, worldKit);
        if (doubleSide) mat.side = THREE.DoubleSide;
        sharedMatCache.set(key, mat);
      }
      return mat;
    };

    const renderStructures = worldExpansion
      ? [...sceneData.structures, ...worldExpansion.worldStructures]
      : sceneData.structures;

    for (const st of renderStructures) {
      if (!st.visible) continue;
      const isSelected =
        selectedItem?.kind === 'structure' && selectedItem.id === st.id;
      const clippableMats: THREE.Material[] = [];

      const wallTexMode = resolveSurfaceTextureMode(
        resolveVisibleTextureMode(st.textureMode),
        'wall',
        sceneData.projection.pitchDeg,
        st.semanticTag
      );
      const hasInteriorWalls =
        st.semanticTag === 'building' || st.semanticTag === 'tower';

      const makeProjMat = (doubleSide = false) =>
        new THREE.MeshStandardMaterial({
          map: ref.sourceTexture,
          color: ref.sourceTexture ? '#ffffff' : '#a1a1aa',
          normalMap: ref.normalTexture,
          normalScale: new THREE.Vector2(0.25, 0.25),
          roughness: 0.82,
          metalness: 0.05,
          side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
          emissive: isSelected ? new THREE.Color('#22d3ee') : new THREE.Color('#000000'),
          emissiveIntensity: isSelected ? 0.18 : 0,
        });

      const archBundle = buildStructureArchitectureBundle(st);
      const wallsGeom = bakeProjectedUVs(archBundle.wallsGeom, identity, projector, {
        textureMode: wallTexMode,
      });
      archBundle.wallsGeom.dispose();

      const wallFallback =
        !hasInteriorWalls && !isSelected
          ? getSharedFallback(st.fallbackMaterial, false)
          : makeFallbackMaterial(st.fallbackMaterial, isSelected, worldKit);
      if (hasInteriorWalls) {
        wallFallback.side = THREE.DoubleSide;
      }
      const wallProj =
        wallTexMode === 'procedural' ? wallFallback : makeProjMat(hasInteriorWalls);
      const wallsMaterial = selectMeshMaterial(wallTexMode, wallProj, wallFallback);
      if (Array.isArray(wallsMaterial)) clippableMats.push(...wallsMaterial);
      else clippableMats.push(wallsMaterial);

      const wallsMesh = new THREE.Mesh(wallsGeom, wallsMaterial);
      wallsMesh.castShadow = true;
      wallsMesh.receiveShadow = true;
      wallsMesh.userData = {
        pickKind: 'structure',
        pickId: st.id,
        ...(st.semanticTag === 'bridge' || st.semanticTag === 'platform'
          ? { walkSurface: 'bridge' }
          : {}),
      };
      ref.worldGroup.add(wallsMesh);

      if (archBundle.floorSlabsGeom) {
        const slabsGeom = bakeProjectedUVs(
          archBundle.floorSlabsGeom,
          identity,
          projector,
          { textureMode: 'procedural', proceduralTileScale: 0.5 }
        );
        archBundle.floorSlabsGeom.dispose();
        const floorPreset =
          st.floorStyle === 'stone_tile' ? 'cobblestone' : 'wood_plank';
        const slabsMat = makeFallbackMaterial(floorPreset, isSelected, worldKit);
        slabsMat.side = THREE.DoubleSide;
        clippableMats.push(slabsMat);
        const slabsMesh = new THREE.Mesh(slabsGeom, slabsMat);
        slabsMesh.receiveShadow = true;
        slabsMesh.userData = {
          pickKind: 'structure',
          pickId: st.id,
          walkSurface: 'floor',
        };
        ref.worldGroup.add(slabsMesh);
      }

      if (archBundle.projectedGroundFloorGeom) {
        const groundFloorMode: TextureMode = showProjectedImage
          ? 'projected'
          : 'procedural';
        const projFloorGeom = bakeProjectedUVs(
          archBundle.projectedGroundFloorGeom,
          identity,
          projector,
          { textureMode: groundFloorMode }
        );
        archBundle.projectedGroundFloorGeom.dispose();
        const projFloorMat =
          groundFloorMode === 'projected'
            ? makeProjMat(true)
            : makeFallbackMaterial('wood_plank', isSelected, worldKit);
        projFloorMat.side = THREE.DoubleSide;
        clippableMats.push(projFloorMat);
        const projFloorMesh = new THREE.Mesh(projFloorGeom, projFloorMat);
        projFloorMesh.receiveShadow = true;
        projFloorMesh.userData = {
          pickKind: 'structure',
          pickId: st.id,
          walkSurface: 'floor',
        };
        ref.worldGroup.add(projFloorMesh);
      }

      if (archBundle.trimGeom) {
        const trimGeom = bakeProjectedUVs(
          archBundle.trimGeom,
          identity,
          projector,
          { textureMode: 'procedural', proceduralTileScale: 0.65 }
        );
        archBundle.trimGeom.dispose();
        const trimMat = makeFallbackMaterial(
          st.wallStyle === 'buttress' ? 'stone_brick' : 'wood_plank',
          isSelected,
          worldKit
        );
        clippableMats.push(trimMat);
        const trimMesh = new THREE.Mesh(trimGeom, trimMat);
        trimMesh.castShadow = true;
        trimMesh.receiveShadow = true;
        trimMesh.userData = { pickKind: 'structure', pickId: st.id };
        ref.worldGroup.add(trimMesh);
      }

      let doorMesh: THREE.Mesh | null = null;
      let doorBaseAngle = 0;
      if (archBundle.doorGeom && archBundle.doorInfo) {
        const doorGeom = bakeProjectedUVs(
          archBundle.doorGeom,
          identity,
          projector,
          { textureMode: 'procedural', proceduralTileScale: 0.7 }
        );
        archBundle.doorGeom.dispose();
        const doorMat = makeFallbackMaterial('wood_plank', isSelected, worldKit);
        clippableMats.push(doorMat);
        doorMesh = new THREE.Mesh(doorGeom, doorMat);
        doorMesh.position.set(...archBundle.doorInfo.hingePos);
        doorBaseAngle = -archBundle.doorInfo.wallAngle;
        const curOpenAngle = explorerStateRef.current.doorAngles.get(st.id) ?? 0;
        doorMesh.rotation.y = doorBaseAngle + curOpenAngle;
        doorMesh.castShadow = true;
        doorMesh.receiveShadow = true;
        doorMesh.userData = {
          pickKind: 'door',
          pickId: st.id,
          doorStructId: st.id,
        };
        ref.worldGroup.add(doorMesh);
      }

      if (archBundle.glassGeom) {
        const glassMat = new THREE.MeshStandardMaterial({
          color: '#ffd984',
          emissive: '#ff9d2e',
          emissiveIntensity: 0.72,
          roughness: 0.25,
          metalness: 0.1,
        });
        clippableMats.push(glassMat);
        const glassMesh = new THREE.Mesh(archBundle.glassGeom, glassMat);
        glassMesh.userData = { pickKind: 'structure', pickId: st.id };
        ref.worldGroup.add(glassMesh);
      }

      let roofMesh: THREE.Mesh | null = null;
      const roofRaw = buildStructureRoofGeometry(st);
      if (roofRaw) {
        const roofTexMode = resolveSurfaceTextureMode(
          resolveVisibleTextureMode(st.textureMode),
          'roof',
          sceneData.projection.pitchDeg,
          st.roofType
        );
        const roofGeom = bakeProjectedUVs(roofRaw, identity, projector, {
          textureMode: roofTexMode,
          proceduralTileScale: 0.45,
        });
        roofRaw.dispose();

        const roofFallback = isSelected
          ? makeFallbackMaterial(st.roofMaterial, true, worldKit)
          : getSharedFallback(st.roofMaterial, false);
        const roofProj = roofTexMode === 'procedural' ? roofFallback : makeProjMat(false);
        roofMesh = new THREE.Mesh(
          roofGeom,
          selectMeshMaterial(roofTexMode, roofProj, roofFallback)
        );
        roofMesh.castShadow = true;
        roofMesh.receiveShadow = true;
        roofMesh.visible = !st.hideRoof;
        roofMesh.userData = { pickKind: 'structure', pickId: st.id };
        ref.worldGroup.add(roofMesh);
      }

      ref.structureRenderMap.set(st.id, {
        def: st,
        roofMesh,
        doorMesh,
        doorBaseAngle,
        mats: clippableMats,
      });
    }

    // 3. Props em código (img2obj — sobreposição PBR limpa para rochas, árvores, poços e barcos)
    for (const prop of sceneData.props) {
      if (!prop.visible) continue;
      const isSelected =
        selectedItem?.kind === 'prop' && selectedItem.id === prop.id;

      const propBundle = buildPropGeometryBundle(prop);
      const raw = propBundle.geometry;
      const mat4 = new THREE.Matrix4().compose(
        new THREE.Vector3(...prop.position),
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          THREE.MathUtils.degToRad(prop.rotationYDeg)
        ),
        new THREE.Vector3(prop.scale, prop.scale, prop.scale)
      );

      let propGeom: THREE.BufferGeometry;
      let propMat: THREE.Material | THREE.Material[];

      if (prop.generator === 'card_25d' && prop.spriteDataUrl) {
        propGeom = raw.clone();
        const sTex = new THREE.TextureLoader().load(prop.spriteDataUrl);
        sTex.colorSpace = THREE.SRGBColorSpace;
        const sMat = new THREE.MeshStandardMaterial({
          map: sTex,
          alphaTest: 0.35,
          side: THREE.DoubleSide,
          roughness: 0.84,
          emissive: isSelected ? new THREE.Color('#22d3ee') : new THREE.Color('#000000'),
          emissiveIntensity: isSelected ? 0.2 : 0,
        });
        sMat.userData.ownsTextures = true;
        propMat = sMat;
      } else {
        const propTexMode = resolveSurfaceTextureMode(
          resolveVisibleTextureMode(prop.textureMode),
          'prop',
          sceneData.projection.pitchDeg,
          prop.generator
        );
        propGeom = bakeProjectedUVs(raw, mat4, projector, {
          textureMode: propTexMode,
          proceduralTileScale: 0.75,
        });
        if (propTexMode === 'procedural') {
          const pickPropMat = (m: MaterialPreset) =>
            isSelected
              ? makeFallbackMaterial(m, true, worldKit)
              : getSharedFallback(m, false);
          propMat =
            propBundle.materials.length > 1
              ? propBundle.materials.map(pickPropMat)
              : pickPropMat(propBundle.materials[0]);
        } else {
          const propFallback = makeFallbackMaterial(
            prop.fallbackMaterial,
            isSelected,
            worldKit
          );
          const projMat = new THREE.MeshStandardMaterial({
            map: ref.sourceTexture,
            color: ref.sourceTexture ? '#ffffff' : '#d4d4d8',
            roughness: 0.78,
            emissive: isSelected ? new THREE.Color('#22d3ee') : new THREE.Color('#000000'),
            emissiveIntensity: isSelected ? 0.2 : 0,
          });
          propMat = selectMeshMaterial(propTexMode, projMat, propFallback);
        }
      }
      raw.dispose();

      const propMesh = new THREE.Mesh(propGeom, propMat);
      propMesh.position.set(...prop.position);
      propMesh.rotation.y = THREE.MathUtils.degToRad(prop.rotationYDeg);
      propMesh.scale.setScalar(prop.scale);
      propMesh.castShadow = true;
      propMesh.receiveShadow = true;
      propMesh.userData = { pickKind: 'prop', pickId: prop.id };
      ref.worldGroup.add(propMesh);
    }

    // 3b. Props da expansão de mundo renderizados via THREE.InstancedMesh (inclui copa + casca multi-material!)
    if (worldExpansion && worldExpansion.worldProps.length > 0) {
      const groups = new Map<string, PropDef[]>();
      for (const wp of worldExpansion.worldProps) {
        if (!wp.visible) continue;
        const key = `${wp.generator}:${wp.fallbackMaterial}`;
        const list = groups.get(key) ?? [];
        list.push(wp);
        groups.set(key, list);
      }

      const dummy = new THREE.Object3D();
      const tint = new THREE.Color();
      for (const [, list] of groups) {
        const sample = list[0];
        const sampleBundle = buildPropGeometryBundle(sample);
        const instGeom = bakeProjectedUVs(sampleBundle.geometry, identity, projector, {
          textureMode: 'procedural',
          proceduralTileScale: 0.75,
        });
        sampleBundle.geometry.dispose();

        const instMat =
          sampleBundle.materials.length > 1
            ? sampleBundle.materials.map((m) =>
                makeFallbackMaterial(m, false, worldKit)
              )
            : makeFallbackMaterial(sampleBundle.materials[0], false, worldKit);
        const instMesh = new THREE.InstancedMesh(instGeom, instMat, list.length);
        instMesh.castShadow = true;
        instMesh.receiveShadow = true;

        list.forEach((wp, idx) => {
          dummy.position.set(...wp.position);
          dummy.rotation.set(0, THREE.MathUtils.degToRad(wp.rotationYDeg), 0);
          dummy.scale.setScalar(wp.scale);
          dummy.updateMatrix();
          instMesh.setMatrixAt(idx, dummy.matrix);

          const shade = 0.88 + ((Math.abs(Math.sin(wp.position[0] * 1.7 + wp.position[2] * 2.3))) * 0.2);
          tint.setRGB(shade, Math.min(1.06, shade * 1.02), shade * 0.96);
          instMesh.setColorAt(idx, tint);
        });
        instMesh.instanceMatrix.needsUpdate = true;
        if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;
        ref.worldGroup.add(instMesh);
      }
    }

    // Contagem de triângulos / vértices / draw calls para provar leveza da cena
    let triangles = 0;
    let vertices = 0;
    let meshCount = 0;
    ref.worldGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        meshCount++;
        const pos = obj.geometry.getAttribute('position');
        const mult = obj instanceof THREE.InstancedMesh ? obj.count : 1;
        if (pos) {
          vertices += pos.count * mult;
          const baseTris = obj.geometry.index
            ? obj.geometry.index.count / 3
            : pos.count / 3;
          triangles += baseTris * mult;
        }
      }
    });
    setStats({ triangles: Math.round(triangles), vertices, meshCount });
  }, [
    sceneData,
    worldKit,
    worldExpansion,
    selectedItem,
    heightField,
    heightMapDataUrl,
    normalMapDataUrl,
    sourceImageUrl,
    showProjectedImage,
    texVersion,
  ]);

  // Foca a câmera Orbit em um chunk clicado no minimapa WFC
  useEffect(() => {
    const ref = threeRef.current;
    if (!ref || !focusChunkTarget) return;
    ref.controls.target.set(focusChunkTarget.x, 0, focusChunkTarget.z);
    ref.orbitCamera.position.set(
      focusChunkTarget.x + 14,
      22,
      focusChunkTarget.z + 18
    );
    ref.controls.update();
  }, [focusChunkTarget]);

  // Atualiza wireframe de desenho ao vivo (retângulo ou polígono)
  useEffect(() => {
    const ref = threeRef.current;
    if (!ref) return;
    disposeObjectTree(ref.previewGroup);
    ref.previewGroup.clear();

    if (tool === 'draw_rect' && drawStart && hoverPoint) {
      const [x0, z0] = drawStart;
      const [x1, z1] = hoverPoint;
      const pts = [
        new THREE.Vector3(x0, 0.08, z0),
        new THREE.Vector3(x1, 0.08, z0),
        new THREE.Vector3(x1, 0.08, z1),
        new THREE.Vector3(x0, 0.08, z1),
        new THREE.Vector3(x0, 0.08, z0),
      ];
      const lineGeom = new THREE.BufferGeometry().setFromPoints(pts);
      const lineMat = new THREE.LineBasicMaterial({ color: '#22d3ee' });
      ref.previewGroup.add(new THREE.Line(lineGeom, lineMat));
    } else if (tool === 'draw_poly' && polyPoints.length > 0) {
      const pts = polyPoints.map(([x, z]) => new THREE.Vector3(x, 0.08, z));
      if (hoverPoint) pts.push(new THREE.Vector3(hoverPoint[0], 0.08, hoverPoint[1]));
      const lineGeom = new THREE.BufferGeometry().setFromPoints(pts);
      const lineMat = new THREE.LineBasicMaterial({ color: '#f59e0b' });
      ref.previewGroup.add(new THREE.Line(lineGeom, lineMat));
    }
  }, [tool, drawStart, polyPoints, hoverPoint]);

  // Exportação GLB quando acionada pelo Toolbar
  useEffect(() => {
    if (exportTrigger === 0 || !threeRef.current) return;
    const ref = threeRef.current;
    setExportStatus('Assando UVs e gerando .glb...');
    exportSceneToGLB(sceneData, {
      sourceTexture: ref.sourceTexture,
      terrainNormalTexture: ref.normalTexture,
      heightField,
      aspectRatio: sceneData.meta.aspectRatio,
      worldKit,
      worldExpansion,
      includeColliders,
      targetEngine,
    })
      .then(() => {
        setExportStatus('GLB exportado!');
        setTimeout(() => setExportStatus(null), 2500);
      })
      .catch((err) => {
        console.error(err);
        setExportStatus('Erro ao exportar GLB');
        setTimeout(() => setExportStatus(null), 3500);
      });
  }, [exportTrigger]);

  // Exportação de um Chunk individual selecionado no Minimapa WFC
  useEffect(() => {
    if (!chunkExportRequest || !threeRef.current || !worldExpansion) return;
    const ref = threeRef.current;
    const { gx, gz } = chunkExportRequest;
    setExportStatus(`Exportando Chunk (${gx},${gz})...`);
    exportSingleChunkToGLB(sceneData, worldExpansion, gx, gz, {
      sourceTexture: ref.sourceTexture,
      terrainNormalTexture: ref.normalTexture,
      heightField,
      aspectRatio: sceneData.meta.aspectRatio,
      worldKit,
      includeColliders,
      targetEngine,
    })
      .then(() => {
        setExportStatus(`Chunk (${gx},${gz}) exportado!`);
        setTimeout(() => setExportStatus(null), 2500);
      })
      .catch((err) => {
        console.error(err);
        setExportStatus('Erro ao exportar Chunk');
        setTimeout(() => setExportStatus(null), 3000);
      });
  }, [chunkExportRequest]);

  // Limpa rascunhos de desenho ao trocar de ferramenta + posiciona câmera confortável na exploração
  useEffect(() => {
    setDrawStart(null);
    setPolyPoints([]);
    if (tool === 'explore' && threeRef.current) {
      const ref = threeRef.current;
      const exp = explorerStateRef.current;
      const allStructures = worldExpansion
        ? [...sceneData.structures, ...worldExpansion.worldStructures]
        : sceneData.structures;
      const sceneSig = `${sceneData.meta.name}:${sceneData.terrain.width}:${sceneData.terrain.depth}:${sceneData.structures.length}`;
      if (exp.lastSceneSig !== sceneSig) {
        exp.lastSceneSig = sceneSig;
        const [sx, sz] = findDefaultSpawnXZ(sceneData, allStructures);
        const sy = sampleWalkableElevation(
          sx,
          sz,
          sceneData,
          heightField,
          1,
          null,
          allStructures,
          worldExpansion?.chunks ?? []
        );
        exp.pos.set(sx, sy, sz);
        exp.target = null;
      }
      const distToTarget = ref.orbitCamera.position.distanceTo(ref.controls.target);
      if (distToTarget > 55) {
        ref.controls.target.set(exp.pos.x, exp.pos.y + 0.8, exp.pos.z);
        ref.orbitCamera.position.set(exp.pos.x + 12, exp.pos.y + 18, exp.pos.z + 16);
        ref.controls.update();
      }
    } else {
      explorerStateRef.current.keys.clear();
    }
  }, [tool]);

  // Teclado: Esc fecha polígono/seleciona; WASD / Setas caminham no modo Exploração
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) =>
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();

      if (tool === 'explore') {
        if (
          key === 'w' ||
          key === 'a' ||
          key === 's' ||
          key === 'd' ||
          key === 'arrowup' ||
          key === 'arrowdown' ||
          key === 'arrowleft' ||
          key === 'arrowright'
        ) {
          explorerStateRef.current.keys.add(key);
        } else if (key === 'e' || key === 'pageup') {
          const st = useSceneStore.getState();
          const structures = st.worldExpansion
            ? [...st.scene.structures, ...st.worldExpansion.worldStructures]
            : st.scene.structures;
          const entered = findEnteredInteriorCluster(
            explorerStateRef.current.pos.x,
            explorerStateRef.current.pos.z,
            structures,
            0.02
          );
          if (entered.primary && (entered.primary.hasStairs ?? entered.primary.floors >= 2)) {
            st.setExplorerFloor(st.explorerFloor + 1);
          }
        } else if (key === 'q' || key === 'pagedown') {
          const st = useSceneStore.getState();
          const structures = st.worldExpansion
            ? [...st.scene.structures, ...st.worldExpansion.worldStructures]
            : st.scene.structures;
          const entered = findEnteredInteriorCluster(
            explorerStateRef.current.pos.x,
            explorerStateRef.current.pos.z,
            structures,
            0.02
          );
          if (entered.primary && (entered.primary.hasStairs ?? entered.primary.floors >= 2)) {
            st.setExplorerFloor(st.explorerFloor - 1);
          }
        } else if (key === 'f') {
          const st = useSceneStore.getState();
          if (st.explorerNearbyDoor) {
            st.requestToggleDoor(st.explorerNearbyDoor.id);
          }
        }
      }

      if (e.key === 'Escape') {
        setDrawStart(null);
        setPolyPoints([]);
        setTool('select');
      } else if (e.key === 'Enter' && tool === 'draw_poly' && polyPoints.length >= 3) {
        const id = `struct_${Date.now().toString(36)}`;
        const newStruct: StructureDef = {
          id,
          name: `Estrutura ${sceneData.structures.length + 1}`,
          semanticTag: 'building',
          footprint: polyPoints,
          baseElevation: 0.4,
          floors: 1,
          floorHeight: 2.4,
          wallStyle: 'timber_frame',
          includeFloorSlabs: true,
          windowsPerWall: 2,
          hasDoor: true,
          roofType: 'hip',
          roofPitchDeg: 36,
          roofOverhang: 0.35,
          hideRoof: false,
          textureMode: 'procedural',
          fallbackMaterial: 'timber_plaster',
          roofMaterial: 'roof_teal',
          visible: true,
        };
        addStructure(newStruct);
        setPolyPoints([]);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      explorerStateRef.current.keys.delete(e.key.toLowerCase());
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [tool, polyPoints, sceneData.structures.length, addStructure, setTool]);

  const getActiveCamera = (): THREE.Camera | null => {
    const ref = threeRef.current;
    const container = containerRef.current;
    if (!ref || !container) return null;
    if (viewMode === 'projector') {
      const aspect = (container.clientWidth || 800) / (container.clientHeight || 600);
      return createProjectorCamera(sceneData.projection, aspect);
    }
    return ref.orbitCamera;
  };

  const raycastGroundXZ = (
    clientX: number,
    clientY: number,
    planeY = 0
  ): [number, number] | null => {
    const container = containerRef.current;
    const cam = getActiveCamera();
    if (!container || !cam) return null;
    const rect = container.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, cam);
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(ground, hit)) {
      return [Number(hit.x.toFixed(2)), Number(hit.z.toFixed(2))];
    }
    return null;
  };

  const raycastExploreClick = (
    clientX: number,
    clientY: number
  ):
    | { kind: 'door'; doorStructId: string }
    | { kind: 'walk'; pt: [number, number] }
    | null => {
    const container = containerRef.current;
    const ref = threeRef.current;
    const cam = getActiveCamera();
    if (!container || !ref || !cam) return null;
    const rect = container.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, cam);

    // 1. Verifica clique direto em uma porta 3D para interagir
    const doorTargets: THREE.Object3D[] = [];
    for (const [, entry] of ref.structureRenderMap) {
      if (entry.doorMesh && entry.doorMesh.visible) {
        doorTargets.push(entry.doorMesh);
      }
    }
    const doorHits = raycaster.intersectObjects(doorTargets, false);
    if (doorHits.length > 0 && doorHits[0].object.userData?.doorStructId) {
      return {
        kind: 'door',
        doorStructId: doorHits[0].object.userData.doorStructId,
      };
    }

    // 2. Dentro de edifício, projeta o clique exatamente no plano do piso ativo
    if (explorerStateRef.current.activePrimaryId) {
      const floorPt = raycastGroundXZ(clientX, clientY, explorerStateRef.current.pos.y);
      if (floorPt) return { kind: 'walk', pt: floorPt };
    }

    // 3. Fora de edifício, usa terreno e pontes ignorando telhados/lajes altas
    const walkTargets: THREE.Object3D[] = [];
    ref.worldGroup.traverse((obj) => {
      if (
        obj instanceof THREE.Mesh &&
        obj.visible &&
        (obj.userData?.walkSurface === 'terrain' ||
          obj.userData?.walkSurface === 'bridge')
      ) {
        walkTargets.push(obj);
      }
    });
    const hits = raycaster.intersectObjects(walkTargets, false);
    if (hits.length > 0) {
      const p = hits[0].point;
      return { kind: 'walk', pt: [Number(p.x.toFixed(2)), Number(p.z.toFixed(2))] };
    }
    const fallbackPt = raycastGroundXZ(clientX, clientY, explorerStateRef.current.pos.y);
    return fallbackPt ? { kind: 'walk', pt: fallbackPt } : null;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pt = raycastGroundXZ(e.clientX, e.clientY);
    if (!pt) return;
    setHoverPoint(pt);

    // Move a tocha interativa suavemente sobre o cursor (fora do modo exploração)
    if (threeRef.current && sceneData.lighting.torchEnabled && tool !== 'explore') {
      threeRef.current.torchLight.position.set(pt[0], 2.8, pt[1]);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };

    if (tool === 'explore') {
      return;
    }

    if (tool === 'select') {
      const container = containerRef.current;
      const ref = threeRef.current;
      const cam = getActiveCamera();
      if (!container || !ref || !cam) return;
      const rect = container.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, cam);
      const hits = raycaster.intersectObjects(ref.worldGroup.children, true);
      const hitObj = hits.find((h) => h.object.userData?.pickId);
      if (hitObj) {
        const pickedKind =
          hitObj.object.userData.pickKind === 'door'
            ? 'structure'
            : hitObj.object.userData.pickKind;
        setSelectedItem({
          kind: pickedKind,
          id: hitObj.object.userData.pickId,
        });
      } else {
        setSelectedItem(null);
      }
      return;
    }

    const pt = raycastGroundXZ(e.clientX, e.clientY);
    if (!pt) return;

    if (tool === 'draw_rect') {
      if (!drawStart) {
        setDrawStart(pt);
      } else {
        const minX = Math.min(drawStart[0], pt[0]);
        const maxX = Math.max(drawStart[0], pt[0]);
        const minZ = Math.min(drawStart[1], pt[1]);
        const maxZ = Math.max(drawStart[1], pt[1]);
        if (maxX - minX >= 0.3 && maxZ - minZ >= 0.3) {
          const id = `struct_${Date.now().toString(36)}`;
          addStructure({
            id,
            name: `Estrutura ${sceneData.structures.length + 1}`,
            semanticTag: 'building',
            footprint: [
              [minX, minZ],
              [maxX, minZ],
              [maxX, maxZ],
              [minX, maxZ],
            ],
            baseElevation: 0.4,
            floors: 1,
            floorHeight: 2.4,
            wallStyle: 'timber_frame',
            includeFloorSlabs: true,
            windowsPerWall: 2,
            hasDoor: true,
            roofType: 'gable',
            roofPitchDeg: 36,
            roofOverhang: 0.35,
            hideRoof: false,
            textureMode: 'procedural',
            fallbackMaterial: 'timber_plaster',
            roofMaterial: 'roof_teal',
            visible: true,
          });
        }
        setDrawStart(null);
      }
    } else if (tool === 'draw_poly') {
      setPolyPoints((prev) => [...prev, pt]);
    } else if (tool === 'place_prop') {
      const id = `prop_${Date.now().toString(36)}`;
      let groundY = 0;
      if (heightField) {
        const u = pt[0] / sceneData.terrain.width + 0.5;
        const v = 1 - (pt[1] / sceneData.terrain.depth + 0.5);
        groundY = Number(
          (
            sampleHeightAtUV(
              heightField.macroHeight,
              heightField.width,
              heightField.height,
              u,
              v
            ) * sceneData.terrain.displacementScale
          ).toFixed(2)
        );
      }
      const newProp: PropDef = {
        id,
        name: `${activePropType}_${sceneData.props.length + 1}`,
        generator: activePropType,
        position: [pt[0], groundY, pt[1]],
        rotationYDeg: 0,
        scale: 1.0,
        textureMode: activePropType === 'card_25d' ? 'projected' : 'procedural',
        spriteDataUrl:
          activePropType === 'card_25d' && activeSpriteUrl
            ? activeSpriteUrl
            : undefined,
        fallbackMaterial:
          activePropType === 'pine_tree' ||
          activePropType === 'deciduous_tree' ||
          activePropType === 'bush'
            ? 'moss_earth'
            : activePropType === 'pillar' ||
              activePropType === 'brazier' ||
              activePropType === 'fireplace' ||
              activePropType === 'rock'
            ? 'stone_brick'
            : activePropType === 'bar_counter'
            ? 'timber_plaster'
            : activePropType === 'wall_sconce'
            ? 'roof_slate'
            : 'wood_plank',
        visible: true,
      };
      addProp(newProp);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || tool !== 'explore') return;
    const down = pointerDownPosRef.current;
    pointerDownPosRef.current = null;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) {
      return;
    }
    const res = raycastExploreClick(e.clientX, e.clientY);
    if (!res) return;

    const exp = explorerStateRef.current;
    if (res.kind === 'door') {
      const state = useSceneStore.getState();
      const allStructures = state.worldExpansion
        ? [...state.scene.structures, ...state.worldExpansion.worldStructures]
        : state.scene.structures;
      const targetStruct = allStructures.find((s) => s.id === res.doorStructId);
      const doorInfo = targetStruct ? computeStructureDoorInfo(targetStruct) : null;
      if (targetStruct && doorInfo) {
        const dist = Math.hypot(
          exp.pos.x - doorInfo.centerXZ[0],
          exp.pos.z - doorInfo.centerXZ[1]
        );
        if (dist <= 2.95) {
          requestToggleDoor(targetStruct.id);
          exp.pendingDoorId = null;
        } else {
          const sign = exp.activePrimaryId === targetStruct.id ? -1 : 1;
          exp.target = new THREE.Vector3(
            doorInfo.centerXZ[0] + doorInfo.normalXZ[0] * 0.72 * sign,
            exp.pos.y,
            doorInfo.centerXZ[1] + doorInfo.normalXZ[1] * 0.72 * sign
          );
          exp.pendingDoorId = targetStruct.id;
        }
      }
      return;
    }

    exp.pendingDoorId = null;
    exp.target = new THREE.Vector3(res.pt[0], exp.pos.y, res.pt[1]);
  };

  const focusCameraOnExplorer = () => {
    const ref = threeRef.current;
    if (!ref) return;
    const p = explorerStateRef.current.pos;
    ref.controls.target.set(p.x, p.y + 0.9, p.z);
    ref.orbitCamera.position.set(p.x + 11, p.y + 15, p.z + 14);
    ref.controls.update();
  };

  return (
    <div className="relative flex-1 h-full bg-zinc-950 overflow-hidden">
      <div
        ref={containerRef}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        className={`w-full h-full ${
          tool === 'select'
            ? 'cursor-grab active:cursor-grabbing'
            : tool === 'explore'
            ? 'cursor-pointer'
            : 'cursor-crosshair'
        }`}
      />

      {/* Sobreposição da imagem de referência alinhada pela altura vertical da câmera projetora */}
      {showReferenceOverlay && sourceImageUrl && (
        <img
          src={sourceImageUrl}
          alt="Reference Overlay"
          className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 h-full w-auto max-w-none"
          style={{ opacity: overlayOpacity }}
        />
      )}

      {/* HUD flutuante do Modo Exploração + Clip de Interior (BG3 / The Sims) */}
      {tool === 'explore' && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl bg-zinc-900/95 border border-cyan-700/60 shadow-2xl backdrop-blur text-xs">
          <span className="font-semibold text-cyan-300">
            Modo Exploração (1.7m)
          </span>
          <span className="text-zinc-400">Clique no mapa ou use WASD</span>

          {explorerInsideName ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-950/75 border border-amber-700/60 text-amber-200">
              <span>Interior: {explorerInsideName}</span>
              <span className="font-mono text-[11px] text-amber-300">
                (Piso {explorerFloor}/{explorerInsideMaxFloors})
              </span>
              {explorerInsideMaxFloors >= 2 && (
                <>
                  <button
                    onClick={() => setExplorerFloor(explorerFloor - 1)}
                    disabled={explorerFloor <= 1}
                    className="ml-1 px-1.5 py-0.5 rounded bg-zinc-900/80 border border-amber-700/60 disabled:opacity-40 hover:bg-amber-900/60 cursor-pointer"
                    title="Descer andar (Q)"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => setExplorerFloor(explorerFloor + 1)}
                    disabled={explorerFloor >= explorerInsideMaxFloors}
                    className="px-1.5 py-0.5 rounded bg-zinc-900/80 border border-amber-700/60 disabled:opacity-40 hover:bg-amber-900/60 cursor-pointer"
                    title="Subir andar (E)"
                  >
                    ↑
                  </button>
                </>
              )}
            </div>
          ) : (
            <span className="px-2 py-0.5 rounded bg-zinc-800/80 text-zinc-300">
              Área Externa
            </span>
          )}

          {explorerNearbyDoor && (
            <button
              onClick={() => requestToggleDoor(explorerNearbyDoor.id)}
              className="px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold cursor-pointer transition"
              title="Interagir com a porta (Tecla F)"
            >
              {explorerNearbyDoor.isOpen ? 'Fechar Porta [F]' : 'Abrir Porta [F]'}
            </button>
          )}

          <label className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800/70 text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={explorerFollowCamera}
              onChange={(e) => setExplorerFollowCamera(e.target.checked)}
              className="accent-cyan-500"
            />
            <span>Seguir Câmera</span>
          </label>

          <button
            onClick={focusCameraOnExplorer}
            className="px-2 py-1 rounded bg-cyan-800/70 hover:bg-cyan-700 text-cyan-100 cursor-pointer"
          >
            Focar Personagem
          </button>

          <button
            onClick={() => setTool('select')}
            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 cursor-pointer"
          >
            Sair (Esc)
          </button>
        </div>
      )}

      {/* HUD flutuante de ajuda contextual e coordenadas */}
      {tool !== 'explore' && (
        <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="px-2.5 py-1 rounded-md bg-zinc-900/85 border border-zinc-800 text-zinc-300 backdrop-blur">
            {viewMode === 'projector'
              ? 'Câmera Projetora (Alinhamento 2D)'
              : 'Orbit 3D Livre (Arraste para girar)'}
          </span>
          {tool === 'draw_rect' && (
            <span className="px-2.5 py-1 rounded-md bg-cyan-950/90 border border-cyan-700/60 text-cyan-200">
              {drawStart
                ? 'Clique no 2º canto no chão para criar a estrutura'
                : 'Clique no 1º canto do footprint no chão'}
            </span>
          )}
          {tool === 'draw_poly' && (
            <span className="px-2.5 py-1 rounded-md bg-amber-950/90 border border-amber-700/60 text-amber-200">
              Clique pontos no chão ({polyPoints.length}) — Enter para fechar polígono
            </span>
          )}
          {tool === 'place_prop' && (
            <span className="px-2.5 py-1 rounded-md bg-emerald-950/90 border border-emerald-700/60 text-emerald-200">
              Clique no terreno para posicionar: {activePropType}
            </span>
          )}
          {hoverPoint && (
            <span className="px-2 py-1 rounded-md bg-zinc-900/80 border border-zinc-800 text-zinc-400 font-mono">
              X:{hoverPoint[0]} Z:{hoverPoint[1]}
            </span>
          )}
        </div>
      )}

      {exportStatus && (
        <div className="absolute top-3 right-3 px-3 py-1.5 rounded-md bg-indigo-600/95 text-white text-xs font-medium shadow-lg">
          {exportStatus}
        </div>
      )}
    </div>
  );
};
