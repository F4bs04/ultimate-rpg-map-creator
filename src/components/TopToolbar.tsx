import React, { useRef } from 'react';
import {
  BookmarkPlus,
  Box,
  Camera,
  Code2,
  Compass,
  Dices,
  Download,
  Eye,
  FolderOpen,
  Footprints,
  Grid,
  ImagePlus,
  Image as ImageIcon,
  Layers,
  Map as MapIcon,
  MousePointer,
  PenTool,
  Square,
  Trees,
  Wand2,
} from 'lucide-react';
import { exportIsoDSLJson } from '../core/exporter';
import { parseImportedMapFile } from '../core/mapLibrary';
import { useSceneStore, type EditorTool } from '../store/useSceneStore';
import type { PropGeneratorType, WorldScale } from '../types/isodsl';

interface TopToolbarProps {
  onOpenDSL: () => void;
  onOpenMaps: (tab?: 'library' | 'saved') => void;
}

const PROP_LABELS: Record<PropGeneratorType, string> = {
  deciduous_tree: 'Árvore Copa',
  bush: 'Arbusto',
  rock: 'Pedra / Rocha',
  signpost: 'Placa 3 Vias',
  well: 'Poço Medieval',
  boat: 'Barco a Remo',
  fallen_pillar: 'Coluna Caída',
  barrel: 'Barril',
  crate: 'Caixote',
  pillar: 'Pilar',
  pine_tree: 'Pinheiro',
  brazier: 'Braseiro',
  tavern_table: 'Mesa Taverna',
  stool: 'Banqueta',
  bar_counter: 'Balcão Bar',
  fireplace: 'Lareira Pedra',
  bookshelf: 'Estante / Armário',
  wall_sconce: 'Arandela Luz',
  card_25d: 'Card 2.5D',
};

export const TopToolbar: React.FC<TopToolbarProps> = ({
  onOpenDSL,
  onOpenMaps,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dslInputRef = useRef<HTMLInputElement | null>(null);

  const scene = useSceneStore((s) => s.scene);
  const tool = useSceneStore((s) => s.tool);
  const activePropType = useSceneStore((s) => s.activePropType);
  const viewMode = useSceneStore((s) => s.viewMode);
  const showGrid = useSceneStore((s) => s.showGrid);
  const showReferenceOverlay = useSceneStore((s) => s.showReferenceOverlay);
  const showProjectedImage = useSceneStore((s) => s.showProjectedImage);
  const stats = useSceneStore((s) => s.stats);

  const loadImageAndScene = useSceneStore((s) => s.loadImageAndScene);
  const openProjectOrScene = useSceneStore((s) => s.openProjectOrScene);
  const autoTranslateCurrentImage = useSceneStore((s) => s.autoTranslateCurrentImage);
  const setTool = useSceneStore((s) => s.setTool);
  const setActivePropType = useSceneStore((s) => s.setActivePropType);
  const setViewMode = useSceneStore((s) => s.setViewMode);
  const setShowGrid = useSceneStore((s) => s.setShowGrid);
  const setShowReferenceOverlay = useSceneStore((s) => s.setShowReferenceOverlay);
  const setShowProjectedImage = useSceneStore((s) => s.setShowProjectedImage);
  const setWorldScale = useSceneStore((s) => s.setWorldScale);
  const rerollWorldSeed = useSceneStore((s) => s.rerollWorldSeed);
  const requestSnapToProjector = useSceneStore((s) => s.requestSnapToProjector);
  const requestExportGLB = useSceneStore((s) => s.requestExportGLB);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        loadImageAndScene(reader.result, undefined, true);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleImportDSL = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        if (typeof reader.result === 'string') {
          const imported = parseImportedMapFile(reader.result);
          openProjectOrScene(imported.scene, imported.sourceImageUrl);
        }
      } catch (err) {
        console.error('Arquivo de mapa inválido:', err);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const toolBtn = (
    id: EditorTool,
    label: string,
    icon: React.ReactNode
  ) => (
    <button
      onClick={() => setTool(id)}
      title={label}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition cursor-pointer ${
        tool === id
          ? 'bg-cyan-600 text-white shadow-sm'
          : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800 border border-zinc-800'
      }`}
    >
      {icon}
      <span className="hidden xl:inline">{label}</span>
    </button>
  );

  return (
    <header className="h-12 px-3 bg-zinc-900/95 border-b border-zinc-800 flex items-center justify-between gap-2 shrink-0">
      {/* Branding + Entrada de imagem/exemplos */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 pr-2 border-r border-zinc-800">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center shadow">
            <Box className="w-4 h-4 text-white" />
          </div>
          <div className="leading-tight">
            <div className="text-xs font-bold tracking-wide text-zinc-100">
              IsoForge
            </div>
            <div className="text-[10px] text-zinc-400">2D → Primitivas 3D</div>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          className="hidden"
        />
        <input
          ref={dslInputRef}
          type="file"
          accept=".json"
          onChange={handleImportDSL}
          className="hidden"
        />

        <button
          onClick={() => onOpenMaps('library')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold bg-amber-600/90 hover:bg-amber-500 text-white cursor-pointer transition"
          title="Abrir Biblioteca de Mapas e Meus Mapas Salvos"
        >
          <MapIcon className="w-3.5 h-3.5" />
          <span>Mapas</span>
        </button>

        <button
          onClick={() => onOpenMaps('saved')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium bg-emerald-700/85 hover:bg-emerald-600 text-white cursor-pointer transition"
          title="Salvar mapa atual na Biblioteca ou baixar projeto .isomap.json"
        >
          <BookmarkPlus className="w-3.5 h-3.5" />
          <span>Salvar</span>
        </button>

        <button
          onClick={() => dslInputRef.current?.click()}
          className="flex items-center gap-1 px-2 py-1.5 rounded text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 cursor-pointer transition"
          title="Abrir projeto .isomap.json ou cena .isodsl.json do computador"
        >
          <FolderOpen className="w-3.5 h-3.5 text-sky-400" />
          <span className="hidden lg:inline">Abrir .JSON</span>
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer transition"
          title="Carregar imagem 2D (PNG/JPG) e auto-traduzir"
        >
          <ImagePlus className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Imagem 2D</span>
        </button>

        <button
          onClick={() => autoTranslateCurrentImage()}
          className="flex items-center gap-1 px-2 py-1.5 rounded text-xs bg-violet-700/85 hover:bg-violet-600 text-white cursor-pointer transition"
          title="Analisar pixels da imagem atual e gerar instruções IsoDSL automaticamente"
        >
          <Wand2 className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Auto-Traduzir</span>
        </button>
      </div>

      {/* Ferramentas de Desenho de Footprints & Props + Modo Exploração */}
      <div className="flex items-center gap-1.5">
        {toolBtn('select', 'Selecionar', <MousePointer className="w-3.5 h-3.5" />)}
        {toolBtn('draw_rect', 'Retângulo', <Square className="w-3.5 h-3.5" />)}
        {toolBtn('draw_poly', 'Polígono', <PenTool className="w-3.5 h-3.5" />)}
        {toolBtn('place_prop', 'Prop', <Trees className="w-3.5 h-3.5" />)}
        <button
          onClick={() => setTool(tool === 'explore' ? 'select' : 'explore')}
          title="Modo Exploração (personagem 1.7m com clique para andar e clip de interior BG3/Sims)"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold transition cursor-pointer ${
            tool === 'explore'
              ? 'bg-amber-500 text-zinc-950 shadow-sm'
              : 'bg-amber-950/60 text-amber-200 hover:bg-amber-900/70 border border-amber-700/60'
          }`}
        >
          <Footprints className="w-3.5 h-3.5" />
          <span>Explorar</span>
        </button>

        {tool === 'place_prop' && (
          <select
            value={activePropType}
            onChange={(e) => setActivePropType(e.target.value as PropGeneratorType)}
            className="ml-1 px-2 py-1.5 rounded text-xs bg-zinc-800 border border-zinc-700 text-zinc-100"
          >
            {(Object.keys(PROP_LABELS) as PropGeneratorType[]).map((k) => (
              <option key={k} value={k}>
                {PROP_LABELS[k]}
              </option>
            ))}
          </select>
        )}

        {/* Seletor Multi-Escala (Pequeno / Médio / Grande — Mundo Aberto) */}
        <div className="hidden md:flex items-center ml-2 bg-zinc-950 border border-zinc-800 rounded p-0.5">
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
              className={`px-2 py-1 rounded text-[11px] font-medium cursor-pointer transition ${
                scene.worldGrammar.scale === item.id
                  ? 'bg-emerald-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title={`Gerar mundo aberto em escala ${item.label}`}
            >
              {item.label}
            </button>
          ))}
          <button
            onClick={rerollWorldSeed}
            className="ml-1 p-1 rounded text-amber-400 hover:bg-zinc-800 cursor-pointer"
            title={`Nova Seed aleatória (atual: ${scene.worldGrammar.seed})`}
          >
            <Dices className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Câmera, Overlay, Métricas e Exportação */}
      <div className="flex items-center gap-1.5">
        <div className="hidden lg:flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-zinc-400">
          <Layers className="w-3 h-3 text-cyan-400" />
          <span>{stats.triangles.toLocaleString()} tris</span>
          <span className="text-zinc-600">|</span>
          <span>{stats.meshCount} meshes</span>
        </div>

        <button
          onClick={() =>
            setViewMode(viewMode === 'orbit' ? 'projector' : 'orbit')
          }
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium cursor-pointer border transition ${
            viewMode === 'projector'
              ? 'bg-amber-600/90 border-amber-500 text-white'
              : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
          }`}
          title="Alternar entre Câmera Orbit 3D Livre e Câmera Projetora 2D"
        >
          <Camera className="w-3.5 h-3.5" />
          <span className="hidden md:inline">
            {viewMode === 'projector' ? 'Projetor' : 'Orbit 3D'}
          </span>
        </button>

        <button
          onClick={requestSnapToProjector}
          className="p-1.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 cursor-pointer"
          title="Alinhar câmera Orbit ao ângulo do Projetor"
        >
          <Compass className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => setShowReferenceOverlay(!showReferenceOverlay)}
          className={`p-1.5 rounded border cursor-pointer ${
            showReferenceOverlay
              ? 'bg-cyan-900/60 border-cyan-600 text-cyan-200'
              : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800'
          }`}
          title="Sobrepor imagem original para calibrar"
        >
          <Eye className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => setShowProjectedImage(!showProjectedImage)}
          className={`p-1.5 rounded border cursor-pointer ${
            showProjectedImage
              ? 'bg-indigo-900/60 border-indigo-600 text-indigo-200'
              : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:bg-zinc-800'
          }`}
          title={
            showProjectedImage
              ? 'Esconder imagem projetada no terreno'
              : 'Mostrar imagem projetada no terreno'
          }
        >
          <ImageIcon className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => setShowGrid(!showGrid)}
          className={`p-1.5 rounded border cursor-pointer ${
            showGrid
              ? 'bg-zinc-800 border-zinc-700 text-zinc-200'
              : 'bg-zinc-900 border-zinc-800 text-zinc-500'
          }`}
          title="Alternar Grid"
        >
          <Grid className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onOpenDSL}
          className="flex items-center gap-1 px-2 py-1.5 rounded text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 cursor-pointer"
          title="Ver / Editar código IsoDSL JSON"
        >
          <Code2 className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden xl:inline">IsoDSL</span>
        </button>

        <button
          onClick={() => exportIsoDSLJson(scene)}
          className="px-2 py-1.5 rounded text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 cursor-pointer"
          title="Baixar arquivo .isodsl.json"
        >
          .JSON
        </button>

        <button
          onClick={requestExportGLB}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer transition"
          title="Exportar .glb leve com UVs assados, normal map e hierarquia semântica"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Exportar .GLB</span>
        </button>
      </div>
    </header>
  );
};
