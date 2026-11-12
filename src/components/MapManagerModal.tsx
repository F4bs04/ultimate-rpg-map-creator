import React, { useMemo, useRef, useState } from 'react';
import {
  BookmarkPlus,
  Check,
  Code2,
  Copy,
  FileDown,
  FolderOpen,
  ImagePlus,
  Layers,
  Map as MapIcon,
  Pencil,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { exportIsoDSLJson } from '../core/exporter';
import {
  BUILTIN_MAPS,
  deleteSavedMap,
  downloadProjectFile,
  duplicateSavedMap,
  listSavedMaps,
  parseImportedMapFile,
  renameSavedMap,
  saveMapToLibrary,
  type BuiltinMapEntry,
  type MapCategory,
  type SavedMapEntry,
} from '../core/mapLibrary';
import { useSceneStore } from '../store/useSceneStore';

interface MapManagerModalProps {
  onClose: () => void;
  initialTab?: 'library' | 'saved';
}

const CATEGORIES: ('Todos' | MapCategory)[] = [
  'Todos',
  'Porto',
  'Cidade',
  'Interno',
  'Ruínas',
  'Floresta',
  'Calibração',
];

const SCALE_LABELS: Record<string, string> = {
  small: '3×3',
  medium: '5×5',
  large: '9×9',
};

export const MapManagerModal: React.FC<MapManagerModalProps> = ({
  onClose,
  initialTab = 'library',
}) => {
  const scene = useSceneStore((s) => s.scene);
  const sourceImageUrl = useSceneStore((s) => s.sourceImageUrl);
  const loadImageAndScene = useSceneStore((s) => s.loadImageAndScene);
  const openProjectOrScene = useSceneStore((s) => s.openProjectOrScene);
  const updateSceneMeta = useSceneStore((s) => s.updateSceneMeta);

  const [tab, setTab] = useState<'library' | 'saved'>(initialTab);
  const [categoryFilter, setCategoryFilter] = useState<'Todos' | MapCategory>('Todos');
  const [searchQuery, setSearchQuery] = useState('');
  const [saveName, setSaveName] = useState(scene.meta.name || 'Meu Mapa');
  const [savedMaps, setSavedMaps] = useState<SavedMapEntry[]>(() => listSavedMaps());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const projectInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const filteredBuiltins = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return BUILTIN_MAPS.filter((item) => {
      if (categoryFilter !== 'Todos' && item.category !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [categoryFilter, searchQuery]);

  const filteredSaved = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return savedMaps;
    return savedMaps.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
    );
  }, [savedMaps, searchQuery]);

  const handleSaveNew = () => {
    const finalName = saveName.trim() || scene.meta.name || 'Mapa Salvo';
    try {
      updateSceneMeta({ name: finalName });
      const { entry, droppedInlineImage } = saveMapToLibrary(scene, sourceImageUrl, {
        name: finalName,
      });
      setSavedMaps(listSavedMaps());
      setTab('saved');
      setStatusMsg(
        droppedInlineImage
          ? {
              kind: 'warn',
              text: `"${entry.name}" salvo na biblioteca (imagem customizada grande omitida da cota local — baixe .isomap.json para backup completo).`,
            }
          : {
              kind: 'ok',
              text: `Mapa "${entry.name}" salvo em Meus Mapas!`,
            }
      );
    } catch (err) {
      setStatusMsg({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Falha ao salvar mapa na biblioteca.',
      });
    }
  };

  const handleOverwriteSaved = (entry: SavedMapEntry) => {
    try {
      const { droppedInlineImage } = saveMapToLibrary(scene, sourceImageUrl, {
        id: entry.id,
        name: entry.name,
        category: entry.category,
      });
      setSavedMaps(listSavedMaps());
      setStatusMsg({
        kind: droppedInlineImage ? 'warn' : 'ok',
        text: droppedInlineImage
          ? `"${entry.name}" atualizado (imagem inline grande omitida do localStorage).`
          : `"${entry.name}" atualizado com a cena atual!`,
      });
    } catch (err) {
      setStatusMsg({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Erro ao atualizar mapa salvo.',
      });
    }
  };

  const handleOpenBuiltin = async (entry: BuiltinMapEntry) => {
    setBusyId(entry.id);
    try {
      const loaded = entry.load();
      await loadImageAndScene(loaded.imageUrl, loaded.scene, false);
      onClose();
    } catch (err) {
      setStatusMsg({
        kind: 'err',
        text: `Não foi possível abrir "${entry.name}": ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleOpenSaved = async (entry: SavedMapEntry) => {
    setBusyId(entry.id);
    try {
      await openProjectOrScene(entry.scene, entry.sourceImageUrl);
      onClose();
    } catch (err) {
      setStatusMsg({
        kind: 'err',
        text: `Falha ao abrir "${entry.name}": ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleCommitRename = (id: string) => {
    if (!editingName.trim()) {
      setEditingId(null);
      return;
    }
    setSavedMaps(renameSavedMap(id, editingName));
    setEditingId(null);
    setStatusMsg({ kind: 'ok', text: 'Mapa renomeado.' });
  };

  const handleImportProjectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        if (typeof reader.result !== 'string') return;
        const imported = parseImportedMapFile(reader.result);
        await openProjectOrScene(imported.scene, imported.sourceImageUrl);
        onClose();
      } catch (err) {
        setStatusMsg({
          kind: 'err',
          text: err instanceof Error ? err.message : 'Arquivo JSON incompatível.',
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImportImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') {
        await loadImageAndScene(reader.result, undefined, true);
        onClose();
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const activeSourceLabel = scene.meta.sourceLabel ?? '';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-5xl h-[86vh] bg-zinc-900 border border-zinc-700 rounded-xl flex flex-col overflow-hidden shadow-2xl">
        {/* Hidden File Inputs */}
        <input
          ref={projectInputRef}
          type="file"
          accept=".json,.isomap.json,.isodsl.json,application/json"
          onChange={handleImportProjectFile}
          className="hidden"
        />
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          onChange={handleImportImage}
          className="hidden"
        />

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950/90">
          <div className="flex items-center gap-2.5">
            <MapIcon className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">
                Gerenciador & Biblioteca de Mapas
              </h2>
              <p className="text-[11px] text-zinc-400">
                Cena atual:{' '}
                <span className="text-zinc-200 font-medium">{scene.meta.name}</span>{' '}
                · {scene.structures.length} estruturas · {scene.props.length} props · Escala{' '}
                {SCALE_LABELS[scene.worldGrammar.scale] ?? scene.worldGrammar.scale}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 cursor-pointer"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Barra de Salvar & Abrir */}
        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-950/50 flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[220px] flex items-center gap-2">
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Nome do mapa para salvar..."
              className="flex-1 px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-700 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
            />
            <button
              onClick={handleSaveNew}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer transition"
              title="Salvar mapa atual na biblioteca local do navegador"
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              <span>Salvar na Biblioteca</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => downloadProjectFile(scene, sourceImageUrl, saveName)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 cursor-pointer transition"
              title="Baixar projeto completo (.isomap.json com imagem + cena 3D + props + Open World)"
            >
              <FileDown className="w-3.5 h-3.5 text-amber-400" />
              <span>Baixar .isomap.json</span>
            </button>

            <button
              onClick={() => exportIsoDSLJson(scene)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 cursor-pointer transition"
              title="Baixar somente a especificação IsoDSL (.isodsl.json)"
            >
              <Code2 className="w-3.5 h-3.5 text-cyan-400" />
              <span>.isodsl.json</span>
            </button>

            <button
              onClick={() => projectInputRef.current?.click()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs bg-sky-700 hover:bg-sky-600 text-white font-medium cursor-pointer transition"
              title="Abrir arquivo salvo (.isomap.json ou .isodsl.json)"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Abrir Arquivo</span>
            </button>

            <button
              onClick={() => imageInputRef.current?.click()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs bg-violet-700/85 hover:bg-violet-600 text-white font-medium cursor-pointer transition"
              title="Carregar uma nova imagem 2D e auto-traduzir para 3D"
            >
              <ImagePlus className="w-3.5 h-3.5" />
              <span>Nova Imagem 2D</span>
            </button>
          </div>
        </div>

        {/* Status feedback */}
        {statusMsg && (
          <div
            className={`px-4 py-2 text-xs border-b flex items-center justify-between ${
              statusMsg.kind === 'ok'
                ? 'bg-emerald-950/70 border-emerald-800 text-emerald-200'
                : statusMsg.kind === 'warn'
                  ? 'bg-amber-950/70 border-amber-800 text-amber-200'
                  : 'bg-rose-950/70 border-rose-800 text-rose-200'
            }`}
          >
            <span>{statusMsg.text}</span>
            <button
              onClick={() => setStatusMsg(null)}
              className="text-current opacity-75 hover:opacity-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Abas & Busca */}
        <div className="px-4 py-2.5 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2 bg-zinc-900">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setTab('library')}
              className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer transition ${
                tab === 'library'
                  ? 'bg-amber-600 text-white'
                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              Biblioteca Integrada ({BUILTIN_MAPS.length})
            </button>
            <button
              onClick={() => setTab('saved')}
              className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer transition ${
                tab === 'saved'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              Meus Mapas Salvos ({savedMaps.length})
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {tab === 'library' && (
              <div className="flex items-center gap-1 flex-wrap">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(cat)}
                    className={`px-2 py-1 rounded text-[11px] cursor-pointer transition ${
                      categoryFilter === cat
                        ? 'bg-zinc-100 text-zinc-950 font-semibold'
                        : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}

            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filtrar mapas..."
              className="px-2.5 py-1 rounded bg-zinc-950 border border-zinc-700 text-xs text-zinc-200 placeholder:text-zinc-500 w-44 focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>

        {/* Corpo / Grade de Mapas */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'library' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredBuiltins.map((item) => {
                const isActive =
                  item.previewUrl !== null &&
                  activeSourceLabel !== '' &&
                  item.previewUrl.toLowerCase().endsWith(activeSourceLabel.toLowerCase());
                return (
                  <div
                    key={item.id}
                    className={`rounded-lg border overflow-hidden flex flex-col bg-zinc-950/75 transition ${
                      isActive
                        ? 'border-amber-500/80 ring-1 ring-amber-500/40'
                        : 'border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    <div className="relative h-36 bg-zinc-900 overflow-hidden flex items-center justify-center border-b border-zinc-800">
                      {item.previewUrl ? (
                        <img
                          src={item.previewUrl}
                          alt={item.name}
                          className="w-full h-full object-cover opacity-90"
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-1 text-zinc-500 text-xs">
                          <Layers className="w-6 h-6" />
                          <span>Gerado Proceduralmente</span>
                        </div>
                      )}
                      <div className="absolute top-2 left-2 flex items-center gap-1">
                        <span className="px-1.5 py-0.5 rounded bg-zinc-950/85 border border-zinc-700 text-[10px] font-medium text-zinc-200">
                          {item.category}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-zinc-950/85 border border-zinc-700 text-[10px] text-emerald-300">
                          {SCALE_LABELS[item.recommendedScale] ?? item.recommendedScale}
                        </span>
                      </div>
                      {isActive && (
                        <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-amber-600 text-white text-[10px] font-semibold">
                          Ativo
                        </span>
                      )}
                    </div>

                    <div className="p-3 flex-1 flex flex-col justify-between gap-2.5">
                      <div>
                        <h3 className="text-xs font-semibold text-zinc-100">
                          {item.name}
                        </h3>
                        <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                          {item.description}
                        </p>
                      </div>

                      <button
                        onClick={() => handleOpenBuiltin(item)}
                        disabled={busyId === item.id}
                        className="w-full py-1.5 rounded text-xs font-medium bg-zinc-800 hover:bg-amber-600 text-zinc-100 cursor-pointer transition disabled:opacity-50"
                      >
                        {busyId === item.id ? 'Carregando...' : 'Abrir Mapa'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : filteredSaved.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-12 text-zinc-400">
              <BookmarkPlus className="w-10 h-10 text-zinc-600 mb-3" />
              <p className="text-sm font-medium text-zinc-200">
                Nenhum mapa salvo nesta lista ainda
              </p>
              <p className="text-xs text-zinc-500 mt-1 max-w-md">
                Use &quot;Salvar na Biblioteca&quot; acima para guardar edições no navegador ou
                &quot;Baixar .isomap.json&quot; para salvar no seu disco e compartilhar entre projetos.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredSaved.map((entry) => {
                const isEditing = editingId === entry.id;
                const formattedDate = new Date(entry.updatedAt).toLocaleString('pt-BR', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                });
                return (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-zinc-800 bg-zinc-950/75 p-3 flex flex-wrap items-center justify-between gap-3 hover:border-zinc-700"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-14 h-14 rounded bg-zinc-900 border border-zinc-800 overflow-hidden shrink-0 flex items-center justify-center">
                        {entry.sourceImageUrl ? (
                          <img
                            src={entry.sourceImageUrl}
                            alt={entry.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <MapIcon className="w-5 h-5 text-zinc-600" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleCommitRename(entry.id);
                                if (e.key === 'Escape') setEditingId(null);
                              }}
                              className="px-2 py-1 rounded bg-zinc-900 border border-emerald-500 text-xs text-zinc-100 focus:outline-none"
                              autoFocus
                            />
                            <button
                              onClick={() => handleCommitRename(entry.id)}
                              className="p-1 rounded bg-emerald-600 text-white cursor-pointer"
                              title="Confirmar nome"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <h3 className="text-xs font-semibold text-zinc-100 truncate">
                              {entry.name}
                            </h3>
                            <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] text-zinc-300">
                              {entry.environmentMode === 'interior' ? 'Interno' : 'Externo'}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] text-emerald-300">
                              {SCALE_LABELS[entry.worldScale] ?? entry.worldScale}
                            </span>
                          </div>
                        )}
                        <p className="text-[11px] text-zinc-400 mt-1">
                          {entry.structureCount} estruturas · {entry.propCount} props · Atualizado em{' '}
                          {formattedDate}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        onClick={() => handleOpenSaved(entry)}
                        disabled={busyId === entry.id}
                        className="px-3 py-1.5 rounded text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer transition disabled:opacity-50"
                      >
                        {busyId === entry.id ? 'Abrindo...' : 'Abrir'}
                      </button>

                      <button
                        onClick={() => handleOverwriteSaved(entry)}
                        className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer"
                        title="Sobrescrever este slot com a cena atual"
                      >
                        <Save className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => {
                          setEditingId(entry.id);
                          setEditingName(entry.name);
                        }}
                        className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer"
                        title="Renomear"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => {
                          duplicateSavedMap(entry.id);
                          setSavedMaps(listSavedMaps());
                          setStatusMsg({ kind: 'ok', text: 'Cópia criada na biblioteca.' });
                        }}
                        className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 cursor-pointer"
                        title="Duplicar"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() =>
                          downloadProjectFile(entry.scene, entry.sourceImageUrl, entry.name)
                        }
                        className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-amber-300 cursor-pointer"
                        title="Baixar projeto (.isomap.json)"
                      >
                        <FileDown className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => {
                          setSavedMaps(deleteSavedMap(entry.id));
                          setStatusMsg({ kind: 'ok', text: `"${entry.name}" removido.` });
                        }}
                        className="p-1.5 rounded bg-zinc-800 hover:bg-rose-900/70 text-zinc-400 hover:text-rose-200 cursor-pointer"
                        title="Excluir mapa salvo"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
