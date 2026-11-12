import {
  createDefaultReconstructionConfig,
  createDefaultWorldGrammar,
  type IsoDSLScene,
} from '../types/isodsl';
import { createCidadeMedievalScene } from './cidadeMedievalScene';
import { createForestCrossroadsScene } from './forestCrossroadsScene';
import { createPortoRustymapsScene } from './portoRustymapsScene';
import { createRuinasRioMediumScene } from './ruinasRioScene';
import { generateIsometricSample, generateTopDownSample } from './sampleScenes';
import { createTavernaMedievalScene } from './tavernaMedievalScene';
import { createValeRegionalScene } from './valeRegionalScene';
import { createVilaMedievalScene } from './vilaMedievalScene';

export type MapCategory =
  | 'Regional'
  | 'Porto'
  | 'Cidade'
  | 'Interno'
  | 'Ruínas'
  | 'Floresta'
  | 'Calibração'
  | 'Personalizado';

export interface BuiltinMapEntry {
  id: string;
  name: string;
  category: MapCategory;
  description: string;
  previewUrl: string | null;
  environmentMode: 'outdoor' | 'interior';
  recommendedScale: IsoDSLScene['worldGrammar']['scale'];
  load: () => { imageUrl: string; scene: IsoDSLScene };
}

export interface SavedMapEntry {
  id: string;
  name: string;
  savedAt: string;
  updatedAt: string;
  category: MapCategory;
  structureCount: number;
  propCount: number;
  worldScale: IsoDSLScene['worldGrammar']['scale'];
  environmentMode: 'outdoor' | 'interior';
  sourceImageUrl: string | null;
  scene: IsoDSLScene;
}

export interface IsoForgeProjectFile {
  format: 'isoforge-project';
  version: '1.0';
  savedAt: string;
  name: string;
  sourceImageUrl: string | null;
  scene: IsoDSLScene;
}

export interface ParsedImportedMap {
  kind: 'project' | 'isodsl';
  name: string;
  sourceImageUrl: string | null;
  scene: IsoDSLScene;
}

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const STORAGE_KEY = 'isoforge.savedMaps.v1';

export const BUILTIN_MAPS: BuiltinMapEntry[] = [
  {
    id: 'vale-regional',
    name: 'Vale dos Rios & Província (Grande 9×9)',
    category: 'Regional',
    description:
      'Província regional com 2 rios, bacia/represa com moinho, solar feudal murado, cascata com torreão, pontes, fazendas e nuvens no céu.',
    previewUrl: '/maps/vale-regional.jpg',
    environmentMode: 'outdoor',
    recommendedScale: 'large',
    load: () => ({
      imageUrl: '/maps/vale-regional.jpg',
      scene: createValeRegionalScene(),
    }),
  },
  {
    id: 'porto-rustymaps',
    name: 'Porto & Cidadela Fluvial (Rustymaps)',
    category: 'Porto',
    description:
      'Porto costeiro com colina fortificada a NW, 2 pontes, 6 píeres, barcos atracados, farol na baía e fortaleza leste.',
    previewUrl: '/maps/porto-rustymaps.jpg',
    environmentMode: 'outdoor',
    recommendedScale: 'medium',
    load: () => ({
      imageUrl: '/maps/porto-rustymaps.jpg',
      scene: createPortoRustymapsScene(),
    }),
  },
  {
    id: 'cidade-medieval',
    name: 'Cidade Medieval (Stress 70+ Edifícios)',
    category: 'Cidade',
    description:
      'Cidade inteira Rustymaps com ~70 construções em enxaimel, rotunda do templo, prefeitura, praça com fonte e mundo 5×5.',
    previewUrl: '/maps/cidade-medieval-rustymaps.jpg',
    environmentMode: 'outdoor',
    recommendedScale: 'medium',
    load: () => ({
      imageUrl: '/maps/cidade-medieval-rustymaps.jpg',
      scene: createCidadeMedievalScene(),
    }),
  },
  {
    id: 'taverna-medieval',
    name: 'Taverna Medieval (Ambiente Interno)',
    category: 'Interno',
    description:
      'Salão interno completo com lareira acesa, balcão, mesas com bancos, barris, caixotes, iluminação quente e salas adjacentes.',
    previewUrl: '/maps/taverna-medieval.jpg',
    environmentMode: 'interior',
    recommendedScale: 'small',
    load: () => ({
      imageUrl: '/maps/taverna-medieval.jpg',
      scene: createTavernaMedievalScene(),
    }),
  },
  {
    id: 'vila-medieval-rio',
    name: 'Vila Medieval no Rio',
    category: 'Cidade',
    description:
      'Vila ribeirinha com casas de telhado azul, fazenda, ruína de torreão na encosta, ponte rústica e botes na praia.',
    previewUrl: '/maps/vila-medieval-rio.jpg',
    environmentMode: 'outdoor',
    recommendedScale: 'small',
    load: () => ({
      imageUrl: '/maps/vila-medieval-rio.jpg',
      scene: createVilaMedievalScene(),
    }),
  },
  {
    id: 'ruinas-rio',
    name: 'Ruínas no Riacho (Médio 3×3)',
    category: 'Ruínas',
    description:
      'Conjunto de ruínas de pedra em torno de santuário central e riacho com árvores decíduas e expansão WFC.',
    previewUrl: '/maps/ruinas-rio.jpg',
    environmentMode: 'outdoor',
    recommendedScale: 'small',
    load: () => ({
      imageUrl: '/maps/ruinas-rio.jpg',
      scene: createRuinasRioMediumScene(),
    }),
  },
  {
    id: 'cruzamento-floresta',
    name: 'Cruzamento da Floresta',
    category: 'Floresta',
    description:
      'Encruzilhada arborizada de escala compacta ideal para testar vegetação densa, troncos com casca e WFC orgânico.',
    previewUrl: '/maps/cruzamento-floresta.jpg',
    environmentMode: 'outdoor',
    recommendedScale: 'small',
    load: () => ({
      imageUrl: '/maps/cruzamento-floresta.jpg',
      scene: createForestCrossroadsScene(),
    }),
  },
  {
    id: 'sample-iso',
    name: 'Calibração Isométrica Procedural',
    category: 'Calibração',
    description:
      'Mapa sintético gerado em tempo real com projeção isométrica ~35° para validar câmera projetora e alinhamento 3D.',
    previewUrl: null,
    environmentMode: 'outdoor',
    recommendedScale: 'small',
    load: () => {
      const pkg = generateIsometricSample();
      return { imageUrl: pkg.imageDataUrl, scene: pkg.scene };
    },
  },
  {
    id: 'sample-topdown',
    name: 'Calibração Top-Down Procedural',
    category: 'Calibração',
    description:
      'Mapa ortográfico top-down sintético útil para calibrar extrusão, portas e telhados sem distorção angular.',
    previewUrl: null,
    environmentMode: 'outdoor',
    recommendedScale: 'small',
    load: () => {
      const pkg = generateTopDownSample();
      return { imageUrl: pkg.imageDataUrl, scene: pkg.scene };
    },
  },
];

function resolveStorage(customStorage?: StorageLike): StorageLike | null {
  if (customStorage) return customStorage;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeScene(raw: IsoDSLScene): IsoDSLScene {
  return {
    ...raw,
    schemaVersion: '1.0',
    worldGrammar: raw.worldGrammar ?? createDefaultWorldGrammar(),
    reconstruction: raw.reconstruction ?? createDefaultReconstructionConfig(),
    terrainFeatures: raw.terrainFeatures ?? [],
    structures: Array.isArray(raw.structures) ? raw.structures : [],
    props: Array.isArray(raw.props) ? raw.props : [],
  };
}

function slugifyName(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'mapa-isoforge'
  );
}

function resolveBuiltinImageFallback(scene: IsoDSLScene): string | null {
  const label = scene.meta?.sourceLabel?.toLowerCase() ?? '';
  if (!label) return null;
  const hit = BUILTIN_MAPS.find(
    (m) => m.previewUrl && m.previewUrl.toLowerCase().endsWith(label)
  );
  return hit?.previewUrl ?? null;
}

export function serializeProjectFile(
  scene: IsoDSLScene,
  sourceImageUrl: string | null,
  overrideName?: string
): IsoForgeProjectFile {
  const now = new Date().toISOString();
  const cleanName = overrideName?.trim() || scene.meta.name || 'Mapa IsoForge';
  return {
    format: 'isoforge-project',
    version: '1.0',
    savedAt: now,
    name: cleanName,
    sourceImageUrl,
    scene: {
      ...scene,
      meta: {
        ...scene.meta,
        name: cleanName,
      },
    },
  };
}

export function downloadProjectFile(
  scene: IsoDSLScene,
  sourceImageUrl: string | null,
  overrideName?: string
): void {
  const project = serializeProjectFile(scene, sourceImageUrl, overrideName);
  const json = JSON.stringify(project, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugifyName(project.name)}.isomap.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseImportedMapFile(rawJson: string): ParsedImportedMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Arquivo JSON inválido.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Conteúdo JSON não representa um projeto ou cena IsoDSL.');
  }

  const record = parsed as Record<string, unknown>;

  // Formato completo IsoForge Project (.isomap.json)
  if (record.format === 'isoforge-project' && record.scene && typeof record.scene === 'object') {
    const rawScene = record.scene as IsoDSLScene;
    if (!rawScene.terrain || !rawScene.projection) {
      throw new Error('Projeto inválido: falta terrain ou projection em scene.');
    }
    const scene = normalizeScene(rawScene);
    const name =
      (typeof record.name === 'string' && record.name.trim()) ||
      scene.meta?.name ||
      'Projeto Importado';
    scene.meta = { ...scene.meta, name };
    const sourceImageUrl =
      typeof record.sourceImageUrl === 'string' && record.sourceImageUrl.length > 0
        ? record.sourceImageUrl
        : resolveBuiltinImageFallback(scene);
    return {
      kind: 'project',
      name,
      sourceImageUrl,
      scene,
    };
  }

  // Formato IsoDSL puro (.isodsl.json)
  if (
    record.schemaVersion === '1.0' &&
    record.terrain &&
    typeof record.terrain === 'object' &&
    record.projection &&
    typeof record.projection === 'object'
  ) {
    const scene = normalizeScene(record as unknown as IsoDSLScene);
    const name = scene.meta?.name || 'Cena IsoDSL Importada';
    return {
      kind: 'isodsl',
      name,
      sourceImageUrl: resolveBuiltinImageFallback(scene),
      scene,
    };
  }

  throw new Error(
    'Formato não reconhecido. Esperado .isomap.json (IsoForge Project) ou .isodsl.json (schemaVersion 1.0).'
  );
}

function writeSavedList(entries: SavedMapEntry[], storage: StorageLike): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function listSavedMaps(customStorage?: StorageLike): SavedMapEntry[] {
  const storage = resolveStorage(customStorage);
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as SavedMapEntry[])
      .filter((e) => e && typeof e.id === 'string' && e.scene && e.scene.terrain)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  } catch {
    return [];
  }
}

export function saveMapToLibrary(
  scene: IsoDSLScene,
  sourceImageUrl: string | null,
  opts?: { id?: string; name?: string; category?: MapCategory },
  customStorage?: StorageLike
): { entry: SavedMapEntry; droppedInlineImage: boolean } {
  const storage = resolveStorage(customStorage);
  const now = new Date().toISOString();
  const cleanName = opts?.name?.trim() || scene.meta.name || 'Mapa Sem Título';
  const normalizedScene = normalizeScene({
    ...scene,
    meta: {
      ...scene.meta,
      name: cleanName,
    },
  });

  const existing = listSavedMaps(customStorage);
  const existingHit = opts?.id ? existing.find((e) => e.id === opts.id) : undefined;
  const entryId =
    existingHit?.id ||
    opts?.id ||
    `map_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  const envMode = normalizedScene.worldGrammar.environmentMode ?? 'outdoor';
  const buildEntry = (imgUrl: string | null): SavedMapEntry => ({
    id: entryId,
    name: cleanName,
    savedAt: existingHit?.savedAt ?? now,
    updatedAt: now,
    category:
      opts?.category ?? (envMode === 'interior' ? 'Interno' : 'Personalizado'),
    structureCount: normalizedScene.structures.length,
    propCount: normalizedScene.props.length,
    worldScale: normalizedScene.worldGrammar.scale,
    environmentMode: envMode,
    sourceImageUrl: imgUrl,
    scene: normalizedScene,
  });

  const nextWithoutSame = existing.filter((e) => e.id !== entryId);
  let entry = buildEntry(sourceImageUrl);
  let droppedInlineImage = false;

  if (storage) {
    try {
      writeSavedList([entry, ...nextWithoutSame], storage);
    } catch {
      // Se DataURL da imagem ultrapassar cota de localStorage, tenta salvar sem a DataURL embutida
      if (sourceImageUrl && sourceImageUrl.startsWith('data:')) {
        droppedInlineImage = true;
        entry = buildEntry(null);
        writeSavedList([entry, ...nextWithoutSame], storage);
      } else {
        throw new Error('Espaço insuficiente no armazenamento local do navegador.');
      }
    }
  }

  return { entry, droppedInlineImage };
}

export function renameSavedMap(
  id: string,
  nextName: string,
  customStorage?: StorageLike
): SavedMapEntry[] {
  const storage = resolveStorage(customStorage);
  const trimmed = nextName.trim();
  if (!storage || !trimmed) return listSavedMaps(customStorage);

  const now = new Date().toISOString();
  const updated = listSavedMaps(customStorage).map((entry) =>
    entry.id === id
      ? {
          ...entry,
          name: trimmed,
          updatedAt: now,
          scene: {
            ...entry.scene,
            meta: { ...entry.scene.meta, name: trimmed },
          },
        }
      : entry
  );
  writeSavedList(updated, storage);
  return updated;
}

export function duplicateSavedMap(
  id: string,
  customStorage?: StorageLike
): SavedMapEntry | null {
  const existing = listSavedMaps(customStorage).find((e) => e.id === id);
  if (!existing) return null;
  const { entry } = saveMapToLibrary(
    existing.scene,
    existing.sourceImageUrl,
    {
      name: `${existing.name} (Cópia)`,
      category: existing.category,
    },
    customStorage
  );
  return entry;
}

export function deleteSavedMap(
  id: string,
  customStorage?: StorageLike
): SavedMapEntry[] {
  const storage = resolveStorage(customStorage);
  const next = listSavedMaps(customStorage).filter((e) => e.id !== id);
  if (storage) {
    writeSavedList(next, storage);
  }
  return next;
}

