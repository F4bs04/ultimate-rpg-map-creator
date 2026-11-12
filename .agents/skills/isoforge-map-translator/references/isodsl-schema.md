# IsoDSL v1.0 Schema & Budget Reference

## Allowed Enumerations

| Field | Allowed Values |
| :--- | :--- |
| `projection.preset` | `"isometric_true"`, `"isometric_dimetric"`, `"top_down"`, `"perspective"` |
| `projection.type` | `"orthographic"`, `"perspective"` |
| `terrain.heightMode` | `"luminance"`, `"semantic_outdoor"`, `"ai_depth"` |
| `textureMode` | `"projected"`, `"hybrid"`, `"procedural"` |
| `fallbackMaterial` / `roofMaterial` | `"stone_brick"`, `"cobblestone"`, `"timber_plaster"`, `"roof_slate"`, `"roof_teal"`, `"roof_terracotta"`, `"thatch"`, `"wood_plank"`, `"moss_earth"`, `"tree_bark"`, `"ember_glow"` |
| `semanticTag` | `"building"`, `"tower"`, `"wall"`, `"cliff"`, `"platform"`, `"bridge"` |
| `wallStyle` | `"plain"`, `"timber_frame"`, `"buttress"` |
| `roofType` | `"flat"`, `"gable"`, `"hip"`, `"cone"`, `"parapet"` |
| `StructureDef` extras | `upperFloorOverhang` (`0..0.6`), `includeFloorSlabs` (`bool`), `floorStyle` (`"wood_plank" \| "projected" \| "stone_tile"`), `windowsPerWall` (`0..4`), `hasDoor` (`bool`), `hasChimney` (`bool`) |
| `PropDef.generator` | `"barrel"`, `"crate"`, `"pillar"`, `"fallen_pillar"`, `"pine_tree"`, `"deciduous_tree"`, `"bush"`, `"rock"`, `"signpost"`, `"well"`, `"boat"`, `"brazier"`, `"tavern_table"`, `"stool"`, `"bar_counter"`, `"fireplace"`, `"bookshelf"`, `"wall_sconce"`, `"card_25d"` |
| `worldGrammar` | `scale`: `"small"` \| `"medium"` \| `"large"`; `environmentMode`: `"outdoor"` \| `"interior"` |

## Recommended Geometry Budgets

- **Terrain subdivisions:** `64–128` for anchor chunk, `26` for ring 1 neighbor chunks, `14` / `8` for outer LOD rings (`medium` `5×5` / `large` `9×9`).
- **Per-structure budget:** ~30–140 triangles (walls + trim + roof).
- **Per-prop budget:**
  - `card_25d`: 4 triangles
  - `signpost` / `crate` / `rock`: 20–60 triangles
  - `barrel` / `pillar` / `fallen_pillar` / `pine_tree`: 60–160 triangles
  - `deciduous_tree` / `bush`: 120–320 triangles (always instanced in `medium`/`large` worlds via `THREE.InstancedMesh`).

## Palette & Height Calibration Rules

1. Match `terrain.width / terrain.depth` to `meta.aspectRatio` (`±0.02` tolerance).
2. When `terrain.waterEnabled` is `true` and `terrain.heightMode` is `"semantic_outdoor"`:
   - Depressed water pixels sit around normalized height `0.08–0.16`.
   - Dry trails and grass sit at `0.42–0.75`.
   - Keep `terrain.waterElevation` around `0.18 * displacementScale` to `0.24 * displacementScale` (typically `0.20–0.26`).
3. Prefer `wallStyle: "buttress"` for stone walls/towers/ruins and `wallStyle: "timber_frame"` for medieval houses and bridges.

