import React, { useMemo, useState } from 'react';
import { Check, Code2, Copy, Sparkles, X } from 'lucide-react';
import { useSceneStore } from '../store/useSceneStore';

interface DSLModalProps {
  onClose: () => void;
}

export const DSLModal: React.FC<DSLModalProps> = ({ onClose }) => {
  const scene = useSceneStore((s) => s.scene);
  const worldKit = useSceneStore((s) => s.worldKit);
  const replaceSceneDSL = useSceneStore((s) => s.replaceSceneDSL);

  const [tab, setTab] = useState<'json' | 'bridge'>('json');
  const [text, setText] = useState(() => JSON.stringify(scene, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const llmPrompt = useMemo(() => {
    const portalsStr = worldKit?.portals
      ? JSON.stringify(worldKit.portals)
      : '[]';
 return `Você é um reconstrutor espacial para o motor IsoForge (IsoDSL v1.0).
Analise a imagem de mapa RPG anexada (ou gere variações com ComfyUI/Magnific) e retorne APENAS um JSON válido seguindo exatamente o schema IsoDSL v1.0.

Regras da cena atual:
- Proporção (aspectRatio): ${scene.meta.aspectRatio.toFixed(4)}
- Dimensões terreno: width=${scene.terrain.width}, depth=${scene.terrain.depth} (centro em X=0, Z=0)
- Reconstrução: use "reconstruction": {"mode":"semantic_rebuild", "semanticFidelity":0.86, "detectTerrainFeatures":true, "detectVegetation":true, "detectStructures":true, "generateProceduralModels":true}. Não use a imagem como textura projetada.
- Portais detectados nas bordas: ${portalsStr}
- Geradores de Props disponíveis: "barrel", "crate", "pillar", "fallen_pillar", "pine_tree", "deciduous_tree", "bush", "rock", "signpost", "well", "boat", "brazier", "tavern_table", "stool", "bar_counter", "fireplace", "bookshelf", "wall_sconce", "card_25d"
- Estilos de telhado: "flat", "gable", "hip", "cone", "parapet"
- Estilos de parede (IRCSS sem booleanas): "plain", "timber_frame", "buttress"
- Ambiente/Escala (worldGrammar): environmentMode "outdoor" | "interior", scale "small" | "medium" | "large" com randomness (0..1)
- Regiões de superfície: use "terrainFeatures" para rios e estradas nativos; cada item tem kind "water" ou "road", points [[x,z],...], width, elevation e material "water_surface" ou "road_dirt".

Conversão de coordenada normalizada da imagem (u, v de 0..1) para mundo (X, Z) em Top-Down:
x = (u - 0.5) * ${scene.terrain.width}
z = (v - 0.5) * ${scene.terrain.depth}

Mantenha a geometria ultraleve (footprints 2D para prédios/muros + props em código). Cole o JSON resultante na aba "IsoDSL JSON" do IsoForge.`;
  }, [scene, worldKit]);

  const handleApply = () => {
    try {
      const parsed = JSON.parse(text);
      if (parsed?.schemaVersion !== '1.0') {
        setError('schemaVersion deve ser "1.0"');
        return;
      }
      replaceSceneDSL(parsed);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(llmPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col max-h-[88vh]">
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">
              IsoDSL v1.0 — Linguagem de Replicação & Expansão de Mundo
            </h2>
            <p className="text-xs text-zinc-400">
              Edite o JSON declarativo ou use o prompt de ponte para LLM de Visão / ComfyUI / Magnific.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex border-b border-zinc-800 bg-zinc-950/60 px-4 gap-2">
          <button
            onClick={() => setTab('json')}
            className={`flex items-center gap-1.5 py-2 px-3 text-xs font-medium border-b-2 cursor-pointer ${
              tab === 'json'
                ? 'border-cyan-500 text-cyan-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>IsoDSL JSON</span>
          </button>
          <button
            onClick={() => setTab('bridge')}
            className={`flex items-center gap-1.5 py-2 px-3 text-xs font-medium border-b-2 cursor-pointer ${
              tab === 'bridge'
                ? 'border-violet-500 text-violet-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Ponte LLM Visão / ComfyUI</span>
          </button>
        </div>

        {tab === 'json' ? (
          <>
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
              spellCheck={false}
              className="flex-1 p-4 bg-zinc-950 text-emerald-300 font-mono text-xs leading-relaxed focus:outline-none resize-none min-h-[380px]"
            />

            {error && (
              <div className="px-4 py-2 bg-red-950/60 border-t border-red-800 text-xs text-red-300">
                Erro de sintaxe JSON: {error}
              </div>
            )}

            <div className="px-4 py-3 border-t border-zinc-800 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleApply}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Aplicar IsoDSL na Cena</span>
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col p-4 space-y-3 overflow-y-auto">
            <p className="text-xs text-zinc-300">
              Anexe sua imagem (ou texturas geradas via <strong>ComfyUI</strong> /{' '}
              <strong>Magnific</strong>) junto com este prompt em um modelo multimodal
              (Gemini, Claude ou GPT) para gerar o JSON estruturado e colar na aba{' '}
              <em>IsoDSL JSON</em>. Para absorver texturas extras direto no Kit, use{' '}
              <strong>Kit &amp; Mundo → + Absorver</strong>.
            </p>
            <pre className="flex-1 p-3 rounded bg-zinc-950 border border-zinc-800 text-violet-200 font-mono text-xs whitespace-pre-wrap overflow-y-auto max-h-[360px]">
              {llmPrompt}
            </pre>
            <div className="flex justify-end">
              <button
                onClick={handleCopyPrompt}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copied ? 'Prompt copiado!' : 'Copiar Prompt Estruturado'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
