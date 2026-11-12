import {
  PROJECTION_PRESETS,
  createDefaultWorldGrammar,
  type IsoDSLScene,
  type PropDef,
} from '../types/isodsl';

const ASPECT = 649 / 1024;
const DEPTH = 32;
const WIDTH = Number((DEPTH * ASPECT).toFixed(3)); // 20.281m

function uvToXZ(u: number, vTopDown: number): [number, number] {
  return [
    Number(((u - 0.5) * WIDTH).toFixed(2)),
    Number(((vTopDown - 0.5) * DEPTH).toFixed(2)),
  ];
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
  textureMode: PropDef['textureMode'] = 'procedural',
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
    textureMode,
    fallbackMaterial,
    visible: true,
  };
}

/**
 * Tradução fiel da imagem enviada pelo usuário ("Cruzamento do Rio na Floresta", 649x1024)
 * para instruções declarativas IsoDSL v1.0:
 * - Câmera Top-Down calibrada exatamente para a proporção vertical 649x1024
 * - Terreno com HeightMode 'semantic_outdoor' rebaixando o rio + afluente sob o plano de água 3D
 * - Marco central (placa de 3 direções), árvores de copa larga, arbustos e pedras no rio
 */
export function createForestCrossroadsScene(): IsoDSLScene {
  const preset = PROJECTION_PRESETS.top_down;

  const props: PropDef[] = [
    // Marco central da encruzilhada (placa de 3 pontas no centro-sul da clareira)
    makeProp(
      'crossroads_signpost',
      'Placa da Encruzilhada (3 Vias)',
      'signpost',
      0.55,
      0.525,
      0.58,
      1.15,
      20,
      'procedural',
      'wood_plank'
    ),

    // Copas principais da borda Norte
    makeProp('tree_n_01', 'Árvore Norte NW', 'deciduous_tree', 0.10, 0.04, 0.72, 1.95, 15),
    makeProp('tree_n_02', 'Árvore Norte Cinza', 'deciduous_tree', 0.28, 0.04, 0.72, 1.85, 65),
    makeProp('tree_n_03', 'Árvore Norte Centro', 'deciduous_tree', 0.45, 0.03, 0.72, 1.55, 110),
    makeProp('tree_n_04', 'Árvore Norte Clara', 'deciduous_tree', 0.58, 0.03, 0.72, 1.75, 200),
    makeProp('tree_n_05', 'Árvore Norte NE', 'deciduous_tree', 0.78, 0.03, 0.72, 1.65, 290),
    makeProp('tree_n_06', 'Árvore Canto NE', 'deciduous_tree', 0.95, 0.05, 0.72, 1.75, 40),

    // Árvores da margem Leste e Oeste
    makeProp('tree_e_01', 'Árvore Leste Alta', 'deciduous_tree', 0.97, 0.24, 0.72, 1.45, 85),
    makeProp('tree_e_02', 'Árvore Leste Média', 'deciduous_tree', 0.93, 0.33, 0.72, 1.65, 145),
    makeProp('tree_e_03', 'Árvore Leste Grande', 'deciduous_tree', 0.94, 0.52, 0.72, 1.95, 230),
    makeProp('tree_w_01', 'Árvore Oeste Escura', 'deciduous_tree', 0.07, 0.41, 0.72, 1.85, 50),
    makeProp('tree_w_02', 'Árvore Oeste Rio', 'deciduous_tree', 0.02, 0.80, 0.70, 1.45, 120),

    // Par de árvores heroicas no quadrante inferior-esquerdo (projetam sombra na estrada)
    makeProp('tree_hero_sw', 'Grande Árvore da Sombra', 'deciduous_tree', 0.41, 0.64, 0.72, 2.35, 35),
    makeProp('tree_sw_02', 'Árvore Secundária SW', 'deciduous_tree', 0.28, 0.73, 0.72, 1.65, 175),

    // Árvores da margem Sul (atravessando o rio)
    makeProp('tree_s_01', 'Árvore Sul Esquerda', 'deciduous_tree', 0.17, 0.97, 0.68, 1.45, 95),
    makeProp('tree_s_02', 'Árvore Sul Brilhante', 'deciduous_tree', 0.36, 0.94, 0.70, 2.05, 210),

    // Moitas centrais da clareira superior
    makeProp('bush_mid_01', 'Moita Clareira A', 'bush', 0.43, 0.28, 0.65, 1.15, 20),
    makeProp('bush_mid_02', 'Moita Clareira B', 'bush', 0.49, 0.29, 0.65, 0.95, 110),
    makeProp('bush_mid_03', 'Moita Clareira C', 'bush', 0.42, 0.31, 0.65, 0.85, 240),

    // Arbustos laterais e margens do rio
    makeProp('bush_w_01', 'Arbusto Estrada Oeste A', 'bush', 0.12, 0.48, 0.68, 1.05, 35),
    makeProp('bush_w_02', 'Arbusto Estrada Oeste B', 'bush', 0.18, 0.52, 0.68, 0.85, 150),
    makeProp('bush_e_01', 'Arbusto Leste A', 'bush', 0.83, 0.57, 0.68, 1.05, 70),
    makeProp('bush_e_02', 'Arbusto Leste B', 'bush', 0.75, 0.61, 0.68, 0.85, 210),
    makeProp('bush_sw_01', 'Arbusto Margem SW A', 'bush', 0.18, 0.79, 0.66, 0.95, 45),
    makeProp('bush_sw_02', 'Arbusto Margem SW B', 'bush', 0.10, 0.82, 0.66, 0.80, 120),
    makeProp('bush_s_01', 'Arbusto Sul A', 'bush', 0.54, 0.90, 0.65, 1.05, 30),
    makeProp('bush_s_02', 'Arbusto Sul B', 'bush', 0.61, 0.95, 0.65, 0.95, 140),
    makeProp('bush_s_03', 'Arbusto Sul C', 'bush', 0.73, 0.98, 0.65, 0.90, 260),

    // Pedras no leito do rio e na margem oeste
    makeProp('rock_river_01', 'Pedra Rio SW', 'rock', 0.14, 0.93, 0.22, 0.70, 25, 'hybrid', 'stone_brick'),
    makeProp('rock_river_02', 'Pedra Passo A', 'rock', 0.31, 0.90, 0.22, 0.65, 110, 'hybrid', 'stone_brick'),
    makeProp('rock_river_03', 'Pedra Passo B', 'rock', 0.41, 0.88, 0.22, 0.60, 200, 'hybrid', 'stone_brick'),
    makeProp('rock_river_04', 'Pedra Confluência A', 'rock', 0.84, 0.71, 0.22, 0.70, 45, 'hybrid', 'stone_brick'),
    makeProp('rock_river_05', 'Pedra Confluência B', 'rock', 0.96, 0.76, 0.22, 0.65, 160, 'hybrid', 'stone_brick'),
    makeProp('rock_west_01', 'Rocha Trilha Oeste', 'rock', 0.03, 0.30, 0.58, 0.75, 80, 'hybrid', 'stone_brick'),
  ];

  return {
    schemaVersion: '1.0',
    meta: {
      name: 'Cruzamento do Rio na Floresta',
      sourceLabel: 'cruzamento-floresta.jpg',
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
      subdivisions: 120,
      displacementScale: 1.25,
      normalStrength: 2.2,
      detailBlend: 0.58,
      smoothRadius: 2,
      invertHeight: false,
      heightMode: 'semantic_outdoor',
      textureMode: 'hybrid',
      fallbackMaterial: 'moss_earth',
      waterEnabled: true,
      waterElevation: 0.34,
    },
    structures: [],
    props,
    lighting: {
      sunAzimuthDeg: 315,
      sunElevationDeg: 52,
      sunIntensity: 1.85,
      ambientIntensity: 0.72,
      torchEnabled: true,
      torchIntensity: 2.2,
      torchColor: '#ff9d42',
    },
    worldGrammar: createDefaultWorldGrammar(),
  };
}

