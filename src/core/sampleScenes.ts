import * as THREE from 'three';
import {
  PROJECTION_PRESETS,
  createDefaultWorldGrammar,
  type IsoDSLScene,
  type PropDef,
  type StructureDef,
} from '../types/isodsl';
import { createProjectorCamera } from './projection';

export interface SampleScenePackage {
  imageDataUrl: string;
  scene: IsoDSLScene;
}

function projectToCanvas(
  x: number,
  y: number,
  z: number,
  cam: THREE.Camera,
  width: number,
  height: number
): [number, number] {
  const v = new THREE.Vector3(x, y, z).project(cam);
  return [(v.x * 0.5 + 0.5) * width, (1 - (v.y * 0.5 + 0.5)) * height];
}

function drawWorldPoly(
  ctx: CanvasRenderingContext2D,
  pts: [number, number, number][],
  cam: THREE.Camera,
  w: number,
  h: number,
  fill: string,
  stroke?: string,
  lineWidth = 1.5
): void {
  if (pts.length === 0) return;
  ctx.beginPath();
  pts.forEach(([x, y, z], idx) => {
    const [px, py] = projectToCanvas(x, y, z, cam, w, h);
    if (idx === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function drawProjectedBox(
  ctx: CanvasRenderingContext2D,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  y0: number,
  y1: number,
  cam: THREE.Camera,
  w: number,
  h: number,
  colors: { top: string; frontZ: string; frontX: string; line: string }
): void {
  // Face +X
  drawWorldPoly(
    ctx,
    [
      [maxX, y0, minZ],
      [maxX, y0, maxZ],
      [maxX, y1, maxZ],
      [maxX, y1, minZ],
    ],
    cam,
    w,
    h,
    colors.frontX,
    colors.line
  );
  // Face +Z
  drawWorldPoly(
    ctx,
    [
      [minX, y0, maxZ],
      [maxX, y0, maxZ],
      [maxX, y1, maxZ],
      [minX, y1, maxZ],
    ],
    cam,
    w,
    h,
    colors.frontZ,
    colors.line
  );
  // Topo
  drawWorldPoly(
    ctx,
    [
      [minX, y1, minZ],
      [maxX, y1, minZ],
      [maxX, y1, maxZ],
      [minX, y1, maxZ],
    ],
    cam,
    w,
    h,
    colors.top,
    colors.line
  );
}

/**
 * Gera uma ilustração RPG Isométrica de referência com perspectiva ortográfica exata
 * para demonstração instantânea de Projeção 2D + Displacement + Normal + Footprints.
 */
export function generateIsometricSample(): SampleScenePackage {
  const w = 1024;
  const h = 640;
  const aspect = w / h;

  const preset = PROJECTION_PRESETS.isometric_true;
  const projection = {
    ...preset,
    orthoScale: 19,
    offsetX: 0,
    offsetY: 0,
  };

  const cam = createProjectorCamera(projection, aspect);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Fundo escuro atmosférico
  ctx.fillStyle = '#243122';
  ctx.fillRect(0, 0, w, h);

  // Chão base de grama + variação de altura visual
  for (let gx = -12; gx < 12; gx += 1) {
    for (let gz = -12; gz < 12; gz += 1) {
      const n = Math.sin(gx * 0.7 + gz * 0.5) * 0.5 + 0.5;
      const isRoad = Math.abs(gz - 2) <= 1.2 || (gx >= -1.5 && gx <= 1.5 && gz >= -5);
      const isRiver = gx <= -5.5 && gx >= -8.5;

      let fill = `rgb(${Math.round(64 + n * 24)}, ${Math.round(98 + n * 28)}, ${Math.round(52 + n * 16)})`;
      if (isRoad) {
        const stone = Math.round(115 + n * 35);
        fill = `rgb(${stone}, ${stone - 6}, ${stone - 14})`;
      }
      if (isRiver) {
        fill = `rgb(${Math.round(35 + n * 15)}, ${Math.round(102 + n * 28)}, ${Math.round(138 + n * 22)})`;
      }

      drawWorldPoly(
        ctx,
        [
          [gx, 0, gz],
          [gx + 1, 0, gz],
          [gx + 1, 0, gz + 1],
          [gx, 0, gz + 1],
        ],
        cam,
        w,
        h,
        fill,
        isRoad ? 'rgba(40,35,30,0.35)' : 'rgba(20,30,18,0.14)',
        1
      );
    }
  }

  // Ponte de madeira sobre o rio
  drawProjectedBox(ctx, -9, -5, 1.3, 3.7, 0, 0.35, cam, w, h, {
    top: '#8f643e',
    frontZ: '#6b4728',
    frontX: '#593a1f',
    line: '#2e1c0e',
  });

  // Muro de pedra traseiro (-Z)
  drawProjectedBox(ctx, -4, 7, -6.5, -5.6, 0, 1.8, cam, w, h, {
    top: '#9ba1ab',
    frontZ: '#7b8089',
    frontX: '#62666f',
    line: '#2b2e33',
  });

  // Taverna Principal (paredes enxaimel + telhado duas águas)
  drawProjectedBox(ctx, -2.5, 3.5, -3.5, 1.0, 0, 2.8, cam, w, h, {
    top: '#c7b89c',
    frontZ: '#d9ccb2',
    frontX: '#b0a187',
    line: '#3b2616',
  });

  // Vigas da fachada da taverna
  drawWorldPoly(
    ctx,
    [
      [-2.5, 1.3, 1.01],
      [3.5, 1.3, 1.01],
      [3.5, 1.55, 1.01],
      [-2.5, 1.55, 1.01],
    ],
    cam,
    w,
    h,
    '#523520'
  );
  // Porta da taverna
  drawWorldPoly(
    ctx,
    [
      [-0.2, 0, 1.02],
      [0.9, 0, 1.02],
      [0.9, 1.9, 1.02],
      [-0.2, 1.9, 1.02],
    ],
    cam,
    w,
    h,
    '#5e381e',
    '#241409',
    2
  );
  // Janelas quentes iluminadas
  drawWorldPoly(
    ctx,
    [
      [1.6, 1.0, 1.02],
      [2.6, 1.0, 1.02],
      [2.6, 2.0, 1.02],
      [1.6, 2.0, 1.02],
    ],
    cam,
    w,
    h,
    '#f6b84c',
    '#3d2717',
    2
  );

  // Telhado duas águas da taverna
  const rOver = 0.4;
  const rx0 = -2.5 - rOver;
  const rx1 = 3.5 + rOver;
  const rz0 = -3.5 - rOver;
  const rz1 = 1.0 + rOver;
  const ridgeY = 2.8 + 2.1;
  // Água frontal (+Z)
  drawWorldPoly(
    ctx,
    [
      [rx0, 2.8, rz1],
      [rx1, 2.8, rz1],
      [rx1, ridgeY, -1.25],
      [rx0, ridgeY, -1.25],
    ],
    cam,
    w,
    h,
    '#8c3c31',
    '#3a1611',
    2
  );
  // Empena direita (+X)
  drawWorldPoly(
    ctx,
    [
      [rx1, 2.8, rz1],
      [rx1, 2.8, rz0],
      [rx1, ridgeY, -1.25],
    ],
    cam,
    w,
    h,
    '#a38f73',
    '#3b2616',
    2
  );

  // Torre de Vigia à direita
  drawProjectedBox(ctx, 4.8, 7.6, -2.5, 0.3, 0, 4.4, cam, w, h, {
    top: '#8c929c',
    frontZ: '#9399a3',
    frontX: '#6c727c',
    line: '#262930',
  });
  // Telhado cônico da torre
  drawWorldPoly(
    ctx,
    [
      [4.5, 4.4, 0.6],
      [7.9, 4.4, 0.6],
      [6.2, 6.9, -1.1],
    ],
    cam,
    w,
    h,
    '#435875',
    '#1b2533',
    2
  );
  drawWorldPoly(
    ctx,
    [
      [7.9, 4.4, 0.6],
      [7.9, 4.4, -2.8],
      [6.2, 6.9, -1.1],
    ],
    cam,
    w,
    h,
    '#33455e',
    '#1b2533',
    2
  );

  // Árvores e barris desenhados na imagem para validação com props
  const drawTreeArt = (tx: number, tz: number) => {
    drawProjectedBox(ctx, tx - 0.15, tx + 0.15, tz - 0.15, tz + 0.15, 0, 0.9, cam, w, h, {
      top: '#5e3c23',
      frontZ: '#5e3c23',
      frontX: '#422917',
      line: '#24150b',
    });
    drawWorldPoly(
      ctx,
      [
        [tx - 1.0, 0.9, tz + 0.8],
        [tx + 1.0, 0.9, tz + 0.8],
        [tx, 3.3, tz],
      ],
      cam,
      w,
      h,
      '#3a6e38',
      '#1a3619',
      1.5
    );
  };
  drawTreeArt(-3.8, 4.8);
  drawTreeArt(7.2, 4.5);
  drawTreeArt(-10.2, -3.5);

  const structures: StructureDef[] = [
    {
      id: 'tavern_main',
      name: 'Taverna Principal',
      semanticTag: 'building',
      footprint: [
        [-2.5, -3.5],
        [3.5, -3.5],
        [3.5, 1.0],
        [-2.5, 1.0],
      ],
      baseElevation: 0,
      floors: 1,
      floorHeight: 2.8,
      roofType: 'gable',
      roofPitchDeg: 39,
      roofOverhang: 0.4,
      hideRoof: false,
      textureMode: 'hybrid',
      fallbackMaterial: 'timber_plaster',
      roofMaterial: 'roof_slate',
      visible: true,
    },
    {
      id: 'watch_tower',
      name: 'Torre de Vigia',
      semanticTag: 'tower',
      footprint: [
        [4.8, -2.5],
        [7.6, -2.5],
        [7.6, 0.3],
        [4.8, 0.3],
      ],
      baseElevation: 0,
      floors: 2,
      floorHeight: 2.2,
      roofType: 'cone',
      roofPitchDeg: 48,
      roofOverhang: 0.35,
      hideRoof: false,
      textureMode: 'hybrid',
      fallbackMaterial: 'stone_brick',
      roofMaterial: 'roof_slate',
      visible: true,
    },
    {
      id: 'north_wall',
      name: 'Muralha Norte',
      semanticTag: 'wall',
      footprint: [
        [-4.0, -6.5],
        [7.0, -6.5],
        [7.0, -5.6],
        [-4.0, -5.6],
      ],
      baseElevation: 0,
      floors: 1,
      floorHeight: 1.8,
      roofType: 'parapet',
      roofPitchDeg: 35,
      roofOverhang: 0,
      hideRoof: false,
      textureMode: 'hybrid',
      fallbackMaterial: 'stone_brick',
      roofMaterial: 'stone_brick',
      visible: true,
    },
  ];

  const props: PropDef[] = [
    {
      id: 'barrel_01',
      name: 'Barril Taverna',
      generator: 'barrel',
      position: [4.0, 0, 1.5],
      rotationYDeg: 0,
      scale: 1.0,
      textureMode: 'procedural',
      fallbackMaterial: 'wood_plank',
      visible: true,
    },
    {
      id: 'crate_01',
      name: 'Caixote Suprimentos',
      generator: 'crate',
      position: [-3.1, 0, 1.2],
      rotationYDeg: 18,
      scale: 0.95,
      textureMode: 'procedural',
      fallbackMaterial: 'wood_plank',
      visible: true,
    },
    {
      id: 'pine_01',
      name: 'Pinheiro Sul',
      generator: 'pine_tree',
      position: [-3.8, 0, 4.8],
      rotationYDeg: 0,
      scale: 1.05,
      textureMode: 'hybrid',
      fallbackMaterial: 'moss_earth',
      visible: true,
    },
    {
      id: 'pine_02',
      name: 'Pinheiro Leste',
      generator: 'pine_tree',
      position: [7.2, 0, 4.5],
      rotationYDeg: 35,
      scale: 1.0,
      textureMode: 'hybrid',
      fallbackMaterial: 'moss_earth',
      visible: true,
    },
  ];

  const scene: IsoDSLScene = {
    schemaVersion: '1.0',
    meta: {
      name: 'Taverna & Torre da Encruzilhada',
      sourceLabel: 'sample-isometric',
      aspectRatio: aspect,
      createdAt: new Date().toISOString(),
    },
    projection,
    terrain: {
      width: 24,
      depth: 24,
      subdivisions: 96,
      displacementScale: 0.9,
      normalStrength: 2.0,
      detailBlend: 0.5,
      smoothRadius: 2,
      invertHeight: false,
      heightMode: 'luminance',
      textureMode: 'hybrid',
      fallbackMaterial: 'moss_earth',
      waterEnabled: false,
      waterElevation: 0.1,
    },
    structures,
    props,
    lighting: {
      sunAzimuthDeg: 48,
      sunElevationDeg: 52,
      sunIntensity: 1.9,
      ambientIntensity: 0.65,
      torchEnabled: true,
      torchIntensity: 2.6,
      torchColor: '#ff9640',
    },
    worldGrammar: createDefaultWorldGrammar(),
  };

  return {
    imageDataUrl: canvas.toDataURL('image/png'),
    scene,
  };
}

/**
 * Gera um Battlemap Top-Down de exemplo pronto para teste de mapeamento vertical.
 */
export function generateTopDownSample(): SampleScenePackage {
  const w = 1024;
  const h = 640;
  const aspect = w / h;

  const preset = PROJECTION_PRESETS.top_down;
  const projection = {
    ...preset,
    orthoScale: 18,
    offsetX: 0,
    offsetY: 0,
  };

  const cam = createProjectorCamera(projection, aspect);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#2c3824';
  ctx.fillRect(0, 0, w, h);

  // Lajeado top-down
  for (let gx = -12; gx < 12; gx++) {
    for (let gz = -10; gz < 10; gz++) {
      const inCourtyard = gx >= -6 && gx <= 6 && gz >= -5 && gz <= 5;
      const shade = Math.round((Math.sin(gx * 1.9 + gz * 2.3) * 0.5 + 0.5) * 24);
      const fill = inCourtyard
        ? `rgb(${112 + shade}, ${114 + shade}, ${120 + shade})`
        : `rgb(${55 + shade}, ${82 + shade}, ${44 + Math.round(shade * 0.6)})`;
      drawWorldPoly(
        ctx,
        [
          [gx, 0, gz],
          [gx + 1, 0, gz],
          [gx + 1, 0, gz + 1],
          [gx, 0, gz + 1],
        ],
        cam,
        w,
        h,
        fill,
        'rgba(18,20,22,0.3)',
        1.2
      );
    }
  }

  // Muros top-down destacados por tom claro para displacement + footprints
  drawWorldPoly(
    ctx,
    [
      [-6, 0, -5],
      [6, 0, -5],
      [6, 0, -4],
      [-6, 0, -4],
    ],
    cam,
    w,
    h,
    '#b8bec9',
    '#20242a',
    2.5
  );
  drawWorldPoly(
    ctx,
    [
      [-6, 0, -5],
      [-5, 0, -5],
      [-5, 0, 5],
      [-6, 0, 5],
    ],
    cam,
    w,
    h,
    '#b8bec9',
    '#20242a',
    2.5
  );
  // Santuário central
  drawWorldPoly(
    ctx,
    [
      [-2.2, 0, -1.8],
      [2.2, 0, -1.8],
      [2.2, 0, 1.8],
      [-2.2, 0, 1.8],
    ],
    cam,
    w,
    h,
    '#9c4738',
    '#30140f',
    2.5
  );

  const scene: IsoDSLScene = {
    schemaVersion: '1.0',
    meta: {
      name: 'Pátio do Forte (Top-Down)',
      sourceLabel: 'sample-topdown',
      aspectRatio: aspect,
      createdAt: new Date().toISOString(),
    },
    projection,
    terrain: {
      width: 24,
      depth: 20,
      subdivisions: 96,
      displacementScale: 0.75,
      normalStrength: 2.5,
      detailBlend: 0.6,
      smoothRadius: 1,
      invertHeight: false,
      heightMode: 'luminance',
      textureMode: 'hybrid',
      fallbackMaterial: 'cobblestone',
      waterEnabled: false,
      waterElevation: 0.1,
    },
    structures: [
      {
        id: 'fort_wall_north',
        name: 'Muralha Norte',
        semanticTag: 'wall',
        footprint: [
          [-6, -5],
          [6, -5],
          [6, -4],
          [-6, -4],
        ],
        baseElevation: 0,
        floors: 1,
        floorHeight: 2.2,
        roofType: 'parapet',
        roofPitchDeg: 30,
        roofOverhang: 0,
        hideRoof: false,
        textureMode: 'hybrid',
        fallbackMaterial: 'stone_brick',
        roofMaterial: 'stone_brick',
        visible: true,
      },
      {
        id: 'fort_wall_west',
        name: 'Muralha Oeste',
        semanticTag: 'wall',
        footprint: [
          [-6, -4],
          [-5, -4],
          [-5, 5],
          [-6, 5],
        ],
        baseElevation: 0,
        floors: 1,
        floorHeight: 2.2,
        roofType: 'parapet',
        roofPitchDeg: 30,
        roofOverhang: 0,
        hideRoof: false,
        textureMode: 'hybrid',
        fallbackMaterial: 'stone_brick',
        roofMaterial: 'stone_brick',
        visible: true,
      },
      {
        id: 'shrine_keep',
        name: 'Santuário Central',
        semanticTag: 'building',
        footprint: [
          [-2.2, -1.8],
          [2.2, -1.8],
          [2.2, 1.8],
          [-2.2, 1.8],
        ],
        baseElevation: 0,
        floors: 1,
        floorHeight: 2.4,
        roofType: 'hip',
        roofPitchDeg: 35,
        roofOverhang: 0.35,
        hideRoof: false,
        textureMode: 'hybrid',
        fallbackMaterial: 'stone_brick',
        roofMaterial: 'roof_slate',
        visible: true,
      },
    ],
    props: [
      {
        id: 'pillar_nw',
        name: 'Pilar Noroeste',
        generator: 'pillar',
        position: [-3.8, 0, -2.8],
        rotationYDeg: 0,
        scale: 0.9,
        textureMode: 'procedural',
        fallbackMaterial: 'stone_brick',
        visible: true,
      },
      {
        id: 'brazier_01',
        name: 'Braseiro Entrada',
        generator: 'brazier',
        position: [3.2, 0, 2.5],
        rotationYDeg: 0,
        scale: 1.0,
        textureMode: 'procedural',
        fallbackMaterial: 'stone_brick',
        visible: true,
      },
    ],
    lighting: {
      sunAzimuthDeg: 45,
      sunElevationDeg: 60,
      sunIntensity: 1.8,
      ambientIntensity: 0.65,
      torchEnabled: true,
      torchIntensity: 3.0,
      torchColor: '#ff9640',
    },
    worldGrammar: createDefaultWorldGrammar(),
  };

  return {
    imageDataUrl: canvas.toDataURL('image/png'),
    scene,
  };
}

