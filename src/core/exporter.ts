import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type {
  IsoDSLScene,
  IsoWorldKit,
  MaterialPreset,
  SwatchCategory,
  TextureMode,
} from '../types/isodsl';
import { getEffectiveTextureMode } from '../types/isodsl';
import {
  buildPropGeometryBundle,
  buildStructureArchitectureBundle,
  buildStructureRoofGeometry,
  buildTerrainFeatureGeometry,
  buildTerrainBaseGeometry,
} from './compiler';
import { sampleHeightAtUV, type HeightFieldResult } from './imageMaps';
import { getProceduralMaterialTextures } from './proceduralTextures';
import {
  bakeProjectedUVs,
  createProjectorCamera,
  resolveSurfaceTextureMode,
} from './projection';
import { buildComfyTexturePrompt } from './textureTool';
import type { GeneratedWorldExpansion } from './worldBuilder';

export interface ExportMaterialsContext {
  sourceTexture: THREE.Texture | null;
  terrainNormalTexture: THREE.Texture | null;
  heightField: HeightFieldResult | null;
  aspectRatio: number;
  worldKit?: IsoWorldKit | null;
  worldExpansion?: GeneratedWorldExpansion | null;
  includeColliders?: boolean;
  targetEngine?: 'standard_glb' | 'godot' | 'unity' | 'unreal';
}

function makeProjectedMaterial(
  sourceTexture: THREE.Texture | null,
  normalTexture: THREE.Texture | null,
  normalScale: number,
  roughness = 0.85
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: sourceTexture,
    normalMap: normalTexture,
    normalScale: new THREE.Vector2(normalScale, normalScale),
    roughness,
    metalness: 0.04,
  });
}

function makeProceduralMaterial(
  preset: MaterialPreset,
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
    emissive: isEmber ? new THREE.Color('#ff6a18') : new THREE.Color('#000000'),
    emissiveIntensity: isEmber ? 1.15 : 0,
  });
}

function chooseMaterialOrArray(
  mode: TextureMode,
  projectedMat: THREE.Material,
  proceduralMat: THREE.Material
): THREE.Material | THREE.Material[] {
  if (mode === 'projected') return projectedMat;
  if (mode === 'procedural') return proceduralMat;
  return [projectedMat, proceduralMat];
}

/**
 * Assa (bake) o macro-relevo do Heightmap diretamente nas coordenadas Y dos vértices do terreno
 * para exportação glTF/GLB (já que o padrão glTF 2.0 não tem slot nativo de displacementMap).
 */
export function bakeTerrainDisplacementIntoGeometry(
  terrainGeom: THREE.BufferGeometry,
  heightField: HeightFieldResult | null,
  displacementScale: number
): void {
  if (!heightField || Math.abs(displacementScale) < 1e-6) return;
  const posAttr = terrainGeom.getAttribute('position');
  const uvAttr = terrainGeom.getAttribute('uv');
  if (!posAttr || !uvAttr) return;

  for (let i = 0; i < posAttr.count; i++) {
    const u = uvAttr.getX(i);
    const v = uvAttr.getY(i);
    const h = sampleHeightAtUV(
      heightField.macroHeight,
      heightField.width,
      heightField.height,
      u,
      v
    );
    posAttr.setY(i, posAttr.getY(i) + h * displacementScale);
  }
  posAttr.needsUpdate = true;
  terrainGeom.computeVertexNormals();
}

/**
 * Monta uma árvore semântica pronta para Unity/Godot/Unreal/Blender (padrão Nova3D).
 */
export function prepareExportSceneGroup(
  sceneData: IsoDSLScene,
  ctx: ExportMaterialsContext
): THREE.Group {
  const root = new THREE.Group();
  root.name = `IsoForge_${sceneData.meta.name.replace(/\s+/g, '_')}`;

  const projector = createProjectorCamera(
    sceneData.projection,
    ctx.aspectRatio || sceneData.meta.aspectRatio || 1.6
  );

  const projectedBaseMat = makeProjectedMaterial(
    ctx.sourceTexture,
    ctx.terrainNormalTexture,
    Math.min(2.5, sceneData.terrain.normalStrength * 0.45)
  );
  const projectedCleanMat = makeProjectedMaterial(ctx.sourceTexture, null, 0);
  const effectiveTerrainMode = getEffectiveTextureMode(
    sceneData,
    sceneData.terrain.textureMode
  );

  // 1. Terreno com UV projetado + displacement assado nos vértices
  const terrainGroup = new THREE.Group();
  terrainGroup.name = 'Terrain';

  const terrainIdentity = new THREE.Matrix4();
  const baseTerrainGeom = buildTerrainBaseGeometry(sceneData.terrain);
  const projectedTerrainGeom = bakeProjectedUVs(
    baseTerrainGeom,
    terrainIdentity,
    projector,
    { textureMode: effectiveTerrainMode, proceduralTileScale: 0.25 }
  );
  baseTerrainGeom.dispose();

  bakeTerrainDisplacementIntoGeometry(
    projectedTerrainGeom,
    ctx.heightField,
    sceneData.terrain.displacementScale
  );

  const terrainMesh = new THREE.Mesh(
    projectedTerrainGeom,
    chooseMaterialOrArray(
      effectiveTerrainMode,
      projectedBaseMat,
      makeProceduralMaterial(sceneData.terrain.fallbackMaterial, ctx.worldKit)
    )
  );
  terrainMesh.name =
    ctx.targetEngine === 'godot' ? 'Terrain_Mesh-col' : 'Terrain_Mesh';
  terrainGroup.add(terrainMesh);

  const hasReconstructedWater = Boolean(
    sceneData.terrainFeatures?.some((feature) => feature.kind === 'water')
  );
  if (sceneData.terrain.waterEnabled && !hasReconstructedWater) {
    const spanMult = ctx.worldExpansion
      ? ctx.worldExpansion.gridRadius * 2 + 1
      : 1;
    const waterGeom = new THREE.PlaneGeometry(
      sceneData.terrain.width * spanMult * 2.2,
      sceneData.terrain.depth * spanMult * 2.2
    );
    waterGeom.rotateX(-Math.PI / 2);
    waterGeom.translate(0, sceneData.terrain.waterElevation, 0);
    const waterMat = new THREE.MeshStandardMaterial({
      color: '#2d6f8e',
      roughness: 0.18,
      metalness: 0.1,
      transparent: true,
      opacity: 0.78,
    });
    const waterMesh = new THREE.Mesh(waterGeom, waterMat);
    waterMesh.name = 'Water_Plane';
    terrainGroup.add(waterMesh);
  }
  for (const feature of sceneData.terrainFeatures ?? []) {
    const featureGeom = buildTerrainFeatureGeometry(feature);
    if (!featureGeom) continue;
    const preset =
      feature.material ??
      (feature.kind === 'water'
        ? 'water_surface'
        : feature.kind === 'road'
        ? 'road_dirt'
        : sceneData.terrain.fallbackMaterial);
    if (feature.kind === 'road' && feature.elevation < sceneData.terrain.displacementScale * 0.42) {
      featureGeom.translate(
        0,
        sceneData.terrain.displacementScale * 0.46 - feature.elevation,
        0
      );
    }
    const featureMesh = new THREE.Mesh(
      featureGeom,
      makeProceduralMaterial(preset, ctx.worldKit)
    );
    featureMesh.name = `Reconstructed_${feature.kind}_${feature.id}`;
    terrainGroup.add(featureMesh);
  }
  root.add(terrainGroup);

  // 2. Estruturas semânticas (Walls + Roof + Collider opcional Nova3D/Godot)
  const structuresGroup = new THREE.Group();
  structuresGroup.name = 'Structures';

  const allStructures = ctx.worldExpansion
    ? [...sceneData.structures, ...ctx.worldExpansion.worldStructures]
    : sceneData.structures;

  for (const st of allStructures) {
    if (!st.visible) continue;
    const node = new THREE.Group();
    node.name = `${st.id}_${st.semanticTag}`;
    node.userData = {
      semanticTag: st.semanticTag,
      floors: st.floors,
      roofType: st.roofType,
    };

    const wallTexMode = resolveSurfaceTextureMode(
      getEffectiveTextureMode(sceneData, st.textureMode),
      'wall',
      sceneData.projection.pitchDeg,
      st.semanticTag
    );
    const archBundle = buildStructureArchitectureBundle(st);
    const wallsGeom = bakeProjectedUVs(
      archBundle.wallsGeom,
      terrainIdentity,
      projector,
      {
        textureMode: wallTexMode,
      }
    );
    archBundle.wallsGeom.dispose();

    const wallFallbackMat = makeProceduralMaterial(st.fallbackMaterial, ctx.worldKit);
    const hasInteriorWalls =
      st.semanticTag === 'building' || st.semanticTag === 'tower';
    if (hasInteriorWalls) {
      wallFallbackMat.side = THREE.DoubleSide;
    }
    const wallProjMat =
      hasInteriorWalls && wallTexMode !== 'procedural'
        ? (() => {
            const c = projectedCleanMat.clone();
            c.side = THREE.DoubleSide;
            return c;
          })()
        : projectedCleanMat;

    const wallsMesh = new THREE.Mesh(
      wallsGeom,
      chooseMaterialOrArray(wallTexMode, wallProjMat, wallFallbackMat)
    );
    wallsMesh.name = `${st.id}_Walls`;
    node.add(wallsMesh);

    if (archBundle.floorSlabsGeom) {
      const slabsGeom = bakeProjectedUVs(
        archBundle.floorSlabsGeom,
        terrainIdentity,
        projector,
        { textureMode: 'procedural', proceduralTileScale: 0.5 }
      );
      archBundle.floorSlabsGeom.dispose();
      const floorMatPreset =
        st.floorStyle === 'stone_tile' ? 'cobblestone' : 'wood_plank';
      const slabsMesh = new THREE.Mesh(
        slabsGeom,
        makeProceduralMaterial(floorMatPreset, ctx.worldKit)
      );
      slabsMesh.name = `${st.id}_Floors`;
      node.add(slabsMesh);
    }

    if (archBundle.projectedGroundFloorGeom) {
      const projFloorGeom = bakeProjectedUVs(
        archBundle.projectedGroundFloorGeom,
        terrainIdentity,
        projector,
        { textureMode: 'projected' }
      );
      archBundle.projectedGroundFloorGeom.dispose();
      const projFloorMesh = new THREE.Mesh(projFloorGeom, projectedCleanMat);
      projFloorMesh.name = `${st.id}_GroundFloor_Projected`;
      node.add(projFloorMesh);
    }

    if (archBundle.trimGeom) {
      const trimGeom = bakeProjectedUVs(
        archBundle.trimGeom,
        terrainIdentity,
        projector,
        { textureMode: 'procedural', proceduralTileScale: 0.65 }
      );
      archBundle.trimGeom.dispose();
      const trimMesh = new THREE.Mesh(
        trimGeom,
        makeProceduralMaterial(
          st.wallStyle === 'buttress' ? 'stone_brick' : 'wood_plank',
          ctx.worldKit
        )
      );
      trimMesh.name = `${st.id}_Trim_Openings`;
      node.add(trimMesh);
    }

    if (archBundle.doorGeom && archBundle.doorInfo) {
      const doorGeom = bakeProjectedUVs(
        archBundle.doorGeom,
        terrainIdentity,
        projector,
        { textureMode: 'procedural', proceduralTileScale: 0.7 }
      );
      archBundle.doorGeom.dispose();
      const doorMesh = new THREE.Mesh(
        doorGeom,
        makeProceduralMaterial('wood_plank', ctx.worldKit)
      );
      doorMesh.position.set(...archBundle.doorInfo.hingePos);
      doorMesh.rotation.y = -archBundle.doorInfo.wallAngle;
      doorMesh.name = `${st.id}_Door`;
      node.add(doorMesh);
    }

    if (archBundle.glassGeom) {
      const glassMat = new THREE.MeshStandardMaterial({
        color: '#ffd984',
        emissive: '#ff9d2e',
        emissiveIntensity: 0.72,
        roughness: 0.25,
      });
      const glassMesh = new THREE.Mesh(archBundle.glassGeom, glassMat);
      glassMesh.name = `${st.id}_Windows`;
      node.add(glassMesh);
    }

    const roofRaw = buildStructureRoofGeometry(st);
    if (roofRaw) {
      const roofTexMode = resolveSurfaceTextureMode(
        getEffectiveTextureMode(sceneData, st.textureMode),
        'roof',
        sceneData.projection.pitchDeg,
        st.roofType
      );
      const roofGeom = bakeProjectedUVs(roofRaw, terrainIdentity, projector, {
        textureMode: roofTexMode,
        proceduralTileScale: 0.45,
      });
      roofRaw.dispose();
      const roofMesh = new THREE.Mesh(
        roofGeom,
        chooseMaterialOrArray(
          roofTexMode,
          projectedCleanMat,
          makeProceduralMaterial(st.roofMaterial, ctx.worldKit)
        )
      );
      roofMesh.name = `${st.id}_Roof_Hideable`;
      node.add(roofMesh);
    }

    if (ctx.includeColliders) {
      const box = new THREE.Box3().setFromObject(node);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const colGeom = new THREE.BoxGeometry(
        Math.max(0.2, size.x),
        Math.max(0.2, size.y),
        Math.max(0.2, size.z)
      );
      colGeom.translate(center.x, center.y, center.z);
      const colMat = new THREE.MeshStandardMaterial({
        color: '#22d3ee',
        wireframe: true,
        visible: false,
      });
      const colMesh = new THREE.Mesh(colGeom, colMat);
      colMesh.name =
        ctx.targetEngine === 'godot' ? `${st.id}-colonly` : `${st.id}_Collider`;
      node.add(colMesh);
    }

    structuresGroup.add(node);
  }
  root.add(structuresGroup);

  // 3. Chunks expandidos (Escala Médio / Grande)
  if (ctx.worldExpansion && ctx.worldExpansion.gridRadius > 0) {
    const chunksGroup = new THREE.Group();
    chunksGroup.name = 'World_Chunks';
    for (const chunk of ctx.worldExpansion.chunks) {
      if (chunk.isAnchor) continue;
      const chunkGeom = new THREE.PlaneGeometry(
        chunk.width,
        chunk.depth,
        chunk.subdivisions,
        chunk.subdivisions
      );
      chunkGeom.rotateX(-Math.PI / 2);
      if (chunk.heightField && chunk.heightWidth && chunk.heightHeight) {
        bakeTerrainDisplacementIntoGeometry(
          chunkGeom,
          {
            macroHeight: chunk.heightField,
            rawLuminance: chunk.heightField,
            width: chunk.heightWidth,
            height: chunk.heightHeight,
          },
          sceneData.terrain.displacementScale
        );
      }
      let chunkMat: THREE.MeshStandardMaterial;
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
          normalTex.minFilter = THREE.LinearFilter;
          normalTex.needsUpdate = true;
        }
        chunkMat = new THREE.MeshStandardMaterial({
          map: albedoTex,
          normalMap: normalTex,
          normalScale: new THREE.Vector2(1.1, 1.1),
          roughness: 0.9,
          metalness: 0.03,
        });
      } else {
        chunkMat = makeProceduralMaterial(sceneData.terrain.fallbackMaterial, ctx.worldKit);
      }
      const chunkMesh = new THREE.Mesh(chunkGeom, chunkMat);
      chunkMesh.position.set(chunk.centerX, 0, chunk.centerZ);
      chunkMesh.name =
        ctx.targetEngine === 'godot'
          ? `Chunk_${chunk.gx}_${chunk.gz}_${chunk.biome}-col`
          : `Chunk_${chunk.gx}_${chunk.gz}_${chunk.biome}`;
      chunkMesh.userData = { gx: chunk.gx, gz: chunk.gz, biome: chunk.biome };
      chunksGroup.add(chunkMesh);
    }
    root.add(chunksGroup);
  }

  // 4. Props procedurais (Âncora + Instâncias de mundo agrupadas por gerador)
  const propsGroup = new THREE.Group();
  propsGroup.name = 'Props';

  const allProps = ctx.worldExpansion
    ? [...sceneData.props, ...ctx.worldExpansion.worldProps]
    : sceneData.props;

  for (const prop of allProps) {
    if (!prop.visible) continue;
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
    const resolvedPropMode = resolveSurfaceTextureMode(
      getEffectiveTextureMode(sceneData, prop.textureMode),
      'prop',
      sceneData.projection.pitchDeg,
      prop.generator
    );
    let propMat: THREE.Material | THREE.Material[];
    if (prop.generator === 'card_25d' && prop.spriteDataUrl) {
      const spriteTex = new THREE.TextureLoader().load(prop.spriteDataUrl);
      spriteTex.colorSpace = THREE.SRGBColorSpace;
      propMat = new THREE.MeshStandardMaterial({
        map: spriteTex,
        alphaTest: 0.35,
        side: THREE.DoubleSide,
        roughness: 0.85,
      });
    } else if (resolvedPropMode === 'procedural') {
      propMat =
        propBundle.materials.length > 1
          ? propBundle.materials.map((m) => makeProceduralMaterial(m, ctx.worldKit))
          : makeProceduralMaterial(propBundle.materials[0], ctx.worldKit);
    } else {
      propMat = chooseMaterialOrArray(
        resolvedPropMode,
        projectedCleanMat,
        makeProceduralMaterial(prop.fallbackMaterial, ctx.worldKit)
      );
    }

    const propGeom =
      prop.generator === 'card_25d' && prop.spriteDataUrl
        ? raw.clone()
        : bakeProjectedUVs(raw, mat4, projector, {
            textureMode: resolvedPropMode,
            proceduralTileScale: 0.7,
          });
    raw.dispose();

    const propMesh = new THREE.Mesh(propGeom, propMat);
    propMesh.name = `${prop.id}_${prop.generator}`;
    propMesh.position.set(...prop.position);
    propMesh.rotation.y = THREE.MathUtils.degToRad(prop.rotationYDeg);
    propMesh.scale.setScalar(prop.scale);
    propsGroup.add(propMesh);
  }
  root.add(propsGroup);

  return root;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Exporta a cena inteira como arquivo binário .glb pronto para Godot, Unity, Unreal e WebGL.
 */
export async function exportSceneToGLB(
  sceneData: IsoDSLScene,
  ctx: ExportMaterialsContext
): Promise<void> {
  const exportGroup = prepareExportSceneGroup(sceneData, ctx);
  const exporter = new GLTFExporter();
  const glbBuffer = await exporter.parseAsync(exportGroup, {
    binary: true,
  });
  const slug = sceneData.meta.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const blob = new Blob([glbBuffer as ArrayBuffer], {
    type: 'model/gltf-binary',
  });
  triggerDownload(blob, `${slug || 'isoforge-map'}.glb`);
}

export function exportIsoDSLJson(sceneData: IsoDSLScene): void {
  const json = JSON.stringify(sceneData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const slug = sceneData.meta.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  triggerDownload(blob, `${slug || 'isoforge-map'}.isodsl.json`);
}

export function exportWorldManifestJson(
  sceneData: IsoDSLScene,
  worldExpansion: GeneratedWorldExpansion | null
): void {
  const manifest = {
    schemaVersion: '1.0',
    worldName: sceneData.meta.name,
    grammar: sceneData.worldGrammar,
    kit: sceneData.kit ?? null,
    summary: worldExpansion?.summary ?? null,
    chunks:
      worldExpansion?.chunks.map((c) => ({
        gx: c.gx,
        gz: c.gz,
        biome: c.biome,
        isAnchor: c.isAnchor,
        center: [c.centerX, c.centerZ],
        size: [c.width, c.depth],
        segments: c.segments,
      })) ?? [],
  };
  const blob = new Blob([JSON.stringify(manifest, null, 2)], {
    type: 'application/json',
  });
  triggerDownload(blob, 'world_manifest.json');
}

export async function exportSingleChunkToGLB(
  sceneData: IsoDSLScene,
  worldExpansion: GeneratedWorldExpansion,
  gx: number,
  gz: number,
  ctx: ExportMaterialsContext
): Promise<void> {
  const chunk = worldExpansion.chunks.find((c) => c.gx === gx && c.gz === gz);
  if (!chunk) return;
  if (chunk.isAnchor) {
    await exportSceneToGLB(sceneData, { ...ctx, worldExpansion: null });
    return;
  }

  const singleExpansion: GeneratedWorldExpansion = {
    gridRadius: 1,
    chunks: [chunk],
    worldStructures: worldExpansion.worldStructures.filter((s) =>
      s.id.includes(`_${gx}_${gz}`)
    ),
    worldProps: worldExpansion.worldProps.filter((p) =>
      p.id.startsWith(`wp_${gx}_${gz}_`)
    ),
    summary: { ...worldExpansion.summary, chunkCount: 1 },
  };
  const group = prepareExportSceneGroup(
    { ...sceneData, structures: [], props: [] },
    { ...ctx, worldExpansion: singleExpansion }
  );
  const exporter = new GLTFExporter();
  const glbBuffer = await exporter.parseAsync(group, { binary: true });
  triggerDownload(
    new Blob([glbBuffer as ArrayBuffer], { type: 'model/gltf-binary' }),
    `chunk_${gx}_${gz}_${chunk.biome}.glb`
  );
}

export function exportComfyUIKitSpecJson(
  sceneData: IsoDSLScene,
  kit: IsoWorldKit | null
): void {
  const categories: SwatchCategory[] = [
    'grass',
    'dirt_road',
    'water',
    'foliage',
    'stone',
  ];
  const spec = {
    schemaVersion: '1.0',
    tool: 'IsoForge ComfyUI / Magnific Asset Pack Spec',
    sceneName: sceneData.meta.name,
    recommendedResolution: '512x512 seamless',
    swatches: categories.map((cat) => {
      const sw = kit?.swatches[cat];
      return {
        category: cat,
        averageColor: sw?.averageColor ?? null,
        confidence: sw?.confidence ?? 0,
        needsUpscaleOrRegen: !sw || sw.confidence < 0.65,
        suggestedPrompt: buildComfyTexturePrompt(cat, sw, sceneData.meta.name),
      };
    }),
    portals: kit?.portals ?? [],
  };
  triggerDownload(
    new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' }),
    'comfyui_kit_spec.json'
  );
}

export function downloadDataUrlPng(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
