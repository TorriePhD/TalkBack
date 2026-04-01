import { AutoModelForCTC, AutoProcessor, env } from '@huggingface/transformers';

const MODEL_ID = 'Xenova/wav2vec2-base-960h';

type ASRProcessor = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
type ASRModel = Awaited<ReturnType<typeof AutoModelForCTC.from_pretrained>>;

interface LoadedASR {
  processor: ASRProcessor;
  model: ASRModel;
}

let loadPromise: Promise<LoadedASR> | null = null;

function supportsWebGPU() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

async function loadModel() {
  if (!supportsWebGPU()) {
    return AutoModelForCTC.from_pretrained(MODEL_ID, {
      dtype: 'q8',
    });
  }

  try {
    return await AutoModelForCTC.from_pretrained(MODEL_ID, {
      device: 'webgpu',
      dtype: 'fp32',
    });
  } catch {
    return AutoModelForCTC.from_pretrained(MODEL_ID, {
      dtype: 'q8',
    });
  }
}

export async function loadASR(): Promise<LoadedASR> {
  if (!loadPromise) {
    loadPromise = (async () => {
      env.allowLocalModels = false;

      const processor = await AutoProcessor.from_pretrained(MODEL_ID);
      const model = await loadModel();

      return { processor, model };
    })().catch((error) => {
      loadPromise = null;
      throw error;
    });
  }

  return loadPromise;
}
