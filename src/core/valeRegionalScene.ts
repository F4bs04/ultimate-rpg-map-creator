import {
  PROJECTION_PRESETS,
  type IsoDSLScene,
  type MaterialPreset,
  type PropDef,
  type StructureDef,
} from '../types/isodsl';

// Dimensões da imagem original: 742 x 960 px -> aspectRatio = 0.7729
const IMG_W = 742;
const IMG_H = 960;
const ASPECT = Number((IMG_W / IMG_H).toFixed(4));
const DEPTH = 160; // 160 metros reais norte-sul (escala regional ampla)
const WIDTH = Number((DEPTH * (IMG_W / IMG_H)).toFixed(3)); // 123.667 m leste-oeste

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
  const roofType =
    opts?.roofType ?? (tag === 'bridge' || tag === 'wall' || tag === 'platform' ? 'flat' : 'gable');

  return {
    id,
    name,
    semanticTag: tag,
    footprint: corners,
    baseElevation: opts?.baseElevation ?? 0.45,
    floors,
    floorHeight: opts?.floorHeight ?? 2.1,
    wallStyle: opts?.wallStyle ?? (tag === 'building' ? 'timber_frame' : 'buttress'),
    upperFloorOverhang: opts?.overhang ?? (floors >= 2 && tag === 'building' ? 0.22 : 0),
    includeFloorSlabs: opts?.includeFloorSlabs ?? tag === 'building',
    floorStyle: opts?.floorStyle ?? 'projected',
    windowsPerWall: opts?.windows ?? (tag === 'building' ? 1 : 0),
    hasDoor: opts?.hasDoor ?? tag === 'building',
    hasChimney: opts?.hasChimney ?? false,
    roofType,
    roofPitchDeg: roofType === 'hip' ? 35 : roofType === 'flat' ? 0 : 38,
    roofOverhang: roofType === 'flat' ? 0.04 : 0.32,
    hideRoof: false,
    textureMode: 'procedural',
    fallbackMaterial: opts?.fallbackMaterial ?? 'timber_plaster',
    roofMaterial: opts?.roofMaterial ?? 'roof_terracotta',
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
    roofType?: StructureDef['roofType'];
    fallbackMaterial?: MaterialPreset;
    roofMaterial?: MaterialPreset;
    hasDoor?: boolean;
  }
): StructureDef {
  const [cx, cz] = uvToXZ(cu, cv);
  const segments = 12;
  const footprint: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const th = (i / segments) * Math.PI * 2;
    footprint.push([
      Number((cx + Math.cos(th) * radiusM).toFixed(2)),
      Number((cz + Math.sin(th) * radiusM).toFixed(2)),
    ]);
  }

  return {
    id,
    name,
    semanticTag: 'tower',
    footprint,
    baseElevation: opts?.baseElevation ?? 0.5,
    floors: opts?.floors ?? 3,
    floorHeight: opts?.floorHeight ?? 2.2,
    wallStyle: 'buttress',
    upperFloorOverhang: 0.15,
    includeFloorSlabs: true,
    floorStyle: 'stone_tile',
    windowsPerWall: 1,
    hasDoor: opts?.hasDoor ?? true,
    hasChimney: false,
    roofType: opts?.roofType ?? 'cone',
    roofPitchDeg: 46,
    roofOverhang: 0.32,
    hideRoof: false,
    textureMode: 'procedural',
    fallbackMaterial: opts?.fallbackMaterial ?? 'stone_brick',
    roofMaterial: opts?.roofMaterial ?? 'roof_slate',
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
  thicknessM = 0.55,
  heightM = 1.6,
  baseElevation = 0.45,
  fallbackMaterial: MaterialPreset = 'stone_brick'
): StructureDef {
  const [x0, z0] = uvToXZ(u0, v0);
  const [x1, z1] = uvToXZ(u1, v1);
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const nx = (-dz / (len || 1)) * (thicknessM * 0.5);
  const nz = (dx / (len || 1)) * (thicknessM * 0.5);

  return {
    id,
    name,
    semanticTag: 'wall',
    footprint: [
      [Number((x0 - nx).toFixed(2)), Number((z0 - nz).toFixed(2))],
      [Number((x1 - nx).toFixed(2)), Number((z1 - nz).toFixed(2))],
      [Number((x1 + nx).toFixed(2)), Number((z1 + nz).toFixed(2))],
      [Number((x0 + nx).toFixed(2)), Number((z0 + nz).toFixed(2))],
    ],
    baseElevation,
    floors: 1,
    floorHeight: heightM,
    wallStyle: 'buttress',
    upperFloorOverhang: 0,
    includeFloorSlabs: false,
    windowsPerWall: 0,
    hasDoor: false,
    hasChimney: false,
    roofType: 'flat',
    roofPitchDeg: 0,
    roofOverhang: 0.05,
    hideRoof: false,
    textureMode: 'procedural',
    fallbackMaterial,
    roofMaterial: fallbackMaterial,
    visible: true,
  };
}

function makePier(
  id: string,
  name: string,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  widthM = 2.4,
  baseElevation = 0.18
): StructureDef {
  return makeWallSegment(id, name, u0, v0, u1, v1, widthM, 0.4, baseElevation, 'wood_plank');
}

function makeProp(
  id: string,
  name: string,
  generator: PropDef['generator'],
  u: number,
  v: number,
  scale = 1.0,
  rotationYDeg = 0,
  y = 0.45,
  fallbackMaterial: MaterialPreset = 'tree_bark'
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
 * Vale dos Rios & Província Agrícola (742 x 960 px):
 * Mapa em escala regional aberta cobrindo vales, rios fluviais duplos, bacia/represa central,
 * pontes de pedra e madeira, complexo senhorial murado, múltiplos povoados e quintas de cultivo,
 * escarpa com cascata e nuvens volumétricas no céu.
 */
export function createValeRegionalScene(): IsoDSLScene {
  const preset = PROJECTION_PRESETS.top_down;

  const structures: StructureDef[] = [
    // =========================================================================
    // 1. COMPLEXO SENHORIAL & VILA NOROESTE (NW MANOR & HAMLET)
    // =========================================================================
    makeRectStructure('b_nw_feudal_manor', 'Solar Senhorial da Colina NW', 0.208, 0.242, 14.0, 10.5, 12, {
      baseElevation: 0.65,
      floors: 2,
      floorHeight: 2.3,
      roofType: 'hip',
      roofMaterial: 'roof_terracotta',
      wallStyle: 'timber_frame',
      hasChimney: true,
      windows: 2,
    }),
    makeRectStructure('b_nw_barn_main', 'Grande Celeiro Senhorial', 0.192, 0.272, 9.2, 5.6, 15, {
      baseElevation: 0.62,
      floors: 1,
      floorHeight: 2.4,
      roofType: 'gable',
      roofMaterial: 'roof_terracotta',
      wallStyle: 'timber_frame',
      windows: 1,
    }),
    makeRectStructure('b_nw_stables', 'Cavalariça & Cocheiras', 0.224, 0.270, 8.4, 4.8, 8, {
      baseElevation: 0.62,
      floors: 1,
      floorHeight: 2.1,
      roofType: 'gable',
      roofMaterial: 'thatch',
      wallStyle: 'timber_frame',
    }),
    makeRectStructure('b_nw_guard_keep', 'Guarita e Corpo da Guarda', 0.185, 0.218, 6.2, 4.4, 18, {
      baseElevation: 0.64,
      floors: 2,
      floorHeight: 2.0,
      roofType: 'gable',
      roofMaterial: 'roof_slate',
      fallbackMaterial: 'stone_brick',
      windows: 1,
    }),
    makeRectStructure('b_nw_smithy', 'Ferraria da Colina', 0.155, 0.222, 5.6, 4.2, -8, {
      baseElevation: 0.6,
      floors: 1,
      floorHeight: 2.0,
      roofType: 'gable',
      roofMaterial: 'roof_slate',
      hasChimney: true,
    }),
    makeRectStructure('b_nw_village_1', 'Casa de Colonos Ribeirinha', 0.155, 0.192, 5.4, 3.8, 22, {
      baseElevation: 0.55,
      floors: 1,
      roofType: 'gable',
      roofMaterial: 'roof_terracotta',
    }),
    makeRectStructure('b_nw_village_2', 'Casa dos Artesãos da Rampa', 0.195, 0.180, 5.6, 4.0, 10, {
      baseElevation: 0.58,
      floors: 1,
      roofType: 'gable',
      roofMaterial: 'roof_terracotta',
    }),
    makeRectStructure('b_nw_bakery', 'Moenda e Padaria da Vila', 0.235, 0.225, 5.2, 3.8, -14, {
      baseElevation: 0.63,
      floors: 1,
      roofType: 'gable',
      roofMaterial: 'roof_terracotta',
      hasChimney: true,
    }),
    makeRectStructure('b_nw_shed', 'Paiol dos Currais', 0.140, 0.245, 4.5, 3.2, 28, {
      baseElevation: 0.6,
      floors: 1,
      roofType: 'gable',
      roofMaterial: 'thatch',
    }),
    // Muros perimetrais do pátio senhorial
    makeWallSegment('wall_nw_p1', 'Muralha Pátio Norte', 0.170, 0.210, 0.245, 0.215, 0.6, 1.6, 0.62),
    makeWallSegment('wall_nw_p2', 'Muralha Pátio Leste', 0.245, 0.215, 0.248, 0.285, 0.6, 1.6, 0.6),
    makeWallSegment('wall_nw_p3', 'Muralha Pátio Sul', 0.248, 0.285, 0.168, 0.280, 0.6, 1.6, 0.6),

    // Ponte de Pedra do Rio Noroeste
    makeRectStructure('bridge_nw', 'Ponte de Pedra do Alto Rio', 0.165, 0.168, 4.6, 9.5, 32, {
      semanticTag: 'bridge',
      baseElevation: 0.32,
      floors: 1,
      floorHeight: 0.9,
      roofType: 'flat',
      fallbackMaterial: 'stone_brick',
      roofMaterial: 'cobblestone',
    }),

    // =========================================================================
    // 2. POVOADO DA REPRESA & LAGO CENTRAL (LAKE RESERVOIR SETTLEMENT)
    // =========================================================================
    makeRectStructure('b_lake_manor', 'Solar Lacustre do Vale', 0.590, 0.585, 11.2, 6.8, -12, {
      baseElevation: 0.42,
      floors: 2,
      floorHeight: 2.15,
      roofType: 'hip',
      roofMaterial: 'roof_terracotta',
      hasChimney: true,
      windows: 2,
    }),
    makeRectStructure('b_lake_watermill', 'Moinho Fluvial do Lago', 0.575, 0.612, 6.8, 5.2, 24, {
      baseElevation: 0.35,
      floors: 1,
      floorHeight: 2.3,
      roofType: 'gable',
      roofMaterial: 'roof_terracotta',
      fallbackMaterial: 'stone_brick',
      hasChimney: true,
    }),
    makeRectStructure('b_lake_fisher_w', 'Casa dos Pescadores Oeste', 0.418, 0.574, 6.5, 4.4, -28, {
      baseElevation: 0.38,
      floors: 1,
      roofType: 'gable',
      roofMaterial: 'roof_terracotta',
      hasChimney: true,
    }),
    makeRectStructure('b_lake_boathouse', 'Galpão dos Barcos e Salga', 0.442, 0.598, 6.0, 4.2, 18, {
      baseElevation: 0.32,
      floors: 1,
      roofType: 'gable',
      roofMaterial: 'thatch',
      wallStyle: 'timber_frame',
    }),
    makeRectStructure('b_lake_cottage', 'Cabana dos Barqueiros Leste', 0.608, 0.553, 5.2, 3.8, 35, {
      baseElevation: 0.4,
      floors: 1,
      roofType: 'gable',
      roofMaterial: 'roof_terracotta',
    }),
    // Píeres de madeira no lago
    makePier('pier_lake_west', 'Píer Oeste do Lago', 0.435, 0.582, 0.450, 0.572, 2.2, 0.22),
    makePier('pier_lake_east', 'Píer Leste do Lago', 0.565, 0.568, 0.550, 0.560, 2.4, 0.22),

    // =========================================================================
    // 3. ALDEIA DA GARGANTA & CASCATA LESTE (EAST GORGE & WATERFALL)
    // =========================================================================
    // Escarpa rochosa onde nasce a cascata
    makeRectStructure('cliff_waterfall', 'Escarpa da Cascata', 0.812, 0.272, 8.5, 6.0, 15, {
      semanticTag: 'cliff',
      baseElevation: 0.68,
      floors: 1,
      floorHeight: 3.5,
      roofType: 'flat',
      fallbackMaterial: 'stone_brick',
      roofMaterial: 'stone_brick',
    }),
    // Torreão de vigia na escarpa
    makeRoundTower('tower_waterfall', 'Torreão da Cascata', 0.795, 0.245, 2.2, {
      baseElevation: 0.72,
      floors: 3,
      floorHeight: 2.2,
      roofType: 'cone',
      roofMaterial: 'roof_slate',
    }),
    makeRectStructure('b_gorge_inn', 'Estalagem da Garganta', 0.755, 0.348, 8.2, 5.5, -35, {
      baseElevation: 0.52,
      floors: 2,
      floorHeight: 2.1,
      roofType: 'gable',
      roofMaterial: 'roof_terracotta',
      hasChimney: true,
      windows: 2,
    }),
    makeRectStructure('b_gorge_guard', 'Posto do Guarda da Estrada Leste', 0.808, 0.345, 6.2, 4.2, 40, {
      baseElevation: 0.54,
      floors: 1,
      roofType: 'gable',
      roofMaterial: 'roof_terracotta',
      fallbackMaterial: 'stone_brick',
    }),
    makeRectStructure('b_gorge_chalet', 'Chalé dos Curtidores', 0.742, 0.365, 5.4, 3.8, 12, {
      baseElevation: 0.48,
      floors: 1,
      roofType: 'gable',
      roofMaterial: 'roof_terracotta',
    }),
    makeRectStructure('b_gorge_shed', 'Paiol da Serra Leste', 0.802, 0.368, 5.0, 3.6, -20, {
      baseElevation: 0.5,
      floors: 1,
      roofType: 'gable',
      roofMaterial: 'thatch',
    }),

    // Ponte de Pedra da Confluência dos Rios (Centro-Leste)
    makeRectStructure('bridge_confluence', 'Grande Ponte da Confluência', 0.685, 0.505, 5.2, 12.0, -48, {
      semanticTag: 'bridge',
      baseElevation: 0.3,
      floors: 1,
      floorHeight: 1.0,
      roofType: 'flat',
      fallbackMaterial: 'stone_brick',
      roofMaterial: 'cobblestone',
    }),

    // =========================================================================
    // 4. QUINTA DAS COLINAS NORTE & NORDESTE (NORTH FARMS)
    // =========================================================================
    makeRectStructure('b_north_farmhouse', 'Sede da Fazenda Norte', 0.505, 0.178, 7.5, 4.8, 25, {
      baseElevation: 0.55,
      floors: 1,
      floorHeight: 2.2,
      roofType: 'gable',
      roofMaterial: 'roof_terracotta',
      hasChimney: true,
    }),
    makeRectStructure('b_north_barn', 'Celeiro de Cereais Norte', 0.490, 0.192, 6.4, 4.2, -18, {
      baseElevation: 0.54,
      floors: 1,
      roofType: 'gable',
      roofMaterial: 'thatch',
    }),
    makeRectStructure('b_ne_homestead', 'Casa dos Colonos Nordeste', 0.865, 0.118, 5.8, 4.0, 15, {
      baseElevation: 0.62,
      floors: 1,
      roofType: 'gable',
      roofMaterial: 'roof_terracotta',
      hasChimney: true,
    }),
    makeRectStructure('b_ne_shed', 'Paiol dos Pomares NE', 0.880, 0.130, 4.6, 3.4, -30, {
      baseElevation: 0.6,
      floors: 1,
      roofType: 'gable',
      roofMaterial: 'thatch',
    }),

    // =========================================================================
    // 5. COMPLEXO AGRÍCOLA LESTE (EAST FARMLANDS)
    // =========================================================================
    makeRectStructure('b_east_estate', 'Casa Grande dos Campos Leste', 0.875, 0.428, 8.4, 5.6, -15, {
      baseElevation: 0.48,
      floors: 1,
      floorHeight: 2.2,
      roofType: 'gable',
      roofMaterial: 'roof_terracotta',
      hasChimney: true,
      windows: 2,
    }),
    makeRectStructure('b_east_silo', 'Silo e Tulha de Grãos Leste', 0.860, 0.445, 6.2, 4.4, 30, {
      baseElevation: 0.47,
      floors: 1,
      roofType: 'gable',
      roofMaterial: 'thatch',
    }),
    makeRectStructure('b_east_stable', 'Estábulo dos Bois de Arado', 0.895, 0.435, 5.4, 3.8, 8, {
      baseElevation: 0.48,
      floors: 1,
      roofType: 'gable',
      roofMaterial: 'thatch',
    }),

    // =========================================================================
    // 6. PROPRIEDADES RURAIS DO SUDOESTE & SUL
    // =========================================================================
    makeRectStructure('b_west_farm', 'Fazenda da Campina Oeste', 0.155, 0.370, 6.6, 4.5, 42, {
      baseElevation: 0.52,
      floors: 1,
      roofType: 'gable',
      roofMaterial: 'roof_terracotta',
      hasChimney: true,
    }),
    makeRectStructure('b_west_vineyard', 'Quinta das Vinhas', 0.202, 0.495, 6.2, 4.2, -22, {
      baseElevation: 0.48,
      floors: 1,
      roofType: 'gable',
      roofMaterial: 'roof_terracotta',
    }),
    makeRectStructure('b_sw_river_house', 'Casa da Várzea Sudoeste', 0.088, 0.792, 5.8, 4.0, 18, {
      baseElevation: 0.38,
      floors: 1,
      roofType: 'gable',
      roofMaterial: 'roof_terracotta',
    }),

    // Ponte de Madeira do Rio Sudoeste
    makeRectStructure('bridge_sw', 'Ponte Rústica do Sudoeste', 0.142, 0.835, 4.2, 8.5, -20, {
      semanticTag: 'bridge',
      baseElevation: 0.25,
      floors: 1,
      floorHeight: 0.8,
      roofType: 'flat',
      fallbackMaterial: 'wood_plank',
      roofMaterial: 'wood_plank',
    }),

    makeRectStructure('b_south_ford', 'Fazenda do Vau Sul', 0.145, 0.912, 6.4, 4.6, 35, {
      baseElevation: 0.42,
      floors: 1,
      roofType: 'gable',
      roofMaterial: 'roof_terracotta',
      hasChimney: true,
    }),
    makeRectStructure('b_south_crossroads', 'Granja da Encruzilhada Sul', 0.592, 0.724, 6.6, 4.5, -12, {
      baseElevation: 0.46,
      floors: 1,
      roofType: 'gable',
      roofMaterial: 'roof_terracotta',
    }),

    // =========================================================================
    // 7. POSTO DA GRANDE FLORESTA DO SUL
    // =========================================================================
    makeRectStructure('b_forest_lodge', 'Cabana dos Caçadores da Mata', 0.935, 0.940, 5.6, 4.2, 28, {
      baseElevation: 0.55,
      floors: 1,
      roofType: 'gable',
      roofMaterial: 'wood_plank',
      fallbackMaterial: 'wood_plank',
      hasChimney: true,
    }),
  ];

  // =========================================================================
  // PROPS: NUVENS FLUTUANTES, MOINHO D'ÁGUA, BARCOS, POÇOS, VEGETAÇÃO E ROCHAS
  // =========================================================================
  const props: PropDef[] = [
    // --- 5 GRANDES FORMAÇÕES DE NUVENS VOLUMÉTRICAS FLUTUANTES (Y = 20..26m) ---
    makeProp('cloud_north', 'Nuvem Alta Norte', 'cloud', 0.365, 0.045, 3.4, 25, 23.5, 'timber_plaster'),
    makeProp('cloud_ne', 'Nuvem da Garganta Leste', 'cloud', 0.945, 0.155, 3.0, -18, 25.0, 'timber_plaster'),
    makeProp('cloud_center', 'Grande Nuvem Central do Vale', 'cloud', 0.365, 0.405, 3.8, 38, 22.0, 'timber_plaster'),
    makeProp('cloud_sw', 'Nuvem das Campinas Sudoeste', 'cloud', 0.205, 0.675, 2.8, -40, 24.5, 'timber_plaster'),
    makeProp('cloud_south', 'Nuvem da Floresta Sul', 'cloud', 0.565, 0.885, 3.2, 12, 24.0, 'timber_plaster'),

    // --- RODA DO MOINHO D'ÁGUA NO LAGO ---
    makeProp('mill_wheel_lake', 'Roda D\'Água do Moinho', 'watermill', 0.568, 0.618, 1.4, 24, 0.38, 'wood_plank'),

    // --- EMBARCAÇÕES & BARCOS ---
    makeProp('boat_lake_1', 'Barco de Pesca do Lago 1', 'boat', 0.455, 0.568, 1.1, -30, 0.18, 'wood_plank'),
    makeProp('boat_lake_2', 'Barco de Pesca do Lago 2', 'boat', 0.545, 0.555, 1.15, 65, 0.18, 'wood_plank'),
    makeProp('boat_river_nw', 'Bote do Alto Rio', 'boat', 0.178, 0.152, 0.95, 45, 0.22, 'wood_plank'),
    makeProp('boat_river_sw', 'Bote do Vau Sul', 'boat', 0.125, 0.842, 1.0, -15, 0.20, 'wood_plank'),

    // --- POÇOS MEDIEVAIS ---
    makeProp('well_nw_manor', 'Poço da Mansão Noroeste', 'well', 0.210, 0.258, 1.1, 0, 0.65, 'stone_brick'),
    makeProp('well_lake', 'Poço da Vila Lacustre', 'well', 0.430, 0.585, 1.0, 0, 0.40, 'stone_brick'),
    makeProp('well_gorge', 'Poço da Garganta Leste', 'well', 0.770, 0.355, 1.05, 0, 0.52, 'stone_brick'),
    makeProp('well_north_farm', 'Poço da Fazenda Norte', 'well', 0.518, 0.185, 0.95, 0, 0.55, 'stone_brick'),
    makeProp('well_east_farm', 'Poço dos Lavradores Leste', 'well', 0.880, 0.440, 1.0, 0, 0.48, 'stone_brick'),

    // --- PLACAS INDICATIVAS DE TRÊS VIAS ---
    makeProp('sign_nw_fork', 'Placa Encruzilhada Noroeste', 'signpost', 0.182, 0.198, 1.1, 45, 0.60, 'wood_plank'),
    makeProp('sign_center_cross', 'Placa Grande Encruzilhada', 'signpost', 0.510, 0.415, 1.2, -20, 0.48, 'wood_plank'),
    makeProp('sign_bridge_east', 'Placa da Ponte da Confluência', 'signpost', 0.675, 0.515, 1.1, 75, 0.42, 'wood_plank'),
    makeProp('sign_south_fork', 'Placa da Estrada Real Sul', 'signpost', 0.585, 0.735, 1.1, 10, 0.46, 'wood_plank'),

    // --- BRASEIROS / LANTERNAS NAS PONTES E ENTRADAS ---
    makeProp('brazier_bridge_nw_1', 'Braseiro Ponte NW A', 'brazier', 0.158, 0.162, 1.0, 0, 0.75, 'stone_brick'),
    makeProp('brazier_bridge_nw_2', 'Braseiro Ponte NW B', 'brazier', 0.172, 0.174, 1.0, 0, 0.75, 'stone_brick'),
    makeProp('brazier_bridge_e_1', 'Braseiro Ponte Confluência A', 'brazier', 0.678, 0.498, 1.1, 0, 0.85, 'stone_brick'),
    makeProp('brazier_bridge_e_2', 'Braseiro Ponte Confluência B', 'brazier', 0.692, 0.512, 1.1, 0, 0.85, 'stone_brick'),
    makeProp('brazier_manor_gate', 'Braseiro Portão Senhorial', 'brazier', 0.175, 0.225, 1.15, 0, 0.68, 'stone_brick'),

    // --- BARRIS E CAIXOTES NOS CELEIROS E PÍERES ---
    makeProp('barrels_lake_pier', 'Barris Píer Oeste', 'barrel', 0.432, 0.586, 0.95, 15, 0.38, 'wood_plank'),
    makeProp('crates_lake_pier', 'Caixotes Píer Leste', 'crate', 0.572, 0.572, 1.0, -25, 0.38, 'wood_plank'),
    makeProp('barrels_nw_barn', 'Barris do Celeiro NW', 'barrel', 0.198, 0.278, 1.05, 50, 0.62, 'wood_plank'),
    makeProp('crates_east_estate', 'Caixotes Fazenda Leste', 'crate', 0.865, 0.450, 1.0, 10, 0.48, 'wood_plank'),

    // --- ROCHAS & DESFILADEIROS DA CASCATA E LEITOS ---
    makeProp('rock_waterfall_1', 'Rocha da Cascata A', 'rock', 0.815, 0.282, 1.8, 35, 0.60, 'stone_brick'),
    makeProp('rock_waterfall_2', 'Rocha da Cascata B', 'rock', 0.822, 0.295, 1.5, -45, 0.55, 'stone_brick'),
    makeProp('rock_waterfall_3', 'Rocha da Cascata C', 'rock', 0.810, 0.315, 1.4, 70, 0.48, 'stone_brick'),
    makeProp('rock_lake_shore_1', 'Rocha Margem do Lago', 'rock', 0.495, 0.635, 1.3, 12, 0.28, 'stone_brick'),
    makeProp('rock_lake_shore_2', 'Pedra Saliente do Lago', 'rock', 0.525, 0.630, 1.1, -60, 0.28, 'stone_brick'),

    // --- BOSQUES & VEGETAÇÃO ORGÂNICA (ÁRVORES E ARBUSTOS) ---
    // Bosque da Mansão NW
    makeProp('tree_nw_g1', 'Carvalho Mansão 1', 'deciduous_tree', 0.395, 0.295, 1.8, 15, 0.58, 'foliage_canopy'),
    makeProp('tree_nw_g2', 'Carvalho Mansão 2', 'deciduous_tree', 0.415, 0.305, 1.9, -40, 0.58, 'foliage_canopy'),
    makeProp('tree_nw_g3', 'Carvalho Mansão 3', 'deciduous_tree', 0.445, 0.298, 1.7, 75, 0.58, 'foliage_canopy'),
    makeProp('tree_nw_g4', 'Carvalho Mansão 4', 'deciduous_tree', 0.470, 0.302, 1.85, -10, 0.58, 'foliage_canopy'),
    makeProp('tree_nw_g5', 'Pinheiro Mansão 1', 'pine_tree', 0.490, 0.295, 1.6, 30, 0.58, 'foliage_canopy'),
    makeProp('bush_nw_1', 'Arbusto Mansão 1', 'bush', 0.428, 0.312, 1.3, 0, 0.58, 'foliage_canopy'),
    makeProp('bush_nw_2', 'Arbusto Mansão 2', 'bush', 0.455, 0.310, 1.2, 45, 0.58, 'foliage_canopy'),

    // Mata Ciliar ao redor do Lago Central
    makeProp('tree_lake_s1', 'Salgueiro do Lago 1', 'deciduous_tree', 0.355, 0.685, 1.75, 20, 0.42, 'foliage_canopy'),
    makeProp('tree_lake_s2', 'Salgueiro do Lago 2', 'deciduous_tree', 0.375, 0.695, 1.85, -35, 0.42, 'foliage_canopy'),
    makeProp('tree_lake_s3', 'Pinheiro do Lago 1', 'pine_tree', 0.395, 0.710, 1.65, 80, 0.42, 'foliage_canopy'),
    makeProp('tree_lake_e1', 'Carvalho Margem Leste 1', 'deciduous_tree', 0.615, 0.625, 1.8, 45, 0.42, 'foliage_canopy'),
    makeProp('tree_lake_e2', 'Carvalho Margem Leste 2', 'deciduous_tree', 0.635, 0.640, 1.9, -15, 0.42, 'foliage_canopy'),
    makeProp('tree_lake_e3', 'Pinheiro Margem Leste 1', 'pine_tree', 0.655, 0.650, 1.7, 60, 0.42, 'foliage_canopy'),

    // Bosque da Garganta Leste
    makeProp('tree_gorge_1', 'Carvalho da Garganta 1', 'deciduous_tree', 0.765, 0.395, 1.7, 30, 0.50, 'foliage_canopy'),
    makeProp('tree_gorge_2', 'Carvalho da Garganta 2', 'deciduous_tree', 0.785, 0.405, 1.85, -50, 0.50, 'foliage_canopy'),
    makeProp('tree_gorge_3', 'Pinheiro da Cascata 1', 'pine_tree', 0.815, 0.385, 1.6, 15, 0.52, 'foliage_canopy'),

    // Pomar da Fazenda Norte
    makeProp('orchard_n_1', 'Macieira Norte 1', 'deciduous_tree', 0.525, 0.155, 1.25, 0, 0.56, 'foliage_canopy'),
    makeProp('orchard_n_2', 'Macieira Norte 2', 'deciduous_tree', 0.545, 0.155, 1.25, 20, 0.56, 'foliage_canopy'),
    makeProp('orchard_n_3', 'Macieira Norte 3', 'deciduous_tree', 0.525, 0.175, 1.25, -30, 0.56, 'foliage_canopy'),
    makeProp('orchard_n_4', 'Macieira Norte 4', 'deciduous_tree', 0.545, 0.175, 1.25, 45, 0.56, 'foliage_canopy'),

    // Mata Densa do Extremo Sul
    makeProp('forest_s_1', 'Grande Carvalho Sul 1', 'deciduous_tree', 0.280, 0.920, 2.1, 10, 0.52, 'foliage_canopy'),
    makeProp('forest_s_2', 'Grande Carvalho Sul 2', 'deciduous_tree', 0.320, 0.935, 2.2, -45, 0.52, 'foliage_canopy'),
    makeProp('forest_s_3', 'Pinheiro Ancestral Sul 1', 'pine_tree', 0.360, 0.945, 2.0, 65, 0.52, 'foliage_canopy'),
    makeProp('forest_s_4', 'Grande Carvalho Sul 3', 'deciduous_tree', 0.420, 0.950, 2.15, -20, 0.52, 'foliage_canopy'),
    makeProp('forest_s_5', 'Pinheiro Ancestral Sul 2', 'pine_tree', 0.650, 0.930, 2.05, 30, 0.54, 'foliage_canopy'),
    makeProp('forest_s_6', 'Grande Carvalho Sul 4', 'deciduous_tree', 0.720, 0.940, 2.25, -15, 0.54, 'foliage_canopy'),
    makeProp('forest_s_7', 'Pinheiro Ancestral Sul 3', 'pine_tree', 0.780, 0.945, 2.1, 75, 0.54, 'foliage_canopy'),
    makeProp('forest_s_8', 'Grande Carvalho Sul 5', 'deciduous_tree', 0.850, 0.950, 2.2, -35, 0.54, 'foliage_canopy'),
  ];

  return {
    schemaVersion: '1.0',
    meta: {
      name: 'Vale dos Rios & Província Agrícola',
      sourceLabel: 'vale-dos-rios-regional',
      aspectRatio: ASPECT,
      createdAt: new Date().toISOString(),
    },
    projection: {
      ...preset,
      orthoScale: 140, // Escala ortográfica ampla para enquadrar a província inteira
      offsetX: 0,
      offsetY: 0,
    },
    terrain: {
      width: WIDTH,
      depth: DEPTH,
      subdivisions: 128,
      displacementScale: 1.15,
      normalStrength: 2.1,
      detailBlend: 0.65,
      smoothRadius: 1,
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
      sunAzimuthDeg: 42,
      sunElevationDeg: 55,
      sunIntensity: 1.85,
      ambientIntensity: 0.72,
      torchEnabled: true,
      torchIntensity: 3.2,
      torchColor: '#ff9c44',
    },
    worldGrammar: {
      scale: 'large', // WFC 9x9 (81 chunks) para expansão aberta de escala regional!
      environmentMode: 'outdoor',
      seed: 9842,
      randomness: 0.38,
      treeDensity: 0.85,
      minTreeSpacing: 3.5,
      poiChance: 0.60,
      meanderStrength: 0.52,
      enableBridges: true,
      enableRoadContinuation: true,
      enableWaterContinuation: true,
      enableForestScatter: true,
      enableArchitecturalPOIs: true,
    },
  };
}
