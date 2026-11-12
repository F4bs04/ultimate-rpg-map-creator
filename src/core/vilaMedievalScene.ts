import {
  PROJECTION_PRESETS,
  createDefaultWorldGrammar,
  type IsoDSLScene,
  type PropDef,
  type StructureDef,
} from '../types/isodsl';

const ASPECT = 723 / 1024; // 0.706055
const DEPTH = 72;
const WIDTH = Number((DEPTH * ASPECT).toFixed(3)); // 50.836m (calibrado pela barra 0..8m)

function uvToXZ(u: number, vTopDown: number): [number, number] {
  return [
    Number(((u - 0.5) * WIDTH).toFixed(2)),
    Number(((vTopDown - 0.5) * DEPTH).toFixed(2)),
  ];
}

function makeHouse(
  id: string,
  name: string,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  opts?: {
    floors?: number;
    floorHeight?: number;
    roofType?: StructureDef['roofType'];
    semanticTag?: StructureDef['semanticTag'];
    wallStyle?: StructureDef['wallStyle'];
    overhang?: number;
    includeFloorSlabs?: boolean;
    windows?: number;
    hasDoor?: boolean;
    hasChimney?: boolean;
    fallbackMaterial?: StructureDef['fallbackMaterial'];
    roofMaterial?: StructureDef['roofMaterial'];
    baseElevation?: number;
  }
): StructureDef {
  const minU = Math.min(u0, u1);
  const maxU = Math.max(u0, u1);
  const minV = Math.min(v0, v1);
  const maxV = Math.max(v0, v1);
  const [x0, z0] = uvToXZ(minU, minV);
  const [x1, z1] = uvToXZ(maxU, maxV);
  const floors = opts?.floors ?? 1;

  return {
    id,
    name,
    semanticTag: opts?.semanticTag ?? 'building',
    footprint: [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ],
    baseElevation: opts?.baseElevation ?? 0.9,
    floors,
    floorHeight: opts?.floorHeight ?? 2.3,
    wallStyle: opts?.wallStyle ?? 'timber_frame',
    upperFloorOverhang: opts?.overhang ?? (floors >= 2 ? 0.24 : 0),
    includeFloorSlabs: opts?.includeFloorSlabs ?? true,
    windowsPerWall: opts?.windows ?? 2,
    hasDoor: opts?.hasDoor ?? true,
    hasChimney: opts?.hasChimney ?? false,
    roofType: opts?.roofType ?? 'gable',
    roofPitchDeg: 38,
    roofOverhang: 0.35,
    hideRoof: false,
    textureMode: 'procedural',
    fallbackMaterial: opts?.fallbackMaterial ?? 'timber_plaster',
    roofMaterial: opts?.roofMaterial ?? 'roof_teal',
    visible: true,
  };
}

function makeRoundTower(
  id: string,
  name: string,
  uCenter: number,
  vCenter: number,
  radiusMeters: number,
  opts?: {
    floors?: number;
    floorHeight?: number;
    roofType?: StructureDef['roofType'];
    windows?: number;
    hasDoor?: boolean;
    baseElevation?: number;
    roofMaterial?: StructureDef['roofMaterial'];
  }
): StructureDef {
  const [cx, cz] = uvToXZ(uCenter, vCenter);
  const sides = 10;
  const footprint: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    footprint.push([
      Number((cx + Math.cos(a) * radiusMeters).toFixed(2)),
      Number((cz - Math.sin(a) * radiusMeters).toFixed(2)),
    ]);
  }
  const floors = opts?.floors ?? 2;
  return {
    id,
    name,
    semanticTag: 'tower',
    footprint,
    baseElevation: opts?.baseElevation ?? 0.9,
    floors,
    floorHeight: opts?.floorHeight ?? 2.3,
    wallStyle: 'buttress',
    upperFloorOverhang: 0,
    includeFloorSlabs: true,
    windowsPerWall: opts?.windows ?? 1,
    hasDoor: opts?.hasDoor ?? true,
    hasChimney: false,
    roofType: opts?.roofType ?? 'cone',
    roofPitchDeg: 44,
    roofOverhang: 0.25,
    hideRoof: false,
    textureMode: 'procedural',
    fallbackMaterial: 'stone_brick',
    roofMaterial: opts?.roofMaterial ?? 'roof_teal',
    visible: true,
  };
}

function makeAngledWall(
  id: string,
  name: string,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  thickness = 0.72,
  height = 1.65,
  baseElevation = 0.72
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
    baseElevation,
    floors: 1,
    floorHeight: height,
    wallStyle: 'buttress',
    includeFloorSlabs: false,
    windowsPerWall: 0,
    hasDoor: false,
    roofType: 'parapet',
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
 * Tradução arquitetônica completa da imagem "Vila Medieval no Rio" (723x1024, barra 0..8m)
 * com casas enxaimel de 1 e 2 andares (balanço jetty, pisos internos, portas, janelas iluminadas,
 * chaminés e telhados azul-turquesa), torres redondas, ruínas no penhasco e poço central.
 */
export function createVilaMedievalScene(): IsoDSLScene {
  const preset = PROJECTION_PRESETS.top_down;

  const structures: StructureDef[] = [
    // 1. Abrigo da Floresta (Noroeste)
    makeHouse('forest_shrine', 'Abrigo da Mata NW', 0.115, 0.15, 0.155, 0.19, {
      floors: 1,
      windows: 1,
    }),

    // 2. Serraria / Acampamento Lenhador (Nordeste)
    makeHouse('sawmill_north', 'Serraria Norte', 0.80, 0.21, 0.85, 0.248, {
      floors: 1,
      hasChimney: true,
      windows: 1,
    }),
    makeHouse('sawmill_south', 'Oficina Madeira', 0.798, 0.258, 0.855, 0.298, {
      floors: 1,
      windows: 2,
    }),

    // 3. Fazenda / Pátio Noroeste
    makeHouse('farm_barn_w', 'Celeiro Oeste', 0.192, 0.32, 0.236, 0.37, {
      floors: 1,
      windows: 1,
    }),
    makeHouse('farm_main', 'Casa da Fazenda (2 Andares)', 0.232, 0.34, 0.295, 0.378, {
      floors: 2,
      overhang: 0.24,
      hasChimney: true,
      windows: 2,
    }),
    makeHouse('farm_shed_s', 'Anexo Pátio Sul', 0.234, 0.388, 0.292, 0.432, {
      floors: 1,
      windows: 1,
    }),
    makeHouse('farm_granary', 'Celeiro Grande Leste (2 Andares)', 0.308, 0.324, 0.378, 0.376, {
      floors: 2,
      roofType: 'hip',
      overhang: 0.26,
      windows: 2,
    }),

    // 4. Núcleo da Vila — Lado Oeste da Estrada
    makeHouse('guard_post_n', 'Posto Norte', 0.518, 0.49, 0.562, 0.525, {
      floors: 1,
      roofType: 'hip',
      windows: 1,
    }),
    makeRoundTower('guild_turret', 'Torre da Guilda', 0.506, 0.553, 1.15, {
      floors: 2,
      roofType: 'cone',
      windows: 1,
    }),
    makeHouse('guild_hall', 'Salão da Guilda', 0.508, 0.556, 0.555, 0.588, {
      floors: 1,
      windows: 2,
    }),
    makeHouse('market_manor', 'Casa do Mercado (2 Andares)', 0.576, 0.532, 0.642, 0.572, {
      floors: 2,
      overhang: 0.25,
      roofType: 'hip',
      hasChimney: true,
      windows: 2,
    }),
    makeHouse('mid_cottage_a', 'Casa Praça Centro', 0.552, 0.602, 0.604, 0.634, {
      floors: 1,
      windows: 1,
    }),
    makeHouse('mid_cottage_b', 'Casa Praça Leste', 0.606, 0.602, 0.652, 0.636, {
      floors: 1,
      hasChimney: true,
      windows: 1,
    }),
    makeHouse('inn_west_wing', 'Ala Oeste Estalagem', 0.552, 0.654, 0.606, 0.688, {
      floors: 1,
      hasChimney: true,
      windows: 2,
    }),
    makeHouse('inn_main_2f', 'Estalagem Principal (2 Andares)', 0.612, 0.648, 0.686, 0.684, {
      floors: 2,
      overhang: 0.26,
      hasChimney: true,
      windows: 2,
    }),
    makeRoundTower('inn_tower', 'Torre Redonda Estalagem', 0.699, 0.655, 1.05, {
      floors: 2,
      roofType: 'cone',
      windows: 1,
    }),
    makeHouse('inn_south_annex', 'Anexo Sul Estalagem', 0.635, 0.684, 0.678, 0.722, {
      floors: 1,
      hasChimney: true,
      windows: 1,
    }),

    // 5. Núcleo da Vila — Lado Leste da Estrada
    makeHouse('bakery_north', 'Padaria Norte', 0.73, 0.444, 0.785, 0.478, {
      floors: 1,
      roofType: 'hip',
      windows: 1,
    }),
    makeHouse('cottage_east_1', 'Casa Horta', 0.735, 0.482, 0.794, 0.512, {
      floors: 1,
      windows: 1,
    }),
    makeHouse('tavern_manor_2f', 'Casarão Forja & Taverna (2 Andares)', 0.725, 0.516, 0.808, 0.556, {
      floors: 2,
      overhang: 0.28,
      hasChimney: true,
      windows: 3,
    }),
    makeHouse('smithy_wing', 'Oficina Ferreiro', 0.748, 0.556, 0.805, 0.592, {
      floors: 1,
      windows: 2,
    }),
    makeHouse('row_house_1', 'Casa da Ferraria', 0.772, 0.612, 0.832, 0.646, {
      floors: 1,
      hasChimney: true,
      windows: 2,
    }),
    makeHouse('stable_2f', 'Estábulo do Curral (2 Andares)', 0.818, 0.648, 0.878, 0.692, {
      floors: 2,
      overhang: 0.22,
      roofType: 'hip',
      windows: 2,
    }),
    makeHouse('cottage_east_2', 'Casa Travessa', 0.784, 0.654, 0.828, 0.692, {
      floors: 1,
      windows: 1,
    }),
    makeHouse('manor_south_2f', 'Casa Sul da Vila (2 Andares)', 0.76, 0.714, 0.824, 0.754, {
      floors: 2,
      overhang: 0.24,
      hasChimney: true,
      windows: 2,
    }),

    // 6. Penhasco Sudoeste — Ruínas de Pedra, Torre Circular e Ponte
    makeAngledWall('cliff_ruin_nw', 'Muralha Penhasco NW', 0.215, 0.635, 0.275, 0.61, 0.75, 1.8, 0.78),
    makeAngledWall('cliff_ruin_sw', 'Muralha Penhasco SW', 0.19, 0.675, 0.25, 0.715, 0.75, 1.7, 0.78),
    makeAngledWall('cliff_ruin_ne', 'Muralha Penhasco NE', 0.34, 0.625, 0.388, 0.69, 0.75, 1.7, 0.78),
    makeRoundTower('cliff_round_tower', 'Torre em Ruína do Penhasco', 0.328, 0.708, 1.32, {
      floors: 1,
      floorHeight: 2.3,
      roofType: 'parapet',
      hasDoor: true,
      windows: 1,
      roofMaterial: 'stone_brick',
      baseElevation: 0.98,
    }),
    makeHouse('rapids_bridge', 'Passarela sobre Corredeiras', 0.132, 0.77, 0.172, 0.798, {
      semanticTag: 'bridge',
      floors: 1,
      floorHeight: 0.55,
      roofType: 'flat',
      hasDoor: false,
      windows: 0,
      includeFloorSlabs: false,
      fallbackMaterial: 'wood_plank',
      roofMaterial: 'wood_plank',
      baseElevation: 0.36,
    }),

    // 7. Margem do Rio & Porto (Sul)
    makeHouse('river_warehouse', 'Armazém da Praia', 0.568, 0.80, 0.638, 0.83, {
      floors: 1,
      windows: 2,
    }),
    makeHouse('ferry_boathouse', 'Casa da Balsa (2 Andares)', 0.745, 0.832, 0.82, 0.875, {
      floors: 2,
      overhang: 0.22,
      windows: 2,
    }),
    makeHouse('south_bank_hut', 'Cabana Margem Sul', 0.256, 0.924, 0.296, 0.966, {
      floors: 1,
      windows: 1,
    }),
  ];

  const props: PropDef[] = [
    // Poço no centro da praça da vila
    makeProp('village_well', 'Poço da Praça', 'well', 0.692, 0.632, 0.62, 1.15, 15, 'stone_brick'),
    // Grande rochedo abaixo da fazenda NW
    makeProp('cliff_boulder', 'Grande Rocha Oeste', 'rock', 0.246, 0.485, 0.65, 3.1, 25, 'stone_brick'),
    // Pilha de toras/caixotes na serraria NE
    makeProp('sawmill_crates', 'Madeira Serraria', 'crate', 0.865, 0.24, 0.62, 1.3, 40, 'wood_plank'),
    // Barcos atracados na praia sul
    makeProp('beach_boat_1', 'Barco Praia A', 'boat', 0.648, 0.88, 0.28, 0.95, 175, 'wood_plank'),
    makeProp('beach_boat_2', 'Barco Praia B', 'boat', 0.672, 0.88, 0.28, 0.95, 185, 'wood_plank'),
    makeProp('beach_boat_3', 'Barco Porto C', 'boat', 0.742, 0.868, 0.3, 1.0, 215, 'wood_plank'),
    makeProp('inn_barrel_1', 'Barris Estalagem', 'barrel', 0.67, 0.625, 0.62, 1.0, 20, 'wood_plank'),
    makeProp('smithy_brazier', 'Forja Braseiro', 'brazier', 0.818, 0.545, 0.62, 1.0, 0, 'stone_brick'),
    // Árvores centrais da bifurcação & praça
    makeProp('tree_cross_w', 'Árvore Estrada W', 'deciduous_tree', 0.64, 0.365, 0.65, 1.75, 20),
    makeProp('tree_cross_e', 'Árvore Estrada E', 'deciduous_tree', 0.715, 0.36, 0.65, 1.65, 85),
    makeProp('tree_mid_a', 'Árvore Clareira A', 'deciduous_tree', 0.48, 0.405, 0.65, 1.85, 140),
    makeProp('tree_mid_b', 'Árvore Clareira B', 'deciduous_tree', 0.535, 0.40, 0.65, 1.65, 210),
    makeProp('tree_cliff', 'Árvore Penhasco', 'deciduous_tree', 0.398, 0.59, 0.75, 1.7, 50),

    // Pomar organizado no canto sudeste (8 árvores em 2 fileiras)
    makeProp('orchard_1', 'Pomar 1', 'deciduous_tree', 0.83, 0.78, 0.65, 1.3, 15),
    makeProp('orchard_2', 'Pomar 2', 'deciduous_tree', 0.885, 0.77, 0.65, 1.3, 75),
    makeProp('orchard_3', 'Pomar 3', 'deciduous_tree', 0.94, 0.76, 0.65, 1.3, 130),
    makeProp('orchard_4', 'Pomar 4', 'deciduous_tree', 0.84, 0.825, 0.65, 1.3, 195),
    makeProp('orchard_5', 'Pomar 5', 'deciduous_tree', 0.90, 0.815, 0.65, 1.3, 250),
    makeProp('orchard_6', 'Pomar 6', 'deciduous_tree', 0.955, 0.805, 0.65, 1.3, 305),
    makeProp('orchard_7', 'Pomar 7', 'deciduous_tree', 0.855, 0.875, 0.65, 1.3, 45),
    makeProp('orchard_8', 'Pomar 8', 'deciduous_tree', 0.92, 0.865, 0.65, 1.3, 115),
  ];

  return {
    schemaVersion: '1.0',
    meta: {
      name: 'Vila Medieval no Rio',
      sourceLabel: 'vila-medieval-rio.jpg',
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
      subdivisions: 128,
      displacementScale: 1.25,
      normalStrength: 2.1,
      detailBlend: 0.55,
      smoothRadius: 2,
      invertHeight: false,
      heightMode: 'semantic_outdoor',
      textureMode: 'hybrid',
      fallbackMaterial: 'moss_earth',
      waterEnabled: true,
      waterElevation: 0.22,
    },
    structures,
    props,
    lighting: {
      sunAzimuthDeg: 320,
      sunElevationDeg: 52,
      sunIntensity: 1.9,
      ambientIntensity: 0.72,
      torchEnabled: true,
      torchIntensity: 2.4,
      torchColor: '#ff9d42',
    },
    worldGrammar: {
      ...createDefaultWorldGrammar(),
      scale: 'small',
      seed: 2026,
      randomness: 0.48,
      treeDensity: 0.95,
      minTreeSpacing: 3.2,
      poiChance: 0.55,
      meanderStrength: 0.55,
      enableBridges: true,
    },
  };
}
