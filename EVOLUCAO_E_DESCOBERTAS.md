# IsoForge — Evolução, Descobertas Técnicas e Direcionamento Arquitetural

Este documento registra toda a evolução conceitual, pesquisa de referências e decisões de engenharia tomadas durante o nascimento do **IsoForge**: uma ferramenta para converter **imagens 2D (isométricas ou top-down)** em **cenários 3D ultraleves** prontos para WebGL e game engines (Godot, Unity, Unreal).

---

## 1. O Problema e a Tese Central

### O que queremos evitar
Modelos generativos 3D recentes baseados em difusão ou *Gaussian Splats* costumam gerar:
- Malhas monolíticas com dezenas de milhares de triângulos e topologia suja;
- Chão, paredes e objetos fundidos em um único bloco (impossível de navegar, colidir ou ocultar tetos em um RPG);
- UVs ilegíveis e texturas pesadas.

### Nossa Tese
Em vez de "esculpir" malhas pesadas, traduzimos a imagem de entrada para um sistema híbrido composto por:
1. **Projeção de Textura 2D** (preserva a arte original sobre geometria simples);
2. **Primitivas 3D Paramétricas** (caixas, prismas extrudados de *footprints* 2D, cilindros, cones);
3. **Displacement Map (Macro-relevo)** + **Normal Map (Micro-relevo)** para que luzes dinâmicas (sol, sombras, tochas) reajam fisicamente com custo mínimo de polígonos;
4. **Linguagem Declarativa de Mapa (`IsoDSL`)** legível por humanos, editores visuais e IAs.

---

## 2. Síntese dos 7 Repositórios Analisados

| Repositório | Principal Contribuição Absorvida | Como entra no IsoForge |
| :--- | :--- | :--- |
| **[vinhhien112/img2obj](https://github.com/vinhhien112/img2obj)** | Fluxo *Imagem → Código Three.js procedural* usando primitivas puras + loop de validação visual contra a imagem original. | Base para a biblioteca de **Props em Código** (`barrel`, `crate`, `pillar`, `pine_tree`, `brazier`, `card_25d`) e futuro loop visual de IA. |
| **[RareSense/Nova3D](https://github.com/RareSense/Nova3D)** | Tese **"3D as Code"**: o `.glb` final é apenas um artefato compilado. Mantém hierarquia semântica de partes nomeadas, pivôs e materiais PBR. | Estrutura de exportação `.glb` com grupos semânticos (`Terrain`, `Structures/<id>/Walls`, `Roof_Hideable`, `Props`). |
| **[H-EmbodVis/ROAD](https://github.com/H-EmbodVis/ROAD)** | Pesquisa sobre alinhamento semântico discriminativo em geração 3D (coerência global + correspondência de partes). | Princípio aplicado antes da instanciação: separar semanticamente o que é chão, muro, construção, água ou prop antes de gerar primitivas. |
| **[hasanharman/isomiddleearth](https://github.com/hasanharman/isomiddleearth)** | Editor web enxuto (React/TypeScript/Zustand) com grid isométrico e persistência em JSON simples (`schemaVersion`, `gridSize`, `map`). | Inspiração direta para a UI leve do editor web e para o contrato JSON da linguagem `IsoDSL`. |
| **[IRCSS/Blender-Geometry-Node-French-Houses](https://github.com/IRCSS/Blender-Geometry-Node-French-Houses)** | Gramática arquitetônica procedural construída a partir de **footprints 2D simples**, evitando operações booleanas. | Base da nossa extrusão de paredes + telhados procedurais (`flat`, `gable`, `hip`, `cone`, `parapet`) sem booleanas. |
| **[Aljullu/threejs-procedural-building-generator](https://github.com/Aljullu/threejs-procedural-building-generator)** | Geração procedural de prédios e cálculo de UVs diretamente no navegador com JavaScript + Three.js. | Prova de que a compilação arquitetônica e mapeamento UV podem rodar 100% no browser em tempo real. |
| **[Belluxx/Aleph](https://github.com/Belluxx/Aleph)** | Captura real de elevação de terreno + imagens + *footprints* vetoriais (OpenStreetMap). | Inspiração invertida: em mapas fictícios, uma **única imagem 2D** fornece esses mesmos 3 pilares sintéticos (Heightmap + Albedo Projetado + Footprints 2D). |

---

## 3. Descobertas Complementares & Soluções Técnicas

Durante o aprofundamento técnico, identificamos 5 pontos críticos que definem a qualidade prática da ferramenta:

### 3.1. Calibração Isométrica (`OrthographicCamera`) vs. `fSpy`
- **Descoberta:** Ferramentas clássicas de *camera matching* como o `fSpy` dependem de **pontos de fuga** (projeção perspectiva *pinhole*). Em mapas **isométricos ou top-down ortográficos** (onde linhas paralelas nunca convergem), o cálculo de pontos de fuga falha ou gera distâncias focais absurdas.
- **Solução adotada:** Suporte nativo a **Câmera Ortográfica Calibrada** com presets prontos (`Isométrico Real 35.264° / 45°`, `Isométrico 2:1 30° / 45°`, `Top-Down 89.5° / 0°`) **além** do modo `Perspectiva 3/4`, com sliders de ajuste fino (`pitch`, `yaw`, `orthoScale`, `offsetX/Z`) e overlay semitransparente alinhado pixel a pixel pela altura da projeção.

### 3.2. Projeção Compatível com Exportação (`Vertex-Baked Projective UVs`)
- **Descoberta:** Bibliotecas baseadas em shader customizado (como `three-projected-material`) ficam ótimas no preview, mas o `GLTFExporter` padrão não exporta lógica de shader customizado para Unity/Godot/Unreal.
- **Solução adotada:** Em `src/core/projection.ts`, calculamos a matriz `projectionMatrix * matrixWorldInverse` da câmera projetora e gravamos as coordenadas `(u, v)` **diretamente no buffer padrão `geometry.attributes.uv`** (com subdivisão leve nas paredes para evitar distorção afim em perspectiva). Assim, a cena usa `MeshStandardMaterial` padrão, recebe sombras + normal maps reais e exporta de forma idêntica para qualquer engine.

### 3.3. Resolvendo Faces Ocultas com o Modo Híbrido
- **Descoberta:** Ao girar a câmera em volta de uma caixa projetada de uma única imagem 2D, as faces traseiras (ocultas da visão original) sofrem esticamento severo de pixels.
- **Solução adotada (`textureMode: 'hybrid'`):** Para cada triângulo, comparamos o produto escalar entre a normal da face e o vetor da câmera projetora:
  - **Faces visíveis (`materialIndex: 0`):** recebem UVs projetados da ilustração original.
  - **Faces ocultas (`materialIndex: 1`):** recebem UVs planares em escala do mundo com **texturas PBR procedurais tileáveis** (pedra, enxaimel, ardósia, madeira, musgo — geradas em `src/core/proceduralTextures.ts` já com Normal Maps derivados via Sobel).
  - Além disso, o usuário pode alternar qualquer estrutura/terreno entre `hybrid`, `projected` (2D puro) e `procedural` (PBR puro).

### 3.4. Displacement Map vs. Normal Map na Exportação `.glb`
- **Descoberta:** A especificação padrão do **glTF 2.0 / `.glb` não possui slot nativo de `displacementMap`** para deformar vértices automaticamente nas engines.
- **Solução adotada em duas camadas:**
  - **No preview WebGL:** o terreno usa `displacementMap` + `normalMap` em tempo real para resposta imediata dos sliders.
  - **Na exportação `.glb` (`src/core/exporter.ts`):** o macro-relevo do *heightfield* é **assado (baked) diretamente nas coordenadas Y dos vértices** do terreno (`bakeTerrainDisplacementIntoGeometry`), garantindo que colisores (`StaticBody3D` / `MeshCollider`) na Godot/Unity/Unreal correspondam exatamente ao relevo visual, enquanto o **micro-relevo** viaja no **Normal Map** PNG embutido (zero polígonos extras).

### 3.5. Visão para Fases Futuras (WebGPU Depth & Wave Function Collapse)
- **Profundidade Neural no Navegador (Fase 2):** O modelo `Depth Anything V2 Small` (~100 MB quantizado em ONNX via `@huggingface/transformers` + `onnxruntime-web` com WebGPU) permite gerar mapas de profundidade reais diretamente no navegador sem backend obrigatório.
- **Expansão de Cenário (Fase 3):** Bibliotecas como `three-wfc` / `ndwfc` (*Wave Function Collapse* para Three.js) permitem expandir estradas, muros e florestas além das bordas originais da imagem usando o mesmo `IsoDSL`.

---

## 4. Decisões Consolidadas (Alinhamento de Produto)

1. **Suporte Dual (Top-Down + Isométrico):** O núcleo de projeção e os exemplos embutidos cobrem tanto *battlemaps* top-down quanto ilustrações isométricas 3/4.
2. **Texturização Híbrida (Projeção + PBR Procedural):** A ferramenta une projeção direta da arte 2D com materiais PBR procedurais para faces ocultas ou reestilização completa.
3. **Ponderação de Stack — Por que "Web-First Core + Contrato `IsoDSL`":**
   - **Núcleo 100% Web (Vite + React + TypeScript + Three.js + Zustand):** Calibração visual de câmera sobre a imagem, desenho de *footprints* sobre o terreno e visualização de luz/normal/displacement a 60 FPS exigem feedback imediato no navegador, sem latência de round-trip ou setup complexo de ambiente para o usuário.
   - **Ponte limpa para Python / Agentes de IA (`IsoDSL v1.0`):** Como toda cena é representada por um JSON declarativo enxuto (`schemaVersion: "1.0"`), scripts Python futuros (ex.: SAM2, Depth Anything pesado, geradores LLM estilo `img2obj`) podem simplesmente produzir ou editar arquivos `.isodsl.json` e carregá-los direto no compilador WebGL.

---

## 5. Estrutura Implementada no MVP (Fase 1)

- `src/types/isodsl.ts` — Schema tipado da linguagem `IsoDSL v1.0`, presets de projeção, `IsoWorldKit` e `WorldGrammarConfig`.
- `src/core/imageMaps.ts` — Extração de *Heightfield* (`luminance` e `semantic_outdoor`) e derivação de *Tangent-Space Normal Map* via operador Sobel 3×3.
- `src/core/aiDepth.ts` — Inferência neural opcional no navegador via **Depth Anything V2 Small** (`@huggingface/transformers` + WebGPU/WASM carregado sob demanda).
- `src/core/worldKit.ts` — **Absorvedor Multi-Imagem (`IsoWorldKit`)**: recorta *swatches* semânticos (`grass`, `dirt_road`, `water`, `foliage`, `stone`), remove gradientes macro e aplica *cross-blend* toroidal para torná-los *tileáveis* sem costura + detecta **Portais de Borda** (onde rios e trilhas saem da imagem).
- `src/core/worldBuilder.ts` — **Construtor Procedural Multi-Escala (Geometry-Nodes style)**: expande todo cenário em **Pequeno (3×3)**, **Médio (5×5)** e **Grande (9×9 com LOD multi-anel)** usando ruído contínuo entre chunks, propagação orgânica de rios/estradas com meandro e aleatoriedade controlada (`seed`, `randomness`), pontes automáticas, POIs (`tower`, `building`, `wall`) e scatter de props, cercados por anel de horizonte montanhoso e névoa atmosférica.
- `src/core/proceduralTextures.ts` — Gerador procedural cacheado de texturas PBR tileáveis (Albedo + Normal) para o modo híbrido e procedural, incluindo **`tree_bark`** (casca vertical com fissuras para troncos de árvores ocultos em mapas 2D top-down).
- `src/core/projection.ts` — Câmera projetora ortográfica/perspectiva e *Projective UV Baking* com separação de grupos frontal/traseiro e preservação de grupos multi-material em props procedurais.
- `src/core/compiler.ts` — Compilador de *footprints* 2D em paredes subdivididas (`DoubleSide` para visualização interna), balanço medieval (`upperFloorOverhang`), pisos internos + mobiliário/escada/lareira, portas, janelas com venezianas e vidros emissivos, chaminés, telhados (`flat`, `gable`, `hip`, `cone`, `parapet` poligonal) e receitas de props (`buildPropGeometryBundle` multi-material separando copa/tronco em `deciduous_tree` e `pine_tree`, além de `barrel`, `crate`, `pillar`, `fallen_pillar`, `bush`, `rock`, `signpost`, `well`, `boat`, `brazier`, `card_25d`).
- `src/core/sampleScenes.ts`, `src/core/forestCrossroadsScene.ts`, `src/core/ruinasRioScene.ts`, `src/core/vilaMedievalScene.ts`, `src/core/tavernaMedievalScene.ts` & `src/core/cidadeMedievalScene.ts` — Cenas calibradas por escala (`Cidade Medieval 80+ Edifícios` em 5×5, `Taverna Medieval (Interno)`, `Vila Medieval no Rio`, `Ruínas no Riacho 3×3`, `Cruzamento do Rio na Floresta`, Isométrico e Top-Down).
- `src/core/worldNav.ts` — Navegação do **Modo Exploração**, detecção de alas conectadas de edifícios, **colisão com móveis/props (`extractPropCollisionObstacles`)** e amostragem de altura entre terreno, pontes e andares internos.
- `src/core/exporter.ts` — Assamento de *displacement* nos vértices + hierarquia semântica (`Walls`, `Floors`, `Trim_Openings`, `Windows`, `Roof_Hideable`) + colliders opcionais (`-colonly` / `_Collider`) + exportação `.glb`, `.isodsl.json` e `world_manifest.json`.
- `src/components/*` e `src/store/useSceneStore.ts` — Editor completo com Viewport Three.js (`THREE.InstancedMesh`), **Modo Exploração com clip de interior em GPU (`localClippingEnabled`) estilo Baldur's Gate / The Sims**, luz solar, tocha dinâmica, aba **Kit & Mundo** e ponte de prompt para LLM de Visão / ComfyUI / Magnific.

---

## 6. Evoluções Recentes: Anti-Distorção 3D, Arquitetura Medieval & Exploração

1. **Sobreposição PBR limpa em Telhados, Torres, Rochas e Props (`resolveSurfaceTextureMode`):**
   - **Descoberta:** Projetar uma imagem 2D top-down sobre geometria 3D inclinada/esférica (`gable`, `cone`, `rock`, árvores, paredes verticais top-down) estica pixels rasantes e mistura grama/sombras do entorno nos modelos.
   - **Solução:** O terreno mantém projeção 2D híbrida de alta fidelidade (`hybrid`), enquanto telhados, topos de torres, rochas, poços, barcos, árvores e paredes top-down resolvem para PBR procedural tileável harmonizado com a paleta do `IsoWorldKit` (além de aumentar `backfaceThreshold` para `0.35` no baking UV).
2. **Arquitetura de Fantasia Medieval & Interiores Habitáveis (`buildStructureArchitectureBundle`):**
   - Casas de 1 e 2 andares com balanço medieval (*jetty*) e cachorros de madeira, lajes internas de tábuas, escadas entre andares, lareiras com brasa emissiva, mesas/bancos, torres circulares de 10 lados e teto aberto no topo sob telhados para inspeção interna.
3. **MVP Modo Exploração + Colisão de Paredes, Interação com Portas & Piso Projetado:**
   - Avatar em escala humana (`~1.72 m`) com clique para caminhar no mapa (e WASD), atravessando pontes e colidindo com paredes externas sólidas (com costura livre entre alas conectadas).
   - Portais reais recortados na geometria das paredes térreas com folha de porta pivotada na dobradiça (`doorGeom`): interaja por clique direto na porta, tecla `[F]` ou botão na HUD para abrir/fechar (`0° ↔ 88°`) e entrar nas construções.
   - Suporte a piso térreo projetado da imagem 2D (`floorStyle: 'projected'`) ou em tábuas/calçamento elevados sobre a fundação, além de clip automático estilo Baldur's Gate / The Sims e troca de andar (`Piso 1 / Piso 2` via `Q`/`E`).

---

## 7. Gerenciador de Mapas (Abrir/Salvar) & Porto Fluvial Rustymaps

- **Gerenciador & Biblioteca de Mapas (`src/core/mapLibrary.ts`, `src/components/MapManagerModal.tsx`):**
  - Substituiu a lista linear de presets na `TopToolbar` pelos fluxos organizados **Mapas**, **Salvar** e **Abrir .JSON** (além de **Imagem 2D**).
  - Suporta biblioteca integrada com filtro por categoria (`Porto`, `Cidade`, `Interno`, `Ruínas`, `Floresta`, `Calibração`), persistência em `localStorage` com tratamento de cota para imagens customizadas (abrir, sobrescrever, renomear, duplicar, excluir) e exportação/importação de projetos completos `.isomap.json` (preservando cena + imagem de referência) e `.isodsl.json`.
- **Novo Cenário Costeiro (`src/core/portoRustymapsScene.ts`):**
  - Tradução fiel de `porto-rustymaps.jpg` (`746×1024`, escala `58.28 m × 80 m`) com paliçada NW e torres de vigia, 2 pontes sobre o rio diagonal, 6 píeres com 5 embarcações (`boat`), bairro portuário, cidadela amuralhada com torreão circular na colina leste, farol costeiro com braseiro e expansão 5×5 (`medium`).


