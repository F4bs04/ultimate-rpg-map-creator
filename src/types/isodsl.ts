/**
 * IsoDSL v1.0 — Linguagem declarativa leve para cenários RPG isométricos e top-down.
 * Combina hierarquia semântica (Nova3D), footprints 2D sem booleanas (IRCSS/Aljullu)
 * e receitas de primitivas em código (img2obj).
 */

export type ProjectionPreset =
  | 'isometric_true'
  | 'isometric_dimetric'
  | 'top_down'
  | 'perspective';

export type TextureMode = 'projected' | 'hybrid' | 'procedural';

/** O modo recomendado reconstrói o mapa com geometria/material nativos. */
export type ReconstructionMode = 'semantic_rebuild' | 'projection_compat';

export type MaterialPreset =
  | 'stone_brick'
  | 'cobblestone'
  | 'timber_plaster'
  | 'roof_slate'
  | 'roof_teal'
  | 'roof_terracotta'
  | 'thatch'
  | 'wood_plank'
  | 'tree_bark'
  | 'foliage_canopy'
  | 'road_dirt'
  | 'water_surface'
  | 'moss_earth'
  | 'ember_glow';

export type RoofType = 'flat' | 'gable' | 'hip' | 'cone' | 'parapet';

export type SemanticTag =
  | 'building'
  | 'tower'
  | 'wall'
  | 'cliff'
  | 'platform'
  | 'bridge';

export type PropGeneratorType =
  | 'barrel'
  | 'crate'
  | 'pillar'
  | 'fallen_pillar'
  | 'pine_tree'
  | 'deciduous_tree'
  | 'bush'
  | 'rock'
  | 'signpost'
  | 'well'
  | 'boat'
  | 'brazier'
  | 'tavern_table'
  | 'stool'
  | 'bar_counter'
  | 'fireplace'
  | 'bookshelf'
  | 'wall_sconce'
  | 'card_25d';

export type HeightMode = 'luminance' | 'semantic_outdoor' | 'ai_depth';

export type WallStyle = 'plain' | 'timber_frame' | 'buttress';

export type FloorStyle = 'wood_plank' | 'projected' | 'stone_tile';

export type WorldScale = 'small' | 'medium' | 'large';

export type SwatchCategory = 'grass' | 'dirt_road' | 'water' | 'foliage' | 'stone';

export type EdgeSide = 'north' | 'south' | 'west' | 'east';

export interface AbsorbedSwatch {
  category: SwatchCategory;
  label: string;
  /** Caixa normalizada [u0, v0, u1, v1] de onde o recorte foi absorvido na imagem fonte */
  sampleBox: [number, number, number, number];
  albedoDataUrl: string;
  normalDataUrl: string;
  averageColor: string;
  confidence: number;
}

export interface BorderPortal {
  side: EdgeSide;
  /** Posição normalizada [0..1] ao longo da borda */
  t: number;
  kind: 'water' | 'road';
  widthNorm: number;
}

export interface WorldBiomeStats {
  waterRatio: number;
  foliageRatio: number;
  roadRatio: number;
  stoneRatio: number;
}

export interface EdgeHeights {
  north: number[];
  south: number[];
  west: number[];
  east: number[];
}

export interface EdgeStrips {
  /** Amostras RGB [r,g,b] ao longo de cada borda (ex.: 48 amostras) para dissolver emendas */
  north: [number, number, number][];
  south: [number, number, number][];
  west: [number, number, number][];
  east: [number, number, number][];
  /** Elevações normalizadas [0..1] nas 4 bordas do terreno âncora para costura sem degrau */
  heights?: EdgeHeights;
}

export interface IsoWorldKit {
  id: string;
  name: string;
  sourceCount: number;
  swatches: Partial<Record<SwatchCategory, AbsorbedSwatch>>;
  portals: BorderPortal[];
  biomeStats: WorldBiomeStats;
  edgeStrips?: EdgeStrips;
}

export interface WorldGrammarConfig {
  scale: WorldScale;
  /** Modo de ambiente: 'outdoor' (paisagem aberta/floresta) ou 'interior' (masmorra/taverna fechada) */
  environmentMode?: 'outdoor' | 'interior';
  seed: number;
  /** Aleatoriedade controlada [0..1]: jitter de escala, rotação, meandro e variação de POIs */
  randomness: number;
  /** Multiplicador de densidade de vegetação [0.2..2.5] */
  treeDensity: number;
  /** Espaçamento mínimo estilo Poisson-Disk entre árvores [1.5..6m] */
  minTreeSpacing: number;
  /** Probabilidade de spawn procedural de construções/torres/ruínas nos chunks vizinhos [0..1] */
  poiChance: number;
  /** Curvatura orgânica dos rios/estradas expandidos [0..1] */
  meanderStrength: number;
  /** Gera pontes automaticamente onde estradas cruzam rios expandidos */
  enableBridges: boolean;
  /** Nós ativos do grafo procedural estilo Geometry Nodes */
  enableRoadContinuation?: boolean;
  enableWaterContinuation?: boolean;
  enableForestScatter?: boolean;
  enableArchitecturalPOIs?: boolean;
}

export interface ProjectionConfig {
  preset: ProjectionPreset;
  type: 'orthographic' | 'perspective';
  pitchDeg: number;
  yawDeg: number;
  orthoScale: number;
  fovDeg: number;
  offsetX: number;
  offsetY: number;
}

export interface TerrainConfig {
  width: number;
  depth: number;
  subdivisions: number;
  displacementScale: number;
  normalStrength: number;
  detailBlend: number;
  smoothRadius: number;
  invertHeight: boolean;
  heightMode: HeightMode;
  textureMode: TextureMode;
  fallbackMaterial: MaterialPreset;
  waterEnabled: boolean;
  waterElevation: number;
}

export type TerrainFeatureKind = 'road' | 'water' | 'shore' | 'clearing';

/** Região reconstruída da imagem, independente de UV/projeção. */
export interface TerrainFeatureDef {
  id: string;
  kind: TerrainFeatureKind;
  /** Polígono fechado em XZ ou linha central quando width estiver definido. */
  points: [number, number][];
  width?: number;
  elevation: number;
  material?: MaterialPreset;
  visible: boolean;
}

export interface ReconstructionConfig {
  mode: ReconstructionMode;
  /** Intensidade da leitura semântica da imagem [0..1]. */
  semanticFidelity: number;
  detectTerrainFeatures: boolean;
  detectVegetation: boolean;
  detectStructures: boolean;
  generateProceduralModels: boolean;
}

export interface StructureDef {
  id: string;
  name: string;
  semanticTag: SemanticTag;
  /** Footprint 2D em coordenadas do mundo [x, z] */
  footprint: [number, number][];
  baseElevation: number;
  floors: number;
  floorHeight: number;
  wallStyle?: WallStyle;
  /** Balanço medieval do 2º andar (jetty) em metros */
  upperFloorOverhang?: number;
  /** Gera pisos internos de madeira entre os andares (visível ao ocultar telhado) */
  includeFloorSlabs?: boolean;
  /** Material / projeção do piso térreo ('projected' projeta o chão da imagem 2D sobre a laje) */
  floorStyle?: FloorStyle;
  /** Quantidade de janelas procedurais com venezianas por parede (0..4) */
  windowsPerWall?: number;
  hasDoor?: boolean;
  /** Gera escada interna e habilita a troca de piso no Modo Exploração. */
  hasStairs?: boolean;
  hasChimney?: boolean;
  roofType: RoofType;
  roofPitchDeg: number;
  roofOverhang: number;
  hideRoof: boolean;
  textureMode: TextureMode;
  fallbackMaterial: MaterialPreset;
  roofMaterial: MaterialPreset;
  visible: boolean;
}

export interface PropDef {
  id: string;
  name: string;
  generator: PropGeneratorType;
  position: [number, number, number];
  rotationYDeg: number;
  scale: number;
  textureMode: TextureMode;
  fallbackMaterial: MaterialPreset;
  /** Sprite PNG transparente opcional (ex.: recorte alpha ou asset ComfyUI/Magnific) para card_25d */
  spriteDataUrl?: string;
  visible: boolean;
}

export interface LightingConfig {
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  sunIntensity: number;
  ambientIntensity: number;
  torchEnabled: boolean;
  torchIntensity: number;
  torchColor: string;
}

export interface IsoDSLScene {
  schemaVersion: '1.0';
  meta: {
    name: string;
    sourceLabel: string;
    aspectRatio: number;
    createdAt: string;
  };
  projection: ProjectionConfig;
  terrain: TerrainConfig;
  reconstruction?: ReconstructionConfig;
  terrainFeatures?: TerrainFeatureDef[];
  structures: StructureDef[];
  props: PropDef[];
  lighting: LightingConfig;
  worldGrammar: WorldGrammarConfig;
  kit?: IsoWorldKit;
}

export const PROJECTION_PRESETS: Record<
  ProjectionPreset,
  Omit<ProjectionConfig, 'orthoScale' | 'offsetX' | 'offsetY'> & { label: string }
> = {
  isometric_true: {
    label: 'Isométrico Real (35.264° / 45°)',
    preset: 'isometric_true',
    type: 'orthographic',
    pitchDeg: 35.264,
    yawDeg: 45,
    fovDeg: 35,
  },
  isometric_dimetric: {
    label: 'Isométrico 2:1 Jogos (30° / 45°)',
    preset: 'isometric_dimetric',
    type: 'orthographic',
    pitchDeg: 30,
    yawDeg: 45,
    fovDeg: 35,
  },
  top_down: {
    label: 'Top-Down Battlemap (89.5° / 0°)',
    preset: 'top_down',
    type: 'orthographic',
    pitchDeg: 89.5,
    yawDeg: 0,
    fovDeg: 35,
  },
  perspective: {
    label: 'Perspectiva 3/4 (42° / 45°)',
    preset: 'perspective',
    type: 'perspective',
    pitchDeg: 42,
    yawDeg: 45,
    fovDeg: 36,
  },
};

export function createDefaultWorldGrammar(): WorldGrammarConfig {
  return {
    scale: 'small',
    environmentMode: 'outdoor',
    seed: 1337,
    randomness: 0.45,
    treeDensity: 1.0,
    minTreeSpacing: 2.8,
    poiChance: 0.45,
    meanderStrength: 0.55,
    enableBridges: true,
    enableRoadContinuation: true,
    enableWaterContinuation: true,
    enableForestScatter: true,
    enableArchitecturalPOIs: true,
  };
}

export function createDefaultReconstructionConfig(): ReconstructionConfig {
  return {
    mode: 'projection_compat',
    semanticFidelity: 0.86,
    detectTerrainFeatures: true,
    detectVegetation: true,
    detectStructures: true,
    generateProceduralModels: true,
  };
}

/** Compatibilidade com mapas .isodsl antigos que ainda não têm o bloco novo. */
export function getReconstructionConfig(scene: Pick<IsoDSLScene, 'reconstruction'>): ReconstructionConfig {
  return {
    ...createDefaultReconstructionConfig(),
    ...(scene.reconstruction ?? {}),
  };
}

export function getEffectiveTextureMode(
  scene: Pick<IsoDSLScene, 'reconstruction'>,
  requested: TextureMode
): TextureMode {
  return getReconstructionConfig(scene).mode === 'semantic_rebuild'
    ? 'procedural'
    : requested;
}

export function createDefaultScene(name = 'Novo Mapa RPG'): IsoDSLScene {
  return {
    schemaVersion: '1.0',
    meta: {
      name,
      sourceLabel: 'custom-image',
      aspectRatio: 16 / 10,
      createdAt: new Date().toISOString(),
    },
    projection: {
      preset: 'isometric_true',
      type: 'orthographic',
      pitchDeg: 35.264,
      yawDeg: 45,
      orthoScale: 18,
      fovDeg: 36,
      offsetX: 0,
      offsetY: 0,
    },
    terrain: {
      width: 28,
      depth: 28,
      subdivisions: 96,
      displacementScale: 1.8,
      normalStrength: 2.2,
      detailBlend: 0.45,
      smoothRadius: 2,
      invertHeight: false,
      heightMode: 'luminance',
      textureMode: 'procedural',
      fallbackMaterial: 'moss_earth',
      waterEnabled: false,
      waterElevation: 0.15,
    },
    reconstruction: createDefaultReconstructionConfig(),
    terrainFeatures: [],
    structures: [],
    props: [],
    lighting: {
      sunAzimuthDeg: 55,
      sunElevationDeg: 52,
      sunIntensity: 1.8,
      ambientIntensity: 0.65,
      torchEnabled: true,
      torchIntensity: 2.2,
      torchColor: '#ff9442',
    },
    worldGrammar: createDefaultWorldGrammar(),
  };
}
