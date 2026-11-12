import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildPropGeometry,
  buildPropGeometryBundle,
  buildStructureArchitectureBundle,
  buildStructureRoofGeometry,
  buildStructureWallsGeometry,
  buildTerrainBaseGeometry,
  computeStructureDoorInfo,
  ensureCCWFootprintXZ,
  signedAreaXZ,
} from '../compiler';
import { bakeTerrainDisplacementIntoGeometry } from '../exporter';
import {
  computeHeightField,
  heightFieldToNormalRGBA,
  sampleHeightAtUV,
} from '../imageMaps';
import {
  bakeProjectedUVs,
  createProjectorCamera,
  resolveSurfaceTextureMode,
} from '../projection';
import {
  extractCollisionSegments,
  extractPropCollisionObstacles,
  findDefaultSpawnXZ,
  findEnteredInteriorCluster,
  findNearestInteractiveDoor,
  isPointInPolygonXZ,
  resolveMovementWithCollisions,
  sampleWalkableElevation,
} from '../worldNav';
import {
  PROJECTION_PRESETS,
  type PropDef,
  type StructureDef,
  type TerrainConfig,
} from '../../types/isodsl';
import { analyzeImageToIsoDSL } from '../autoAnalyze';
import { createCidadeMedievalScene } from '../cidadeMedievalScene';
import { createForestCrossroadsScene } from '../forestCrossroadsScene';
import {
  BUILTIN_MAPS,
  deleteSavedMap,
  duplicateSavedMap,
  listSavedMaps,
  parseImportedMapFile,
  renameSavedMap,
  saveMapToLibrary,
  serializeProjectFile,
  type StorageLike,
} from '../mapLibrary';
import { createPortoRustymapsScene } from '../portoRustymapsScene';
import { createRuinasRioMediumScene } from '../ruinasRioScene';
import { createTavernaMedievalScene } from '../tavernaMedievalScene';
import { createVilaMedievalScene } from '../vilaMedievalScene';
import { extractAlphaCutoutRGBA } from '../cutoutHarvester';
import { buildWorldNodePipelineSummary } from '../proceduralNodes';
import {
  generatePainterlySwatchRGBA,
  synthesizePainterlyWorldKit,
  buildComfyTexturePrompt,
} from '../textureTool';
import { buildMultiScaleWorld } from '../worldBuilder';
import {
  detectBorderPortals,
  extractEdgeStrips,
  extractWorldKitFromImage,
  makeSeamlessTileRGBA,
  mergeImageIntoWorldKit,
} from '../worldKit';

describe('imageMaps (Heightfield & Tangent Normal Map)', () => {
  it('deriva heightfield normalizado e gera normal map inclinado corretamente na rampa', () => {
    const w = 8;
    const h = 8;
    const rgba = new Uint8ClampedArray(w * h * 4);

    // Rampa crescente da esquerda (x=0) para direita (x=7)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const val = Math.round((x / (w - 1)) * 255);
        const i = (y * w + x) * 4;
        rgba[i] = val;
        rgba[i + 1] = val;
        rgba[i + 2] = val;
        rgba[i + 3] = 255;
      }
    }

    const hf = computeHeightField(rgba, w, h, {
      smoothRadius: 0,
      invertHeight: false,
      contrast: 1,
    });

    expect(hf.macroHeight[0]).toBeCloseTo(0, 4);
    expect(hf.macroHeight[w - 1]).toBeCloseTo(1, 4);

    // Rampa sobe para +X -> normal deve apontar para -X (canal R < 128)
    const normalRgba = heightFieldToNormalRGBA(
      hf.macroHeight,
      hf.rawLuminance,
      w,
      h,
      2.0,
      0.5
    );
    const centerIdx = (3 * w + 3) * 4;
    expect(normalRgba[centerIdx]).toBeLessThan(120);
    // Sem gradiente vertical -> canal G próximo de 128
    expect(Math.abs(normalRgba[centerIdx + 1] - 128)).toBeLessThanOrEqual(2);
    // Componente Z aponta para fora (> 128)
    expect(normalRgba[centerIdx + 2]).toBeGreaterThan(128);
  });

  it('amostra altura bilinear com convenção flipY=true', () => {
    const w = 2;
    const h = 2;
    // Linha superior (y=0, v=1) = 1.0, linha inferior (y=1, v=0) = 0.0
    const field = new Float32Array([1, 1, 0, 0]);
    expect(sampleHeightAtUV(field, w, h, 0.5, 1.0)).toBeCloseTo(1.0, 5);
    expect(sampleHeightAtUV(field, w, h, 0.5, 0.0)).toBeCloseTo(0.0, 5);
    expect(sampleHeightAtUV(field, w, h, 0.5, 0.5)).toBeCloseTo(0.5, 5);
  });
});

describe('projection (Calibrador Isométrico / Top-Down & UV Baking)', () => {
  it('projeta o centro do mundo (0,0,0) exatamente para UV (0.5, 0.5)', () => {
    const isoCam = createProjectorCamera(
      { ...PROJECTION_PRESETS.isometric_true, orthoScale: 20, offsetX: 0, offsetY: 0 },
      1.6
    );
    const pt = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const baked = bakeProjectedUVs(pt, new THREE.Matrix4(), isoCam, {
      textureMode: 'projected',
    });
    const uv = baked.getAttribute('uv');
    let sumU = 0;
    let sumV = 0;
    for (let i = 0; i < uv.count; i++) {
      sumU += uv.getX(i);
      sumV += uv.getY(i);
    }
    expect(sumU / uv.count).toBeCloseTo(0.5, 2);
    expect(sumV / uv.count).toBeCloseTo(0.5, 2);
  });

  it('separa faces visíveis e faces ocultas em 2 grupos no modo híbrido', () => {
    const cam = createProjectorCamera(
      { ...PROJECTION_PRESETS.isometric_true, orthoScale: 20, offsetX: 0, offsetY: 0 },
      1.6
    );
    const box = new THREE.BoxGeometry(2, 2, 2);
    const baked = bakeProjectedUVs(box, new THREE.Matrix4(), cam, {
      textureMode: 'hybrid',
    });

    // Um cubo tem 6 faces: 3 apontam para a câmera (+X,+Y,+Z) e 3 ficam ocultas (-X,-Y,-Z)
    expect(baked.groups.length).toBe(2);
    expect(baked.groups[0].materialIndex).toBe(0);
    expect(baked.groups[1].materialIndex).toBe(1);
    expect(baked.groups[0].count).toBe(18); // 3 faces * 2 tris * 3 verts
    expect(baked.groups[1].count).toBe(18);
  });
});

describe('compiler (Gramática de Footprints & Props img2obj)', () => {
  const sampleStruct: StructureDef = {
    id: 'house_1',
    name: 'Casa Teste',
    semanticTag: 'building',
    footprint: [
      [-2, -2],
      [2, -2],
      [2, 2],
      [-2, 2],
    ],
    baseElevation: 0,
    floors: 1,
    floorHeight: 2.5,
    roofType: 'gable',
    roofPitchDeg: 35,
    roofOverhang: 0.3,
    hideRoof: false,
    textureMode: 'hybrid',
    fallbackMaterial: 'stone_brick',
    roofMaterial: 'roof_slate',
    visible: true,
  };

  it('normaliza orientação do footprint em XZ garantindo normais externas', () => {
    // Sentido horário visto de cima (+Y) -> área > 0 deve ser invertida para < 0
    const cw: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ];
    expect(signedAreaXZ(cw)).toBeGreaterThan(0);
    const normalized = ensureCCWFootprintXZ(cw);
    expect(normalized).toHaveLength(4);
    expect(signedAreaXZ(normalized)).toBeLessThan(0);

    // Já anti-horário -> preserva ordem
    const ccw: [number, number][] = [
      [0, 0],
      [0, 4],
      [4, 4],
      [4, 0],
    ];
    expect(ensureCCWFootprintXZ(ccw)).toEqual(ccw);
  });

  it('compila paredes e todos os tipos de telhado mantendo baixa contagem de triângulos', () => {
    const walls = buildStructureWallsGeometry(sampleStruct);
    const wallTris = walls.getAttribute('position').count / 3;
    expect(wallTris).toBeGreaterThan(10);
    expect(wallTris).toBeLessThan(120);

    for (const roofType of ['gable', 'hip', 'cone', 'parapet'] as const) {
      const roof = buildStructureRoofGeometry({ ...sampleStruct, roofType });
      expect(roof).not.toBeNull();
      const roofTris = roof!.getAttribute('position').count / 3;
      expect(roofTris).toBeGreaterThan(4);
      expect(roofTris).toBeLessThan(150);
    }

    expect(
      buildStructureRoofGeometry({ ...sampleStruct, hideRoof: true })
    ).toBeNull();

    const plain = buildStructureWallsGeometry(sampleStruct);
    expect(plain.getAttribute('position').count).toBeGreaterThan(0);

    const bundle = buildStructureArchitectureBundle({
      ...sampleStruct,
      wallStyle: 'timber_frame',
      hasDoor: true,
      windowsPerWall: 1,
      includeFloorSlabs: true,
    });
    expect(bundle.wallsGeom.getAttribute('position').count).toBeGreaterThan(0);
    expect(bundle.trimGeom).not.toBeNull();
    expect(bundle.trimGeom!.getAttribute('position').count).toBeGreaterThan(0);
    expect(bundle.glassGeom).not.toBeNull();
    expect(bundle.glassGeom!.getAttribute('position').count).toBeGreaterThan(0);
    expect(bundle.floorSlabsGeom).not.toBeNull();
    expect(bundle.floorSlabsGeom!.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('compila todos os props procedurais leves (img2obj)', () => {
    const types: PropDef['generator'][] = [
      'barrel',
      'crate',
      'pillar',
      'fallen_pillar',
      'pine_tree',
      'deciduous_tree',
      'bush',
      'rock',
      'signpost',
      'well',
      'boat',
      'brazier',
      'tavern_table',
      'stool',
      'bar_counter',
      'fireplace',
      'bookshelf',
      'wall_sconce',
      'card_25d',
    ];
    for (const generator of types) {
      const geom = buildPropGeometry({
        id: `p_${generator}`,
        name: generator,
        generator,
        position: [0, 0, 0],
        rotationYDeg: 0,
        scale: 1,
        textureMode: 'hybrid',
        fallbackMaterial: 'wood_plank',
        visible: true,
      });
      const tris = geom.getAttribute('position').count / 3;
      expect(tris).toBeGreaterThan(2);
      expect(tris).toBeLessThan(350);
    }
  });

  it('separa copas e troncos/partes multi-material e preserva grupos em bakeProjectedUVs', () => {
    const cam = createProjectorCamera(
      { ...PROJECTION_PRESETS.isometric_true, orthoScale: 20, offsetX: 0, offsetY: 0 },
      1.6
    );

    for (const generator of ['deciduous_tree', 'pine_tree'] as const) {
      const bundle = buildPropGeometryBundle({
        id: `bundle_${generator}`,
        name: generator,
        generator,
        position: [0, 0, 0],
        rotationYDeg: 0,
        scale: 1,
        textureMode: 'procedural',
        fallbackMaterial: 'moss_earth',
        visible: true,
      });
      expect(bundle.materials).toEqual(['moss_earth', 'tree_bark']);
      expect(bundle.geometry.groups.length).toBe(2);
      expect(bundle.geometry.groups.map((g) => g.materialIndex)).toEqual([0, 1]);

      const baked = bakeProjectedUVs(bundle.geometry, new THREE.Matrix4(), cam, {
        textureMode: 'procedural',
      });
      expect(baked.groups.length).toBe(2);
      expect(baked.groups.map((g) => g.materialIndex)).toEqual([0, 1]);
    }

    const wellBundle = buildPropGeometryBundle({
      id: 'bundle_well',
      name: 'well',
      generator: 'well',
      position: [0, 0, 0],
      rotationYDeg: 0,
      scale: 1,
      textureMode: 'procedural',
      fallbackMaterial: 'stone_brick',
      visible: true,
    });
    expect(wellBundle.materials).toEqual(['stone_brick', 'wood_plank', 'roof_teal']);
    expect(wellBundle.geometry.groups.map((g) => g.materialIndex)).toEqual([0, 1, 2]);
  });
});

describe('autoAnalyze & forestCrossroads (Imagem -> IsoDSL)', () => {
  it('rebaixo de água semântico e detecção automática de árvores e rio', () => {
    const w = 32;
    const h = 48;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        // Faixa inferior azul = rio; bloco superior esquerdo verde escuro = árvore; resto = grama clara
        if (y >= 36) {
          rgba[i] = 40;
          rgba[i + 1] = 120;
          rgba[i + 2] = 175;
        } else if (x >= 4 && x <= 14 && y >= 4 && y <= 14) {
          rgba[i] = 32;
          rgba[i + 1] = 95;
          rgba[i + 2] = 35;
        } else {
          rgba[i] = 165;
          rgba[i + 1] = 190;
          rgba[i + 2] = 95;
        }
        rgba[i + 3] = 255;
      }
    }

    const hf = computeHeightField(rgba, w, h, {
      smoothRadius: 0,
      invertHeight: false,
      heightMode: 'semantic_outdoor',
    });
    // Pixel de rio deve ser mais baixo que pixel de grama
    expect(hf.macroHeight[40 * w + 10]).toBeLessThan(hf.macroHeight[20 * w + 20]);

    const dsl = analyzeImageToIsoDSL(rgba, w, h, { name: 'Teste Floresta' });
    expect(dsl.terrain.waterEnabled).toBe(true);
    expect(dsl.terrain.heightMode).toBe('semantic_outdoor');
    expect(dsl.terrain.depth).toBeGreaterThan(dsl.terrain.width);
    expect(dsl.props.some((p) => p.generator === 'deciduous_tree')).toBe(true);
  });

  it('cena Cruzamento do Rio na Floresta possui proporção 649x1024 e marco central', () => {
    const scene = createForestCrossroadsScene();
    expect(scene.meta.aspectRatio).toBeCloseTo(649 / 1024, 4);
    expect(scene.terrain.waterEnabled).toBe(true);
    expect(scene.props.some((p) => p.generator === 'signpost')).toBe(true);
    expect(scene.props.length).toBeGreaterThan(25);
  });

  it('detecta mapa de ambiente interno no Auto-Traduzir com madeira e fogo sem vegetação', () => {
    const w = 32;
    const h = 48;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (x <= 1 || x >= w - 2 || y <= 1 || y >= h - 2) {
          rgba[i] = 28;
          rgba[i + 1] = 20;
          rgba[i + 2] = 16;
        } else if (x >= 13 && x <= 18 && y >= 5 && y <= 9) {
          rgba[i] = 248;
          rgba[i + 1] = 152;
          rgba[i + 2] = 42;
        } else {
          rgba[i] = 178;
          rgba[i + 1] = 112;
          rgba[i + 2] = 62;
        }
        rgba[i + 3] = 255;
      }
    }
    const indoor = analyzeImageToIsoDSL(rgba, w, h, { name: 'Sala Interna' });
    expect(indoor.worldGrammar.environmentMode).toBe('interior');
    expect(indoor.terrain.waterEnabled).toBe(false);
    expect(indoor.terrain.fallbackMaterial).toBe('wood_plank');
    expect(indoor.props.some((p) => p.generator === 'fireplace')).toBe(true);
  });
});

describe('worldKit & worldBuilder (Absorção Multi-Imagem & Escalas Pequeno/Médio/Grande)', () => {
  function makeSyntheticOutdoorImage(w = 64, h = 64): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        // Rio atravessando da esquerda (y~48) para direita (y~40)
        if (Math.abs(y - (46 - x * 0.1)) <= 4) {
          rgba[i] = 35;
          rgba[i + 1] = 115;
          rgba[i + 2] = 170;
        } else if (Math.abs(x - 32) <= 4) {
          // Estrada vertical cruzando o mapa norte-sul
          rgba[i] = 175;
          rgba[i + 1] = 132;
          rgba[i + 2] = 82;
        } else if (x < 16 && y < 16) {
          // Copa densa escura
          rgba[i] = 34;
          rgba[i + 1] = 92;
          rgba[i + 2] = 36;
        } else {
          // Gramado iluminado
          rgba[i] = 135;
          rgba[i + 1] = 175;
          rgba[i + 2] = 75;
        }
        rgba[i + 3] = 255;
      }
    }
    return rgba;
  }

  it('gera swatches sem costura e absorve múltiplas imagens no IsoWorldKit', () => {
    const patch = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < 16 * 16; i++) {
      patch[i * 4] = (i % 16) * 15;
      patch[i * 4 + 1] = 120;
      patch[i * 4 + 2] = 60;
      patch[i * 4 + 3] = 255;
    }
    const seamless = makeSeamlessTileRGBA(patch, 16);
    // Bordas opostas devem convergir suavemente no cross-blend toroidal
    const leftEdgeR = seamless[0];
    const rightEdgeR = seamless[(15) * 4];
    expect(Math.abs(leftEdgeR - rightEdgeR)).toBeLessThan(15);

    const imgA = makeSyntheticOutdoorImage(64, 64);
    const portals = detectBorderPortals(imgA, 64, 64);
    expect(portals.some((p) => p.kind === 'water')).toBe(true);
    expect(portals.some((p) => p.kind === 'road')).toBe(true);

    const kitA = extractWorldKitFromImage(imgA, 64, 64, 'Floresta');
    expect(kitA.swatches.grass).toBeDefined();
    expect(kitA.swatches.water).toBeDefined();

    // Segunda imagem só de pedra/ruína mesclada ao mesmo Kit
    const imgB = new Uint8ClampedArray(48 * 48 * 4);
    for (let i = 0; i < 48 * 48; i++) {
      imgB[i * 4] = 130;
      imgB[i * 4 + 1] = 132;
      imgB[i * 4 + 2] = 135;
      imgB[i * 4 + 3] = 255;
    }
    const merged = mergeImageIntoWorldKit(kitA, imgB, 48, 48, 'Ruínas');
    expect(merged.sourceCount).toBe(2);
    expect(merged.swatches.stone).toBeDefined();
    expect(merged.swatches.grass).toBeDefined();
  });

  it('expande mundo deterministicamente nas escalas Pequeno (3x3), Médio (5x5) e Grande (9x9)', () => {
    const base = createForestCrossroadsScene();
    const kit = extractWorldKitFromImage(makeSyntheticOutdoorImage(64, 64), 64, 64);

    const small = buildMultiScaleWorld(
      { ...base, worldGrammar: { ...base.worldGrammar, scale: 'small', seed: 17 } },
      kit
    );
    expect(small.chunks).toHaveLength(9);
    expect(small.worldProps.length).toBeGreaterThan(20);

    const medA = buildMultiScaleWorld(
      { ...base, worldGrammar: { ...base.worldGrammar, scale: 'medium', seed: 42 } },
      kit
    );
    const medB = buildMultiScaleWorld(
      { ...base, worldGrammar: { ...base.worldGrammar, scale: 'medium', seed: 42 } },
      kit
    );
    expect(medA.chunks).toHaveLength(25);
    expect(medA.summary.riverSegments).toBeGreaterThan(0);
    expect(medA.summary.roadSegments).toBeGreaterThan(0);
    expect(medA.worldProps.length).toBeGreaterThan(small.worldProps.length);
    expect(medA.worldProps[0]).toEqual(medB.worldProps[0]);

    const large = buildMultiScaleWorld(
      { ...base, worldGrammar: { ...base.worldGrammar, scale: 'large', seed: 99 } },
      kit
    );
    expect(large.chunks).toHaveLength(81);
    expect(large.chunks.some((c) => c.isOuterLOD && c.subdivisions <= 14)).toBe(true);
    expect(large.worldProps.length).toBeGreaterThan(medA.worldProps.length);
  });

  it('traduz Ruínas no Riacho (576x1024) e expande em escala Média 5x5 com arenito e riacho pastel', () => {
    const ruinsScene = createRuinasRioMediumScene();
    expect(ruinsScene.meta.aspectRatio).toBeCloseTo(576 / 1024, 4);
    expect(ruinsScene.worldGrammar.scale).toBe('medium');
    expect(ruinsScene.structures.length).toBeGreaterThan(18);
    expect(ruinsScene.props.some((p) => p.generator === 'fallen_pillar')).toBe(true);

    // Simula imagem pastel de arenito + grama sálvia + riacho
    const w = 64;
    const h = 64;
    const pastel = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (Math.abs(y - 44) <= 3) {
          // Riacho azul pastel
          pastel[i] = 148;
          pastel[i + 1] = 172;
          pastel[i + 2] = 186;
        } else if (x >= 16 && x <= 32 && y >= 16 && y <= 32) {
          // Muro arenito claro
          pastel[i] = 224;
          pastel[i + 1] = 200;
          pastel[i + 2] = 160;
        } else {
          // Prado sálvia pastel
          pastel[i] = 168;
          pastel[i + 1] = 194;
          pastel[i + 2] = 132;
        }
        pastel[i + 3] = 255;
      }
    }

    const kit = extractWorldKitFromImage(pastel, w, h, 'Ruínas Pastel');
    expect(kit.swatches.water).toBeDefined();
    expect(kit.swatches.stone).toBeDefined();
    expect(kit.swatches.grass).toBeDefined();

    const expanded = buildMultiScaleWorld(ruinsScene, kit);
    expect(expanded.chunks).toHaveLength(25);
    expect(expanded.summary.riverSegments).toBeGreaterThan(0);
    expect(expanded.worldStructures.length).toBeGreaterThan(0);
    expect(expanded.worldProps.length).toBeGreaterThan(30);
  });

  it('sintetiza texturas Painterly 128px, extrai edgeStrips, cria alpha cutout 2.5D e resume nós procedurais', () => {
    const w = 32;
    const h = 32;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        // Borda branca sólida, centro verde
        const isCenter = x >= 8 && x <= 24 && y >= 8 && y <= 24;
        rgba[i] = isCenter ? 60 : 250;
        rgba[i + 1] = isCenter ? 150 : 250;
        rgba[i + 2] = isCenter ? 70 : 250;
        rgba[i + 3] = 255;
      }
    }

    const cutout = extractAlphaCutoutRGBA(rgba, w, h, 35);
    expect(cutout[3]).toBe(0); // canto branco removido
    expect(cutout[(16 * w + 16) * 4 + 3]).toBe(255); // centro verde mantido

    const strips = extractEdgeStrips(rgba, w, h, 8);
    expect(strips.north).toHaveLength(8);
    expect(strips.east).toHaveLength(8);

    const painterly = generatePainterlySwatchRGBA('grass', [150, 185, 115], null, 64, 17);
    expect(painterly).toHaveLength(64 * 64 * 4);

    const baseKit = extractWorldKitFromImage(rgba, w, h, 'Teste');
    const upgraded = synthesizePainterlyWorldKit(baseKit, 42);
    expect(Object.keys(upgraded.swatches).length).toBe(5);
    expect(buildComfyTexturePrompt('stone', upgraded.swatches.stone, 'Ruínas')).toContain('tileable');

    const ruins = createRuinasRioMediumScene();
    const exp = buildMultiScaleWorld(ruins, upgraded);
    const nodes = buildWorldNodePipelineSummary(ruins, upgraded, exp);
    expect(nodes).toHaveLength(6);
    expect(nodes[0].metricLabel).toContain('5 swatches');

    // Desativar nó de scatter deve zerar instâncias mantendo chunks e POIs
    const noScatter = buildMultiScaleWorld(
      { ...ruins, worldGrammar: { ...ruins.worldGrammar, enableForestScatter: false } },
      upgraded
    );
    expect(noScatter.worldProps).toHaveLength(0);
  });

  it('compila arquitetura medieval completa (2 andares com balanço, pisos internos, portas, janelas e chaminé) e Vila Medieval', () => {
    const inn: StructureDef = {
      id: 'inn_test',
      name: 'Estalagem Teste',
      semanticTag: 'building',
      footprint: [
        [-3, -2],
        [3, -2],
        [3, 2],
        [-3, 2],
      ],
      baseElevation: 0.5,
      floors: 2,
      floorHeight: 2.3,
      wallStyle: 'timber_frame',
      upperFloorOverhang: 0.25,
      includeFloorSlabs: true,
      windowsPerWall: 2,
      hasDoor: true,
      hasChimney: true,
      roofType: 'gable',
      roofPitchDeg: 38,
      roofOverhang: 0.35,
      hideRoof: false,
      textureMode: 'hybrid',
      fallbackMaterial: 'timber_plaster',
      roofMaterial: 'roof_teal',
      visible: true,
    };

    const bundle = buildStructureArchitectureBundle(inn);
    expect(bundle.wallsGeom.getAttribute('position').count).toBeGreaterThan(24);
    expect(bundle.floorSlabsGeom).not.toBeNull();
    expect(bundle.trimGeom).not.toBeNull();
    expect(bundle.glassGeom).not.toBeNull();

    const vila = createVilaMedievalScene();
    expect(vila.meta.aspectRatio).toBeCloseTo(723 / 1024, 4);
    expect(vila.structures.length).toBeGreaterThan(25);
    expect(vila.structures.some((s) => s.floors === 2 && (s.upperFloorOverhang ?? 0) > 0)).toBe(true);
    expect(vila.structures.some((s) => s.footprint.length >= 8 && s.semanticTag === 'tower')).toBe(true);
    expect(vila.props.some((p) => p.generator === 'well')).toBe(true);
    expect(vila.props.some((p) => p.generator === 'boat')).toBe(true);
  });

  it('resolve projeção limpa sem distorção em telhados/torres/rochas e detecta interior + piso no Modo Exploração', () => {
    expect(resolveSurfaceTextureMode('hybrid', 'terrain', 89.5)).toBe('hybrid');
    expect(resolveSurfaceTextureMode('hybrid', 'roof', 89.5, 'cone')).toBe('procedural');
    expect(resolveSurfaceTextureMode('hybrid', 'prop', 89.5, 'rock')).toBe('procedural');
    expect(resolveSurfaceTextureMode('hybrid', 'wall', 89.5, 'building')).toBe('procedural');
    expect(resolveSurfaceTextureMode('hybrid', 'wall', 35.264, 'building')).toBe('hybrid');
    expect(resolveSurfaceTextureMode('hybrid', 'prop', 89.5, 'card_25d')).toBe('hybrid');
    expect(resolveSurfaceTextureMode('projected', 'roof', 89.5, 'gable')).toBe('projected');

    const vila = createVilaMedievalScene();
    const innMain = vila.structures.find((s) => s.id === 'inn_main_2f')!;
    const cx = (innMain.footprint[0][0] + innMain.footprint[2][0]) * 0.5;
    const cz = (innMain.footprint[0][1] + innMain.footprint[2][1]) * 0.5;
    expect(isPointInPolygonXZ(cx, cz, innMain.footprint)).toBe(true);

    const entered = findEnteredInteriorCluster(cx, cz, vila.structures, 0.12);
    expect(entered.primary?.id).toBe('inn_main_2f');
    expect(entered.clusterIds.has('inn_tower')).toBe(true);

    const yF1 = sampleWalkableElevation(cx, cz, vila, null, 1, entered.primary);
    const yF2 = sampleWalkableElevation(cx, cz, vila, null, 2, entered.primary);
    expect(yF2).toBeGreaterThan(yF1 + 1.5);
  });

  it('projeta piso térreo, recorta portal com dobradiça e bloqueia paredes até a porta abrir', () => {
    const house: StructureDef = {
      id: 'door_test_house',
      name: 'Casa Porta',
      semanticTag: 'building',
      footprint: [
        [-2.5, -2.0],
        [2.5, -2.0],
        [2.5, 2.0],
        [-2.5, 2.0],
      ],
      baseElevation: 0.9,
      floors: 2,
      floorHeight: 2.3,
      wallStyle: 'timber_frame',
      floorStyle: 'projected',
      includeFloorSlabs: true,
      windowsPerWall: 1,
      hasDoor: true,
      roofType: 'gable',
      roofPitchDeg: 35,
      roofOverhang: 0.3,
      hideRoof: false,
      textureMode: 'procedural',
      fallbackMaterial: 'timber_plaster',
      roofMaterial: 'roof_teal',
      visible: true,
    };

    const bundle = buildStructureArchitectureBundle(house);
    expect(bundle.projectedGroundFloorGeom).not.toBeNull();
    expect(bundle.floorSlabsGeom).not.toBeNull();
    expect(bundle.doorGeom).not.toBeNull();
    expect(bundle.doorInfo).not.toBeNull();

    const door = computeStructureDoorInfo(house)!;
    const outX = door.centerXZ[0] + door.normalXZ[0] * 0.9;
    const outZ = door.centerXZ[1] + door.normalXZ[1] * 0.9;
    const inX = door.centerXZ[0] - door.normalXZ[0] * 0.9;
    const inZ = door.centerXZ[1] - door.normalXZ[1] * 0.9;

    // 1. Porta fechada: colisão impede o explorador de atravessar a parede/porta
    const closedSegs = extractCollisionSegments([house], new Set());
    const [blockedX, blockedZ] = resolveMovementWithCollisions(
      outX,
      outZ,
      inX,
      inZ,
      0.25,
      closedSegs
    );
    expect(isPointInPolygonXZ(blockedX, blockedZ, house.footprint)).toBe(false);

    // Proximidade da porta detectada corretamente para interação
    const nearby = findNearestInteractiveDoor(outX, outZ, [house], new Set(), 2.5);
    expect(nearby?.structure.id).toBe('door_test_house');
    expect(nearby?.isOpen).toBe(false);

    // 2. Porta aberta: vão livre permite entrar sem atravessar paredes sólidas
    const openSegs = extractCollisionSegments([house], new Set(['door_test_house']));
    const [passedX, passedZ] = resolveMovementWithCollisions(
      outX,
      outZ,
      inX,
      inZ,
      0.25,
      openSegs
    );
    expect(isPointInPolygonXZ(passedX, passedZ, house.footprint)).toBe(true);

    // Parede lateral fechada continua sólida mesmo com a porta frontal aberta
    const [wallStopX] = resolveMovementWithCollisions(
      -3.4,
      0,
      -1.2,
      0,
      0.25,
      openSegs
    );
    expect(wallStopX).toBeLessThan(-2.5);
  });

  it('compila Taverna Medieval em modo interior sem floresta externa e colide com mesas/balcão/lareira', () => {
    const tavern = createTavernaMedievalScene();
    expect(tavern.worldGrammar.environmentMode).toBe('interior');
    expect(tavern.terrain.width / tavern.terrain.depth).toBeCloseTo(tavern.meta.aspectRatio, 3);

    // Pequeno interior mantém apenas o salão âncora sem árvores externas
    const smallWorld = buildMultiScaleWorld(tavern, undefined);
    expect(smallWorld.gridRadius).toBe(0);
    expect(smallWorld.chunks.length).toBe(1);
    expect(smallWorld.worldProps.length).toBe(0);

    // Médio interior gera alas modulares internas sem árvores outdoor
    const mediumWorld = buildMultiScaleWorld(
      { ...tavern, worldGrammar: { ...tavern.worldGrammar, scale: 'medium' } },
      undefined
    );
    expect(mediumWorld.chunks.length).toBe(9);
    expect(
      mediumWorld.worldProps.some(
        (p) => p.generator === 'deciduous_tree' || p.generator === 'pine_tree'
      )
    ).toBe(false);

    // Verifica materiais emissivos da lareira e mesa da taverna
    const hearth = tavern.props.find((p) => p.generator === 'fireplace')!;
    const hearthBundle = buildPropGeometryBundle(hearth);
    expect(hearthBundle.materials).toEqual(['stone_brick', 'wood_plank', 'ember_glow']);

    // Spawn no corredor livre e colisão sólida contra balcão/mesas
    const [sx] = findDefaultSpawnXZ(tavern, tavern.structures, tavern.props);
    const propObs = extractPropCollisionObstacles(tavern.props);
    const segs = [
      ...extractCollisionSegments(tavern.structures, new Set()),
      ...propObs.segments,
    ];
    const bar = tavern.props.find((p) => p.id === 'tav_bar_mid')!;
    const [blockedX] = resolveMovementWithCollisions(
      sx,
      bar.position[2],
      bar.position[0],
      bar.position[2],
      0.25,
      segs,
      propObs.circles
    );
    expect(blockedX).toBeLessThan(bar.position[0] - 0.15);
  });

  it('stress test: compila Cidade Medieval com 80+ estruturas rotacionadas, arcos de fonte e expansão 5x5', () => {
    const city = createCidadeMedievalScene();
    expect(city.meta.aspectRatio).toBeCloseTo(819 / 1024, 4);
    expect(city.structures.length).toBeGreaterThanOrEqual(80);
    expect(city.props.length).toBeGreaterThanOrEqual(40);
    expect(
      city.structures.some((s) => s.roofMaterial === 'roof_terracotta')
    ).toBe(true);

    let totalArchTris = 0;
    for (const st of city.structures) {
      const b = buildStructureArchitectureBundle(st);
      totalArchTris += b.wallsGeom.getAttribute('position').count / 3;
      const roof = buildStructureRoofGeometry(st);
      if (roof) totalArchTris += roof.getAttribute('position').count / 3;
    }
    expect(totalArchTris).toBeGreaterThan(3000);
    expect(totalArchTris).toBeLessThan(35000);

    const world = buildMultiScaleWorld(city, undefined);
    expect(world.gridRadius).toBe(2);
    expect(world.chunks.length).toBe(25);
    expect(world.worldProps.length).toBeGreaterThan(50);

    const [sx, sz] = findDefaultSpawnXZ(city, city.structures, city.props);
    expect(Math.hypot(sx, sz)).toBeLessThan(city.terrain.depth);
  });

  it('compila Porto & Cidadela Fluvial (Rustymaps) com muralha, 2 pontes, 6 píeres, barcos, farol e mundo 5x5', () => {
    const port = createPortoRustymapsScene();
    expect(port.meta.aspectRatio).toBeCloseTo(746 / 1024, 4);
    expect(port.terrain.waterEnabled).toBe(true);

    const bridges = port.structures.filter((s) => s.semanticTag === 'bridge');
    const walls = port.structures.filter((s) => s.semanticTag === 'wall');
    const towers = port.structures.filter((s) => s.semanticTag === 'tower');
    const boats = port.props.filter((p) => p.generator === 'boat');
    expect(bridges.length).toBeGreaterThanOrEqual(8); // 2 pontes + 6 píeres
    expect(walls.length).toBeGreaterThanOrEqual(6);
    expect(towers.length).toBeGreaterThanOrEqual(5);
    expect(boats.length).toBe(5);

    let totalArchTris = 0;
    for (const st of port.structures) {
      const b = buildStructureArchitectureBundle(st);
      totalArchTris += b.wallsGeom.getAttribute('position').count / 3;
      const roof = buildStructureRoofGeometry(st);
      if (roof) totalArchTris += roof.getAttribute('position').count / 3;
    }
    expect(totalArchTris).toBeGreaterThan(2000);
    expect(totalArchTris).toBeLessThan(30000);

    const world = buildMultiScaleWorld(port, undefined);
    expect(world.gridRadius).toBe(2);
    expect(world.chunks.length).toBe(25);
  });
});

describe('mapLibrary (Abrir, Salvar & Biblioteca de Mapas)', () => {
  it('lista biblioteca integrada com Porto & Cidadela e serializa/importa projeto completo e IsoDSL', () => {
    expect(BUILTIN_MAPS.length).toBeGreaterThanOrEqual(8);
    expect(BUILTIN_MAPS.some((m) => m.id === 'porto-rustymaps')).toBe(true);

    const port = createPortoRustymapsScene();
    const project = serializeProjectFile(port, '/maps/porto-rustymaps.jpg', 'Porto Editado');
    const parsedProject = parseImportedMapFile(JSON.stringify(project));
    expect(parsedProject.kind).toBe('project');
    expect(parsedProject.name).toBe('Porto Editado');
    expect(parsedProject.sourceImageUrl).toBe('/maps/porto-rustymaps.jpg');
    expect(parsedProject.scene.structures.length).toBe(port.structures.length);

    // Importação de .isodsl.json puro recupera imagem integrada pelo sourceLabel
    const parsedDsl = parseImportedMapFile(JSON.stringify(port));
    expect(parsedDsl.kind).toBe('isodsl');
    expect(parsedDsl.sourceImageUrl).toBe('/maps/porto-rustymaps.jpg');
  });

  it('salva, renomeia, duplica, exclui na biblioteca e trata cota de imagem DataURL', () => {
    const backing = new Map<string, string>();
    const mockStorage: StorageLike = {
      getItem: (k) => backing.get(k) ?? null,
      setItem: (k, v) => {
        if (v.includes('data:image/png;base64,HUGE')) {
          throw new Error('QuotaExceededError');
        }
        backing.set(k, v);
      },
    };

    const port = createPortoRustymapsScene();
    const saved = saveMapToLibrary(
      port,
      'data:image/png;base64,HUGE_IMAGE_DATA',
      { name: 'Porto Custom' },
      mockStorage
    );
    expect(saved.droppedInlineImage).toBe(true);
    expect(saved.entry.sourceImageUrl).toBeNull();
    expect(listSavedMaps(mockStorage).length).toBe(1);

    const dup = duplicateSavedMap(saved.entry.id, mockStorage);
    expect(dup?.name).toBe('Porto Custom (Cópia)');
    expect(listSavedMaps(mockStorage).length).toBe(2);

    const renamed = renameSavedMap(saved.entry.id, 'Porto Final', mockStorage);
    expect(renamed.find((m) => m.id === saved.entry.id)?.name).toBe('Porto Final');

    const afterDel = deleteSavedMap(saved.entry.id, mockStorage);
    expect(afterDel.length).toBe(1);
  });
});

describe('exporter (Baking de Displacement no Terreno)', () => {
  it('assa macro-relevo nos vértices Y da malha de terreno para exportação glTF', () => {
    const terrainCfg: TerrainConfig = {
      width: 10,
      depth: 10,
      subdivisions: 4,
      displacementScale: 3.0,
      normalStrength: 1,
      detailBlend: 0.5,
      smoothRadius: 0,
      invertHeight: false,
      heightMode: 'luminance',
      textureMode: 'projected',
      fallbackMaterial: 'moss_earth',
      waterEnabled: false,
      waterElevation: 0,
    };
    const geom = buildTerrainBaseGeometry(terrainCfg);
    const hf = {
      macroHeight: new Float32Array([1, 1, 1, 1]),
      rawLuminance: new Float32Array([1, 1, 1, 1]),
      width: 2,
      height: 2,
    };

    bakeTerrainDisplacementIntoGeometry(geom, hf, terrainCfg.displacementScale);
    const pos = geom.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBeCloseTo(3.0, 4);
    }
  });
});
