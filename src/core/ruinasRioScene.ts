import {
  PROJECTION_PRESETS,
  type IsoDSLScene,
  type PropDef,
  type StructureDef,
} from '../types/isodsl';

const ASPECT = 576 / 1024; // 0.5625
const DEPTH = 32;
const WIDTH = Number((DEPTH * ASPECT).toFixed(3)); // 18.0m

function uvToXZ(u: number, vTopDown: number): [number, number] {
  return [
    Number(((u - 0.5) * WIDTH).toFixed(2)),
    Number(((vTopDown - 0.5) * DEPTH).toFixed(2)),
  ];
}

function makeWallSegment(
  id: string,
  name: string,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  thickness = 0.62,
  height = 1.45
): StructureDef {
  const [x0, z0] = uvToXZ(u0, v0);
  const [x1, z1] = uvToXZ(u1, v1);
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz) || 1;
  const px = (-dz / len) * (thickness * 0.5);
  const pz = (dx / len) * (thickness * 0.5);

  return {
    id,
    name,
    semanticTag: 'wall',
    footprint: [
      [Number((x0 + px).toFixed(2)), Number((z0 + pz).toFixed(2))],
      [Number((x1 + px).toFixed(2)), Number((z1 + pz).toFixed(2))],
      [Number((x1 - px).toFixed(2)), Number((z1 - pz).toFixed(2))],
      [Number((x0 - px).toFixed(2)), Number((z0 - pz).toFixed(2))],
    ],
    baseElevation: 0.48,
    floors: 1,
    floorHeight: height,
    wallStyle: 'buttress',
    hasDoor: false,
    roofType: 'flat',
    roofPitchDeg: 20,
    roofOverhang: 0,
    hideRoof: false,
    textureMode: 'procedural',
    fallbackMaterial: 'stone_brick',
    roofMaterial: 'stone_brick',
    visible: true,
  };
}

function makeProp(
  id: string,
  name: string,
  generator: PropDef['generator'],
  u: number,
  v: number,
  y: number,
  scale: number,
  rotationYDeg = 0,
  fallbackMaterial: PropDef['fallbackMaterial'] = 'moss_earth'
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
 * Tradução fiel da imagem "Ruínas no Riacho" (576x1024) configurada como Mapa Médio (3x3 chunks, 54m x 96m):
 * - Extrai muros de arenito angulados, altar circular central, colunas caídas, árvores e pedras
 * - Expande em 8 chunks vizinhos via WFC preservando o estilo sálvia/arenito e continuando o riacho + trilhas
 */
export function createRuinasRioMediumScene(): IsoDSLScene {
  const preset = PROJECTION_PRESETS.top_down;

  const structures: StructureDef[] = [
    // Ruína Noroeste (L superior e L inferior)
    makeWallSegment('ruin_nw_top', 'Muro Ruína NW Norte', 0.06, 0.075, 0.25, 0.04, 0.58, 1.35),
    makeWallSegment('ruin_nw_west', 'Muro Ruína NW Oeste', 0.065, 0.075, 0.125, 0.175, 0.58, 1.35),
    makeWallSegment('ruin_nw_south', 'Muro Ruína NW Sul', 0.115, 0.18, 0.22, 0.16, 0.55, 1.15),

    // Ruína Nordeste
    makeWallSegment('ruin_ne_north', 'Muro Ruína NE Norte', 0.65, 0.10, 0.89, 0.105, 0.55, 1.35),
    makeWallSegment('ruin_ne_east', 'Muro Ruína NE Leste', 0.90, 0.11, 0.90, 0.25, 0.58, 1.45),
    makeWallSegment('ruin_ne_diag', 'Muro Ruína NE Interno', 0.635, 0.105, 0.59, 0.195, 0.52, 1.2),
    makeWallSegment('ruin_ne_mid', 'Muro Ruína NE Sul', 0.61, 0.18, 0.71, 0.20, 0.52, 1.15),

    // Ruína Oeste-Centro (próxima à árvore central esquerda)
    makeWallSegment('ruin_cw_top', 'Muro Centro-Oeste N', 0.195, 0.365, 0.375, 0.32, 0.58, 1.5),
    makeWallSegment('ruin_cw_side', 'Muro Centro-Oeste W', 0.195, 0.365, 0.255, 0.43, 0.58, 1.4),

    // Ruínas Leste-Centro (dois cômodos em losango)
    makeWallSegment('ruin_ce_a1', 'Sala Leste A - NW', 0.555, 0.33, 0.64, 0.28, 0.55, 1.4),
    makeWallSegment('ruin_ce_a2', 'Sala Leste A - NE', 0.64, 0.28, 0.705, 0.315, 0.55, 1.4),
    makeWallSegment('ruin_ce_a3', 'Sala Leste A - SW', 0.555, 0.33, 0.615, 0.37, 0.55, 1.3),
    makeWallSegment('ruin_ce_b1', 'Sala Leste B - E', 0.76, 0.34, 0.855, 0.375, 0.55, 1.4),
    makeWallSegment('ruin_ce_b2', 'Sala Leste B - S', 0.855, 0.375, 0.785, 0.435, 0.55, 1.35),
    makeWallSegment('ruin_ce_b3', 'Sala Leste B - SW', 0.71, 0.40, 0.785, 0.435, 0.52, 1.25),

    // Altar Circular Central (4 arcos de pedra deixando centro aberto)
    makeWallSegment('altar_nw', 'Altar Circular NW', 0.425, 0.49, 0.47, 0.45, 0.62, 1.55),
    makeWallSegment('altar_ne', 'Altar Circular NE', 0.505, 0.448, 0.56, 0.47, 0.62, 1.55),
    makeWallSegment('altar_se', 'Altar Circular SE', 0.585, 0.485, 0.555, 0.54, 0.62, 1.55),
    makeWallSegment('altar_sw', 'Altar Circular SW', 0.425, 0.515, 0.485, 0.548, 0.62, 1.55),

    // Ruína Sudoeste
    makeWallSegment('ruin_sw_w', 'Ruína SW Oeste', 0.175, 0.625, 0.275, 0.57, 0.55, 1.3),
    makeWallSegment('ruin_sw_s', 'Ruína SW Sul', 0.18, 0.635, 0.345, 0.71, 0.58, 1.4),

    // Bastião Sudeste (abaixo do riacho)
    makeWallSegment('ruin_se_e', 'Bastião SE Leste', 0.885, 0.815, 0.89, 0.935, 0.62, 1.5),
    makeWallSegment('ruin_se_s', 'Bastião SE Sul', 0.65, 0.935, 0.885, 0.935, 0.62, 1.45),
    makeWallSegment('ruin_se_w', 'Bastião SE Oeste', 0.645, 0.88, 0.65, 0.935, 0.58, 1.35),
  ];

  const props: PropDef[] = [
    // Colunas caídas & pilar de pé
    makeProp('col_fall_n', 'Coluna Caída Norte', 'fallen_pillar', 0.48, 0.055, 0.52, 1.0, 28, 'stone_brick'),
    makeProp('col_fall_mid', 'Coluna Caída Centro', 'fallen_pillar', 0.62, 0.65, 0.50, 1.05, 32, 'stone_brick'),
    makeProp('col_fall_sw', 'Coluna Caída SW', 'fallen_pillar', 0.19, 0.885, 0.48, 0.95, 112, 'stone_brick'),
    makeProp('col_fall_se', 'Coluna Caída SE', 'fallen_pillar', 0.675, 0.84, 0.50, 0.85, 138, 'stone_brick'),
    makeProp('col_stand_ce', 'Pilar Quebrado Centro', 'pillar', 0.70, 0.555, 0.50, 0.65, 0, 'stone_brick'),

    // Árvores e Moitas da cena original
    makeProp('tree_nw_ruin', 'Árvore Ruína NW', 'deciduous_tree', 0.32, 0.095, 0.55, 1.25, 25),
    makeProp('tree_ne_01', 'Árvore Canto NE A', 'deciduous_tree', 0.87, 0.02, 0.55, 1.75, 70),
    makeProp('tree_ne_02', 'Árvore Canto NE B', 'deciduous_tree', 0.96, 0.075, 0.55, 1.6, 140),
    makeProp('tree_cw_hero', 'Árvore Centro-Oeste', 'deciduous_tree', 0.25, 0.30, 0.55, 1.65, 45),
    makeProp('tree_w_edge', 'Árvore Borda Oeste', 'deciduous_tree', 0.03, 0.42, 0.55, 1.55, 110),
    makeProp('tree_sw_edge', 'Árvore Borda SW', 'deciduous_tree', 0.05, 0.71, 0.52, 1.5, 200),
    makeProp('tree_se_01', 'Árvore Riacho Leste A', 'deciduous_tree', 0.96, 0.63, 0.52, 1.6, 15),
    makeProp('tree_se_02', 'Árvore Riacho Leste B', 'deciduous_tree', 0.92, 0.73, 0.52, 1.55, 95),
    makeProp('tree_se_03', 'Árvore Canto SE', 'deciduous_tree', 0.95, 0.95, 0.52, 1.5, 180),
    makeProp('bush_s_mid', 'Moita Margem Sul', 'bush', 0.365, 0.83, 0.50, 1.25, 35),
    makeProp('bush_s_sw', 'Moita Margem SW', 'bush', 0.295, 0.865, 0.50, 0.95, 130),
  ];

  return {
    schemaVersion: '1.0',
    meta: {
      name: 'Ruínas no Riacho (Médio 5×5)',
      sourceLabel: 'ruinas-rio.jpg',
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
      subdivisions: 112,
      displacementScale: 1.15,
      normalStrength: 2.1,
      detailBlend: 0.55,
      smoothRadius: 2,
      invertHeight: false,
      heightMode: 'semantic_outdoor',
      textureMode: 'hybrid',
      fallbackMaterial: 'moss_earth',
      waterEnabled: true,
      waterElevation: 0.21,
    },
    structures,
    props,
    lighting: {
      sunAzimuthDeg: 318,
      sunElevationDeg: 54,
      sunIntensity: 1.85,
      ambientIntensity: 0.75,
      torchEnabled: true,
      torchIntensity: 2.0,
      torchColor: '#ffa84c',
    },
    worldGrammar: {
      scale: 'medium',
      seed: 2026,
      randomness: 0.48,
      treeDensity: 0.95,
      minTreeSpacing: 2.9,
      poiChance: 0.65,
      meanderStrength: 0.6,
      enableBridges: true,
    },
  };
}

