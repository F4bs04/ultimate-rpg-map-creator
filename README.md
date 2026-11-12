# Ultimate RPG Map Creator — Reconstrutor Procedural de Cenários RPG

Ferramenta web em **React + TypeScript + Three.js** que reconstrói ilustrações 2D (**Top-Down** e **Isométricas**) como cenários 3D ultraleves prontos para **WebGL, Godot 4, Unity e Unreal**, evitando malhas densas e usando **leitura semântica de regiões**, **primitivas paramétricas**, **materiais procedurais**, **Displacement/Heightmaps**, **Normal Maps**, **Absorção Multi-Imagem (`IsoWorldKit`)** e **Wave Function Collapse (WFC)** em escalas **Pequeno**, **Médio** e **Grande**.

---

## Como Rodar

```bash
npm install
npm run dev
```

Para executar testes e build de produção:

```bash
npm test
npm run build
```

---

## Principais Recursos

- **Reconstrução Semântica Procedural (padrão):** rios, estradas, clareiras, vegetação e estruturas viram geometria nativa; a imagem não é aplicada sobre a malha.
- **Projeção 2D opcional:** o calibrador e o modo de compatibilidade continuam disponíveis para inspeção e cenas antigas, mas não são necessários para reconstruir um mapa.
- **Relevo & Micro-Detalhe:** *Heightfield* (`semantic_outdoor` para rios/trilhas/grama, `luminance`, ou `Depth Anything V2` via WebGPU/ONNX sob demanda) + *Normal Maps* derivados via Sobel 3×3.
- **Geometry Nodes semântico:** classifica regiões, gera múltiplas espécies de árvores por manchas, evita caminhos/estruturas com scatter espacial, escolhe modelos por bioma e materializa rios/estradas como faixas 3D.
- **Absorvedor Multi-Imagem (`IsoWorldKit`) & Gerador de Texturas:** extrai *swatches* sem costura, detecta portais de rios/estradas nas bordas, sintetiza texturas Painterly 128px (ou conecta direto ao **ComfyUI Local API**) e suaviza transições entre chunks (`edgeStrips`).
- **Expansão Procedural Multi-Escala (`Pequeno 1×1` · `Médio 3×3` · `Grande 7×7`):** solver WFC de biomas, continuidade orgânica de rios/estradas com pontes automáticas, POIs sem booleanas (`IRCSS`) e `THREE.InstancedMesh` com espaçamento Poisson-Disk.
- **Exportação Engine:** `.glb` completo ou por chunk individual (com displacement assado nos vértices do terreno e colliders opcionais `-colonly` / `_Collider`), `.isodsl.json`, `world_manifest.json` e `comfyui_kit_spec.json`.

---

## Skill para IAs Locais (`.agents/skills/isoforge-map-translator/`)

Qualquer agente ou modelo local (Antigravity, Ollama `qwen2.5vl`/`llama3.2-vision`, LM Studio, Codex) pode reproduzir o fluxo usando a skill em [SKILL.md](./.agents/skills/isoforge-map-translator/SKILL.md):

```bash
# Medir imagem e calcular tamanho exato do terreno
node .agents/skills/isoforge-map-translator/scripts/uv-helper.mjs --image public/maps/ruinas-rio.jpg --ortho 32

# Calcular footprint rotacionado para muros em ângulo
node .agents/skills/isoforge-map-translator/scripts/uv-helper.mjs --width 18 --depth 32 --wall 0.06,0.075,0.25,0.04,0.58

# Gerar IsoDSL via Ollama local com loop automático de validação e reparo
node .agents/skills/isoforge-map-translator/scripts/translate-image-local.mjs public/maps/ruinas-rio.jpg --model qwen2.5vl --scale medium --out meu-mapa.isodsl.json

# Validar e compilar triângulos/chunks de qualquer arquivo .isodsl.json
node .agents/skills/isoforge-map-translator/scripts/validate-and-build.mjs public/maps/ruinas-rio-medio.isodsl.json
```

Veja o histórico completo de pesquisa e decisões técnicas em [EVOLUCAO_E_DESCOBERTAS.md](./EVOLUCAO_E_DESCOBERTAS.md).
