import {
  PROJECTION_PRESETS,
  type IsoDSLScene,
  type PropDef,
  type StructureDef,
} from '../types/isodsl';

// Imagem original Taverna Medieval (Mimosa20): 611 x 1024 px -> aspectRatio = 0.5967
const IMG_W = 611;
const IMG_H = 1024;
const ASPECT = Number((IMG_W / IMG_H).toFixed(4));
const DEPTH = 16; // metros reais de salão (~16m de fundo) -> escala humana 1.72m realista!
const WIDTH = Number((DEPTH * (IMG_W / IMG_H)).toFixed(3)); // ~9.547 m

function uvToXZ(u: number, v: number): [number, number] {
  return [
    Number(((u - 0.5) * WIDTH).toFixed(2)),
    Number(((v - 0.5) * DEPTH).toFixed(2)),
  ];
}

function makeWallSegment(
  id: string,
  name: string,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  floorHeight: number,
  opts?: {
    wallStyle?: StructureDef['wallStyle'];
    windows?: number;
  }
): StructureDef {
  const [x0, z0] = uvToXZ(u0, v0);
  const [x1, z1] = uvToXZ(u1, v1);
  return {
    id,
    name,
    semanticTag: 'wall',
    footprint: [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ],
    baseElevation: 0.05,
    floors: 1,
    floorHeight,
    wallStyle: opts?.wallStyle ?? 'timber_frame',
    windowsPerWall: opts?.windows ?? 0,
    hasDoor: false,
    roofType: 'flat',
    roofPitchDeg: 10,
    roofOverhang: 0,
    hideRoof: false,
    textureMode: 'procedural',
    fallbackMaterial: 'timber_plaster',
    roofMaterial: 'wood_plank',
    visible: true,
  };
}

function makeProp(
  id: string,
  name: string,
  generator: PropDef['generator'],
  u: number,
  v: number,
  scale: number,
  rotationYDeg = 0,
  fallbackMaterial: PropDef['fallbackMaterial'] = 'wood_plank',
  y = 0.06
): PropDef {
  const [x, z] = uvToXZ(u, v);
  return {
    id,
    name,
    generator,
    position: [x, y, z],
    rotationYDeg,
    scale,
    textureMode: 'procedural',
    fallbackMaterial,
    visible: true,
  };
}

/**
 * Tradução 3D completa de ambiente interno ("Taverna Medieval", 611x1024):
 * lareira de pedra com fogo, 3 mesas redondas c/ banquetas e velas, balcão em L com
 * banquetas de bar, estantes de bebidas, barris, caixotes, arandelas acesas e paredes enxaimel.
 */
export function createTavernaMedievalScene(): IsoDSLScene {
  const preset = PROJECTION_PRESETS.top_down;

  const structures: StructureDef[] = [
    makeWallSegment('tav_wall_nw', 'Parede Norte (Oeste da Lareira)', 0.02, 0.022, 0.34, 0.055, 2.65),
    makeWallSegment('tav_wall_ne', 'Parede Norte (Janela NE)', 0.66, 0.022, 0.98, 0.055, 2.65, {
      windows: 1,
    }),
    makeWallSegment('tav_wall_w', 'Parede Oeste', 0.012, 0.045, 0.042, 0.975, 2.35),
    makeWallSegment('tav_wall_e', 'Parede Leste', 0.958, 0.045, 0.988, 0.975, 2.35),
    makeWallSegment('tav_wall_sw', 'Soleira Sul Oeste', 0.03, 0.968, 0.41, 0.992, 0.58),
    makeWallSegment('tav_wall_se', 'Soleira Sul Leste', 0.59, 0.968, 0.97, 0.992, 0.58),
  ];

  const props: PropDef[] = [
    // Lareira central e armário NW
    makeProp('tav_hearth', 'Lareira Principal', 'fireplace', 0.5, 0.14, 1.55, 0, 'stone_brick'),
    makeProp('tav_cupboard_nw', 'Armário NW', 'bookshelf', 0.155, 0.145, 1.05, 0, 'wood_plank'),

    // 3 Mesas redondas com banquetas, canecas e velas
    makeProp('tav_table_n', 'Mesa Redonda Norte', 'tavern_table', 0.258, 0.362, 1.0, 18, 'wood_plank'),
    makeProp('tav_table_c', 'Mesa Redonda Centro', 'tavern_table', 0.258, 0.62, 1.0, 52, 'wood_plank'),
    makeProp('tav_table_s', 'Mesa Redonda Sul', 'tavern_table', 0.238, 0.882, 0.98, -20, 'wood_plank'),

    // Balcão em L + estantes atrás do balcão
    makeProp('tav_bar_top', 'Balcão L (Retorno Norte)', 'bar_counter', 0.855, 0.525, 0.98, 180, 'timber_plaster'),
    makeProp('tav_bar_mid', 'Balcão Principal (Norte)', 'bar_counter', 0.708, 0.615, 1.25, -90, 'timber_plaster'),
    makeProp('tav_bar_bot', 'Balcão Principal (Sul)', 'bar_counter', 0.708, 0.795, 1.35, -90, 'timber_plaster'),
    makeProp('tav_rack_n', 'Estante Bebidas Norte', 'bookshelf', 0.938, 0.675, 0.95, -90, 'wood_plank'),
    makeProp('tav_rack_s', 'Estante Bebidas Sul', 'bookshelf', 0.938, 0.845, 0.95, -90, 'wood_plank'),

    // 5 Banquetas do bar
    makeProp('tav_stool_1', 'Banqueta Bar 1', 'stool', 0.605, 0.562, 0.88, 0, 'wood_plank'),
    makeProp('tav_stool_2', 'Banqueta Bar 2', 'stool', 0.602, 0.638, 0.88, 35, 'wood_plank'),
    makeProp('tav_stool_3', 'Banqueta Bar 3', 'stool', 0.605, 0.728, 0.88, 70, 'wood_plank'),
    makeProp('tav_stool_4', 'Banqueta Bar 4', 'stool', 0.605, 0.805, 0.88, 15, 'wood_plank'),
    makeProp('tav_stool_back', 'Banqueta Interna Bar', 'stool', 0.785, 0.885, 0.85, 45, 'wood_plank'),

    // Barris & caixotes de estoque
    makeProp('tav_barrel_nw', 'Barril Canto NW', 'barrel', 0.105, 0.222, 0.78, 25, 'wood_plank'),
    makeProp('tav_barrel_hearth', 'Cesto de Lenha', 'barrel', 0.268, 0.226, 0.72, 12, 'wood_plank'),
    makeProp('tav_barrel_ne1', 'Barril Grande NE', 'barrel', 0.748, 0.192, 0.95, 110, 'wood_plank'),
    makeProp('tav_crate_ne1', 'Caixote NE Superior', 'crate', 0.842, 0.208, 0.88, 38, 'wood_plank'),
    makeProp('tav_barrel_ne2', 'Barril Pequeno NE', 'barrel', 0.902, 0.172, 0.78, 60, 'wood_plank'),
    makeProp('tav_barrel_ne3', 'Barril Médio NE', 'barrel', 0.892, 0.272, 1.0, 145, 'wood_plank'),
    makeProp('tav_crate_ne2', 'Caixote Pequeno Leste', 'crate', 0.842, 0.34, 0.58, 8, 'wood_plank'),
    makeProp('tav_crate_ne3', 'Caixote Grande Leste', 'crate', 0.885, 0.388, 0.85, 4, 'wood_plank'),
    makeProp('tav_barrel_w1', 'Barril Oeste Norte', 'barrel', 0.102, 0.49, 0.88, 15, 'wood_plank'),
    makeProp('tav_crate_w1', 'Caixote Oeste', 'crate', 0.17, 0.51, 0.66, 18, 'wood_plank'),
    makeProp('tav_barrel_w2', 'Barril Oeste Sul', 'barrel', 0.108, 0.542, 0.92, 95, 'wood_plank'),
    makeProp('tav_crate_sw', 'Caixote Canto SW', 'crate', 0.108, 0.945, 0.92, 28, 'wood_plank'),

    // Arandelas luminosas nas paredes
    makeProp('tav_sconce_w1', 'Arandela Oeste Norte', 'wall_sconce', 0.048, 0.312, 0.95, 90, 'roof_slate'),
    makeProp('tav_sconce_w2', 'Arandela Oeste Sul', 'wall_sconce', 0.048, 0.72, 0.95, 90, 'roof_slate'),
    makeProp('tav_sconce_e1', 'Arandela Leste', 'wall_sconce', 0.952, 0.342, 0.95, -90, 'roof_slate'),
  ];

  return {
    schemaVersion: '1.0',
    meta: {
      name: 'Taverna Medieval (Interno)',
      sourceLabel: 'taverna-medieval.jpg',
      aspectRatio: ASPECT,
      createdAt: new Date().toISOString(),
    },
    projection: {
      ...preset,
      orthoScale: DEPTH,
      offsetX: 0,
      offsetY: 0,
    },
    terrain: {
      width: WIDTH,
      depth: DEPTH,
      subdivisions: 96,
      displacementScale: 0.14,
      normalStrength: 1.5,
      detailBlend: 0.45,
      smoothRadius: 2,
      invertHeight: false,
      heightMode: 'luminance',
      textureMode: 'hybrid',
      fallbackMaterial: 'wood_plank',
      waterEnabled: false,
      waterElevation: 0.15,
    },
    structures,
    props,
    lighting: {
      sunAzimuthDeg: 25,
      sunElevationDeg: 68,
      sunIntensity: 1.25,
      ambientIntensity: 0.62,
      torchEnabled: true,
      torchIntensity: 4.5,
      torchColor: '#ff963c',
    },
    worldGrammar: {
      scale: 'small',
      environmentMode: 'interior',
      seed: 777,
      randomness: 0.35,
      treeDensity: 0,
      minTreeSpacing: 2.5,
      poiChance: 0.45,
      meanderStrength: 0,
      enableBridges: false,
      enableRoadContinuation: false,
      enableWaterContinuation: false,
      enableForestScatter: false,
      enableArchitecturalPOIs: true,
    },
  };
}
