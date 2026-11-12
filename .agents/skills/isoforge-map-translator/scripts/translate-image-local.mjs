#!/usr/bin/env node
/**
 * Pipeline autônomo para IAs locais (Ollama / LM Studio / OpenAI-compatible VLM)
 * reproduzirem o processo do IsoForge:
 *   Imagem 2D -> Medição -> Prompt Estruturado -> IsoDSL JSON -> Validação & Reparo -> Arquivo Final
 *
 * Exemplos:
 *   # Imprimir apenas o prompt calibrado para a imagem (dry-run):
 *   node translate-image-local.mjs public/maps/ruinas-rio.jpg --scale medium --dry-run-prompt
 *
 *   # Rodar direto com Ollama local (ex.: qwen2.5vl ou llama3.2-vision):
 *   node translate-image-local.mjs public/maps/ruinas-rio.jpg --model qwen2.5vl --scale medium --out meu-mapa.isodsl.json
 *
 *   # Rodar com servidor compatível OpenAI (LM Studio / vLLM):
 *   node translate-image-local.mjs public/maps/ruinas-rio.jpg --openai-url http://127.0.0.1:1234/v1 --model qwen2.5-vl-7b --out meu-mapa.isodsl.json
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readImageDimensions } from './uv-helper.mjs';

function extractJsonBlock(rawText) {
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : rawText.trim();
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Resposta do modelo não contém JSON válido.');
  }
  return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
}

function buildTranslationPrompt({ dims, aspectRatio, terrainW, terrainD, orthoScale, preset, scale }) {
  return `Você é o agente tradutor espacial IsoForge (IsoDSL v1.0).
Analise esta imagem de mapa RPG (${dims.width}x${dims.height}, aspectRatio=${aspectRatio}, preset=${preset}) e gere APENAS um objeto JSON válido (sem texto extra) no formato IsoDSL v1.0.

REGRAS OBRIGATÓRIAS:
1. meta: { "name": "Mapa Traduzido", "sourceLabel": "local-vlm", "aspectRatio": ${aspectRatio}, "createdAt": "${new Date().toISOString()}" }
2. projection: { "preset": "${preset}", "type": "${preset === 'perspective' ? 'perspective' : 'orthographic'}", "pitchDeg": ${preset === 'top_down' ? 89.5 : preset === 'isometric_true' ? 35.264 : preset === 'isometric_dimetric' ? 30 : 42}, "yawDeg": ${preset === 'top_down' ? 0 : 45}, "orthoScale": ${orthoScale}, "fovDeg": 36, "offsetX": 0, "offsetY": 0 }
3. terrain: { "width": ${terrainW}, "depth": ${terrainD}, "subdivisions": 112, "displacementScale": 1.15, "normalStrength": 2.1, "detailBlend": 0.55, "smoothRadius": 2, "invertHeight": false, "heightMode": "semantic_outdoor", "textureMode": "hybrid", "fallbackMaterial": "moss_earth", "waterEnabled": <true|false>, "waterElevation": 0.21 }
4. Conversão de coordenadas normalizadas (u,v de 0..1 da imagem) para mundo (X, Z):
   x = (u - 0.5) * ${terrainW}
   z = (v - 0.5) * ${terrainD}
5. structures[]: muros, casas, torres ou ruínas detectadas com "footprint": [[x,z], ...] (>=3 vértices), "baseElevation": 0.45, "floors": 1, "floorHeight": 1.5, "wallStyle": "plain"|"timber_frame"|"buttress", "hasDoor": false, "roofType": "flat"|"gable"|"hip"|"cone"|"parapet", "roofPitchDeg": 35, "roofOverhang": 0.3, "hideRoof": false, "textureMode": "hybrid", "fallbackMaterial": "stone_brick"|"timber_plaster", "roofMaterial": "roof_slate"|"stone_brick", "visible": true.
   - Muros em ângulo: trace os 4 vértices rotacionados ao longo do muro (espessura ~0.55m).
   - Círculos abertos: divida em arcos separados deixando o centro livre.
6. props[]: objetos visíveis usando APENAS: "deciduous_tree", "pine_tree", "bush", "rock", "pillar", "fallen_pillar", "signpost", "barrel", "crate", "brazier", "tavern_table", "stool", "bar_counter", "fireplace", "bookshelf", "wall_sconce", "card_25d", com "position": [x, y, z] (y ~ 0.5 em terra firme, y ~ 0.06 em piso interno, y ~ 0.2 em pedras no rio), "rotationYDeg": 0..360, "scale": 0.6..2.2, "textureMode": "hybrid", "fallbackMaterial": "moss_earth"|"stone_brick"|"wood_plank"|"timber_plaster", "visible": true.
7. lighting: { "sunAzimuthDeg": 318, "sunElevationDeg": 54, "sunIntensity": 1.85, "ambientIntensity": 0.72, "torchEnabled": true, "torchIntensity": 2.0, "torchColor": "#ffa84c" }
8. worldGrammar: { "scale": "${scale}", "seed": 2026, "randomness": 0.48, "treeDensity": 1.0, "minTreeSpacing": 2.8, "poiChance": 0.6, "meanderStrength": 0.55, "enableBridges": true }`;
}

async function callOllama({ url, model, prompt, base64Img }) {
  const res = await fetch(`${url.replace(/\/+$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: 'json',
      messages: [
        {
          role: 'user',
          content: prompt,
          images: [base64Img],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.message?.content ?? '';
}

async function callOpenAICompat({ url, model, prompt, base64Img, mimeType }) {
  const res = await fetch(`${url.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Img}` },
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI-compat HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function main() {
  const args = process.argv.slice(2);
  const imgArg = args.find((a) => !a.startsWith('--'));
  const getFlag = (flag, def = null) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : def;
  };
  const hasFlag = (flag) => args.includes(flag);

  if (!imgArg) {
    console.error(
      'Uso: node translate-image-local.mjs <imagem> [--scale small|medium|large] [--preset top_down|isometric_true] [--model qwen2.5vl] [--ollama-url http://127.0.0.1:11434] [--openai-url URL] [--out out.isodsl.json] [--dry-run-prompt]'
    );
    process.exit(1);
  }

  const imgPath = path.resolve(process.cwd(), imgArg);
  if (!fs.existsSync(imgPath)) {
    console.error(`Imagem não encontrada: ${imgPath}`);
    process.exit(1);
  }

  const dims = readImageDimensions(imgPath);
  const aspectRatio = Number((dims.width / dims.height).toFixed(6));
  const preset = getFlag('--preset', 'top_down');
  const scale = getFlag('--scale', 'medium');
  const orthoScale = Number(getFlag('--ortho', aspectRatio < 1 ? 32 : 22));
  const terrainD = orthoScale;
  const terrainW = Number((orthoScale * aspectRatio).toFixed(3));

  const prompt = buildTranslationPrompt({
    dims,
    aspectRatio,
    terrainW,
    terrainD,
    orthoScale,
    preset,
    scale,
  });

  if (hasFlag('--dry-run-prompt')) {
    console.log(prompt);
    return;
  }

  const model = getFlag('--model', 'qwen2.5vl');
  const ollamaUrl = getFlag('--ollama-url', 'http://127.0.0.1:11434');
  const openaiUrl = getFlag('--openai-url', null);
  const outPath = path.resolve(
    process.cwd(),
    getFlag('--out', `${path.basename(imgPath, path.extname(imgPath))}.isodsl.json`)
  );

  const ext = path.extname(imgPath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
  const base64Img = fs.readFileSync(imgPath).toString('base64');

  console.log(`🔍 Enviando ${path.basename(imgPath)} (${dims.width}x${dims.height}) para ${openaiUrl ?? ollamaUrl} [${model}]...`);

  const invokeModel = (textPrompt) =>
    openaiUrl
      ? callOpenAICompat({ url: openaiUrl, model, prompt: textPrompt, base64Img, mimeType })
      : callOllama({ url: ollamaUrl, model, prompt: textPrompt, base64Img });

  let raw = await invokeModel(prompt);
  let parsed = extractJsonBlock(raw);
  parsed.schemaVersion = '1.0';
  fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2));

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const validatorScript = path.join(__dirname, 'validate-and-build.mjs');

  try {
    const out = execFileSync('node', [validatorScript, outPath], { encoding: 'utf8' });
    console.log(out);
  } catch (err) {
    console.warn('⚠️ Primeira tentativa apresentou erro de validação; solicitando autocorreção ao modelo local...');
    const repairPrompt = `${prompt}\n\nCORRIJA O JSON ANTERIOR COM BASE NESTE ERRO DE VALIDAÇÃO:\n${err.stderr || err.message}\n\nJSON ANTERIOR:\n${JSON.stringify(parsed)}`;
    raw = await invokeModel(repairPrompt);
    parsed = extractJsonBlock(raw);
    parsed.schemaVersion = '1.0';
    fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2));
    const repairedOut = execFileSync('node', [validatorScript, outPath], { encoding: 'utf8' });
    console.log(repairedOut);
  }

  console.log(`💾 Salvo em: ${outPath}`);
}

main().catch((err) => {
  console.error('❌ Erro no pipeline local:', err.message);
  process.exit(1);
});

