import { env, pipeline } from '@huggingface/transformers';

/**
 * Whisper transcription, in a separate thread: the model keeps the CPU busy
 * for several seconds, and the interface must stay responsive. Nothing leaves
 * the machine - neither the audio nor the text.
 */

// No point looking for a model on our own server before downloading it
env.allowLocalModels = false;

/**
 * The ONNX engine (WebAssembly) is served by the application itself: the
 * bundler emits these files as static assets, instead of the jsdelivr
 * CDN chosen by default by the library (which the CSP does not allow).
 * The Blob cache is disabled for the same reason: it would import the
 * script from a `blob:` URL, rejected by `script-src`.
 * The non-asyncify variant is only used for Safari versions before 26
 * without WebGPU, as the library does.
 */
const legacySafari = (() => {
  const agent = self.navigator.userAgent;
  if (!/Safari\//.test(agent) || /Chrom(e|ium)|Edg\//.test(agent)) return false;
  const version = Number(/Version\/(\d+)/.exec(agent)?.[1] ?? 0);
  return version > 0 && version < 26 && !(self.navigator as { gpu?: unknown }).gpu;
})();
env.useWasmCache = false;
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown } };
if (onnx.wasm) {
  onnx.wasm.wasmPaths = legacySafari
    ? {
        mjs: new URL('onnxruntime-web/ort-wasm-simd-threaded.mjs', import.meta.url).href,
        wasm: new URL('onnxruntime-web/ort-wasm-simd-threaded.wasm', import.meta.url).href,
      }
    : {
        mjs: new URL('onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href,
        wasm: new URL('onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href,
      };
}

/**
 * Two quality levels, chosen according to the machine. Measured on a twelve-second
 * business sentence: "base" gets trade words wrong (« le devine numéro »),
 * "small" stays approximate, "large-v3-turbo" transcribes without a single mistake.
 * Turbo is therefore only picked if the GPU can run it - on the CPU alone, it
 * would take more than a minute and be pointless.
 */
const ACCURATE_MODEL = 'onnx-community/whisper-large-v3-turbo';
const FAST_MODEL = 'onnx-community/whisper-small';

type Transcriber = (
  audio: Float32Array,
  options: { language: string; task: string; chunk_length_s: number; stride_length_s: number },
) => Promise<{ text: string }>;

let transcriber: Promise<Transcriber> | null = null;

/**
 * Download progress. The library reports **file by
 * file**: following the last event would reset the percentage to zero
 * on each new file. So the bytes are summed to show a
 * single progress, the one the user expects.
 */
const files = new Map<string, { loaded: number; total: number }>();

const trackProgress = (progress: { status: string; file?: string; loaded?: number; total?: number }) => {
  if (progress.status !== 'progress' || !progress.file || !progress.total) return;
  files.set(progress.file, { loaded: progress.loaded ?? 0, total: progress.total });

  let loaded = 0;
  let total = 0;
  for (const file of files.values()) {
    loaded += file.loaded;
    total += file.total;
  }
  if (!total) return;
  // Capped at 99: 100% is announced by the `ready` message
  self.postMessage({
    type: 'loading',
    percent: Math.min(99, Math.round((loaded / total) * 100)),
  });
};

/**
 * The GPU cuts transcription time, but its mere presence in
 * the API guarantees nothing: an adapter must be obtained to know
 * whether it is actually usable. Failing that, computation runs in WASM - slower,
 * but available in all targeted browsers.
 */
async function hasUsableGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return Boolean(await gpu?.requestAdapter());
  } catch {
    return false;
  }
}

async function build(): Promise<Transcriber> {
  if (await hasUsableGpu()) {
    try {
      self.postMessage({ type: 'quality', accurate: true });
      return (await pipeline('automatic-speech-recognition', ACCURATE_MODEL, {
        device: 'webgpu',
        dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' },
        progress_callback: trackProgress,
      })) as unknown as Transcriber;
    } catch (error) {
      // An advertised but unusable GPU must not doom dictation
      self.postMessage({
        type: 'fallback',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  /**
   * Without a GPU, fall back to the intermediate model: the large model
   * would take more than a minute for twelve seconds of speech.
   * 4-bit quantization is used everywhere - 8-bit breaks session
   * creation in the current ONNX engine version, verified on both
   * public repositories.
   */
  self.postMessage({ type: 'quality', accurate: false });
  return (await pipeline('automatic-speech-recognition', FAST_MODEL, {
    device: 'wasm',
    dtype: 'q4',
    progress_callback: trackProgress,
  })) as unknown as Transcriber;
}

function load(): Promise<Transcriber> {
  transcriber ??= build().then((ready) => {
    self.postMessage({ type: 'ready' });
    return ready;
  });
  return transcriber;
}

/**
 * One transcription at a time. Since the message handler is asynchronous,
 * two close requests - the live preview and the final transcription -
 * ran concurrently on the same model: decoding states got
 * mixed up and results came back out of order, making
 * an already spoken sentence reappear. The queue restores order.
 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

self.onmessage = async (
  event: MessageEvent<{ id?: number; audio?: Float32Array; preload?: boolean }>,
) => {
  // Preload: the model starts up while the user is speaking,
  // instead of being requested only at the first transcription.
  if (event.data.preload) {
    await load().catch((error: unknown) => {
      self.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return;
  }

  // Transcription language: the interface one (ISO 639-1 code, "fr" by default)
  const { id, audio, language } = event.data as { id: number; audio: Float32Array; language?: string };
  await enqueue(async () => {
    try {
      const transcribe = await load();
      // Whisper only handles thirty seconds at a time: beyond that, without chunking,
      // it starts repeating itself. The overlap avoids cutting a word.
      const output = await transcribe(audio, {
        language: language ?? 'fr',
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      self.postMessage({ type: 'text', id, text: output.text.trim() });
    } catch (error) {
      self.postMessage({
        type: 'error',
        id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
};
