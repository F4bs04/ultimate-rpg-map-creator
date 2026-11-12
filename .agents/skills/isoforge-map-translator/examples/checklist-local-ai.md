# Prompt Template para Modelos Locais (Ollama / LM Studio / VLM)

Use este prompt compacto ao acionar um modelo local multimodal (ex.: `qwen2.5vl`, `llama3.2-vision`, `gemma3`) para gerar um arquivo `.isodsl.json` válido a partir de uma imagem de mapa RPG:

```text
Você é um tradutor espacial para o motor IsoForge (IsoDSL v1.0).
Analise a imagem de mapa RPG anexada (dimensões: {WIDTH_PX}x{HEIGHT_PX}, aspectRatio={ASPECT_RATIO}).
Retorne APENAS JSON válido (sem markdown extra) seguindo estas regras:

1. PROPORÇÃO DO TERRENO:
   - orthoScale = 32 (se retrato) ou 22 (se paisagem/isométrico)
   - terrain.depth = orthoScale
   - terrain.width = round(orthoScale * aspectRatio, 3)

2. CONVERSÃO DE COORDENADAS (u,v de 0..1 da imagem para mundo X,Z):
   - x = (u - 0.5) * terrain.width
   - z = (v - 0.5) * terrain.depth

3. REGRAS DE ESTRUTURAS & PROPS LEVES:
   - Muros/ruínas em ângulo: trace os 4 vértices rotacionados ao longo da linha do muro (espessura ~0.55m).
   - Círculos abertos: divida em 3 ou 4 arcos separados deixando o centro livre.
   - Use textureMode: "hybrid", wallStyle: "buttress" (pedra) ou "timber_frame" (casas).
   - Props permitidos: "deciduous_tree", "pine_tree", "bush", "rock", "pillar", "fallen_pillar", "signpost", "barrel", "crate", "brazier", "tavern_table", "stool", "bar_counter", "fireplace", "bookshelf", "wall_sconce", "card_25d".
   - Para mapas internos (tavernas/masmorras): use `displacementScale: 0.14`, `waterEnabled: false` e `"environmentMode": "interior"` em `worldGrammar`.
   - Se houver rio/água: heightMode: "semantic_outdoor", waterEnabled: true, waterElevation: 0.21, displacementScale: 1.15.

4. ESCALA DE MUNDO:
   - worldGrammar: { "scale": "small" | "medium" | "large", "seed": 2026, "randomness": 0.45, "treeDensity": 1.0, "minTreeSpacing": 2.8, "poiChance": 0.55, "meanderStrength": 0.55, "enableBridges": true }

Depois salve o JSON e execute:
node .agents/skills/isoforge-map-translator/scripts/validate-and-build.mjs seu-mapa.isodsl.json
```

