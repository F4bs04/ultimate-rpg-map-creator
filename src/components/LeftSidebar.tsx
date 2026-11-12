import React, { useRef, useState } from 'react';
import {
  Building2,
  Cpu,
  Dices,
  Download,
  Eye,
  EyeOff,
  Globe,
  Home,
  ImagePlus,
  Layers,
  Paintbrush,
  Scissors,
  Trash2,
  Trees,
  Upload,
} from 'lucide-react';
import {
  exportComfyUIKitSpecJson,
  exportWorldManifestJson,
} from '../core/exporter';
import { buildWorldNodePipelineSummary } from '../core/proceduralNodes';
import { SWATCH_CATEGORY_LABELS } from '../core/worldKit';
import { useSceneStore } from '../store/useSceneStore';
import {
  PROJECTION_PRESETS,
  type ProjectionPreset,
  type SwatchCategory,
  type WorldScale,
} from '../types/isodsl';

export const LeftSidebar: React.FC = () => {
  const [tab, setTab] = useState<'layers' | 'kit'>('kit');
  const [comfyEndpoint, setComfyEndpoint] = useState('http://127.0.0.1:8188');
  const [comfyCheckpoint, setComfyCheckpoint] = useState('v1-5-pruned-emaonly.safetensors');
  const [comfyCategory, setComfyCategory] = useState<SwatchCategory>('grass');
  const [replaceCat, setReplaceCat] = useState<SwatchCategory>('grass');

  const kitFileRef = useRef<HTMLInputElement | null>(null);
  const swatchFileRef = useRef<HTMLInputElement | null>(null);
  const spriteFileRef = useRef<HTMLInputElement | null>(null);

  const scene = useSceneStore((s) => s.scene);
  const worldKit = useSceneStore((s) => s.worldKit);
  const worldExpansion = useSceneStore((s) => s.worldExpansion);
  const selectedItem = useSceneStore((s) => s.selectedItem);
  const textureToolStatus = useSceneStore((s) => s.textureToolStatus);
  const customSprites = useSceneStore((s) => s.customSprites);
  const activeSpriteUrl = useSceneStore((s) => s.activeSpriteUrl);
  const selectedChunkCoord = useSceneStore((s) => s.selectedChunkCoord);

  const setProjectionPreset = useSceneStore((s) => s.setProjectionPreset);
  const setSelectedItem = useSceneStore((s) => s.setSelectedItem);
  const updateStructure = useSceneStore((s) => s.updateStructure);
  const removeStructure = useSceneStore((s) => s.removeStructure);
  const updateProp = useSceneStore((s) => s.updateProp);
  const removeProp = useSceneStore((s) => s.removeProp);
  const absorbImageIntoKit = useSceneStore((s) => s.absorbImageIntoKit);
  const regeneratePainterlyTextures = useSceneStore(
    (s) => s.regeneratePainterlyTextures
  );
  const replaceKitSwatchFromImageUrl = useSceneStore(
    (s) => s.replaceKitSwatchFromImageUrl
  );
  const generateComfySwatch = useSceneStore((s) => s.generateComfySwatch);
  const addCustomSpriteFromUrl = useSceneStore((s) => s.addCustomSpriteFromUrl);
  const setActiveSpriteUrl = useSceneStore((s) => s.setActiveSpriteUrl);
  const setTool = useSceneStore((s) => s.setTool);
  const setActivePropType = useSceneStore((s) => s.setActivePropType);
  const setWorldScale = useSceneStore((s) => s.setWorldScale);
  const updateWorldGrammar = useSceneStore((s) => s.updateWorldGrammar);
  const rerollWorldSeed = useSceneStore((s) => s.rerollWorldSeed);
  const focusWorldChunk = useSceneStore((s) => s.focusWorldChunk);
  const requestChunkExportGLB = useSceneStore((s) => s.requestChunkExportGLB);

  const handleAbsorbImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        absorbImageIntoKit(reader.result, file.name.replace(/\.[^.]+$/, ''));
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleReplaceSwatchFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        replaceKitSwatchFromImageUrl(replaceCat, reader.result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSpriteUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        addCustomSpriteFromUrl(
          reader.result,
          file.name.replace(/\.[^.]+$/, '')
        );
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const nodePipeline = buildWorldNodePipelineSummary(
    scene,
    worldKit,
    worldExpansion
  );

  return (
    <aside className="w-72 bg-zinc-900/90 border-r border-zinc-800 flex flex-col h-full overflow-hidden shrink-0">
      {/* Abas Camadas vs Kit & Mundo */}
      <div className="grid grid-cols-2 border-b border-zinc-800 bg-zinc-950/60 shrink-0">
        <button
          onClick={() => setTab('layers')}
          className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium cursor-pointer border-b-2 transition ${
            tab === 'layers'
              ? 'border-cyan-500 text-cyan-300 bg-zinc-900/60'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Camadas</span>
        </button>
        <button
          onClick={() => setTab('kit')}
          className={`flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium cursor-pointer border-b-2 transition ${
            tab === 'kit'
              ? 'border-emerald-500 text-emerald-300 bg-zinc-900/60'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>Kit &amp; Mundo</span>
        </button>
      </div>

      {tab === 'layers' ? (
        <div className="flex-1 overflow-y-auto">
          {/* Presets de Câmera */}
          <div className="p-3 border-b border-zinc-800">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-2">
               Câmera / Compatibilidade
            </div>
            <select
              value={scene.projection.preset}
              onChange={(e) =>
                setProjectionPreset(e.target.value as ProjectionPreset)
              }
              className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-xs text-zinc-100"
            >
              {(Object.keys(PROJECTION_PRESETS) as ProjectionPreset[]).map(
                (key) => (
                  <option key={key} value={key}>
                    {PROJECTION_PRESETS[key].label}
                  </option>
                )
              )}
            </select>
          </div>

          {/* Estruturas (Footprints 2D -> Primitivas) */}
          <div className="p-3 border-b border-zinc-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Estruturas ({scene.structures.length})
              </span>
              <span className="text-[10px] text-zinc-500">Footprints</span>
            </div>

            {scene.structures.length === 0 ? (
              <p className="text-xs text-zinc-500 italic">
                Use Retângulo ou Polígono para extrudar estruturas sobre a imagem.
              </p>
            ) : (
              <div className="space-y-1">
                {scene.structures.map((st) => {
                  const isSelected =
                    selectedItem?.kind === 'structure' &&
                    selectedItem.id === st.id;
                  return (
                    <div
                      key={st.id}
                      onClick={() =>
                        setSelectedItem({ kind: 'structure', id: st.id })
                      }
                      className={`group flex items-center justify-between px-2 py-1.5 rounded text-xs cursor-pointer border transition ${
                        isSelected
                          ? 'bg-cyan-950/60 border-cyan-600/70 text-cyan-100'
                          : 'bg-zinc-950/50 border-zinc-800/80 text-zinc-300 hover:bg-zinc-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <Building2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        <span className="truncate">{st.name}</span>
                      </div>
                      <div
                        className="flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() =>
                            updateStructure(st.id, { hideRoof: !st.hideRoof })
                          }
                          title={
                            st.hideRoof
                              ? 'Mostrar telhado'
                              : 'Ocultar telhado (ver interior)'
                          }
                          className={`p-1 rounded hover:bg-zinc-700 ${
                            st.hideRoof ? 'text-amber-400' : 'text-zinc-400'
                          }`}
                        >
                          <Home className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() =>
                            updateStructure(st.id, { visible: !st.visible })
                          }
                          title="Visibilidade"
                          className="p-1 rounded hover:bg-zinc-700 text-zinc-400"
                        >
                          {st.visible ? (
                            <Eye className="w-3 h-3" />
                          ) : (
                            <EyeOff className="w-3 h-3 text-zinc-600" />
                          )}
                        </button>
                        <button
                          onClick={() => removeStructure(st.id)}
                          title="Remover"
                          className="p-1 rounded hover:bg-red-900/60 text-zinc-500 hover:text-red-300"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Props Procedurais */}
          <div className="p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Props Âncora ({scene.props.length})
              </span>
              <span className="text-[10px] text-zinc-500">img2obj</span>
            </div>

            {scene.props.length === 0 ? (
              <p className="text-xs text-zinc-500 italic">
                Selecione Prop e clique no mapa para instanciar primitivas.
              </p>
            ) : (
              <div className="space-y-1">
                {scene.props.map((prop) => {
                  const isSelected =
                    selectedItem?.kind === 'prop' &&
                    selectedItem.id === prop.id;
                  return (
                    <div
                      key={prop.id}
                      onClick={() =>
                        setSelectedItem({ kind: 'prop', id: prop.id })
                      }
                      className={`flex items-center justify-between px-2 py-1.5 rounded text-xs cursor-pointer border transition ${
                        isSelected
                          ? 'bg-emerald-950/60 border-emerald-600/70 text-emerald-100'
                          : 'bg-zinc-950/50 border-zinc-800/80 text-zinc-300 hover:bg-zinc-800/60'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <Trees className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span className="truncate">{prop.name}</span>
                      </div>
                      <div
                        className="flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() =>
                            updateProp(prop.id, { visible: !prop.visible })
                          }
                          className="p-1 rounded hover:bg-zinc-700 text-zinc-400"
                        >
                          {prop.visible ? (
                            <Eye className="w-3 h-3" />
                          ) : (
                            <EyeOff className="w-3 h-3 text-zinc-600" />
                          )}
                        </button>
                        <button
                          onClick={() => removeProp(prop.id)}
                          className="p-1 rounded hover:bg-red-900/60 text-zinc-500 hover:text-red-300"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* Escala & Parâmetros de Aleatoriedade */}
          <section className="space-y-2.5 border-b border-zinc-800 pb-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                Construtor de Mundo
              </span>
              <button
                onClick={rerollWorldSeed}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[10px] text-amber-300 cursor-pointer"
                title="Gerar nova Seed aleatória"
              >
                <Dices className="w-3 h-3" />
                <span>Seed #{scene.worldGrammar.seed}</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1">
              {(
                [
                  { id: 'outdoor', label: 'Exterior (Aberto)' },
                  { id: 'interior', label: 'Interno (Salão)' },
                ] as const
              ).map((mode) => (
                <button
                  key={mode.id}
                  onClick={() =>
                    updateWorldGrammar({
                      environmentMode: mode.id,
                      enableForestScatter: mode.id === 'outdoor',
                    })
                  }
                  className={`py-1 rounded text-[11px] font-medium cursor-pointer border ${
                    (scene.worldGrammar.environmentMode ?? 'outdoor') === mode.id
                      ? 'bg-amber-600/80 border-amber-500 text-white'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-1">
              {(
                [
                  { id: 'small', label: 'Pequeno 3×3' },
                  { id: 'medium', label: 'Médio 5×5' },
                  { id: 'large', label: 'Grande 9×9' },
                ] as { id: WorldScale; label: string }[]
              ).map((item) => (
                <button
                  key={item.id}
                  onClick={() => setWorldScale(item.id)}
                  className={`py-1.5 rounded text-xs font-medium cursor-pointer border ${
                    scene.worldGrammar.scale === item.id
                      ? 'bg-emerald-600 border-emerald-500 text-white'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="space-y-1.5 text-[11px]">
              <div className="flex justify-between text-zinc-400">
                <span>Aleatoriedade (Jitter/POIs)</span>
                <span className="font-mono text-zinc-200">
                  {Math.round(scene.worldGrammar.randomness * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={scene.worldGrammar.randomness}
                onChange={(e) =>
                  updateWorldGrammar({ randomness: parseFloat(e.target.value) })
                }
                className="w-full accent-emerald-500 h-1.5 bg-zinc-800 rounded cursor-pointer"
              />

              <div className="flex justify-between text-zinc-400">
                <span>Densidade Vegetação</span>
                <span className="font-mono text-zinc-200">
                  {scene.worldGrammar.treeDensity.toFixed(1)}x
                </span>
              </div>
              <input
                type="range"
                min={0.2}
                max={2.2}
                step={0.1}
                value={scene.worldGrammar.treeDensity}
                onChange={(e) =>
                  updateWorldGrammar({
                    treeDensity: parseFloat(e.target.value),
                  })
                }
                className="w-full accent-emerald-500 h-1.5 bg-zinc-800 rounded cursor-pointer"
              />

              <div className="flex justify-between text-zinc-400">
                <span>Espaçamento Árvores (Poisson)</span>
                <span className="font-mono text-zinc-200">
                  {(scene.worldGrammar.minTreeSpacing ?? 2.8).toFixed(1)}m
                </span>
              </div>
              <input
                type="range"
                min={1.4}
                max={6.0}
                step={0.2}
                value={scene.worldGrammar.minTreeSpacing ?? 2.8}
                onChange={(e) =>
                  updateWorldGrammar({
                    minTreeSpacing: parseFloat(e.target.value),
                  })
                }
                className="w-full accent-emerald-500 h-1.5 bg-zinc-800 rounded cursor-pointer"
              />

              <div className="flex justify-between text-zinc-400">
                <span>Meandro Rios / Estradas</span>
                <span className="font-mono text-zinc-200">
                  {Math.round(scene.worldGrammar.meanderStrength * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={scene.worldGrammar.meanderStrength}
                onChange={(e) =>
                  updateWorldGrammar({
                    meanderStrength: parseFloat(e.target.value),
                  })
                }
                className="w-full accent-emerald-500 h-1.5 bg-zinc-800 rounded cursor-pointer"
              />

              <div className="flex justify-between text-zinc-400">
                <span>Chance POIs (Torres/Cabanas)</span>
                <span className="font-mono text-zinc-200">
                  {Math.round(scene.worldGrammar.poiChance * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={scene.worldGrammar.poiChance}
                onChange={(e) =>
                  updateWorldGrammar({ poiChance: parseFloat(e.target.value) })
                }
                className="w-full accent-emerald-500 h-1.5 bg-zinc-800 rounded cursor-pointer"
              />

              <label className="flex items-center gap-2 pt-1 cursor-pointer text-zinc-300">
                <input
                  type="checkbox"
                  checked={scene.worldGrammar.enableBridges}
                  onChange={(e) =>
                    updateWorldGrammar({ enableBridges: e.target.checked })
                  }
                  className="accent-emerald-500"
                />
                <span>Pontes automáticas sobre rios</span>
              </label>
            </div>

            {worldExpansion && (
              <div className="p-2 rounded bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-zinc-400 space-y-2">
                <div className="space-y-0.5">
                  <div className="text-emerald-300 font-semibold">
                    Minimapa WFC ({worldExpansion.summary.chunkCount} chunks)
                  </div>
                  <div>
                    Clique no chunk para focar ou exportar isolado
                  </div>
                </div>
                <div
                  className="grid gap-0.5"
                  style={{
                    gridTemplateColumns: `repeat(${worldExpansion.gridRadius * 2 + 1}, minmax(0, 1fr))`,
                  }}
                >
                  {worldExpansion.chunks.map((c) => {
                    const isFocused =
                      selectedChunkCoord?.[0] === c.gx &&
                      selectedChunkCoord?.[1] === c.gz;
                    const bg =
                      c.biome === 'anchor'
                        ? 'bg-amber-400 text-zinc-950 font-bold'
                        : c.biome === 'river_valley'
                        ? 'bg-sky-700/80 text-sky-100'
                        : c.biome === 'crossroads'
                        ? 'bg-amber-800/75 text-amber-100'
                        : c.biome === 'dense_forest'
                        ? 'bg-emerald-900/90 text-emerald-200'
                        : c.biome === 'ruins_outpost'
                        ? 'bg-stone-600/90 text-stone-100'
                        : 'bg-lime-800/60 text-lime-200';
                    const tag =
                      c.biome === 'anchor'
                        ? '★'
                        : c.biome === 'river_valley'
                        ? '~'
                        : c.biome === 'crossroads'
                        ? '+'
                        : c.biome === 'dense_forest'
                        ? '♣'
                        : c.biome === 'ruins_outpost'
                        ? 'Π'
                        : '·';
                    return (
                      <button
                        key={`${c.gx},${c.gz}`}
                        onClick={() => focusWorldChunk(c.gx, c.gz)}
                        title={`Chunk (${c.gx},${c.gz}): ${c.biome}`}
                        className={`h-4 rounded-[2px] flex items-center justify-center text-[9px] cursor-pointer ${bg} ${
                          isFocused ? 'ring-1 ring-cyan-300' : ''
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
                {selectedChunkCoord && (
                  <button
                    onClick={() =>
                      requestChunkExportGLB(
                        selectedChunkCoord[0],
                        selectedChunkCoord[1]
                      )
                    }
                    className="w-full py-1 rounded bg-cyan-900/60 hover:bg-cyan-800/70 border border-cyan-700/60 text-[10px] text-cyan-200 cursor-pointer"
                  >
                    Exportar Chunk ({selectedChunkCoord[0]},{selectedChunkCoord[1]}) .GLB
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Grafo Procedural (Geometry Nodes Chain) */}
          <section className="space-y-1.5 border-b border-zinc-800 pb-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-cyan-400">
              Pipeline Geometry Nodes
            </div>
            <div className="space-y-1">
              {nodePipeline.map((node) => (
                <div
                  key={node.id}
                  className={`p-1.5 rounded border text-[10px] ${
                    node.enabled
                      ? 'bg-zinc-950/90 border-zinc-800 text-zinc-200'
                      : 'bg-zinc-950/30 border-zinc-900 text-zinc-500'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold truncate">{node.title}</span>
                    {node.toggleKey && (
                      <input
                        type="checkbox"
                        checked={node.enabled}
                        onChange={(e) =>
                          updateWorldGrammar({
                            [node.toggleKey!]: e.target.checked,
                          })
                        }
                        className="accent-cyan-500 cursor-pointer"
                      />
                    )}
                  </div>
                  <div className="text-[9px] text-zinc-400 font-mono mt-0.5">
                    {node.metricLabel}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Ferramenta Geradora de Texturas (Painterly + ComfyUI + Substituir Swatch) */}
          <section className="space-y-2.5 border-b border-zinc-800 pb-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-violet-300">
                Gerador de Texturas (Tool)
              </span>
              <input
                ref={kitFileRef}
                type="file"
                accept="image/*"
                onChange={handleAbsorbImage}
                className="hidden"
              />
              <input
                ref={swatchFileRef}
                type="file"
                accept="image/*"
                onChange={handleReplaceSwatchFile}
                className="hidden"
              />
              <button
                onClick={() => kitFileRef.current?.click()}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-600/80 hover:bg-indigo-500 text-[10px] font-medium text-white cursor-pointer"
                title="Absorver outra imagem para o Kit"
              >
                <ImagePlus className="w-3 h-3" />
                <span>+ Absorver</span>
              </button>
            </div>

            <button
              onClick={regeneratePainterlyTextures}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-emerald-700/80 hover:bg-emerald-600 text-xs font-medium text-white cursor-pointer transition"
              title="Sintetiza texturas Painterly 128px 100% tileáveis com Normal Maps a partir da paleta absorvida"
            >
              <Paintbrush className="w-3.5 h-3.5" />
              <span>Sintetizar Texturas Painterly</span>
            </button>

            {/* Conector ComfyUI Local */}
            <div className="p-2 rounded bg-zinc-950 border border-zinc-800 space-y-1.5">
              <div className="flex items-center gap-1 text-[10px] font-semibold text-violet-300">
                <Cpu className="w-3 h-3" />
                <span>Conector ComfyUI Local</span>
              </div>
              <input
                type="text"
                value={comfyEndpoint}
                onChange={(e) => setComfyEndpoint(e.target.value)}
                placeholder="http://127.0.0.1:8188"
                className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-zinc-200"
              />
              <input
                type="text"
                value={comfyCheckpoint}
                onChange={(e) => setComfyCheckpoint(e.target.value)}
                placeholder="checkpoint .safetensors"
                className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-zinc-200"
              />
              <div className="flex gap-1">
                <select
                  value={comfyCategory}
                  onChange={(e) =>
                    setComfyCategory(e.target.value as SwatchCategory)
                  }
                  className="flex-1 px-1.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-[10px]"
                >
                  {(Object.keys(SWATCH_CATEGORY_LABELS) as SwatchCategory[]).map(
                    (c) => (
                      <option key={c} value={c}>
                        {SWATCH_CATEGORY_LABELS[c]}
                      </option>
                    )
                  )}
                </select>
                <button
                  onClick={() =>
                    generateComfySwatch(
                      comfyCategory,
                      comfyEndpoint,
                      comfyCheckpoint
                    )
                  }
                  className="px-2 py-1 rounded bg-violet-700 hover:bg-violet-600 text-[10px] font-medium text-white cursor-pointer"
                >
                  Gerar
                </button>
              </div>
            </div>

            {textureToolStatus && (
              <div className="text-[10px] font-mono text-emerald-300 bg-emerald-950/40 border border-emerald-800/50 rounded px-2 py-1">
                {textureToolStatus}
              </div>
            )}

            {worldKit ? (
              <>
                <div className="grid grid-cols-2 gap-1.5">
                  {(Object.keys(worldKit.swatches) as SwatchCategory[]).map(
                    (cat) => {
                      const sw = worldKit.swatches[cat];
                      if (!sw) return null;
                      return (
                        <div
                          key={cat}
                          className="p-1.5 rounded bg-zinc-950 border border-zinc-800 space-y-1"
                        >
                          <div className="grid grid-cols-2 gap-1">
                            {sw.albedoDataUrl && (
                              <img
                                src={sw.albedoDataUrl}
                                alt={sw.label}
                                className="w-full h-9 object-cover rounded border border-zinc-800"
                              />
                            )}
                            {sw.normalDataUrl && (
                              <img
                                src={sw.normalDataUrl}
                                alt={`${sw.label} normal`}
                                className="w-full h-9 object-cover rounded border border-zinc-800"
                              />
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[10px] text-zinc-300 truncate">
                              {SWATCH_CATEGORY_LABELS[cat]}
                            </span>
                            <button
                              onClick={() => {
                                setReplaceCat(cat);
                                swatchFileRef.current?.click();
                              }}
                              title="Substituir por textura PNG externa (ComfyUI/Magnific)"
                              className="p-0.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-cyan-300 cursor-pointer"
                            >
                              <Upload className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>

                <div className="grid grid-cols-2 gap-1">
                  <button
                    onClick={() => exportComfyUIKitSpecJson(scene, worldKit)}
                    className="flex items-center justify-center gap-1 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-[10px] text-zinc-200 cursor-pointer"
                    title="Exporta prompts e especificações para ComfyUI / Magnific"
                  >
                    <Download className="w-3 h-3" />
                    <span>Spec ComfyUI</span>
                  </button>
                  <button
                    onClick={() => exportWorldManifestJson(scene, worldExpansion)}
                    className="flex items-center justify-center gap-1 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-[10px] text-zinc-200 cursor-pointer"
                  >
                    <Download className="w-3 h-3" />
                    <span>Manifest</span>
                  </button>
                </div>
              </>
            ) : (
              <p className="text-xs text-zinc-500">
                Abra uma imagem para extrair swatches tileáveis e portais.
              </p>
            )}
          </section>

          {/* Sprites 2.5D Cutout (HD-2D Cards com Alpha) */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Sprites 2.5D ({customSprites.length})
              </span>
              <input
                ref={spriteFileRef}
                type="file"
                accept="image/*"
                onChange={handleSpriteUpload}
                className="hidden"
              />
              <button
                onClick={() => spriteFileRef.current?.click()}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-700/80 hover:bg-amber-600 text-[10px] font-medium text-white cursor-pointer"
                title="Remove fundo sólido e cria Card 2.5D transparente (4 triângulos)"
              >
                <Scissors className="w-3 h-3" />
                <span>+ Sprite 2.5D</span>
              </button>
            </div>
            {customSprites.length > 0 && (
              <div className="grid grid-cols-3 gap-1.5">
                {customSprites.map((sp) => (
                  <button
                    key={sp.id}
                    onClick={() => {
                      setActiveSpriteUrl(sp.dataUrl);
                      setActivePropType('card_25d');
                      setTool('place_prop');
                    }}
                    className={`p-1 rounded border bg-zinc-950 cursor-pointer ${
                      activeSpriteUrl === sp.dataUrl
                        ? 'border-amber-400'
                        : 'border-zinc-800'
                    }`}
                    title={`Clique no mapa para posicionar ${sp.name}`}
                  >
                    <img
                      src={sp.dataUrl}
                      alt={sp.name}
                      className="w-full h-10 object-contain"
                    />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </aside>
  );
};
