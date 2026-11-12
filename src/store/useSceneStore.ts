import { create } from 'zustand';
import { estimateAIDepthFromImage } from '../core/aiDepth';
import { analyzeImageToIsoDSL } from '../core/autoAnalyze';
import {
  computeHeightField,
  extractImageAnalysisBuffer,
  heightFieldToGrayscaleRGBA,
  heightFieldToNormalRGBA,
  rgbaToDataUrl,
  sampleHeightAtUV,
  type HeightFieldResult,
} from '../core/imageMaps';
import {
  buildMultiScaleWorld,
  type GeneratedWorldExpansion,
} from '../core/worldBuilder';
import {
  extractWorldKitFromImage,
  mergeImageIntoWorldKit,
} from '../core/worldKit';
import {
  applyCustomSwatchBuffer,
  buildComfyTexturePrompt,
  generateTextureViaComfyUI,
  synthesizePainterlyWorldKit,
} from '../core/textureTool';
import { convertImageUrlToCutoutSprite } from '../core/cutoutHarvester';
import {
  PROJECTION_PRESETS,
  createDefaultScene,
  createDefaultReconstructionConfig,
  createDefaultWorldGrammar,
  type IsoDSLScene,
  type IsoWorldKit,
  type LightingConfig,
  type ProjectionConfig,
  type ProjectionPreset,
  type ReconstructionMode,
  type PropDef,
  type PropGeneratorType,
  type StructureDef,
  type SwatchCategory,
  type TerrainConfig,
  type WorldGrammarConfig,
  type WorldScale,
} from '../types/isodsl';

export type EditorTool = 'select' | 'draw_rect' | 'draw_poly' | 'place_prop' | 'explore';
export type ViewMode = 'orbit' | 'projector';
export type TargetEngine = 'standard_glb' | 'godot' | 'unity' | 'unreal';

export interface SceneStats {
  triangles: number;
  vertices: number;
  meshCount: number;
}

interface ImageBufferState {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

interface SceneStore {
  scene: IsoDSLScene;
  sourceImageUrl: string | null;
  analysisBuffer: ImageBufferState | null;
  heightField: HeightFieldResult | null;
  aiDepthField: Float32Array | null;
  aiDepthStatus: string | null;
  heightMapDataUrl: string | null;
  normalMapDataUrl: string | null;
  normalMapRgba: Uint8ClampedArray | null;

  worldKit: IsoWorldKit | null;
  worldExpansion: GeneratedWorldExpansion | null;
  textureToolStatus: string | null;
  customSprites: { id: string; name: string; dataUrl: string }[];
  activeSpriteUrl: string | null;
  selectedChunkCoord: [number, number] | null;
  focusChunkTarget: { x: number; z: number; nonce: number } | null;
  chunkExportRequest: { gx: number; gz: number; nonce: number } | null;

  viewMode: ViewMode;
  tool: EditorTool;
  activePropType: PropGeneratorType;
  selectedItem: { kind: 'structure' | 'prop'; id: string } | null;
  explorerFloor: number;
  explorerInsideName: string | null;
  explorerInsideMaxFloors: number;
  explorerFollowCamera: boolean;
  explorerNearbyDoor: { id: string; name: string; isOpen: boolean } | null;
  doorToggleRequest: { id: string; nonce: number } | null;
  showGrid: boolean;
  showReferenceOverlay: boolean;
  overlayOpacity: number;
  stats: SceneStats;
  snapRequestCount: number;
  exportTrigger: number;
  includeColliders: boolean;
  targetEngine: TargetEngine;

  loadImageAndScene: (
    imageUrl: string,
    customScene?: IsoDSLScene,
    autoTranslate?: boolean
  ) => Promise<void>;
  absorbImageIntoKit: (imageUrl: string, label: string) => Promise<void>;
  regeneratePainterlyTextures: () => void;
  replaceKitSwatchFromImageUrl: (
    category: SwatchCategory,
    imageUrl: string
  ) => Promise<void>;
  generateComfySwatch: (
    category: SwatchCategory,
    endpoint: string,
    checkpoint: string
  ) => Promise<void>;
  addCustomSpriteFromUrl: (imageUrl: string, name: string) => Promise<void>;
  setActiveSpriteUrl: (url: string | null) => void;
  focusWorldChunk: (gx: number, gz: number) => void;
  requestChunkExportGLB: (gx: number, gz: number) => void;
  autoTranslateCurrentImage: (preset?: ProjectionPreset) => void;
  runAIDepthEstimation: () => Promise<void>;
  recomputeMaps: () => void;

  setWorldScale: (scale: WorldScale) => void;
  updateWorldGrammar: (patch: Partial<WorldGrammarConfig>) => void;
  rerollWorldSeed: () => void;
  rebuildWorldExpansion: () => void;

  setProjectionPreset: (preset: ProjectionPreset) => void;
  setReconstructionMode: (mode: ReconstructionMode) => void;
  updateProjection: (patch: Partial<ProjectionConfig>) => void;
  updateTerrain: (patch: Partial<TerrainConfig>) => void;
  updateLighting: (patch: Partial<LightingConfig>) => void;

  addStructure: (structure: StructureDef) => void;
  updateStructure: (id: string, patch: Partial<StructureDef>) => void;
  removeStructure: (id: string) => void;

  addProp: (prop: PropDef) => void;
  updateProp: (id: string, patch: Partial<PropDef>) => void;
  removeProp: (id: string) => void;

  replaceSceneDSL: (newScene: IsoDSLScene) => void;
  openProjectOrScene: (scene: IsoDSLScene, imageUrl: string | null) => Promise<void>;
  updateSceneMeta: (patch: Partial<IsoDSLScene['meta']>) => void;
  setTool: (tool: EditorTool) => void;
  setActivePropType: (gen: PropGeneratorType) => void;
  setViewMode: (mode: ViewMode) => void;
  setSelectedItem: (item: { kind: 'structure' | 'prop'; id: string } | null) => void;
  setExplorerFloor: (floor: number) => void;
  setExplorerInside: (name: string | null, maxFloors: number) => void;
  setExplorerFollowCamera: (follow: boolean) => void;
  setExplorerNearbyDoor: (
    door: { id: string; name: string; isOpen: boolean } | null
  ) => void;
  requestToggleDoor: (id: string) => void;
  setShowGrid: (v: boolean) => void;
  setShowReferenceOverlay: (v: boolean) => void;
  setOverlayOpacity: (v: number) => void;
  setStats: (stats: SceneStats) => void;
  setIncludeColliders: (v: boolean) => void;
  setTargetEngine: (engine: TargetEngine) => void;
  requestSnapToProjector: () => void;
  requestExportGLB: () => void;
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = url;
  });
}

function buildMapsFromBuffer(
  buffer: ImageBufferState,
  terrain: TerrainConfig,
  aiDepthField: Float32Array | null
): {
  heightField: HeightFieldResult;
  heightMapDataUrl: string;
  normalMapDataUrl: string;
  normalMapRgba: Uint8ClampedArray;
} {
  const baseHf = computeHeightField(buffer.rgba, buffer.width, buffer.height, {
    smoothRadius: terrain.smoothRadius,
    invertHeight: terrain.invertHeight,
    heightMode: terrain.heightMode,
  });

  const heightField: HeightFieldResult =
    terrain.heightMode === 'ai_depth' &&
    aiDepthField &&
    aiDepthField.length === buffer.width * buffer.height
      ? {
          macroHeight: aiDepthField,
          rawLuminance: baseHf.rawLuminance,
          width: buffer.width,
          height: buffer.height,
        }
      : baseHf;

  const heightRgba = heightFieldToGrayscaleRGBA(
    heightField.macroHeight,
    buffer.width,
    buffer.height
  );
  const normalRgba = heightFieldToNormalRGBA(
    heightField.macroHeight,
    heightField.rawLuminance,
    buffer.width,
    buffer.height,
    terrain.normalStrength,
    terrain.detailBlend
  );

  return {
    heightField,
    heightMapDataUrl: rgbaToDataUrl(heightRgba, buffer.width, buffer.height),
    normalMapDataUrl: rgbaToDataUrl(normalRgba, buffer.width, buffer.height),
    normalMapRgba: normalRgba,
  };
}

function computeExpansionIfNeeded(
  scene: IsoDSLScene,
  kit: IsoWorldKit | null
): GeneratedWorldExpansion {
  return buildMultiScaleWorld(scene, kit ?? undefined);
}

export const useSceneStore = create<SceneStore>((set, get) => ({
  scene: createDefaultScene(),
  sourceImageUrl: null,
  analysisBuffer: null,
  heightField: null,
  aiDepthField: null,
  aiDepthStatus: null,
  heightMapDataUrl: null,
  normalMapDataUrl: null,
  normalMapRgba: null,

  worldKit: null,
  worldExpansion: null,
  textureToolStatus: null,
  customSprites: [],
  activeSpriteUrl: null,
  selectedChunkCoord: null,
  focusChunkTarget: null,
  chunkExportRequest: null,

  viewMode: 'orbit',
  tool: 'select',
  activePropType: 'deciduous_tree',
  selectedItem: null,
  explorerFloor: 1,
  explorerInsideName: null,
  explorerInsideMaxFloors: 1,
  explorerFollowCamera: true,
  explorerNearbyDoor: null,
  doorToggleRequest: null,
  showGrid: true,
  showReferenceOverlay: false,
  overlayOpacity: 0.35,
  stats: { triangles: 0, vertices: 0, meshCount: 0 },
  snapRequestCount: 0,
  exportTrigger: 0,
  includeColliders: true,
  targetEngine: 'standard_glb',

  loadImageAndScene: async (imageUrl, customScene, autoTranslate = false) => {
    const img = await loadImageElement(imageUrl);
    const buffer = extractImageAnalysisBuffer(img, 384);
    const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);

    let baseScene: IsoDSLScene;
    if (customScene) {
      baseScene = {
        ...customScene,
        worldGrammar: customScene.worldGrammar ?? createDefaultWorldGrammar(),
        reconstruction:
          customScene.reconstruction ?? createDefaultReconstructionConfig(),
        terrainFeatures: customScene.terrainFeatures ?? [],
        meta: { ...customScene.meta, aspectRatio: aspect },
      };
    } else if (autoTranslate) {
      baseScene = analyzeImageToIsoDSL(buffer.rgba, buffer.width, buffer.height, {
        preset: get().scene.projection.preset,
      });
    } else {
      const current = get().scene;
      const orthoScale = current.projection.orthoScale;
      baseScene = {
        ...current,
        meta: {
          ...current.meta,
          aspectRatio: aspect,
          sourceLabel: 'uploaded-image',
        },
        terrain: {
          ...current.terrain,
          width: Number((orthoScale * aspect).toFixed(3)),
          depth: orthoScale,
        },
      };
    }

    const rawKit = extractWorldKitFromImage(
      buffer.rgba,
      buffer.width,
      buffer.height,
      baseScene.meta.name
    );
    const kit = synthesizePainterlyWorldKit(
      rawKit,
      baseScene.worldGrammar.seed
    );
    baseScene = { ...baseScene, kit };

    const maps = buildMapsFromBuffer(buffer, baseScene.terrain, null);
    if (autoTranslate && !customScene) {
      baseScene = {
        ...baseScene,
        props: baseScene.props.map((prop) => {
          const u = prop.position[0] / baseScene.terrain.width + 0.5;
          const v = 1 - (prop.position[2] / baseScene.terrain.depth + 0.5);
          const h = sampleHeightAtUV(
            maps.heightField.macroHeight,
            maps.heightField.width,
            maps.heightField.height,
            u,
            v
          );
          return {
            ...prop,
            position: [
              prop.position[0],
              Number((h * baseScene.terrain.displacementScale).toFixed(2)),
              prop.position[2],
            ],
          };
        }),
        structures: baseScene.structures.map((structure) => {
          const center = structure.footprint.reduce(
            (acc, [x, z]) => [acc[0] + x, acc[1] + z] as [number, number],
            [0, 0] as [number, number]
          );
          const count = Math.max(1, structure.footprint.length);
          const u = center[0] / count / baseScene.terrain.width + 0.5;
          const v = 1 - (center[1] / count / baseScene.terrain.depth + 0.5);
          const h = sampleHeightAtUV(
            maps.heightField.macroHeight,
            maps.heightField.width,
            maps.heightField.height,
            u,
            v
          );
          return {
            ...structure,
            baseElevation: Number((h * baseScene.terrain.displacementScale).toFixed(2)),
          };
        }),
      };
    }

    const worldExpansion = computeExpansionIfNeeded(baseScene, kit);

    set({
      sourceImageUrl: imageUrl,
      analysisBuffer: buffer,
      aiDepthField: null,
      aiDepthStatus: null,
      scene: baseScene,
      worldKit: kit,
      worldExpansion,
      selectedItem: null,
      snapRequestCount: get().snapRequestCount + 1,
      ...maps,
    });
  },

  absorbImageIntoKit: async (imageUrl, label) => {
    const img = await loadImageElement(imageUrl);
    const buffer = extractImageAnalysisBuffer(img, 384);
    const mergedRaw = mergeImageIntoWorldKit(
      get().worldKit ?? undefined,
      buffer.rgba,
      buffer.width,
      buffer.height,
      label
    );
    const mergedKit = synthesizePainterlyWorldKit(
      mergedRaw,
      get().scene.worldGrammar.seed
    );
    const updatedScene = { ...get().scene, kit: mergedKit };
    const worldExpansion = computeExpansionIfNeeded(updatedScene, mergedKit);
    set({
      worldKit: mergedKit,
      scene: updatedScene,
      worldExpansion,
      textureToolStatus: `Absorvido "${label}" + texturas Painterly atualizadas`,
    });
  },

  regeneratePainterlyTextures: () => {
    const { worldKit, scene } = get();
    if (!worldKit) return;
    const nextSeed = Math.floor(Math.random() * 9999) + 1;
    const upgraded = synthesizePainterlyWorldKit(worldKit, nextSeed);
    const updatedScene = { ...scene, kit: upgraded };
    const worldExpansion = computeExpansionIfNeeded(updatedScene, upgraded);
    set({
      worldKit: upgraded,
      scene: updatedScene,
      worldExpansion,
      textureToolStatus: `Texturas Painterly 128px sintetizadas (variação #${nextSeed})`,
    });
  },

  replaceKitSwatchFromImageUrl: async (category, imageUrl) => {
    const { worldKit, scene } = get();
    if (!worldKit) return;
    const img = await loadImageElement(imageUrl);
    const buffer = extractImageAnalysisBuffer(img, 256);
    const updatedKit = applyCustomSwatchBuffer(
      worldKit,
      category,
      buffer.rgba,
      buffer.width,
      buffer.height
    );
    const updatedScene = { ...scene, kit: updatedKit };
    const worldExpansion = computeExpansionIfNeeded(updatedScene, updatedKit);
    set({
      worldKit: updatedKit,
      scene: updatedScene,
      worldExpansion,
      textureToolStatus: `Swatch "${category}" atualizado pela ferramenta externa`,
    });
  },

  generateComfySwatch: async (category, endpoint, checkpoint) => {
    const { worldKit, scene } = get();
    if (!worldKit) return;
    try {
      set({ textureToolStatus: `Enviando "${category}" para ComfyUI...` });
      const prompt = buildComfyTexturePrompt(
        category,
        worldKit.swatches[category],
        scene.meta.name
      );
      const imageUrl = await generateTextureViaComfyUI({
        endpoint,
        checkpointName: checkpoint,
        prompt,
        seed: scene.worldGrammar.seed,
      });
      await get().replaceKitSwatchFromImageUrl(category, imageUrl);
      set({ textureToolStatus: `Textura "${category}" gerada via ComfyUI!` });
    } catch (err) {
      set({
        textureToolStatus: `ComfyUI indisponível (${(err as Error).message})`,
      });
    }
  },

  addCustomSpriteFromUrl: async (imageUrl, name) => {
    const cutoutUrl = await convertImageUrlToCutoutSprite(imageUrl, 256, 38);
    const entry = {
      id: `sprite_${Date.now().toString(36)}`,
      name,
      dataUrl: cutoutUrl,
    };
    set((state) => ({
      customSprites: [...state.customSprites, entry],
      activeSpriteUrl: cutoutUrl,
      tool: 'place_prop',
      activePropType: 'card_25d',
      textureToolStatus: `Sprite 2.5D "${name}" pronto para posicionar no mapa`,
    }));
  },

  setActiveSpriteUrl: (activeSpriteUrl) => set({ activeSpriteUrl }),

  focusWorldChunk: (gx, gz) => {
    const { worldExpansion } = get();
    const chunk = worldExpansion?.chunks.find((c) => c.gx === gx && c.gz === gz);
    if (!chunk) return;
    set((state) => ({
      selectedChunkCoord: [gx, gz],
      focusChunkTarget: {
        x: chunk.centerX,
        z: chunk.centerZ,
        nonce: (state.focusChunkTarget?.nonce ?? 0) + 1,
      },
    }));
  },

  requestChunkExportGLB: (gx, gz) =>
    set((state) => ({
      chunkExportRequest: {
        gx,
        gz,
        nonce: (state.chunkExportRequest?.nonce ?? 0) + 1,
      },
    })),

  autoTranslateCurrentImage: (preset) => {
    const { analysisBuffer, scene, worldKit, aiDepthField } = get();
    if (!analysisBuffer) return;
    let translated = analyzeImageToIsoDSL(
      analysisBuffer.rgba,
      analysisBuffer.width,
      analysisBuffer.height,
      {
        name: `${scene.meta.name} (Auto)`,
        preset: preset ?? scene.projection.preset,
      }
    );
    translated = {
      ...translated,
      worldGrammar: scene.worldGrammar,
      kit: worldKit ?? undefined,
    };
    const maps = buildMapsFromBuffer(analysisBuffer, translated.terrain, aiDepthField);
    translated = {
      ...translated,
      props: translated.props.map((prop) => {
        const u = prop.position[0] / translated.terrain.width + 0.5;
        const v = 1 - (prop.position[2] / translated.terrain.depth + 0.5);
        const h = sampleHeightAtUV(
          maps.heightField.macroHeight,
          maps.heightField.width,
          maps.heightField.height,
          u,
          v
        );
        return {
          ...prop,
          position: [
            prop.position[0],
            Number((h * translated.terrain.displacementScale).toFixed(2)),
            prop.position[2],
          ],
        };
      }),
      structures: translated.structures.map((structure) => {
        const center = structure.footprint.reduce(
          (acc, [x, z]) => [acc[0] + x, acc[1] + z] as [number, number],
          [0, 0] as [number, number]
        );
        const count = Math.max(1, structure.footprint.length);
        const u = center[0] / count / translated.terrain.width + 0.5;
        const v = 1 - (center[1] / count / translated.terrain.depth + 0.5);
        const h = sampleHeightAtUV(
          maps.heightField.macroHeight,
          maps.heightField.width,
          maps.heightField.height,
          u,
          v
        );
        return {
          ...structure,
          baseElevation: Number((h * translated.terrain.displacementScale).toFixed(2)),
        };
      }),
    };
    const worldExpansion = computeExpansionIfNeeded(translated, worldKit);
    set({
      scene: translated,
      worldExpansion,
      selectedItem: null,
      snapRequestCount: get().snapRequestCount + 1,
      ...maps,
    });
  },

  runAIDepthEstimation: async () => {
    const { sourceImageUrl, analysisBuffer, scene } = get();
    if (!sourceImageUrl || !analysisBuffer) return;

    try {
      set({ aiDepthStatus: 'Iniciando Depth Anything V2...' });
      const res = await estimateAIDepthFromImage(
        sourceImageUrl,
        analysisBuffer.width,
        analysisBuffer.height,
        (info) => {
          const pct = info.progress !== undefined ? ` (${info.progress}%)` : '';
          set({ aiDepthStatus: `${info.status}${pct}` });
        }
      );

      const updatedScene: IsoDSLScene = {
        ...scene,
        terrain: { ...scene.terrain, heightMode: 'ai_depth' },
      };
      const maps = buildMapsFromBuffer(
        analysisBuffer,
        updatedScene.terrain,
        res.depthField
      );

      set({
        aiDepthField: res.depthField,
        aiDepthStatus: `Concluído (${res.backend.toUpperCase()})`,
        scene: updatedScene,
        ...maps,
      });
    } catch (err) {
      console.error(err);
      set({ aiDepthStatus: 'Erro na inferência Depth IA' });
    }
  },

  recomputeMaps: () => {
    const { analysisBuffer, scene, aiDepthField } = get();
    if (!analysisBuffer) return;
    const maps = buildMapsFromBuffer(analysisBuffer, scene.terrain, aiDepthField);
    set(maps);
  },

  setWorldScale: (scale) => {
    const { scene, worldKit } = get();
    const updatedScene: IsoDSLScene = {
      ...scene,
      worldGrammar: { ...scene.worldGrammar, scale },
    };
    const worldExpansion = computeExpansionIfNeeded(updatedScene, worldKit);
    set((state) => ({
      scene: updatedScene,
      worldExpansion,
      snapRequestCount: state.snapRequestCount + 1,
    }));
  },

  updateWorldGrammar: (patch) => {
    const { scene, worldKit } = get();
    const updatedScene: IsoDSLScene = {
      ...scene,
      worldGrammar: { ...scene.worldGrammar, ...patch },
    };
    const worldExpansion = computeExpansionIfNeeded(updatedScene, worldKit);
    set({
      scene: updatedScene,
      worldExpansion,
    });
  },

  rerollWorldSeed: () => {
    const newSeed = Math.floor(Math.random() * 999999) + 1;
    get().updateWorldGrammar({ seed: newSeed });
  },

  rebuildWorldExpansion: () => {
    const { scene, worldKit } = get();
    set({ worldExpansion: computeExpansionIfNeeded(scene, worldKit) });
  },

  setProjectionPreset: (preset) => {
    const p = PROJECTION_PRESETS[preset];
    set((state) => ({
      scene: {
        ...state.scene,
        projection: {
          ...state.scene.projection,
          preset: p.preset,
          type: p.type,
          pitchDeg: p.pitchDeg,
          yawDeg: p.yawDeg,
          fovDeg: p.fovDeg,
        },
      },
    }));
  },

  setReconstructionMode: (mode) =>
    set((state) => ({
      scene: {
        ...state.scene,
        reconstruction: {
          ...createDefaultReconstructionConfig(),
          ...(state.scene.reconstruction ?? {}),
          mode,
        },
      },
    })),

  updateProjection: (patch) =>
    set((state) => ({
      scene: {
        ...state.scene,
        projection: { ...state.scene.projection, ...patch },
      },
    })),

  updateTerrain: (patch) => {
    set((state) => ({
      scene: {
        ...state.scene,
        terrain: { ...state.scene.terrain, ...patch },
      },
    }));
    if (
      patch.smoothRadius !== undefined ||
      patch.invertHeight !== undefined ||
      patch.heightMode !== undefined ||
      patch.normalStrength !== undefined ||
      patch.detailBlend !== undefined
    ) {
      get().recomputeMaps();
    }
    if (patch.displacementScale !== undefined || patch.waterElevation !== undefined) {
      get().rebuildWorldExpansion();
    }
  },

  updateLighting: (patch) =>
    set((state) => ({
      scene: {
        ...state.scene,
        lighting: { ...state.scene.lighting, ...patch },
      },
    })),

  addStructure: (structure) =>
    set((state) => ({
      scene: {
        ...state.scene,
        structures: [...state.scene.structures, structure],
      },
      selectedItem: { kind: 'structure', id: structure.id },
    })),

  updateStructure: (id, patch) =>
    set((state) => ({
      scene: {
        ...state.scene,
        structures: state.scene.structures.map((s) =>
          s.id === id ? { ...s, ...patch } : s
        ),
      },
    })),

  removeStructure: (id) =>
    set((state) => ({
      scene: {
        ...state.scene,
        structures: state.scene.structures.filter((s) => s.id !== id),
      },
      selectedItem:
        state.selectedItem?.kind === 'structure' && state.selectedItem.id === id
          ? null
          : state.selectedItem,
    })),

  addProp: (prop) =>
    set((state) => ({
      scene: {
        ...state.scene,
        props: [...state.scene.props, prop],
      },
      selectedItem: { kind: 'prop', id: prop.id },
    })),

  updateProp: (id, patch) =>
    set((state) => ({
      scene: {
        ...state.scene,
        props: state.scene.props.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      },
    })),

  removeProp: (id) =>
    set((state) => ({
      scene: {
        ...state.scene,
        props: state.scene.props.filter((p) => p.id !== id),
      },
      selectedItem:
        state.selectedItem?.kind === 'prop' && state.selectedItem.id === id
          ? null
          : state.selectedItem,
    })),

  replaceSceneDSL: (newScene) => {
    const { analysisBuffer, aiDepthField, worldKit } = get();
      const normalized: IsoDSLScene = {
        ...newScene,
        worldGrammar: newScene.worldGrammar ?? createDefaultWorldGrammar(),
        reconstruction:
          newScene.reconstruction ?? createDefaultReconstructionConfig(),
        terrainFeatures: newScene.terrainFeatures ?? [],
      };
    const kit = normalized.kit ?? worldKit;
    const worldExpansion = computeExpansionIfNeeded(normalized, kit);
    set({ scene: normalized, worldKit: kit ?? null, worldExpansion, selectedItem: null });
    if (analysisBuffer) {
      const maps = buildMapsFromBuffer(analysisBuffer, normalized.terrain, aiDepthField);
      set(maps);
    }
  },

  openProjectOrScene: async (targetScene, imageUrl) => {
    if (imageUrl) {
      try {
        await get().loadImageAndScene(imageUrl, targetScene, false);
        return;
      } catch (err) {
        console.warn('Falha ao carregar imagem de referência do projeto, abrindo cena direto:', err);
      }
    }
    get().replaceSceneDSL(targetScene);
  },

  updateSceneMeta: (patch) =>
    set((state) => ({
      scene: {
        ...state.scene,
        meta: { ...state.scene.meta, ...patch },
      },
    })),

  setTool: (tool) =>
    set({
      tool,
      ...(tool === 'explore' ? { explorerFloor: 1, explorerInsideName: null, explorerInsideMaxFloors: 1 } : {}),
    }),
  setActivePropType: (activePropType) => set({ activePropType }),
  setViewMode: (viewMode) => set({ viewMode }),
  setSelectedItem: (selectedItem) => set({ selectedItem }),
  setExplorerFloor: (explorerFloor) =>
    set((s) => ({
      explorerFloor: Math.max(1, Math.min(s.explorerInsideMaxFloors, explorerFloor)),
    })),
  setExplorerInside: (explorerInsideName, explorerInsideMaxFloors) =>
    set((s) => ({
      explorerInsideName,
      explorerInsideMaxFloors: Math.max(1, explorerInsideMaxFloors),
      explorerFloor:
        explorerInsideName === null
          ? 1
          : Math.max(1, Math.min(explorerInsideMaxFloors, s.explorerFloor)),
    })),
  setExplorerFollowCamera: (explorerFollowCamera) => set({ explorerFollowCamera }),
  setExplorerNearbyDoor: (explorerNearbyDoor) => set({ explorerNearbyDoor }),
  requestToggleDoor: (id) =>
    set((s) => ({
      doorToggleRequest: { id, nonce: (s.doorToggleRequest?.nonce ?? 0) + 1 },
    })),
  setShowGrid: (showGrid) => set({ showGrid }),
  setShowReferenceOverlay: (showReferenceOverlay) => set({ showReferenceOverlay }),
  setOverlayOpacity: (overlayOpacity) => set({ overlayOpacity }),
  setStats: (stats) => set({ stats }),
  setIncludeColliders: (includeColliders) => set({ includeColliders }),
  setTargetEngine: (targetEngine) => set({ targetEngine }),
  requestSnapToProjector: () =>
    set((state) => ({ snapRequestCount: state.snapRequestCount + 1 })),
  requestExportGLB: () =>
    set((state) => ({ exportTrigger: state.exportTrigger + 1 })),
}));
