#!/usr/bin/env node
/**
 * Validador & Compilador CLI do IsoForge para agentes locais.
 * Valida schema IsoDSL v1.0, proporções, riscos de waterElevation,
 * compila geometria de estruturas/props via compiler.ts + worldBuilder.ts
 * e imprime orçamento exato de triângulos e chunks WFC.
 *
 * Uso:
 *   node .agents/skills/isoforge-map-translator/scripts/validate-and-build.mjs <scene.isodsl.json>
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_PROJECTION_PRESETS = new Set([
  'isometric_true',
  'isometric_dimetric',
  'top_down',
  'perspective',
]);
const VALID_TEXTURE_MODES = new Set(['projected', 'hybrid', 'procedural']);
const VALID_ROOF_TYPES = new Set(['flat', 'gable', 'hip', 'cone', 'parapet']);
const VALID_WALL_STYLES = new Set(['plain', 'timber_frame', 'buttress']);
const VALID_PROP_TYPES = new Set([
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
]);
const VALID_SCALES = new Set(['small', 'medium', 'large']);
const VALID_ENV_MODES = new Set(['outdoor', 'interior']);

function validateIsoDSL(scene) {
  const errors = [];
  const warnings = [];

  if (!scene || typeof scene !== 'object') {
    return { errors: ['JSON raiz inválido.'], warnings };
  }
  if (scene.schemaVersion !== '1.0') {
    errors.push(`schemaVersion esperado "1.0", recebido "${scene.schemaVersion}".`);
  }
  if (!scene.projection || !VALID_PROJECTION_PRESETS.has(scene.projection.preset)) {
    errors.push(`projection.preset inválido: "${scene.projection?.preset}".`);
  }
  if (!scene.terrain || scene.terrain.width <= 0 || scene.terrain.depth <= 0) {
    errors.push('terrain.width e terrain.depth devem ser > 0.');
  } else if (scene.meta?.aspectRatio) {
    const terrainAspect = scene.terrain.width / scene.terrain.depth;
    const diff = Math.abs(terrainAspect - scene.meta.aspectRatio);
    if (diff > 0.04) {
      warnings.push(
        `Proporção do terreno (${terrainAspect.toFixed(3)}) difere do aspectRatio da imagem (${scene.meta.aspectRatio.toFixed(3)}). Ajuste terrain.width = orthoScale * aspectRatio.`
      );
    }
  }

  if (
    scene.terrain?.waterEnabled &&
    scene.terrain?.heightMode === 'semantic_outdoor' &&
    scene.terrain.waterElevation > 0.32 * (scene.terrain.displacementScale || 1)
  ) {
    warnings.push(
      `waterElevation (${scene.terrain.waterElevation}) está alto para semantic_outdoor e pode invadir áreas secas. Recomendado <= ${(0.24 * (scene.terrain.displacementScale || 1)).toFixed(2)}.`
    );
  }

  const structures = Array.isArray(scene.structures) ? scene.structures : [];
  structures.forEach((st, idx) => {
    if (!Array.isArray(st.footprint) || st.footprint.length < 3) {
      errors.push(`structures[${idx}] (${st.id}) precisa de footprint com >= 3 vértices.`);
    }
    if (!VALID_ROOF_TYPES.has(st.roofType)) {
      errors.push(`structures[${idx}] roofType inválido: "${st.roofType}".`);
    }
    if (st.wallStyle && !VALID_WALL_STYLES.has(st.wallStyle)) {
      errors.push(`structures[${idx}] wallStyle inválido: "${st.wallStyle}".`);
    }
    if (!VALID_TEXTURE_MODES.has(st.textureMode)) {
      errors.push(`structures[${idx}] textureMode inválido: "${st.textureMode}".`);
    }
  });

  const props = Array.isArray(scene.props) ? scene.props : [];
  props.forEach((p, idx) => {
    if (!VALID_PROP_TYPES.has(p.generator)) {
      errors.push(`props[${idx}] generator inválido: "${p.generator}".`);
    }
    if (!Array.isArray(p.position) || p.position.length !== 3) {
      errors.push(`props[${idx}] position deve ter 3 números [x, y, z].`);
    }
  });

  if (scene.worldGrammar && !VALID_SCALES.has(scene.worldGrammar.scale)) {
    errors.push(`worldGrammar.scale inválido: "${scene.worldGrammar.scale}".`);
  }
  if (
    scene.worldGrammar?.environmentMode &&
    !VALID_ENV_MODES.has(scene.worldGrammar.environmentMode)
  ) {
    errors.push(
      `worldGrammar.environmentMode inválido: "${scene.worldGrammar.environmentMode}".`
    );
  }

  return { errors, warnings };
}

async function main() {
  const inputArg = process.argv[2];
  if (!inputArg) {
    console.error('Uso: node validate-and-build.mjs <caminho-scene.isodsl.json>');
    process.exit(1);
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, '../../../..');
  const scenePath = path.resolve(process.cwd(), inputArg);

  if (!fs.existsSync(scenePath)) {
    console.error(`Arquivo não encontrado: ${scenePath}`);
    process.exit(1);
  }

  const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  const { errors, warnings } = validateIsoDSL(scene);

  if (errors.length > 0) {
    console.error('❌ Falha na validação IsoDSL:');
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  // Empacota compiler + worldBuilder com esbuild em memória para medir triângulos reais
  const entryTs = `
    export { buildStructureWallsGeometry, buildStructureRoofGeometry, buildPropGeometry, buildTerrainBaseGeometry } from './src/core/compiler.ts';
    export { buildMultiScaleWorld } from './src/core/worldBuilder.ts';
  `;
  const esbuildBin = path.join(repoRoot, 'node_modules', '.bin', 'esbuild');
  const bundled = execFileSync(
    esbuildBin,
    [
      '--bundle',
      '--format=esm',
      '--platform=node',
      '--loader=ts',
      '--external:three',
      '--external:three/*',
    ],
    {
      cwd: repoRoot,
      input: entryTs,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    }
  );

  // Rewrite bare 'three' imports to absolute file URL so node resolves from repo node_modules
  const threeEntry = path.join(repoRoot, 'node_modules/three/build/three.module.js');
  const bufferUtilsEntry = path.join(
    repoRoot,
    'node_modules/three/examples/jsm/utils/BufferGeometryUtils.js'
  );
  const patchedBundle = bundled
    .replaceAll(`"three"`, `"file://${threeEntry}"`)
    .replaceAll(`'three'`, `'file://${threeEntry}'`)
    .replaceAll(
      `"three/examples/jsm/utils/BufferGeometryUtils.js"`,
      `"file://${bufferUtilsEntry}"`
    );

  const mod = await import(
    `data:text/javascript;base64,${Buffer.from(patchedBundle).toString('base64')}`
  );

  const countTris = (geom) => {
    if (!geom) return 0;
    const pos = geom.getAttribute('position');
    if (!pos) return 0;
    return geom.index ? geom.index.count / 3 : pos.count / 3;
  };

  let anchorTris = countTris(mod.buildTerrainBaseGeometry(scene.terrain));
  for (const st of scene.structures || []) {
    if (!st.visible) continue;
    anchorTris += countTris(mod.buildStructureWallsGeometry(st));
    anchorTris += countTris(mod.buildStructureRoofGeometry(st));
  }
  for (const prop of scene.props || []) {
    if (!prop.visible) continue;
    anchorTris += countTris(mod.buildPropGeometry(prop));
  }

  let worldSummary = null;
  if (scene.worldGrammar) {
    const exp = mod.buildMultiScaleWorld(scene, scene.kit);
    worldSummary = exp.summary;
  }

  console.log('✅ IsoDSL v1.0 válido!');
  console.log(
    JSON.stringify(
      {
        scene: scene.meta?.name ?? 'sem-nome',
        projection: scene.projection.preset,
        terrainMeters: [scene.terrain.width, scene.terrain.depth],
        structuresCount: (scene.structures || []).length,
        anchorPropsCount: (scene.props || []).length,
        anchorTriangles: Math.round(anchorTris),
        worldScale: scene.worldGrammar?.scale ?? 'small',
        worldExpansion: worldSummary,
        warnings,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error('Erro ao validar/compilar:', err);
  process.exit(1);
});

