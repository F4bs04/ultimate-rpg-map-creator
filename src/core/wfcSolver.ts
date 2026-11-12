import type { IsoWorldKit, WorldGrammarConfig } from '../types/isodsl';

export type ChunkBiome =
  | 'anchor'
  | 'river_valley'
  | 'crossroads'
  | 'clearing'
  | 'dense_forest'
  | 'ruins_outpost';

export type WFCSelectableBiome = Exclude<ChunkBiome, 'anchor'>;

const ALL_BIOMES: WFCSelectableBiome[] = [
  'clearing',
  'dense_forest',
  'river_valley',
  'crossroads',
  'ruins_outpost',
];

/** Regras de adjacência Wave Function Collapse (WFC) para transições naturais entre chunks */
const WFC_ADJACENCY: Record<WFCSelectableBiome, Set<WFCSelectableBiome>> = {
  dense_forest: new Set(['dense_forest', 'clearing', 'river_valley']),
  clearing: new Set([
    'dense_forest',
    'clearing',
    'river_valley',
    'crossroads',
    'ruins_outpost',
  ]),
  river_valley: new Set([
    'river_valley',
    'clearing',
    'dense_forest',
    'crossroads',
  ]),
  crossroads: new Set([
    'crossroads',
    'clearing',
    'river_valley',
    'ruins_outpost',
  ]),
  ruins_outpost: new Set(['clearing', 'crossroads', 'ruins_outpost']),
};

export interface WFCSolveInput {
  gridRadius: number;
  pinnedCells: Map<string, ChunkBiome>;
  grammar: WorldGrammarConfig;
  kit?: IsoWorldKit;
  rng: () => number;
}

/**
 * Resolve uma grade 2D de biomas por Wave Function Collapse (menor entropia primeiro)
 * respeitando células âncora/portais fixas e pesos absorvidos do IsoWorldKit.
 */
export function solveChunkBiomeWFC(
  input: WFCSolveInput
): Map<string, ChunkBiome> {
  const { gridRadius, pinnedCells, grammar, kit, rng } = input;
  const result = new Map<string, ChunkBiome>();
  if (gridRadius === 0) {
    result.set('0,0', 'anchor');
    return result;
  }

  const size = gridRadius * 2 + 1;
  const idxOf = (gx: number, gz: number) =>
    (gz + gridRadius) * size + (gx + gridRadius);
  const coordsOf = (idx: number): [number, number] => [
    (idx % size) - gridRadius,
    Math.floor(idx / size) - gridRadius,
  ];
  const keyOf = (gx: number, gz: number) => `${gx},${gz}`;

  const foliageBias = kit ? 0.8 + kit.biomeStats.foliageRatio * 2.5 : 1.0;
  const waterBias = kit ? 0.6 + kit.biomeStats.waterRatio * 2.0 : 0.8;
  const stoneBias = kit ? 0.5 + kit.biomeStats.stoneRatio * 2.2 : 0.7;

  const weights: Record<WFCSelectableBiome, number> = {
    clearing: 1.4,
    dense_forest: 1.15 * foliageBias * Math.max(0.4, grammar.treeDensity),
    river_valley: 0.75 * waterBias,
    crossroads: 0.9,
    ruins_outpost: 0.45 * stoneBias + grammar.poiChance * 0.9,
  };

  // Inicializa domínio de possibilidades por célula
  const domains: Set<WFCSelectableBiome>[] = new Array(size * size);
  const collapsed = new Array<ChunkBiome | null>(size * size).fill(null);

  for (let i = 0; i < size * size; i++) {
    const [gx, gz] = coordsOf(i);
    const pinned = pinnedCells.get(keyOf(gx, gz));
    if (pinned) {
      collapsed[i] = pinned;
      domains[i] =
        pinned === 'anchor'
          ? new Set(['clearing'])
          : new Set([pinned]);
    } else {
      domains[i] = new Set(ALL_BIOMES);
    }
  }

  const propagateFrom = (startIdx: number) => {
    const queue = [startIdx];
    while (queue.length > 0) {
      const curIdx = queue.shift()!;
      const [cx, cz] = coordsOf(curIdx);
      const allowedFromCur = new Set<WFCSelectableBiome>();
      for (const b of domains[curIdx]) {
        for (const nb of WFC_ADJACENCY[b]) {
          allowedFromCur.add(nb);
        }
      }

      const dirs: [number, number][] = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (const [dx, dz] of dirs) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (Math.abs(nx) > gridRadius || Math.abs(nz) > gridRadius) continue;
        const nIdx = idxOf(nx, nz);
        if (collapsed[nIdx]) continue;

        let changed = false;
        for (const candidate of Array.from(domains[nIdx])) {
          if (!allowedFromCur.has(candidate)) {
            domains[nIdx].delete(candidate);
            changed = true;
          }
        }
        // Proteção contra contradição: se domínio zerar, restaura 'clearing' como transição universal
        if (domains[nIdx].size === 0) {
          domains[nIdx].add('clearing');
        }
        if (changed) queue.push(nIdx);
      }
    }
  };

  for (let i = 0; i < size * size; i++) {
    if (collapsed[i]) propagateFrom(i);
  }

  // Loop principal WFC: colapsa célula com menor entropia
  for (let step = 0; step < size * size; step++) {
    let bestIdx = -1;
    let bestEntropy = Infinity;

    for (let i = 0; i < size * size; i++) {
      if (collapsed[i]) continue;
      const entropy = domains[i].size + rng() * 0.25 * (0.2 + grammar.randomness);
      if (entropy < bestEntropy) {
        bestEntropy = entropy;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;

    const options = Array.from(domains[bestIdx]);
    let totalW = 0;
    for (const opt of options) totalW += weights[opt];
    let pick = rng() * totalW;
    let chosen: WFCSelectableBiome = options[0] ?? 'clearing';
    for (const opt of options) {
      pick -= weights[opt];
      if (pick <= 0) {
        chosen = opt;
        break;
      }
    }

    collapsed[bestIdx] = chosen;
    domains[bestIdx] = new Set([chosen]);
    propagateFrom(bestIdx);
  }

  for (let i = 0; i < size * size; i++) {
    const [gx, gz] = coordsOf(i);
    result.set(keyOf(gx, gz), collapsed[i] ?? 'clearing');
  }
  return result;
}

