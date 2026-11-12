import {
  PROJECTION_PRESETS,
  type IsoDSLScene,
  type MaterialPreset,
  type PropDef,
  type StructureDef,
} from '../types/isodsl';

// Porto & Rio Rustymaps: 746 x 1024 px -> aspectRatio = 0.7285
const IMG_W = 746;
const IMG_H = 1024;
const ASPECT = Number((IMG_W / IMG_H).toFixed(4));
const DEPTH = 80; // metros reais (~80m norte-sul -> pontes ~7.5m, ruas ~3m, avatar 1.72m)
const WIDTH = Number((DEPTH * (IMG_W / IMG_H)).toFixed(3)); // 58.281 m

function uvToXZ(u: number, v: number): [number, number] {
  return [
    Number(((u - 0.5) * WIDTH).toFixed(2)),
    Number(((v - 0.5) * DEPTH).toFixed(2)),
  ];
}

function makeRectStructure(
  id: string,
  name: string,
  cu: number,
  cv: number,
  widthM: number,
  depthM: number,
  angleDeg = 0,
  opts?: {
    semanticTag?: StructureDef['semanticTag'];
    baseElevation?: number;
    floors?: number;
    floorHeight?: number;
    roofType?: StructureDef['roofType'];
    roofMaterial?: MaterialPreset;
    fallbackMaterial?: MaterialPreset;
    wallStyle?: StructureDef['wallStyle'];
    overhang?: number;
    hasDoor?: boolean;
    hasChimney?: boolean;
    windows?: number;
    floorStyle?: StructureDef['floorStyle'];
    includeFloorSlabs?: boolean;
  }
): StructureDef {
  const [cx, cz] = uvToXZ(cu, cv);
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = widthM * 0.5;
  const hd = depthM * 0.5;

  const corners: [number, number][] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([lx, lz]) => [
    Number((cx + lx * cos - lz * sin).toFixed(2)),
    Number((cz + lx * sin + lz * cos).toFixed(2)),
  ]);

  const floors = opts?.floors ?? 1;
  const tag = opts?.semanticTag ?? 'building';
  const roofType = opts?.roofType ?? (tag === 'bridge' || tag === 'wall' ? 'flat' : 'gable');

  return {
    id,
    name,
    semanticTag: tag,
    footprint: corners,
    baseElevation: opts?.baseElevation ?? 0.42,
    floors,
    floorHeight: opts?.floorHeight ?? 2.0,
    wallStyle: opts?.wallStyle ?? (tag === 'building' ? 'timber_frame' : 'buttress'),
    upperFloorOverhang: opts?.overhang ?? (floors >= 2 && tag === 'building' ? 0.2 : 0),
    includeFloorSlabs: opts?.includeFloorSlabs ?? tag === 'building',
    floorStyle: opts?.floorStyle ?? 'projected',
    windowsPerWall: opts?.windows ?? (tag === 'building' ? 1 : 0),
    hasDoor: opts?.hasDoor ?? tag === 'building',
    hasChimney: opts?.hasChimney ?? false,
    roofType,
    roofPitchDeg: roofType === 'hip' ? 35 : roofType === 'flat' ? 0 : 37,
    roofOverhang: roofType === 'flat' ? 0.04 : 0.28,
    hideRoof: false,
    textureMode: 'procedural',
    fallbackMaterial: opts?.fallbackMaterial ?? 'timber_plaster',
    roofMaterial: opts?.roofMaterial ?? 'roof_terracotta',
    visible: true,
  };
}

function makeWallSegment(
  id: string,
  name: string,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  thickness = 0.72,
  height = 1.65,
  baseElevation = 0.48,
  material: MaterialPreset = 'wood_plank'
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
    roofType: 'flat',
    roofPitchDeg: 0,
    roofOverhang: 0.02,
    hideRoof: false,
    textureMode: 'procedural',
    fallbackMaterial: material,
    roofMaterial: material,
    visible: true,
  };
}

function makeRoundTower(
  id: string,
  name: string,
  cu: number,
  cv: number,
  radiusM: number,
  opts?: {
    baseElevation?: number;
    floors?: number;
    floorHeight?: number;
    roofMaterial?: MaterialPreset;
    fallbackMaterial?: MaterialPreset;
    hasDoor?: boolean;
  }
): StructureDef {
  const [cx, cz] = uvToXZ(cu, cv);
  const footprint: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    footprint.push([
      Number((cx + Math.cos(a) * radiusM).toFixed(2)),
      Number((cz + Math.sin(a) * radiusM).toFixed(2)),
    ]);
  }
  return {
    id,
    name,
    semanticTag: 'tower',
    footprint,
    baseElevation: opts?.baseElevation ?? 0.55,
    floors: opts?.floors ?? 2,
    floorHeight: opts?.floorHeight ?? 2.1,
    wallStyle: 'buttress',
    upperFloorOverhang: 0,
    includeFloorSlabs: true,
    floorStyle: 'wood_plank',
    windowsPerWall: 1,
    hasDoor: opts?.hasDoor ?? true,
    roofType: 'cone',
    roofPitchDeg: 35,
    roofOverhang: 0.28,
    hideRoof: false,
    textureMode: 'procedural',
    fallbackMaterial: opts?.fallbackMaterial ?? 'stone_brick',
    roofMaterial: opts?.roofMaterial ?? 'roof_terracotta',
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
  fallbackMaterial: PropDef['fallbackMaterial'] = 'moss_earth',
  y = 0.42
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
 * Vila Portuária & Forte Fluvial ("Art by Rustymaps", 746x1024):
 * Colina fortificada a NW com paliçada, torres de vigia e mansão senhorial; rio diagonal com
 * 2 pontes de pedra, 6 píeres de madeira com embarcações atracadas, baía sudoeste com farol
 * costeiro e fortaleza amuralhada com torre circular no alto da colina leste.
 */
export function createPortoRustymapsScene(): IsoDSLScene {
  const preset = PROJECTION_PRESETS.top_down;

  const structures: StructureDef[] = [
    // --- 1. MURALHA / PALIÇADA NOROESTE & TORRES DE VIGIA ---
    makeWallSegment('wall_nw_sw', 'Paliçada Porto Oeste', 0.172, 0.538, 0.145, 0.492, 0.65, 1.55, 0.36),
    makeWallSegment('wall_nw_w1', 'Paliçada Oeste Sul', 0.142, 0.486, 0.098, 0.352, 0.65, 1.6, 0.44),
    // Abertura natural em v ~ 0.32..0.348 para a estrada oeste cruzar o portão
    makeWallSegment('wall_nw_w2', 'Paliçada Oeste Norte', 0.088, 0.296, 0.112, 0.186, 0.65, 1.65, 0.48),
    makeWallSegment('wall_nw_nw', 'Paliçada Noroeste', 0.116, 0.18, 0.228, 0.038, 0.68, 1.7, 0.54),
    makeWallSegment('wall_nw_n', 'Paliçada Norte', 0.236, 0.036, 0.392, 0.048, 0.68, 1.75, 0.58),
    makeWallSegment('wall_nw_ne', 'Paliçada Nordeste', 0.4, 0.052, 0.618, 0.184, 0.68, 1.65, 0.5),

    makeRoundTower('tower_wall_port', 'Torre Vigia Porto NW', 0.174, 0.54, 1.0, {
      baseElevation: 0.36,
      floors: 2,
      floorHeight: 1.8,
      hasDoor: false,
    }),
    makeRoundTower('tower_wall_w', 'Torre Vigia Oeste', 0.112, 0.184, 1.05, {
      baseElevation: 0.5,
      floors: 2,
      floorHeight: 1.9,
      hasDoor: false,
    }),
    makeRoundTower('tower_wall_n', 'Torre Vigia Norte', 0.396, 0.048, 1.05, {
      baseElevation: 0.56,
      floors: 2,
      floorHeight: 1.9,
      hasDoor: false,
    }),
    makeRoundTower('tower_wall_ne', 'Torre Vigia Rio Norte', 0.62, 0.184, 1.0, {
      baseElevation: 0.48,
      floors: 2,
      floorHeight: 1.8,
      hasDoor: false,
    }),

    // --- 2. CIDADELA ALTA NOROESTE (MANSÃO & ANEXOS) ---
    makeRectStructure('b_nw_manor', 'Solar do Governador', 0.394, 0.182, 5.8, 3.6, 40, {
      baseElevation: 0.66,
      floors: 2,
      floorHeight: 2.05,
      roofType: 'hip',
      roofMaterial: 'roof_terracotta',
      hasChimney: true,
      windows: 2,
    }),
    makeRectStructure('b_nw_guest', 'Casa Hóspedes Colina', 0.302, 0.165, 3.5, 2.5, -24, {
      baseElevation: 0.66,
      floors: 1,
      roofType: 'gable',
      roofMaterial: 'roof_terracotta',
      hasChimney: true,
    }),
    makeRectStructure('b_nw_guard_e', 'Corpo da Guarda Colina', 0.392, 0.252, 2.6, 2.0, 38, {
      baseElevation: 0.6,
      floors: 1,
      roofType: 'gable',
    }),
    makeRectStructure('b_nw_gatehouse', 'Guarida da Rampa', 0.352, 0.305, 3.1, 2.2, 28, {
      baseElevation: 0.52,
      floors: 1,
      roofType: 'gable',
    }),
    makeRectStructure('b_river_n_post', 'Posto Ribeirinho Norte', 0.582, 0.212, 3.2, 2.3, -38, {
      baseElevation: 0.42,
      floors: 1,
      roofType: 'gable',
    }),

    // --- 3. PONTES SOBRE O RIO & PÍERES PORTUÁRIOS ---
    makeRectStructure('bridge_main', 'Ponte Principal do Porto', 0.408, 0.432, 7.6, 2.3, 45, {
      semanticTag: 'bridge',
      baseElevation: 0.38,
      floors: 1,
      floorHeight: 0.44,
      roofType: 'flat',
      roofMaterial: 'stone_brick',
      fallbackMaterial: 'stone_brick',
      hasDoor: false,
      windows: 0,
      includeFloorSlabs: false,
    }),
    makeRectStructure('bridge_north', 'Ponte Norte', 0.554, 0.298, 7.6, 2.0, 41, {
      semanticTag: 'bridge',
      baseElevation: 0.38,
      floors: 1,
      floorHeight: 0.42,
      roofType: 'flat',
      roofMaterial: 'stone_brick',
      fallbackMaterial: 'stone_brick',
      hasDoor: false,
      windows: 0,
      includeFloorSlabs: false,
    }),
    // Píeres / docas de madeira avançando sobre a água
    makeRectStructure('pier_w_1', 'Píer Doca Oeste 1', 0.268, 0.488, 3.8, 0.95, 45, {
      semanticTag: 'bridge',
      baseElevation: 0.22,
      floors: 1,
      floorHeight: 0.32,
      roofType: 'flat',
      roofMaterial: 'wood_plank',
      fallbackMaterial: 'wood_plank',
      hasDoor: false,
      windows: 0,
      includeFloorSlabs: false,
    }),
    makeRectStructure('pier_w_2', 'Píer Doca Oeste 2', 0.306, 0.458, 3.8, 0.95, 45, {
      semanticTag: 'bridge',
      baseElevation: 0.22,
      floors: 1,
      floorHeight: 0.32,
      roofType: 'flat',
      roofMaterial: 'wood_plank',
      fallbackMaterial: 'wood_plank',
      hasDoor: false,
      windows: 0,
      includeFloorSlabs: false,
    }),
    makeRectStructure('pier_center_1', 'Píer Armazém Central 1', 0.476, 0.342, 3.3, 0.9, 44, {
      semanticTag: 'bridge',
      baseElevation: 0.22,
      floors: 1,
      floorHeight: 0.32,
      roofType: 'flat',
      roofMaterial: 'wood_plank',
      fallbackMaterial: 'wood_plank',
      hasDoor: false,
      windows: 0,
      includeFloorSlabs: false,
    }),
    makeRectStructure('pier_center_2', 'Píer Armazém Central 2', 0.506, 0.318, 3.1, 0.85, 44, {
      semanticTag: 'bridge',
      baseElevation: 0.22,
      floors: 1,
      floorHeight: 0.32,
      roofType: 'flat',
      roofMaterial: 'wood_plank',
      fallbackMaterial: 'wood_plank',
      hasDoor: false,
      windows: 0,
      includeFloorSlabs: false,
    }),
    makeRectStructure('pier_north', 'Píer Ribeirinho Norte', 0.594, 0.24, 3.2, 0.85, 43, {
      semanticTag: 'bridge',
      baseElevation: 0.22,
      floors: 1,
      floorHeight: 0.32,
      roofType: 'flat',
      roofMaterial: 'wood_plank',
      fallbackMaterial: 'wood_plank',
      hasDoor: false,
      windows: 0,
      includeFloorSlabs: false,
    }),
    makeRectStructure('pier_bay_sw', 'Trapiche da Enseada', 0.245, 0.562, 3.4, 0.88, 42, {
      semanticTag: 'bridge',
      baseElevation: 0.22,
      floors: 1,
      floorHeight: 0.32,
      roofType: 'flat',
      roofMaterial: 'wood_plank',
      fallbackMaterial: 'wood_plank',
      hasDoor: false,
      windows: 0,
      includeFloorSlabs: false,
    }),

    // --- 4. ZONA PORTUÁRIA & ENCRUZILHADA OESTE ---
    makeRectStructure('b_w_warehouse', 'Armazém das Docas', 0.285, 0.405, 4.4, 2.7, -18, {
      floors: 2,
      roofType: 'gable',
      hasChimney: true,
    }),
    makeRectStructure('b_w_customs', 'Alfândega da Ponte', 0.342, 0.402, 3.1, 2.4, -42, {
      floors: 1,
      roofType: 'hip',
      roofMaterial: 'roof_slate',
    }),
    makeRectStructure('b_dock_w_shed', 'Estaleiro Oeste', 0.192, 0.505, 3.0, 2.1, -36, {
      floors: 1,
      roofType: 'gable',
    }),
    makeRectStructure('b_dock_w_booth', 'Cabana dos Remos', 0.268, 0.464, 2.6, 1.8, -38, {
      floors: 1,
      roofType: 'gable',
    }),
    makeRectStructure('b_port_hall', 'Grande Armazém do Cais', 0.455, 0.322, 5.8, 2.8, -40, {
      floors: 2,
      roofType: 'hip',
      hasChimney: true,
      windows: 2,
    }),

    // --- 5. BAIRRO CENTRAL & PRAÇA DO MERCADO ---
    makeRectStructure('b_center_guild', 'Prefeitura / Capitania', 0.468, 0.505, 3.7, 3.0, 0, {
      floors: 2,
      roofType: 'hip',
      roofMaterial: 'roof_slate',
      hasChimney: true,
      windows: 2,
    }),
    makeRectStructure('b_center_merchant', 'Casa dos Mercadores', 0.514, 0.518, 3.1, 2.5, -10, {
      floors: 1,
      roofType: 'gable',
    }),
    makeRectStructure('b_bridge_n_east', 'Posto da Ponte Norte', 0.625, 0.342, 2.9, 2.1, -45, {
      floors: 1,
      roofType: 'gable',
    }),
    makeRectStructure('b_row_1', 'Sobrado Ribeirinho 1', 0.578, 0.395, 2.8, 2.1, -42, {
      floors: 1,
      roofType: 'gable',
    }),
    makeRectStructure('b_row_2', 'Sobrado Ribeirinho 2', 0.552, 0.422, 2.7, 2.1, -42, {
      floors: 1,
      roofType: 'gable',
    }),
    makeRectStructure('b_row_3', 'Oficina do Cais', 0.605, 0.428, 2.7, 2.0, -45, {
      floors: 1,
      roofType: 'gable',
    }),
    makeRectStructure('b_row_4', 'Estalagem do Porto', 0.552, 0.478, 3.4, 2.3, -45, {
      floors: 2,
      roofType: 'gable',
      hasChimney: true,
    }),

    // --- 6. LAVOURAS NORDESTE ---
    makeRectStructure('b_ne_farm_1', 'Celeiro Nordeste', 0.742, 0.348, 3.1, 2.2, -45, {
      floors: 1,
      roofType: 'gable',
    }),
    makeRectStructure('b_ne_farm_2', 'Casa do Lavrador', 0.748, 0.385, 2.7, 2.0, 5, {
      floors: 1,
      roofType: 'gable',
    }),
    makeRectStructure('b_ne_shack', 'Cabana Estrada Leste', 0.855, 0.298, 2.2, 1.8, 0, {
      floors: 1,
      roofType: 'gable',
    }),

    // --- 7. BAIRRO DA PRAIA & ENSEADA SUDOESTE ---
    makeRectStructure('b_bay_1', 'Casa dos Pescadores 1', 0.352, 0.595, 3.3, 2.5, -35, {
      floors: 1,
      roofType: 'gable',
    }),
    makeRectStructure('b_bay_2', 'Casa dos Pescadores 2', 0.318, 0.642, 2.9, 2.2, 0, {
      floors: 1,
      roofType: 'gable',
    }),
    makeRectStructure('b_bay_3', 'Secadouro da Praia', 0.252, 0.708, 3.6, 2.5, -20, {
      floors: 1,
      roofType: 'gable',
    }),
    makeRectStructure('b_bay_4', 'Taverna da Enseada', 0.358, 0.705, 3.3, 2.4, -35, {
      floors: 2,
      roofType: 'gable',
      hasChimney: true,
    }),
    makeRectStructure('b_bay_mid', 'Casa Encosta Sul', 0.422, 0.642, 3.1, 2.4, 40, {
      floors: 1,
      roofType: 'gable',
    }),
    makeRectStructure('b_market_south', 'Celeiro Sul', 0.525, 0.648, 4.2, 2.6, 0, {
      floors: 1,
      roofType: 'gable',
    }),

    // --- 8. CIDADELA FORTIFICADA NA COLINA LESTE ---
    makeRoundTower('fort_keep_round', 'Torreão Redondo Leste', 0.678, 0.528, 2.15, {
      baseElevation: 0.68,
      floors: 2,
      floorHeight: 2.35,
      roofMaterial: 'roof_terracotta',
      fallbackMaterial: 'stone_brick',
    }),
    makeRectStructure('fort_wing_ne', 'Caserna Leste Norte', 0.768, 0.492, 4.3, 2.1, 35, {
      baseElevation: 0.66,
      floors: 2,
      floorHeight: 2.05,
      wallStyle: 'buttress',
      fallbackMaterial: 'stone_brick',
      roofType: 'hip',
      roofMaterial: 'roof_terracotta',
    }),
    makeRectStructure('fort_wing_se', 'Caserna Leste Sul', 0.768, 0.538, 4.0, 2.0, -52, {
      baseElevation: 0.66,
      floors: 2,
      floorHeight: 2.0,
      wallStyle: 'buttress',
      fallbackMaterial: 'stone_brick',
      roofType: 'gable',
      roofMaterial: 'roof_terracotta',
    }),
    makeRectStructure('fort_wing_nw', 'Pavilhão do Comando', 0.718, 0.482, 3.1, 1.8, -52, {
      baseElevation: 0.66,
      floors: 2,
      floorHeight: 1.95,
      wallStyle: 'buttress',
      fallbackMaterial: 'stone_brick',
      roofType: 'gable',
      roofMaterial: 'roof_terracotta',
    }),
    makeWallSegment('fort_wall_sw', 'Cortina Sul da Cidadela', 0.696, 0.535, 0.742, 0.556, 0.72, 2.3, 0.66, 'stone_brick'),

    // --- 9. FAROL COSTEIRO & ENCOSTA SUL ---
    makeRectStructure('b_coastal_lighthouse', 'Farol da Baía', 0.432, 0.858, 2.5, 2.5, 0, {
      baseElevation: 0.46,
      floors: 2,
      floorHeight: 2.35,
      wallStyle: 'buttress',
      fallbackMaterial: 'stone_brick',
      roofType: 'hip',
      roofMaterial: 'roof_terracotta',
      hasChimney: true,
    }),
    makeRectStructure('b_south_ridge_1', 'Cabana das Lavouras', 0.542, 0.708, 2.6, 2.0, -10, {
      floors: 1,
      roofType: 'gable',
    }),
    makeRectStructure('b_south_ridge_2', 'Casa Encosta SE 1', 0.682, 0.712, 2.7, 2.1, -30, {
      floors: 1,
      roofType: 'gable',
    }),
    makeRectStructure('b_south_ridge_3', 'Vila da Colina SE', 0.765, 0.728, 3.9, 2.7, 0, {
      baseElevation: 0.56,
      floors: 2,
      roofType: 'hip',
      hasChimney: true,
    }),
    makeRectStructure('b_south_ridge_4', 'Solar Sul da Colina', 0.742, 0.785, 3.8, 2.6, -18, {
      baseElevation: 0.56,
      floors: 2,
      roofType: 'gable',
      hasChimney: true,
    }),
    makeRectStructure('b_east_road_gate', 'Posto Estrada Leste', 0.842, 0.712, 2.2, 1.8, 0, {
      floors: 1,
      roofType: 'gable',
    }),
    makeRectStructure('b_south_gate_hut', 'Posto Estrada Sul', 0.622, 0.902, 2.2, 1.8, -20, {
      floors: 1,
      roofType: 'gable',
    }),
  ];

  const props: PropDef[] = [
    // Lago / fonte ornamental no pátio da mansão NW
    makeProp('fountain_nw_manor', 'Fonte da Colina NW', 'well', 0.318, 0.215, 1.15, 0, 'stone_brick', 0.64),
    // Braseiro aceso no Farol da Baía
    makeProp('beacon_lighthouse', 'Farol Aceso', 'brazier', 0.432, 0.842, 1.1, 0, 'stone_brick', 0.52),

    // Barcos atracados nos píeres e enseada
    makeProp('boat_dock_1', 'Barco Cais Oeste 1', 'boat', 0.298, 0.502, 1.15, -42, 'wood_plank', 0.16),
    makeProp('boat_dock_2', 'Barco Cais Oeste 2', 'boat', 0.334, 0.464, 1.05, -38, 'wood_plank', 0.16),
    makeProp('boat_center', 'Balsa Armazém Central', 'boat', 0.488, 0.354, 1.1, -46, 'wood_plank', 0.16),
    makeProp('boat_north', 'Barco Ribeirinho Norte', 'boat', 0.612, 0.258, 1.0, -42, 'wood_plank', 0.16),
    makeProp('boat_bay', 'Saveiro da Baía', 'boat', 0.228, 0.584, 1.15, -35, 'wood_plank', 0.16),

    // Barris & caixotes de carga nos píeres e armazéns
    makeProp('cargo_barrel_1', 'Barris Cais Oeste', 'barrel', 0.255, 0.474, 0.95, 25, 'wood_plank', 0.38),
    makeProp('cargo_crate_1', 'Caixotes Armazém', 'crate', 0.442, 0.335, 0.95, 42, 'wood_plank', 0.38),
    makeProp('cargo_barrel_2', 'Barris Armazém Central', 'barrel', 0.462, 0.352, 0.9, 15, 'wood_plank', 0.38),
    makeProp('cargo_crate_2', 'Caixotes Enseada', 'crate', 0.278, 0.542, 0.9, 12, 'wood_plank', 0.38),

    // Bosques & árvores espalhadas conforme vegetação do mapa
    makeProp('tree_nw_1', 'Árvore Muralha NW 1', 'deciduous_tree', 0.068, 0.045, 1.9, 20),
    makeProp('tree_nw_2', 'Árvore Muralha NW 2', 'deciduous_tree', 0.162, 0.032, 1.8, 75),
    makeProp('tree_nw_3', 'Árvore Muralha NW 3', 'deciduous_tree', 0.125, 0.105, 1.7, 130),
    makeProp('tree_nw_hill_1', 'Árvore Colina NW 1', 'deciduous_tree', 0.275, 0.122, 1.75, 45),
    makeProp('tree_nw_hill_2', 'Árvore Colina NW 2', 'deciduous_tree', 0.465, 0.138, 1.8, 210),
    makeProp('tree_nw_hill_3', 'Árvore Colina NW 3', 'deciduous_tree', 0.215, 0.242, 1.85, 95),
    makeProp('tree_n_woods_1', 'Árvore Bosque Norte 1', 'deciduous_tree', 0.642, 0.058, 2.0, 15),
    makeProp('tree_n_woods_2', 'Árvore Bosque Norte 2', 'deciduous_tree', 0.728, 0.095, 1.9, 160),
    makeProp('tree_n_woods_3', 'Árvore Bosque Norte 3', 'deciduous_tree', 0.875, 0.115, 1.85, 290),
    makeProp('tree_w_orchard', 'Árvore Pomar Oeste', 'deciduous_tree', 0.175, 0.388, 1.95, 50),
    makeProp('tree_w_gate', 'Árvore Portão Sul NW', 'deciduous_tree', 0.112, 0.555, 1.85, 110),
    makeProp('tree_center_1', 'Árvore Bairro Central 1', 'deciduous_tree', 0.422, 0.512, 1.7, 30),
    makeProp('tree_center_2', 'Árvore Bairro Central 2', 'deciduous_tree', 0.635, 0.435, 1.65, 145),
    makeProp('tree_e_cliff_1', 'Árvore Penhasco Leste 1', 'deciduous_tree', 0.908, 0.352, 2.0, 70),
    makeProp('tree_e_cliff_2', 'Árvore Penhasco Leste 2', 'deciduous_tree', 0.915, 0.442, 1.85, 185),
    makeProp('tree_e_fort_1', 'Árvore Fortaleza 1', 'deciduous_tree', 0.785, 0.448, 1.7, 250),
    makeProp('tree_e_fort_2', 'Árvore Fortaleza 2', 'deciduous_tree', 0.855, 0.558, 1.9, 40),
    makeProp('tree_mid_1', 'Árvore Pomar Centro 1', 'deciduous_tree', 0.525, 0.752, 1.8, 120),
    makeProp('tree_mid_2', 'Árvore Pomar Centro 2', 'deciduous_tree', 0.585, 0.742, 1.7, 230),
    makeProp('tree_se_ridge_1', 'Árvore Encosta SE 1', 'deciduous_tree', 0.822, 0.768, 1.85, 80),
    makeProp('tree_se_ridge_2', 'Árvore Encosta SE 2', 'deciduous_tree', 0.885, 0.825, 2.0, 175),
    makeProp('tree_se_woods_1', 'Árvore Mata Sudeste 1', 'deciduous_tree', 0.795, 0.892, 2.05, 10),
    makeProp('tree_se_woods_2', 'Árvore Mata Sudeste 2', 'deciduous_tree', 0.865, 0.908, 1.95, 135),
    makeProp('tree_se_woods_3', 'Árvore Mata Sudeste 3', 'deciduous_tree', 0.922, 0.935, 1.9, 260),
    makeProp('tree_s_lighthouse', 'Árvore Falésia Farol', 'deciduous_tree', 0.382, 0.895, 1.75, 45),

    // Arbustos e rochedos costeiros
    makeProp('bush_manor_w', 'Arbusto Jardim Solar', 'bush', 0.292, 0.228, 1.1, 30),
    makeProp('bush_pier_n', 'Arbusto Margem Norte', 'bush', 0.538, 0.258, 1.15, 95),
    makeProp('bush_fort_w', 'Arbusto Cidadela', 'bush', 0.652, 0.495, 1.15, 150),
    makeProp('bush_south_bay', 'Arbusto Baía Sul', 'bush', 0.342, 0.922, 1.25, 220),
    makeProp('rock_bay_island_1', 'Rochedo Ilhota 1', 'rock', 0.068, 0.668, 1.35, 20, 'stone_brick', 0.24),
    makeProp('rock_bay_island_2', 'Rochedo Ilhota 2', 'rock', 0.118, 0.855, 1.25, 75, 'stone_brick', 0.24),
    makeProp('rock_cliff_nw', 'Afloramento Colina NW', 'rock', 0.248, 0.155, 1.15, 40, 'stone_brick', 0.58),
    makeProp('rock_cliff_e', 'Afloramento Cidadela', 'rock', 0.688, 0.578, 1.2, 110, 'stone_brick', 0.62),
  ];

  return {
    schemaVersion: '1.0',
    meta: {
      name: 'Porto & Cidadela Fluvial (Rustymaps)',
      sourceLabel: 'porto-rustymaps.jpg',
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
      displacementScale: 0.95,
      normalStrength: 1.9,
      detailBlend: 0.55,
      smoothRadius: 2,
      invertHeight: false,
      heightMode: 'semantic_outdoor',
      textureMode: 'hybrid',
      fallbackMaterial: 'moss_earth',
      waterEnabled: true,
      waterElevation: 0.2,
    },
    structures,
    props,
    lighting: {
      sunAzimuthDeg: 325,
      sunElevationDeg: 54,
      sunIntensity: 1.95,
      ambientIntensity: 0.78,
      torchEnabled: true,
      torchIntensity: 2.3,
      torchColor: '#ffa84c',
    },
    worldGrammar: {
      scale: 'medium',
      environmentMode: 'outdoor',
      seed: 5123,
      randomness: 0.45,
      treeDensity: 0.85,
      minTreeSpacing: 3.4,
      poiChance: 0.55,
      meanderStrength: 0.58,
      enableBridges: true,
      enableRoadContinuation: true,
      enableWaterContinuation: true,
      enableForestScatter: true,
      enableArchitecturalPOIs: true,
    },
  };
}
