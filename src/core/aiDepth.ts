/**
 * Estimador de profundidade neural no navegador usando Depth Anything V2 Small (ONNX + WebGPU/WASM)
 * carregado sob demanda (lazy dynamic import) para manter o carregamento inicial instantâneo.
 */

export interface AIDepthProgress {
  status: string;
  progress?: number;
}

export interface AIDepthResult {
  depthField: Float32Array;
  width: number;
  height: number;
  backend: 'webgpu' | 'wasm';
}

type DepthPipeline = (
  image: string
) => Promise<{
  depth: { data: Uint8Array | Uint8ClampedArray; width: number; height: number };
}>;

let cachedPipeline: DepthPipeline | null = null;
let cachedBackend: 'webgpu' | 'wasm' = 'wasm';

function resampleGrayToFloat(
  src: Uint8Array | Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Float32Array {
  const out = new Float32Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y / dstH) * srcH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x / dstW) * srcW));
      out[y * dstW + x] = src[sy * srcW + sx] / 255;
    }
  }
  return out;
}

export async function estimateAIDepthFromImage(
  imageUrl: string,
  targetW: number,
  targetH: number,
  onProgress?: (info: AIDepthProgress) => void
): Promise<AIDepthResult> {
  if (!cachedPipeline) {
    onProgress?.({ status: 'Carregando Depth Anything V2 (ONNX)...', progress: 5 });
    const transformers = await import('@huggingface/transformers');
    const hasWebGPU =
      typeof navigator !== 'undefined' && 'gpu' in navigator;

    const device: 'webgpu' | 'wasm' = hasWebGPU ? 'webgpu' : 'wasm';
    cachedBackend = device;

    try {
      const pipe = await transformers.pipeline(
        'depth-estimation',
        'onnx-community/depth-anything-v2-small',
        {
          device,
          progress_callback: (evt: { status?: string; progress?: number }) => {
            onProgress?.({
              status: evt.status ?? 'Baixando pesos ONNX...',
              progress: typeof evt.progress === 'number' ? Math.round(evt.progress) : undefined,
            });
          },
        }
      );
      cachedPipeline = pipe as unknown as DepthPipeline;
    } catch {
      // Fallback garantido para WASM caso WebGPU falhe no driver do navegador
      cachedBackend = 'wasm';
      const pipe = await transformers.pipeline(
        'depth-estimation',
        'onnx-community/depth-anything-v2-small',
        {
          device: 'wasm',
        }
      );
      cachedPipeline = pipe as unknown as DepthPipeline;
    }
  }

  onProgress?.({ status: 'Inferindo mapa de profundidade...', progress: 95 });
  const result = await cachedPipeline(imageUrl);
  const { data, width, height } = result.depth;
  const depthField = resampleGrayToFloat(data, width, height, targetW, targetH);

  return {
    depthField,
    width: targetW,
    height: targetH,
    backend: cachedBackend,
  };
}

