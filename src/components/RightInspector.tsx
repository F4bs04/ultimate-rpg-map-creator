import React from 'react';
import { Cpu, Download, Flame, Package, Sliders, Sun } from 'lucide-react';
import { downloadDataUrlPng } from '../core/exporter';
import { MATERIAL_PRESET_LABELS } from '../core/proceduralTextures';
import { useSceneStore, type TargetEngine } from '../store/useSceneStore';
import type {
  FloorStyle,
  HeightMode,
  MaterialPreset,
  PropGeneratorType,
  RoofType,
  ReconstructionMode,
  SemanticTag,
  TextureMode,
  WallStyle,
} from '../types/isodsl';

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}

const SliderRow: React.FC<SliderRowProps> = ({
  label,
  value,
  min,
  max,
  step,
  unit = '',
  onChange,
}) => (
  <div className="space-y-1">
    <div className="flex justify-between text-[11px]">
      <span className="text-zinc-400">{label}</span>
      <span className="font-mono text-zinc-200">
        {value.toFixed(step < 1 ? 2 : 0)}
        {unit}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full accent-cyan-500 h-1.5 bg-zinc-800 rounded cursor-pointer"
    />
  </div>
);

const TEXTURE_MODE_OPTIONS: { value: TextureMode; label: string }[] = [
  { value: 'procedural', label: 'Procedural nativo (recomendado)' },
  { value: 'hybrid', label: 'Híbrido (compatibilidade)' },
  { value: 'projected', label: 'Projeção 2D (legado)' },
];

export const RightInspector: React.FC = () => {
  const scene = useSceneStore((s) => s.scene);
  const selectedItem = useSceneStore((s) => s.selectedItem);
  const sourceImageUrl = useSceneStore((s) => s.sourceImageUrl);
  const heightMapDataUrl = useSceneStore((s) => s.heightMapDataUrl);
  const normalMapDataUrl = useSceneStore((s) => s.normalMapDataUrl);
  const showReferenceOverlay = useSceneStore((s) => s.showReferenceOverlay);
  const showProjectedImage = useSceneStore((s) => s.showProjectedImage);
  const overlayOpacity = useSceneStore((s) => s.overlayOpacity);

  const updateProjection = useSceneStore((s) => s.updateProjection);
  const setReconstructionMode = useSceneStore((s) => s.setReconstructionMode);
  const updateTerrain = useSceneStore((s) => s.updateTerrain);
  const updateLighting = useSceneStore((s) => s.updateLighting);
  const updateStructure = useSceneStore((s) => s.updateStructure);
  const updateProp = useSceneStore((s) => s.updateProp);
  const setOverlayOpacity = useSceneStore((s) => s.setOverlayOpacity);
  const setShowProjectedImage = useSceneStore((s) => s.setShowProjectedImage);
  const runAIDepthEstimation = useSceneStore((s) => s.runAIDepthEstimation);
  const aiDepthField = useSceneStore((s) => s.aiDepthField);
  const aiDepthStatus = useSceneStore((s) => s.aiDepthStatus);
  const includeColliders = useSceneStore((s) => s.includeColliders);
  const setIncludeColliders = useSceneStore((s) => s.setIncludeColliders);
  const targetEngine = useSceneStore((s) => s.targetEngine);
  const setTargetEngine = useSceneStore((s) => s.setTargetEngine);

  const selectedStruct =
    selectedItem?.kind === 'structure'
      ? scene.structures.find((s) => s.id === selectedItem.id)
      : null;

  const selectedProp =
    selectedItem?.kind === 'prop'
      ? scene.props.find((p) => p.id === selectedItem.id)
      : null;

  return (
    <aside className="w-80 bg-zinc-900/90 border-l border-zinc-800 h-full overflow-y-auto p-3 space-y-4 shrink-0">
      {/* Inspetor de Item Selecionado */}
      {selectedStruct && (
        <section className="p-3 rounded-lg bg-cyan-950/25 border border-cyan-800/50 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-cyan-300">
              Estrutura Selecionada
            </span>
            <span className="text-[10px] font-mono text-cyan-500">
              {selectedStruct.footprint.length} vértices
            </span>
          </div>

          <input
            type="text"
            value={selectedStruct.name}
            onChange={(e) =>
              updateStructure(selectedStruct.id, { name: e.target.value })
            }
            className="w-full px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-xs"
          />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-zinc-400">Tag Semântica</label>
              <select
                value={selectedStruct.semanticTag}
                onChange={(e) =>
                  updateStructure(selectedStruct.id, {
                    semanticTag: e.target.value as SemanticTag,
                  })
                }
                className="w-full px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-xs"
              >
                <option value="building">building</option>
                <option value="tower">tower</option>
                <option value="wall">wall</option>
                <option value="cliff">cliff</option>
                <option value="platform">platform</option>
                <option value="bridge">bridge</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-zinc-400">Telhado</label>
              <select
                value={selectedStruct.roofType}
                onChange={(e) =>
                  updateStructure(selectedStruct.id, {
                    roofType: e.target.value as RoofType,
                  })
                }
                className="w-full px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-xs"
              >
                <option value="gable">Duas Águas (Gable)</option>
                <option value="hip">Quatro Águas (Hip)</option>
                <option value="cone">Cônico (Torre)</option>
                <option value="parapet">Ameias (Parapet)</option>
                <option value="flat">Plano</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 items-end">
            <div>
              <label className="text-[10px] text-zinc-400">Estilo Parede (IRCSS)</label>
              <select
                value={selectedStruct.wallStyle ?? 'plain'}
                onChange={(e) =>
                  updateStructure(selectedStruct.id, {
                    wallStyle: e.target.value as WallStyle,
                  })
                }
                className="w-full px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-xs"
              >
                <option value="plain">Simples</option>
                <option value="timber_frame">Vigas Enxaimel</option>
                <option value="buttress">Contrafortes Pedra</option>
              </select>
            </div>
            <label className="flex items-center gap-2 py-1 cursor-pointer text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={Boolean(selectedStruct.hasDoor)}
                onChange={(e) =>
                  updateStructure(selectedStruct.id, { hasDoor: e.target.checked })
                }
                className="accent-cyan-500"
              />
              <span>Porta Frontal</span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs text-zinc-300">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(selectedStruct.hasChimney)}
                onChange={(e) =>
                  updateStructure(selectedStruct.id, {
                    hasChimney: e.target.checked,
                  })
                }
                className="accent-cyan-500"
              />
              <span>Chaminé</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={
                  selectedStruct.includeFloorSlabs ?? selectedStruct.floors >= 2
                }
                onChange={(e) =>
                  updateStructure(selectedStruct.id, {
                    includeFloorSlabs: e.target.checked,
                  })
                }
                className="accent-cyan-500"
              />
              <span>Pisos Internos</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedStruct.hasStairs ?? selectedStruct.floors >= 2}
                disabled={selectedStruct.floors < 2}
                onChange={(e) =>
                  updateStructure(selectedStruct.id, { hasStairs: e.target.checked })
                }
                className="accent-cyan-500 disabled:opacity-40"
              />
              <span>Escada / Acesso</span>
            </label>
          </div>

          <div>
            <label className="text-[10px] text-zinc-400">
              Piso Térreo (Projeção / Material)
            </label>
            <select
              value={selectedStruct.floorStyle ?? 'wood_plank'}
              onChange={(e) =>
                updateStructure(selectedStruct.id, {
                  floorStyle: e.target.value as FloorStyle,
                })
              }
              className="w-full px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-xs"
            >
              <option value="wood_plank">Tábuas de Madeira</option>
              <option value="projected">Projetado da Imagem 2D</option>
              <option value="stone_tile">Ladrilho / Calçamento</option>
            </select>
          </div>

          <SliderRow
            label="Janelas / Parede"
            value={selectedStruct.windowsPerWall ?? 0}
            min={0}
            max={4}
            step={1}
            onChange={(v) =>
              updateStructure(selectedStruct.id, { windowsPerWall: v })
            }
          />
          {selectedStruct.floors >= 2 && (
            <SliderRow
              label="Balanço 2º Andar (Jetty)"
              value={selectedStruct.upperFloorOverhang ?? 0}
              min={0}
              max={0.6}
              step={0.05}
              unit="m"
              onChange={(v) =>
                updateStructure(selectedStruct.id, { upperFloorOverhang: v })
              }
            />
          )}

          <SliderRow
            label="Elevação Base"
            value={selectedStruct.baseElevation}
            min={-2}
            max={8}
            step={0.1}
            unit="m"
            onChange={(v) =>
              updateStructure(selectedStruct.id, { baseElevation: v })
            }
          />
          <SliderRow
            label="Andares"
            value={selectedStruct.floors}
            min={1}
            max={6}
            step={1}
            onChange={(v) => updateStructure(selectedStruct.id, { floors: v })}
          />
          <SliderRow
            label="Altura / Andar"
            value={selectedStruct.floorHeight}
            min={0.5}
            max={5}
            step={0.1}
            unit="m"
            onChange={(v) =>
              updateStructure(selectedStruct.id, { floorHeight: v })
            }
          />
          <SliderRow
            label="Inclinação Telhado"
            value={selectedStruct.roofPitchDeg}
            min={10}
            max={65}
            step={1}
            unit="°"
            onChange={(v) =>
              updateStructure(selectedStruct.id, { roofPitchDeg: v })
            }
          />
          <SliderRow
            label="Beiral (Overhang)"
            value={selectedStruct.roofOverhang}
            min={0}
            max={1.2}
            step={0.05}
            unit="m"
            onChange={(v) =>
              updateStructure(selectedStruct.id, { roofOverhang: v })
            }
          />

          <div>
            <label className="text-[10px] text-zinc-400">Modo de Textura</label>
            <select
              value={selectedStruct.textureMode}
              onChange={(e) =>
                updateStructure(selectedStruct.id, {
                  textureMode: e.target.value as TextureMode,
                })
              }
              className="w-full px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-xs mt-0.5"
            >
              {TEXTURE_MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-zinc-400">PBR Parede</label>
              <select
                value={selectedStruct.fallbackMaterial}
                onChange={(e) =>
                  updateStructure(selectedStruct.id, {
                    fallbackMaterial: e.target.value as MaterialPreset,
                  })
                }
                className="w-full px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-xs"
              >
                {(Object.keys(MATERIAL_PRESET_LABELS) as MaterialPreset[]).map((k) => (
                  <option key={k} value={k}>
                    {MATERIAL_PRESET_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-zinc-400">PBR Telhado</label>
              <select
                value={selectedStruct.roofMaterial}
                onChange={(e) =>
                  updateStructure(selectedStruct.id, {
                    roofMaterial: e.target.value as MaterialPreset,
                  })
                }
                className="w-full px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-xs"
              >
                {(Object.keys(MATERIAL_PRESET_LABELS) as MaterialPreset[]).map((k) => (
                  <option key={k} value={k}>
                    {MATERIAL_PRESET_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>
      )}

      {selectedProp && (
        <section className="p-3 rounded-lg bg-emerald-950/25 border border-emerald-800/50 space-y-2.5">
          <div className="text-xs font-semibold text-emerald-300">
            Prop Selecionado
          </div>
          <input
            type="text"
            value={selectedProp.name}
            onChange={(e) => updateProp(selectedProp.id, { name: e.target.value })}
            className="w-full px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-xs"
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-zinc-400">Receita</label>
              <select
                value={selectedProp.generator}
                onChange={(e) =>
                  updateProp(selectedProp.id, {
                    generator: e.target.value as PropGeneratorType,
                  })
                }
                className="w-full px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-xs"
              >
                <option value="deciduous_tree">Árvore Copa</option>
                <option value="bush">Arbusto</option>
                <option value="rock">Pedra / Rocha</option>
                <option value="signpost">Placa 3 Vias</option>
                <option value="well">Poço Medieval</option>
                <option value="boat">Barco a Remo</option>
                <option value="fallen_pillar">Coluna Caída</option>
                <option value="barrel">Barril</option>
                <option value="crate">Caixote</option>
                <option value="pillar">Pilar</option>
                <option value="pine_tree">Pinheiro</option>
                <option value="brazier">Braseiro</option>
                <option value="tavern_table">Mesa Taverna</option>
                <option value="stool">Banqueta</option>
                <option value="bar_counter">Balcão Bar</option>
                <option value="fireplace">Lareira Pedra</option>
                <option value="bookshelf">Estante / Armário</option>
                <option value="wall_sconce">Arandela Luz</option>
                <option value="card_25d">Card 2.5D</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-zinc-400">Textura</label>
              <select
                value={selectedProp.textureMode}
                onChange={(e) =>
                  updateProp(selectedProp.id, {
                    textureMode: e.target.value as TextureMode,
                  })
                }
                className="w-full px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-xs"
              >
                {TEXTURE_MODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <SliderRow
            label="Elevação Y"
            value={selectedProp.position[1]}
            min={-2}
            max={8}
            step={0.1}
            unit="m"
            onChange={(v) =>
              updateProp(selectedProp.id, {
                position: [selectedProp.position[0], v, selectedProp.position[2]],
              })
            }
          />
          <SliderRow
            label="Rotação Y"
            value={selectedProp.rotationYDeg}
            min={0}
            max={360}
            step={5}
            unit="°"
            onChange={(v) => updateProp(selectedProp.id, { rotationYDeg: v })}
          />
          <SliderRow
            label="Escala"
            value={selectedProp.scale}
            min={0.3}
            max={3.5}
            step={0.05}
            unit="x"
            onChange={(v) => updateProp(selectedProp.id, { scale: v })}
          />
        </section>
      )}

      <section className="space-y-2 border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
          <Cpu className="w-3.5 h-3.5" />
          <span>Reconstrução do Mapa</span>
        </div>
        <select
          value={scene.reconstruction?.mode ?? 'projection_compat'}
          onChange={(e) =>
            setReconstructionMode(e.target.value as ReconstructionMode)
          }
          className="w-full px-2 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-xs"
        >
          <option value="projection_compat">Híbrido: Mapa 2D no Terreno + Assets 3D (recomendado)</option>
          <option value="semantic_rebuild">Somente Procedural (sem imagem no terreno)</option>
        </select>
        <p className="text-[10px] leading-relaxed text-zinc-500">
          O modo híbrido mantém a arte pintada do mapa no terreno (com costura
          contínua no mundo aberto) e constrói telhados, árvores e edifícios em
          3D nativo sem distorção.
        </p>
      </section>

      {/* Calibrador de Câmera Projetora */}
      <section className="space-y-2.5 border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          <Sliders className="w-3.5 h-3.5 text-cyan-400" />
          <span>Projeção (compatibilidade / inspeção)</span>
        </div>

        <SliderRow
          label="Pitch (Inclinação)"
          value={scene.projection.pitchDeg}
          min={10}
          max={89.5}
          step={0.5}
          unit="°"
          onChange={(v) => updateProjection({ pitchDeg: v })}
        />
        <SliderRow
          label="Yaw (Rotação)"
          value={scene.projection.yawDeg}
          min={-180}
          max={180}
          step={1}
          unit="°"
          onChange={(v) => updateProjection({ yawDeg: v })}
        />
        <SliderRow
          label="Escala Ortográfica"
          value={scene.projection.orthoScale}
          min={6}
          max={100}
          step={0.5}
          onChange={(v) => updateProjection({ orthoScale: v })}
        />
        <div className="grid grid-cols-2 gap-2">
          <SliderRow
            label="Offset X"
            value={scene.projection.offsetX}
            min={-12}
            max={12}
            step={0.2}
            onChange={(v) => updateProjection({ offsetX: v })}
          />
          <SliderRow
            label="Offset Z"
            value={scene.projection.offsetY}
            min={-12}
            max={12}
            step={0.2}
            onChange={(v) => updateProjection({ offsetY: v })}
          />
        </div>
        {showReferenceOverlay && (
          <SliderRow
            label="Opacidade Overlay"
            value={overlayOpacity}
            min={0.1}
            max={0.95}
            step={0.05}
            onChange={setOverlayOpacity}
          />
        )}
        <label className="flex items-center gap-2 pt-1 cursor-pointer text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={showProjectedImage}
            onChange={(e) => setShowProjectedImage(e.target.checked)}
            className="accent-indigo-500"
          />
          <span>Imagem projetada no terreno</span>
        </label>
      </section>

      {/* Terreno, Displacement & Normal Map */}
      <section className="space-y-2.5 border-b border-zinc-800 pb-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          Terreno · Displacement & Normal
        </div>

        <select
          value={scene.terrain.textureMode}
          onChange={(e) =>
            updateTerrain({ textureMode: e.target.value as TextureMode })
          }
          className="w-full px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-xs"
        >
          {TEXTURE_MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <div>
          <label className="text-[10px] text-zinc-400">Modo de Relevo (Heightmap)</label>
          <select
            value={scene.terrain.heightMode}
            onChange={(e) =>
              updateTerrain({ heightMode: e.target.value as HeightMode })
            }
            className="w-full px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-xs mt-0.5"
          >
            <option value="semantic_outdoor">Semântico Outdoor (Rio/Trilha/Grama)</option>
            <option value="luminance">Luminância Clássica</option>
            {aiDepthField && (
              <option value="ai_depth">Depth Anything V2 (IA WebGPU)</option>
            )}
          </select>
        </div>

        <button
          onClick={runAIDepthEstimation}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-violet-700/80 hover:bg-violet-600 text-xs font-medium text-white cursor-pointer transition"
          title="Baixa Depth Anything V2 Small (~100MB cache local) e calcula profundidade neural no navegador"
        >
          <Cpu className="w-3.5 h-3.5" />
          <span>Gerar Depth IA (WebGPU)</span>
        </button>
        {aiDepthStatus && (
          <div className="text-[10px] font-mono text-violet-300 bg-violet-950/50 border border-violet-800/60 rounded px-2 py-1">
            {aiDepthStatus}
          </div>
        )}

        <SliderRow
          label="Subdivisões Malha"
          value={scene.terrain.subdivisions}
          min={16}
          max={160}
          step={8}
          onChange={(v) => updateTerrain({ subdivisions: v })}
        />
        <SliderRow
          label="Displacement Scale"
          value={scene.terrain.displacementScale}
          min={0}
          max={5}
          step={0.1}
          unit="m"
          onChange={(v) => updateTerrain({ displacementScale: v })}
        />
        <SliderRow
          label="Normal Map Força"
          value={scene.terrain.normalStrength}
          min={0}
          max={6}
          step={0.1}
          onChange={(v) => updateTerrain({ normalStrength: v })}
        />
        <SliderRow
          label="Micro-Detalhe (Normal)"
          value={scene.terrain.detailBlend}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => updateTerrain({ detailBlend: v })}
        />
        <SliderRow
          label="Suavização Relevo"
          value={scene.terrain.smoothRadius}
          min={0}
          max={10}
          step={1}
          unit="px"
          onChange={(v) => updateTerrain({ smoothRadius: v })}
        />

        <div className="flex items-center justify-between pt-1 text-xs">
          <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
            <input
              type="checkbox"
              checked={scene.terrain.invertHeight}
              onChange={(e) => updateTerrain({ invertHeight: e.target.checked })}
              className="accent-cyan-500"
            />
            <span>Inverter Altura</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
            <input
              type="checkbox"
              checked={scene.terrain.waterEnabled}
              onChange={(e) => updateTerrain({ waterEnabled: e.target.checked })}
              className="accent-cyan-500"
            />
            <span>Água 3D</span>
          </label>
        </div>

        {scene.terrain.waterEnabled && (
          <SliderRow
            label="Nível da Água"
            value={scene.terrain.waterElevation}
            min={-1}
            max={3}
            step={0.05}
            unit="m"
            onChange={(v) => updateTerrain({ waterElevation: v })}
          />
        )}

        {/* Miniaturas dos mapas gerados */}
        {(sourceImageUrl || heightMapDataUrl || normalMapDataUrl) && (
          <div className="grid grid-cols-3 gap-1.5 pt-2">
            {sourceImageUrl && (
              <div className="space-y-1">
                <img
                  src={sourceImageUrl}
                  alt="Albedo"
                  className="w-full h-14 object-cover rounded border border-zinc-700"
                />
                <div className="text-[10px] text-center text-zinc-400">Albedo</div>
              </div>
            )}
            {heightMapDataUrl && (
              <div className="space-y-1">
                <img
                  src={heightMapDataUrl}
                  alt="Height"
                  onClick={() =>
                    downloadDataUrlPng(heightMapDataUrl, 'heightmap.png')
                  }
                  title="Clique para baixar Heightmap PNG"
                  className="w-full h-14 object-cover rounded border border-zinc-700 cursor-pointer hover:border-cyan-400"
                />
                <div className="text-[10px] text-center text-zinc-400 flex items-center justify-center gap-0.5">
                  <span>Height</span>
                  <Download className="w-2.5 h-2.5" />
                </div>
              </div>
            )}
            {normalMapDataUrl && (
              <div className="space-y-1">
                <img
                  src={normalMapDataUrl}
                  alt="Normal"
                  onClick={() =>
                    downloadDataUrlPng(normalMapDataUrl, 'normalmap.png')
                  }
                  title="Clique para baixar Normal Map PNG"
                  className="w-full h-14 object-cover rounded border border-zinc-700 cursor-pointer hover:border-cyan-400"
                />
                <div className="text-[10px] text-center text-zinc-400 flex items-center justify-center gap-0.5">
                  <span>Normal</span>
                  <Download className="w-2.5 h-2.5" />
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Iluminação Dinâmica (Prova de Normal Map + Sombras) */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            <Sun className="w-3.5 h-3.5 text-amber-400" />
            <span>Luz & Tocha Dinâmica</span>
          </div>
          <button
            onClick={() =>
              updateLighting({ torchEnabled: !scene.lighting.torchEnabled })
            }
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border cursor-pointer ${
              scene.lighting.torchEnabled
                ? 'bg-orange-950/70 border-orange-500/60 text-orange-300'
                : 'bg-zinc-950 border-zinc-700 text-zinc-500'
            }`}
          >
            <Flame className="w-3 h-3" />
            <span>Tocha</span>
          </button>
        </div>

        <SliderRow
          label="Azimute Sol"
          value={scene.lighting.sunAzimuthDeg}
          min={0}
          max={360}
          step={5}
          unit="°"
          onChange={(v) => updateLighting({ sunAzimuthDeg: v })}
        />
        <SliderRow
          label="Elevação Sol"
          value={scene.lighting.sunElevationDeg}
          min={10}
          max={88}
          step={2}
          unit="°"
          onChange={(v) => updateLighting({ sunElevationDeg: v })}
        />
        <SliderRow
          label="Intensidade Sol"
          value={scene.lighting.sunIntensity}
          min={0}
          max={4}
          step={0.1}
          onChange={(v) => updateLighting({ sunIntensity: v })}
        />
      </section>

      {/* Preset de Exportação Engine (Nova3D) */}
      <section className="space-y-2 border-t border-zinc-800 pt-3">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          <Package className="w-3.5 h-3.5 text-emerald-400" />
          <span>Exportação Engine (.GLB)</span>
        </div>
        <select
          value={targetEngine}
          onChange={(e) => setTargetEngine(e.target.value as TargetEngine)}
          className="w-full px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-xs"
        >
          <option value="standard_glb">glTF / Three.js Padrão</option>
          <option value="godot">Godot 4 (-colonly)</option>
          <option value="unity">Unity (_Collider)</option>
          <option value="unreal">Unreal Engine (_Collider)</option>
        </select>
        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={includeColliders}
            onChange={(e) => setIncludeColliders(e.target.checked)}
            className="accent-emerald-500"
          />
          <span>Incluir caixas de Colisão semânticas</span>
        </label>
      </section>
    </aside>
  );
};
