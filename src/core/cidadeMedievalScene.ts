import {
  PROJECTION_PRESETS,
  type IsoDSLScene,
  type MaterialPreset,
  type PropDef,
  type StructureDef,
} from '../types/isodsl';

// Cidade Medieval Rustymaps: 819 x 1024 px -> aspectRatio = 0.7998
const IMG_W = 819;
const IMG_H = 1024;
const ASPECT = Number((IMG_W / IMG_H).toFixed(4));
const DEPTH = 80; // metros reais (~80m norte-sul -> rua ~3m, casas ~3.5-6m, avatar 1.72m realista)
const WIDTH = Number((DEPTH * (IMG_W / IMG_H)).toFixed(3)); // 63.984 m

function uvToXZ(u: number, v: number): [number, number] {
  return [
    Number(((u - 0.5) * WIDTH).toFixed(2)),
    Number(((v - 0.5) * DEPTH).toFixed(2)),
  ];
}

function makeBuilding(
  id: string,
  name: string,
  cu: number,
  cv: number,
  widthM: number,
  depthM: number,
  angleDeg = 0,
  opts?: {
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
  return {
    id,
    name,
    semanticTag: 'building',
    footprint: corners,
    baseElevation: 0.36,
    floors,
    floorHeight: opts?.floorHeight ?? 2.0,
    wallStyle: opts?.wallStyle ?? 'timber_frame',
    upperFloorOverhang: opts?.overhang ?? (floors >= 2 ? 0.22 : 0),
    includeFloorSlabs: true,
    floorStyle: opts?.floorStyle ?? 'projected',
    windowsPerWall: opts?.windows ?? 1,
    hasDoor: opts?.hasDoor ?? true,
    hasChimney: opts?.hasChimney ?? false,
    roofType: opts?.roofType ?? 'gable',
    roofPitchDeg: opts?.roofType === 'hip' ? 35 : 37,
    roofOverhang: 0.3,
    hideRoof: false,
    textureMode: 'procedural',
    fallbackMaterial: opts?.fallbackMaterial ?? 'timber_plaster',
    roofMaterial: opts?.roofMaterial ?? 'roof_terracotta',
    visible: true,
  };
}

function makeRoundBuilding(
  id: string,
  name: string,
  cu: number,
  cv: number,
  radiusM: number,
  opts?: {
    floors?: number;
    floorHeight?: number;
    roofMaterial?: MaterialPreset;
    fallbackMaterial?: MaterialPreset;
    wallStyle?: StructureDef['wallStyle'];
    hasDoor?: boolean;
    windows?: number;
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
    baseElevation: 0.36,
    floors: opts?.floors ?? 2,
    floorHeight: opts?.floorHeight ?? 2.1,
    wallStyle: opts?.wallStyle ?? 'buttress',
    upperFloorOverhang: 0,
    includeFloorSlabs: true,
    floorStyle: 'wood_plank',
    windowsPerWall: opts?.windows ?? 1,
    hasDoor: opts?.hasDoor ?? true,
    roofType: 'cone',
    roofPitchDeg: 34,
    roofOverhang: 0.28,
    hideRoof: false,
    textureMode: 'procedural',
    fallbackMaterial: opts?.fallbackMaterial ?? 'stone_brick',
    roofMaterial: opts?.roofMaterial ?? 'thatch',
    visible: true,
  };
}

function makeArcWall(
  id: string,
  name: string,
  cu: number,
  cv: number,
  rInner: number,
  rOuter: number,
  startDeg: number,
  endDeg: number,
  height = 0.55
): StructureDef {
  const [cx, cz] = uvToXZ(cu, cv);
  const outer: [number, number][] = [];
  const inner: [number, number][] = [];
  for (let s = 0; s <= 4; s++) {
    const a = ((startDeg + ((endDeg - startDeg) * s) / 4) * Math.PI) / 180;
    outer.push([
      Number((cx + Math.cos(a) * rOuter).toFixed(2)),
      Number((cz + Math.sin(a) * rOuter).toFixed(2)),
    ]);
    inner.unshift([
      Number((cx + Math.cos(a) * rInner).toFixed(2)),
      Number((cz + Math.sin(a) * rInner).toFixed(2)),
    ]);
  }
  return {
    id,
    name,
    semanticTag: 'wall',
    footprint: [...outer, ...inner],
    baseElevation: 0.22,
    floors: 1,
    floorHeight: height,
    wallStyle: 'buttress',
    roofType: 'parapet',
    roofPitchDeg: 20,
    roofOverhang: 0,
    hideRoof: false,
    textureMode: 'procedural',
    fallbackMaterial: 'stone_brick',
    roofMaterial: 'cobblestone',
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
  y = 0.36
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
 * Mapa de estresse arquitetônico ("Cidade Medieval — Rustymaps Town", 819x1024):
 * ~70 construções entre casas rotacionadas em enxaimel, Prefeitura (#3), Pátio Quadrado vazado,
 * Estalagem Dead Horse (#5), Pavilhão Market Square (#6), Rotunda do Templo (#7), Quartel em L (#8),
 * Alojamento Caçador (#9), Tenda Acampamento (#10), Fonte Central e expansão Média 5x5 (25 chunks).
 */
export function createCidadeMedievalScene(): IsoDSLScene {
  const preset = PROJECTION_PRESETS.top_down;

  const structures: StructureDef[] = [
    // === ZONA 1: Portão Noroeste, #1 Leatherworker & #2 Blacksmith ===
    makeBuilding('nw_gate_shack', 'Guarida Portão Norte', 0.158, 0.056, 1.9, 1.8, 5, {
      roofMaterial: 'roof_terracotta',
      hasChimney: true,
    }),
    makeBuilding('leatherworker_1', '1. Leatherworker', 0.205, 0.168, 3.0, 2.5, 0, {
      roofMaterial: 'roof_terracotta',
      hasChimney: true,
    }),
    makeBuilding('nw_shed_a', 'Anexo Portão Leste', 0.258, 0.168, 2.2, 1.7, 0, {
      roofMaterial: 'thatch',
    }),
    makeRoundBuilding('nw_round_watch', 'Torre Vigia NW', 0.272, 0.196, 1.45, {
      floors: 2,
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('nw_row_1', 'Casa Estrada NW 1', 0.198, 0.212, 4.1, 2.2, -32, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('nw_row_2', 'Casa Estrada NW 2', 0.24, 0.232, 4.2, 2.3, 38, {
      roofMaterial: 'thatch',
    }),
    makeBuilding('blacksmith_2', '2. Blacksmith', 0.268, 0.258, 3.6, 3.0, 42, {
      floors: 1,
      roofMaterial: 'roof_slate',
      wallStyle: 'buttress',
      hasChimney: true,
    }),

    // === ZONA 2: #3 Town Hall, #4 Stables & Pátio Quadrado Vazado ===
    makeBuilding('town_hall_w_wing', 'Ala Oeste Prefeitura', 0.336, 0.218, 2.3, 4.2, -6, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('town_hall_3', '3. Town Hall (Prefeitura)', 0.376, 0.208, 3.8, 6.4, 2, {
      floors: 2,
      roofType: 'hip',
      roofMaterial: 'thatch',
      overhang: 0.28,
      hasChimney: true,
      windows: 2,
    }),
    makeBuilding('town_hall_se', 'Anexo Sul Prefeitura', 0.418, 0.236, 4.1, 2.3, 24, {
      roofMaterial: 'roof_slate',
    }),
    makeBuilding('stables_4', '4. Stables (Estábulos)', 0.456, 0.256, 4.2, 2.3, 35, {
      roofMaterial: 'thatch',
      hasDoor: true,
    }),
    makeBuilding('stables_e_barn', 'Celeiro Estábulos Leste', 0.486, 0.228, 3.6, 2.2, -52, {
      roofMaterial: 'roof_terracotta',
    }),
    // Pátio quadrado vazado (4 alas independentes)
    makeBuilding('courtyard_n', 'Claustro Norte (Pátio)', 0.466, 0.146, 4.6, 1.5, 18, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('courtyard_s', 'Claustro Sul (Pátio)', 0.474, 0.19, 4.6, 1.5, 18, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('courtyard_w', 'Claustro Oeste (Pátio)', 0.442, 0.165, 1.5, 3.3, 18, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('courtyard_e', 'Claustro Leste (Pátio)', 0.498, 0.172, 1.5, 3.3, 18, {
      roofMaterial: 'roof_terracotta',
    }),

    // === ZONA 3: Praça Central, Fonte & Lado Oeste ===
    makeArcWall('plaza_fountain_w', 'Borda Oeste Fonte', 0.365, 0.328, 1.38, 1.78, 100, 260, 0.48),
    makeArcWall('plaza_fountain_e', 'Borda Leste Fonte', 0.365, 0.328, 1.38, 1.78, -80, 80, 0.48),
    makeBuilding('plaza_west_hall', 'Estalagem Oeste Praça', 0.228, 0.3, 5.4, 2.3, 12, {
      floors: 2,
      roofMaterial: 'thatch',
      windows: 2,
    }),
    makeBuilding('plaza_west_mid', 'Oficina Oeste Praça', 0.242, 0.34, 4.6, 2.2, -10, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('plaza_west_south', 'Casa Sul da Praça', 0.245, 0.39, 4.5, 2.4, -38, {
      floors: 2,
      roofMaterial: 'thatch',
    }),
    makeBuilding('plaza_west_kiosk', 'Casa Canto Praça', 0.288, 0.375, 2.6, 2.3, 30, {
      roofType: 'hip',
      roofMaterial: 'roof_slate',
    }),

    // === ZONA 4: Avenida Leste, #5 Dead Horse Inn, #6 Market Square & #7 Temple ===
    makeBuilding('ne_avenue_1', 'Casa Av. Norte 1', 0.538, 0.242, 2.4, 3.6, 18, {
      roofMaterial: 'thatch',
    }),
    makeBuilding('ne_avenue_2', 'Casa Av. Norte 2', 0.585, 0.232, 4.0, 2.1, -14, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('ne_avenue_3', 'Casa Av. Norte 3', 0.628, 0.225, 3.3, 2.0, -8, {
      roofMaterial: 'thatch',
    }),
    makeBuilding('ne_avenue_4', 'Casa Av. Norte 4', 0.662, 0.218, 2.7, 2.0, 0, {
      roofType: 'hip',
      roofMaterial: 'roof_slate',
    }),
    makeRoundBuilding('ne_avenue_tower', 'Torre Comércio NE', 0.692, 0.218, 1.35, {
      floors: 2,
      roofMaterial: 'thatch',
    }),
    makeBuilding('ne_avenue_5', 'Casa Av. Norte 5', 0.728, 0.218, 3.1, 2.0, 0, {
      roofMaterial: 'roof_terracotta',
    }),

    // #5 Dead Horse Inn
    makeRoundBuilding('inn_5_rotunda', '5. Dead Horse Inn (Rotunda)', 0.602, 0.28, 2.35, {
      floors: 2,
      roofMaterial: 'thatch',
      wallStyle: 'timber_frame',
    }),
    makeBuilding('inn_5_hall', '5. Dead Horse Inn (Salão)', 0.642, 0.275, 4.1, 3.2, -12, {
      floors: 2,
      roofMaterial: 'roof_terracotta',
      hasChimney: true,
      windows: 2,
    }),
    makeBuilding('inn_5_annex', 'Anexo Estalagem Sul', 0.63, 0.312, 3.8, 2.1, -18, {
      roofMaterial: 'thatch',
    }),

    // #6 Market Square
    makeBuilding('market_6_pavilion', '6. Market Square (Pavilhão)', 0.652, 0.352, 4.3, 4.3, 38, {
      floors: 2,
      roofType: 'hip',
      roofMaterial: 'roof_terracotta',
      windows: 2,
    }),
    makeBuilding('market_6_east', 'Armazém Mercado Leste', 0.702, 0.305, 2.3, 4.0, 5, {
      roofMaterial: 'thatch',
    }),

    // #7 Temple (Rotunda Grande + Nave + Claustro)
    makeRoundBuilding('temple_7_rotunda', '7. Temple (Rotunda Sagrada)', 0.522, 0.366, 3.15, {
      floors: 2,
      floorHeight: 2.3,
      roofMaterial: 'thatch',
      wallStyle: 'buttress',
      windows: 2,
    }),
    makeBuilding('temple_7_nave', '7. Temple (Nave Leste)', 0.562, 0.342, 4.6, 3.4, -30, {
      floors: 2,
      roofMaterial: 'roof_terracotta',
      wallStyle: 'buttress',
    }),
    makeBuilding('temple_7_cloister', 'Claustro Oeste do Templo', 0.47, 0.398, 4.1, 2.5, -36, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('temple_7_chapel', 'Capela Sul Templo', 0.492, 0.422, 2.3, 2.1, 42, {
      roofType: 'hip',
      roofMaterial: 'roof_slate',
    }),
    makeBuilding('temple_north_hall', 'Casa Norte do Templo', 0.502, 0.305, 4.1, 2.3, 10, {
      roofMaterial: 'thatch',
    }),

    // Saída Estrada Nordeste & Rua Leste
    makeBuilding('road_ne_1', 'Posto Estrada NE 1', 0.778, 0.264, 4.0, 2.1, -12, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('road_ne_2', 'Posto Estrada NE 2', 0.818, 0.258, 3.3, 2.1, -18, {
      roofMaterial: 'thatch',
    }),
    makeBuilding('road_ne_3', 'Posto Estrada NE 3', 0.858, 0.242, 3.5, 2.0, -32, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('road_ne_4', 'Guarita Portão Leste', 0.898, 0.222, 3.0, 2.0, -35, {
      roofMaterial: 'roof_slate',
    }),
    makeBuilding('east_row_1', 'Casa Rua Leste 1', 0.748, 0.315, 2.2, 3.5, 12, {
      roofMaterial: 'thatch',
    }),
    makeBuilding('east_row_2', 'Casa Rua Leste 2', 0.758, 0.365, 2.3, 3.6, 4, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('east_row_3', 'Casa Rua Leste 3', 0.742, 0.415, 2.3, 3.3, -25, {
      roofMaterial: 'thatch',
    }),
    makeBuilding('east_row_4', 'Casa Rua Leste 4', 0.715, 0.455, 3.1, 2.2, -38, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('east_row_5', 'Casa Rua Leste 5', 0.688, 0.485, 2.7, 2.1, -30, {
      roofMaterial: 'thatch',
    }),

    // === ZONA 5: #8 Guard Barracks (Forte em L) & Avenida Oeste ===
    makeBuilding('plaza_south_a', 'Casa Praça Sul A', 0.376, 0.432, 2.7, 3.5, 0, {
      roofMaterial: 'thatch',
    }),
    makeBuilding('plaza_south_b', 'Casa Praça Sul B', 0.336, 0.422, 3.1, 4.2, -12, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('plaza_south_c', 'Casa Praça Sul C', 0.305, 0.468, 2.9, 4.4, 30, {
      floors: 2,
      roofMaterial: 'thatch',
    }),
    makeBuilding('barracks_8_west', '8. Guard Barracks (Ala W)', 0.275, 0.514, 2.7, 5.0, 4, {
      floors: 2,
      roofMaterial: 'roof_terracotta',
      wallStyle: 'buttress',
      windows: 2,
    }),
    makeBuilding('barracks_8_south', '8. Guard Barracks (Ala S)', 0.302, 0.53, 4.6, 2.5, 2, {
      floors: 2,
      roofMaterial: 'roof_terracotta',
      wallStyle: 'buttress',
    }),
    makeRoundBuilding('west_col_turret', 'Torre Muralha Oeste', 0.228, 0.448, 1.35, {
      floors: 2,
      roofMaterial: 'roof_slate',
    }),
    makeBuilding('west_row_1', 'Oficina Oeste 1', 0.212, 0.485, 2.2, 3.6, 10, {
      roofMaterial: 'thatch',
    }),
    makeBuilding('west_row_2', 'Oficina Oeste 2', 0.212, 0.528, 2.1, 3.5, 4, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('west_row_3', 'Oficina Oeste 3', 0.222, 0.578, 2.3, 4.0, -18, {
      roofMaterial: 'thatch',
    }),
    makeBuilding('west_row_4', 'Oficina Oeste 4', 0.238, 0.618, 4.0, 2.4, 38, {
      roofMaterial: 'roof_terracotta',
    }),

    // === ZONA 6: Bairro Central & #9 Hunter's Lodge ===
    makeBuilding('center_alley_1', 'Casa Beco Central 1', 0.442, 0.418, 3.6, 2.3, -32, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('center_alley_2', 'Casa Beco Central 2', 0.588, 0.432, 3.8, 2.5, 38, {
      roofMaterial: 'thatch',
    }),
    makeBuilding('center_alley_3', 'Casa Beco Central 3', 0.556, 0.452, 3.5, 2.4, -45, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('center_alley_4', 'Casa Beco Central 4', 0.625, 0.468, 3.6, 2.4, 35, {
      roofMaterial: 'thatch',
    }),
    makeRoundBuilding('center_watch_e', 'Torre Bairro Leste', 0.652, 0.495, 1.3, {
      floors: 2,
      roofMaterial: 'roof_slate',
    }),
    makeBuilding('center_alley_5', 'Casa Leste Baixo 1', 0.682, 0.525, 2.5, 3.1, 5, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('center_alley_6', 'Casa Leste Baixo 2', 0.68, 0.568, 2.3, 2.9, 10, {
      roofMaterial: 'thatch',
    }),

    makeBuilding('sw_street_1', 'Casa Rua Sul-W 1', 0.318, 0.568, 4.0, 2.3, 25, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('sw_street_2', 'Casa Rua Sul-W 2', 0.365, 0.572, 2.3, 4.0, -18, {
      roofMaterial: 'thatch',
    }),
    makeBuilding('hunters_9_lodge', "9. Hunter's Lodge (Salão)", 0.398, 0.585, 4.0, 2.9, 18, {
      floors: 2,
      roofMaterial: 'thatch',
      hasChimney: true,
    }),
    makeRoundBuilding('hunters_9_tower', "9. Hunter's Lodge (Torre)", 0.422, 0.602, 1.65, {
      floors: 2,
      roofMaterial: 'thatch',
    }),
    makeBuilding('sw_row_1', 'Casa Beco Caçador 1', 0.452, 0.622, 3.1, 2.2, 42, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('sw_row_2', 'Casa Beco Caçador 2', 0.478, 0.648, 3.0, 2.1, 45, {
      roofMaterial: 'thatch',
    }),
    makeBuilding('sw_outer_1', 'Casa Sul Externa 1', 0.275, 0.635, 4.4, 2.5, 32, {
      roofMaterial: 'thatch',
    }),
    makeBuilding('sw_outer_2', 'Casa Sul Externa 2', 0.312, 0.645, 2.1, 2.1, 0, {
      roofType: 'hip',
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('sw_outer_3', 'Casa Sul Externa 3', 0.348, 0.665, 3.5, 2.3, -28, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('sw_outer_4', 'Casa Sul Externa 4', 0.398, 0.662, 3.5, 2.3, 18, {
      roofMaterial: 'thatch',
    }),
    makeBuilding('sw_outer_5', 'Casa Sul Externa 5', 0.432, 0.688, 2.5, 2.3, 25, {
      roofType: 'hip',
      roofMaterial: 'roof_slate',
    }),

    // === ZONA 7: Bairro Sul & #10 Camp ===
    makeBuilding('se_street_1', 'Casa Sul-Leste 1', 0.608, 0.568, 3.6, 2.4, 35, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('se_street_2', 'Casa Sul-Leste 2', 0.582, 0.618, 3.8, 2.5, 28, {
      roofMaterial: 'thatch',
    }),
    makeBuilding('se_street_3', 'Casa Sul-Leste 3', 0.562, 0.65, 3.6, 2.4, 32, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('se_street_4', 'Casa Sul-Leste 4', 0.622, 0.635, 3.2, 2.2, -40, {
      roofMaterial: 'roof_terracotta',
    }),
    makeBuilding('se_street_5', 'Portão Sul Casa E', 0.525, 0.68, 2.2, 2.2, 45, {
      roofType: 'hip',
      roofMaterial: 'thatch',
    }),
    makeBuilding('south_gate_manor', 'Casa Portão Sul Principal', 0.495, 0.728, 2.8, 3.7, 4, {
      floors: 2,
      roofMaterial: 'roof_terracotta',
      hasDoor: true,
    }),
    makeBuilding('south_gate_shack', 'Guarida Portão Sul', 0.428, 0.728, 2.3, 1.8, 0, {
      roofMaterial: 'thatch',
    }),
    makeRoundBuilding('camp_10_tent', '10. Camp (Tenda Vermelha)', 0.585, 0.848, 1.65, {
      floors: 1,
      floorHeight: 1.4,
      roofMaterial: 'roof_terracotta',
      fallbackMaterial: 'thatch',
      wallStyle: 'plain',
    }),
    makeBuilding('camp_south_guard', 'Posto Estrada Sul', 0.58, 0.942, 1.9, 1.5, -28, {
      roofMaterial: 'thatch',
    }),
  ];

  const props: PropDef[] = [
    // Marcos na Praça Central, Forja & Acampamento
    makeProp('fountain_spire', 'Fonte Central Praça', 'pillar', 0.365, 0.328, 0.78, 0, 'stone_brick', 0.14),
    makeProp('plaza_crate_a', 'Barraca Mercado A', 'crate', 0.33, 0.308, 1.1, 25, 'wood_plank'),
    makeProp('plaza_crate_b', 'Barraca Mercado B', 'crate', 0.35, 0.296, 1.05, 25, 'wood_plank'),
    makeProp('plaza_barrel', 'Barris Mercado', 'barrel', 0.398, 0.312, 0.95, 10, 'wood_plank'),
    makeProp('blacksmith_forja', 'Forja #2 Blacksmith', 'brazier', 0.294, 0.275, 1.1, 0, 'stone_brick'),
    makeProp('camp_10_fire', 'Fogueira Acampamento #10', 'brazier', 0.565, 0.854, 1.1, 0, 'stone_brick'),
    makeProp('nw_sign', 'Placa Entrada Norte', 'signpost', 0.205, 0.105, 1.0, 20, 'wood_plank'),
    makeProp('south_sign', 'Placa Estrada Sul', 'signpost', 0.468, 0.76, 1.0, -15, 'wood_plank'),

    // Bosques & pomares ao redor e dentro da cidade (árvores frondosas em grupos copa/casca!)
    makeProp('tree_nw_1', 'Árvore NW 1', 'deciduous_tree', 0.095, 0.092, 1.9, 15),
    makeProp('tree_nw_2', 'Árvore NW 2', 'deciduous_tree', 0.115, 0.278, 1.7, 75),
    makeProp('tree_nw_3', 'Árvore NW 3', 'deciduous_tree', 0.165, 0.342, 1.85, 130),
    makeProp('tree_nw_4', 'Árvore NW 4', 'deciduous_tree', 0.135, 0.388, 1.95, 42),
    makeProp('tree_nw_5', 'Árvore NW 5', 'deciduous_tree', 0.165, 0.435, 1.6, 190),
    makeProp('tree_nw_6', 'Árvore NW 6', 'deciduous_tree', 0.138, 0.505, 1.75, 250),
    makeProp('tree_w_edge', 'Árvore Oeste Sul', 'deciduous_tree', 0.172, 0.592, 1.8, 310),
    makeProp('tree_n_orchard_1', 'Árvore Norte 1', 'deciduous_tree', 0.335, 0.148, 1.65, 85),
    makeProp('tree_n_orchard_2', 'Árvore Norte 2', 'deciduous_tree', 0.502, 0.052, 1.7, 140),
    makeProp('tree_n_orchard_3', 'Árvore Norte 3', 'deciduous_tree', 0.538, 0.195, 1.85, 22),
    makeProp('tree_ne_1', 'Árvore Pomar NE 1', 'deciduous_tree', 0.678, 0.115, 1.7, 65),
    makeProp('tree_ne_2', 'Árvore Pomar NE 2', 'deciduous_tree', 0.768, 0.142, 1.65, 120),
    makeProp('tree_ne_3', 'Árvore Pomar NE 3', 'deciduous_tree', 0.805, 0.175, 1.75, 200),
    makeProp('tree_ne_4', 'Árvore Pomar NE 4', 'deciduous_tree', 0.902, 0.155, 1.6, 35),
    makeProp('tree_center_1', 'Árvore Jardim Central 1', 'deciduous_tree', 0.372, 0.505, 1.7, 45),
    makeProp('tree_center_2', 'Árvore Jardim Central 2', 'deciduous_tree', 0.478, 0.495, 1.5, 160),
    makeProp('tree_center_3', 'Árvore Jardim Central 3', 'deciduous_tree', 0.598, 0.512, 1.65, 280),
    makeProp('tree_center_4', 'Árvore Jardim Central 4', 'deciduous_tree', 0.528, 0.555, 1.55, 15),
    makeProp('tree_e_1', 'Árvore Leste 1', 'deciduous_tree', 0.835, 0.345, 1.9, 95),
    makeProp('tree_e_2', 'Árvore Leste 2', 'deciduous_tree', 0.848, 0.415, 1.5, 145),
    makeProp('tree_e_3', 'Árvore Leste 3', 'deciduous_tree', 0.788, 0.455, 1.6, 220),
    makeProp('tree_e_4', 'Árvore Leste 4', 'deciduous_tree', 0.865, 0.525, 1.85, 55),
    makeProp('tree_se_1', 'Árvore Pomar SE 1', 'deciduous_tree', 0.735, 0.655, 1.75, 115),
    makeProp('tree_s_road_1', 'Árvore Estrada Sul 1', 'deciduous_tree', 0.452, 0.885, 1.85, 40),
    makeProp('tree_s_road_2', 'Árvore Estrada Sul 2', 'deciduous_tree', 0.495, 0.858, 1.7, 175),
    makeProp('tree_s_road_3', 'Árvore Estrada Sul 3', 'deciduous_tree', 0.505, 0.908, 1.75, 290),
    makeProp('tree_se_camp_1', 'Árvore Campo SE 1', 'deciduous_tree', 0.742, 0.825, 1.8, 30),
    makeProp('tree_se_camp_2', 'Árvore Campo SE 2', 'deciduous_tree', 0.798, 0.802, 1.65, 125),
    makeProp('tree_se_camp_3', 'Árvore Campo SE 3', 'deciduous_tree', 0.675, 0.878, 1.7, 210),

    // Arbustos e rochas ornamentais nos cercados
    makeProp('bush_plaza_s', 'Arbusto Jardim Sul', 'bush', 0.412, 0.515, 1.15, 30),
    makeProp('bush_sw_1', 'Arbusto Sudoeste', 'bush', 0.352, 0.71, 1.2, 85),
    makeProp('bush_e_gate', 'Arbusto Portão Leste', 'bush', 0.928, 0.258, 1.1, 140),
    makeProp('rock_gate_s', 'Pedra Portão Sul', 'rock', 0.405, 0.842, 1.1, 45, 'stone_brick'),
    makeProp('rock_field_ne', 'Pedra Campo NE', 'rock', 0.722, 0.088, 1.0, 120, 'stone_brick'),
  ];

  return {
    schemaVersion: '1.0',
    meta: {
      name: 'Cidade Medieval (Stress Test 70+ Edifícios)',
      sourceLabel: 'cidade-medieval-rustymaps.jpg',
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
      displacementScale: 0.75,
      normalStrength: 1.85,
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
      sunIntensity: 1.9,
      ambientIntensity: 0.75,
      torchEnabled: true,
      torchIntensity: 2.2,
      torchColor: '#ffa84c',
    },
    worldGrammar: {
      scale: 'medium',
      environmentMode: 'outdoor',
      seed: 4242,
      randomness: 0.45,
      treeDensity: 0.9,
      minTreeSpacing: 3.4,
      poiChance: 0.55,
      meanderStrength: 0.55,
      enableBridges: true,
      enableRoadContinuation: true,
      enableWaterContinuation: false,
      enableForestScatter: true,
      enableArchitecturalPOIs: true,
    },
  };
}

