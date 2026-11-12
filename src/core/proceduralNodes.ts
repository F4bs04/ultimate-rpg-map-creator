import type {
  IsoDSLScene,
  IsoWorldKit,
  WorldGrammarConfig,
} from '../types/isodsl';
import { getReconstructionConfig } from '../types/isodsl';
import type { GeneratedWorldExpansion } from './worldBuilder';

export type NodeToggleKey =
  | 'enableWaterContinuation'
  | 'enableRoadContinuation'
  | 'enableBridges'
  | 'enableArchitecturalPOIs'
  | 'enableForestScatter';

export interface ProceduralNodeDescriptor {
  id: string;
  title: string;
  category: 'input' | 'field' | 'wfc' | 'spline' | 'scatter' | 'geometry';
  summary: string;
  metricLabel: string;
  toggleKey?: NodeToggleKey;
  enabled: boolean;
}

/**
 * Representa o grafo procedural estilo Geometry Nodes (IRCSS / Blender) que governa
 * a expansão do mundo a partir dos recortes da imagem âncora.
 */
export function buildWorldNodePipelineSummary(
  scene: IsoDSLScene,
  kit: IsoWorldKit | null,
  expansion: GeneratedWorldExpansion | null
): ProceduralNodeDescriptor[] {
  const g: WorldGrammarConfig = scene.worldGrammar;
  const swatchCount = kit ? Object.keys(kit.swatches).length : 0;
  const portalCount = kit?.portals.length ?? 0;
  const reconstruction = getReconstructionConfig(scene);
  const featureCount = scene.terrainFeatures?.length ?? 0;
  const species = new Set(scene.props.map((prop) => prop.generator));

  return [
    {
      id: 'node_kit_absorber',
      title: '1. Image & Swatch Absorber',
      category: 'input',
       summary: reconstruction.mode === 'semantic_rebuild'
         ? 'Absorve paleta e bordas como sinais de reconstrução, sem projetar a imagem na malha.'
         : 'Recorta texturas tileáveis sem costura e detecta portais nas bordas.',
      metricLabel: `${swatchCount} swatches · ${portalCount} portais`,
      enabled: true,
    },
    {
      id: 'node_wfc_grid',
      title: '2. WFC Biome Grid Solver',
      category: 'wfc',
       summary: 'Colapsa biomas vizinhos por entropia e injeta a leitura semântica do mapa âncora.',
       metricLabel: expansion
         ? `${expansion.summary.chunkCount} chunks · ${featureCount} regiões (${g.scale})`
         : `1 chunk · ${featureCount} regiões (${g.scale})`,
      enabled: true,
    },
    {
      id: 'node_water_spline',
      title: '3. River Spline & Carving',
      category: 'spline',
       summary: 'Estende rios dos portais com meandro, leito escavado e superfície de água nativa.',
      metricLabel: `${expansion?.summary.riverSegments ?? 0} segs rio`,
      toggleKey: 'enableWaterContinuation',
      enabled: g.enableWaterContinuation ?? true,
    },
    {
      id: 'node_road_spline',
      title: '4. Road Network & Bridges',
      category: 'spline',
      summary: 'Continua estradas entre chunks e posiciona pontes nos cruzamentos.',
      metricLabel: `${expansion?.summary.roadSegments ?? 0} segs via`,
      toggleKey: 'enableRoadContinuation',
      enabled: g.enableRoadContinuation ?? true,
    },
    {
      id: 'node_arch_grammar',
      title: '5. Architecture Grammar (IRCSS)',
      category: 'geometry',
       summary: 'Reconstrói footprints, portas, telhados e ruínas sem operações booleanas.',
       metricLabel: `${scene.structures.length + (expansion?.summary.poiCount ?? 0)} estruturas`,
      toggleKey: 'enableArchitecturalPOIs',
      enabled: g.enableArchitecturalPOIs ?? true,
    },
    {
      id: 'node_poisson_scatter',
      title: '6. Poisson-Disk Scatter + Instancing',
      category: 'scatter',
       summary: 'Distribui espécies por bioma, raio mínimo, caminhos e variação de modelo.',
       metricLabel: `${species.size} espécies · ${expansion?.summary.instancedPropCount ?? 0} instâncias`,
      toggleKey: 'enableForestScatter',
      enabled: g.enableForestScatter ?? true,
    },
  ];
}
