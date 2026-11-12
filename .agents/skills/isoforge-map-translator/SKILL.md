---
name: isoforge-map-translator
description: >-
  Use this skill to translate any 2D RPG map image (top-down or isometric) into a
  lightweight 3D IsoDSL v1.0 scene and multi-scale procedural world (small, medium,
  or large) for IsoForge, keeping low triangle budgets via 2D texture projection,
  textured primitives, displacement/heightmaps, tangent normal maps, and WFC expansion.
---

# IsoForge Map Translator (Image → Lightweight 3D World Skill)

Use this runbook whenever a user provides an RPG map image (or set of reference images) and wants to translate its visual layout into executable `IsoDSL v1.0` instructions, validate geometry budgets, and generate a lightweight 3D map ready for WebGL, Godot, Unity, or Unreal.

## Core Design Constraints (Never Violate)

1. **No heavy monolithic meshes.** Represent terrain as one subdivided `PlaneGeometry` with height/displacement + tangent normal map, buildings/ruins as extruded 2D footprint primitives (`StructureDef`), and objects as code-native primitive assemblies (`PropDef`) or 4-triangle `card_25d` cutouts.
2. **Match image proportions 1:1.** Never force a portrait/landscape map into a square terrain.
3. **Preserve front art + solve occluded backfaces.** Default to `textureMode: "hybrid"` so camera-facing surfaces project the original artwork while hidden back/side faces use palette-matched procedural PBR textures.
4. **Keep water strictly below dry plazas.** When `heightMode: "semantic_outdoor"` and `waterEnabled: true`, set `waterElevation` in `[0.18, 0.24]` so water fills depressed riverbeds without poking through dry floors or central structures.

---

## Step-by-Step Spatial Reasoning Workflow

### Step 1 — Measure Image & Calibrate Camera Projection

1. Inspect image pixel dimensions and terrain proportions automatically with [uv-helper.mjs](./scripts/uv-helper.mjs):
   ```bash
   node .agents/skills/isoforge-map-translator/scripts/uv-helper.mjs --image <image-path>
   ```
   Or compute manually: `aspectRatio = widthPx / heightPx`.
2. Choose projection preset:
   - Overhead battlemaps → `top_down` (`type: "orthographic"`, `pitchDeg: 89.5`, `yawDeg: 0`).
   - True 3/4 isometric art → `isometric_true` (`type: "orthographic"`, `pitchDeg: 35.264`, `yawDeg: 45`).
   - 2:1 pixel-art isometric → `isometric_dimetric` (`type: "orthographic"`, `pitchDeg: 30`, `yawDeg: 45`).
   - Perspective illustration → `perspective` (`type: "perspective"`, `pitchDeg: 42`, `yawDeg: 45`, `fovDeg: 36`).
3. Lock terrain dimensions to `orthoScale` (recommended `32` for portrait maps, `20–24` for landscape/isometric):
   - `terrain.depth = orthoScale`
   - `terrain.width = Number((orthoScale * aspectRatio).toFixed(3))`

### Step 2 — Choose Height Mode & Texture Mode

- **Outdoor / Forest / River / Nature Maps:**
  - `terrain.heightMode = "semantic_outdoor"` (depresses blue/cyan rivers, flattens dirt trails, keeps dark tree shadows from digging pits).
  - Set `waterEnabled = true` and `waterElevation = 0.21` (with `displacementScale` around `1.1–1.35`) when rivers/streams exist; otherwise `waterEnabled = false`.
- **Architectural / Dungeon / Interior Maps (Tavern, Crypt, Manor):**
  - `terrain.heightMode = "luminance"` (or `"ai_depth"` when Depth Anything V2 WebGPU is run in the browser).
  - For **indoor rooms** (e.g. a tavern or hall), set `worldGrammar.environmentMode = "interior"`, `displacementScale` subtle (`0.12–0.20`), `waterEnabled = false`, calibrate `orthoScale` to human room scale (`14–18m`), and frame perimeter walls as `"wall"` segments (lower South cutaway sill so the 3/4 orbit view stays open).
- Consult [isodsl-schema.md](./references/isodsl-schema.md) for all allowed enum values and material presets.

### Step 3 — Convert Image Landmarks from Normalized `(u, v)` to World `(X, Z)`

For `top_down` maps (`u` in `[0..1]` left-to-right, `v` in `[0..1]` top-to-bottom):
```text
x = (u - 0.5) * terrain.width
z = (v - 0.5) * terrain.depth
```

Apply these geometric rules when tracing structures (`structures[]`):
1. **Axis-aligned buildings:** Emit 4-corner `[x, z]` rectangle footprints, set `floors`, `floorHeight`, `roofType` (`flat | gable | hip | cone | parapet`), `wallStyle` (`plain | timber_frame | buttress`), and `hasDoor`.
2. **Angled walls / ruins:** Trace centerline endpoints `(u0, v0) -> (u1, v1)` and use [uv-helper.mjs](./scripts/uv-helper.mjs) to compute the exact rotated 4-vertex polygon (never approximate diagonal ruins with oversized axis-aligned boxes):
   ```bash
   node .agents/skills/isoforge-map-translator/scripts/uv-helper.mjs --width <W> --depth <D> --wall u0,v0,u1,v1,0.58
   ```
3. **Circular/curved ruins or rings:** Split into 3–4 short wall arc segments leaving the interior open rather than placing a solid cylinder over an open courtyard.

### Step 4 — Populate Lightweight Props (`props[]`)

Place each distinct visible object using the exact `PropGeneratorType` catalog:
- **Nature:** `deciduous_tree`, `pine_tree`, `bush`, `rock`
- **Ruins & Landmarks:** `pillar`, `fallen_pillar`, `signpost`, `brazier`
- **Town / Tavern & Interior Props:** `barrel`, `crate`, `tavern_table`, `stool`, `bar_counter`, `fireplace`, `bookshelf`, `wall_sconce`
- **Custom Transparent Sprites:** `card_25d` (4-triangle crossed planes with optional `spriteDataUrl`)

Estimate vertical `y` to match the terrain surface (`~0.5 * displacementScale` on grass/dirt, `~0.2` for stones peeking out of water).

### Step 5 — Configure Multi-Scale World Expansion (`worldGrammar`)

Set `worldGrammar.scale` according to the target scope:
- `"small"` (`3×3`, 9 chunks): Compact open world surrounding the anchor scene + distant mountain horizon.
- `"medium"` (`5×5`, 25 chunks): Extended WFC biome grid + continuous river/road extension + automatic bridges + POIs + instanced forest scatter.
- `"large"` (`9×9`, 81 chunks): Vast open region with multi-ring LOD (`14×14` & `8×8` outer rings) + `InstancedMesh` batching + atmospheric horizon.

Control variation via `seed`, `randomness` (`0..1`), `treeDensity`, `minTreeSpacing` (recommended `2.6–3.2m`), `poiChance`, `meanderStrength`, and node toggles (`enableRoadContinuation`, `enableWaterContinuation`, `enableArchitecturalPOIs`, `enableForestScatter`, `enableBridges`).

### Step 6 — Validate and Compile Before Returning

Always run [validate-and-build.mjs](./scripts/validate-and-build.mjs) on the generated JSON to verify schema compliance, triangle budgets, coordinate bounds, and WFC chunk output:

```bash
node .agents/skills/isoforge-map-translator/scripts/validate-and-build.mjs <path-to-scene.isodsl.json>
```

For autonomous local VLM execution (Ollama / LM Studio with 1-shot validation & auto-repair), run [translate-image-local.mjs](./scripts/translate-image-local.mjs):

```bash
node .agents/skills/isoforge-map-translator/scripts/translate-image-local.mjs <image-path> --model qwen2.5vl --scale medium --out scene.isodsl.json
```

Check [checklist-local-ai.md](./examples/checklist-local-ai.md) for a compact single-turn prompt template suited for local Vision-Language Models.

---

## Reference Examples in Workspace

- [ruinas-rio-medio.isodsl.json](../../../public/maps/ruinas-rio-medio.isodsl.json) — Portrait `576×1024` top-down ruins with angled wall segments, circular ring, `fallen_pillar` props, and `medium` 3×3 WFC expansion.
- [cruzamento-floresta.isodsl.json](../../../public/maps/cruzamento-floresta.isodsl.json) — Portrait `649×1024` top-down forest crossroads with 3-way `signpost`, river rocks, and `semantic_outdoor` terrain.

