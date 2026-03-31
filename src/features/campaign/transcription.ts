import type { AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

const WHISPER_MODEL_ID = 'Xenova/whisper-tiny.en';
const DEBUG_PREFIX = '[Campaign][ASR]';
const TARGET_SAMPLE_RATE = 16_000;

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function debugLog(message: string, details?: unknown) {
  if (details === undefined) {
    console.debug(`${DEBUG_PREFIX} ${message}`);
    return;
  }

  console.debug(`${DEBUG_PREFIX} ${message}`, details);
}

function normalizeTranscriptText(text: string) {
  return text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function extractTranscriptionText(output: unknown) {
  if (Array.isArray(output)) {
    return normalizeTranscriptText(
      output
        .map((entry) =>
          typeof entry === 'object' && entry && 'text' in entry
            ? String((entry as { text?: unknown }).text ?? '')
            : '',
        )
        .join(' '),
    );
  }

  if (typeof output === 'object' && output && 'text' in output) {
    return normalizeTranscriptText(String((output as { text?: unknown }).text ?? ''));
  }

  return '';
}

async function decodeAudioBlob(blob: Blob) {
  const AudioContextCtor =
    typeof window !== 'undefined'
      ? (window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;

  if (!AudioContextCtor) {
    throw new Error('AudioContext is not available in this browser.');
  }

  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContextCtor();

  try {
    return await audioContext.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    void audioContext.close();
  }
}

function mixToMono(audioBuffer: AudioBuffer) {
  const { numberOfChannels, length } = audioBuffer;

  if (numberOfChannels === 1) {
    return new Float32Array(audioBuffer.getChannelData(0));
  }

  const mono = new Float32Array(length);

  for (let channelIndex = 0; channelIndex < numberOfChannels; channelIndex += 1) {
    const channelData = audioBuffer.getChannelData(channelIndex);
    for (let frameIndex = 0; frameIndex < length; frameIndex += 1) {
      mono[frameIndex] += channelData[frameIndex] ?? 0;
    }
  }

  const scale = 1 / numberOfChannels;
  for (let frameIndex = 0; frameIndex < length; frameIndex += 1) {
    mono[frameIndex] *= scale;
  }

  return mono;
}

function resampleFloat32Linear(samples: Float32Array, sourceSampleRate: number, targetSampleRate: number) {
  if (sourceSampleRate === targetSampleRate) {
    return samples;
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const targetLength = Math.max(1, Math.round(samples.length / ratio));
  const output = new Float32Array(targetLength);

  for (let index = 0; index < targetLength; index += 1) {
    const sourceIndex = index * ratio;
    const sourceFloor = Math.floor(sourceIndex);
    const sourceCeil = Math.min(sourceFloor + 1, samples.length - 1);
    const interpolation = sourceIndex - sourceFloor;
    output[index] =
      (samples[sourceFloor] ?? 0) * (1 - interpolation) + (samples[sourceCeil] ?? 0) * interpolation;
  }

  return output;
}

async function normalizeAudioForWhisper(blob: Blob) {
  const audioBuffer = await decodeAudioBlob(blob);
  const mono = mixToMono(audioBuffer);
  const resampled = resampleFloat32Linear(mono, audioBuffer.sampleRate, TARGET_SAMPLE_RATE);

  debugLog('Normalized audio for Whisper.', {
    sourceChannels: audioBuffer.numberOfChannels,
    sourceSampleRate: audioBuffer.sampleRate,
    sourceFrames: audioBuffer.length,
    outputSampleRate: TARGET_SAMPLE_RATE,
    outputFrames: resampled.length,
  });

  return resampled;
}

async function loadWhisperTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      const startedAt = performance.now();
      debugLog(`Loading Whisper pipeline for model ${WHISPER_MODEL_ID}.`);
      const { env, pipeline } = await import('@huggingface/transformers');

      env.allowLocalModels = false;

      const transcriber = await pipeline('automatic-speech-recognition', WHISPER_MODEL_ID, {
        dtype: 'q8',
        progress_callback: (progress: unknown) => {
          debugLog('Model progress update.', progress);
        },
      });

      debugLog(`Whisper pipeline ready in ${Math.round(performance.now() - startedAt)}ms.`);
      return transcriber;
    })().catch((error) => {
      console.error(`${DEBUG_PREFIX} Whisper pipeline failed to load.`, error);
      transcriberPromise = null;
      throw error;
    });
  } else {
    debugLog('Reusing existing Whisper pipeline promise.');
  }

  return transcriberPromise;
}

type BrowserSpeechRecognition = {
  abort?: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult:
    | ((event: { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void)
    | null;
  start: () => void;
  stop: () => void;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const recognitionWindow = window as Window & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };

  return recognitionWindow.SpeechRecognition ?? recognitionWindow.webkitSpeechRecognition ?? null;
}

async function transcribeWithSpeechRecognition(blob: Blob) {
  const SpeechRecognition = getSpeechRecognitionConstructor();
  debugLog('Falling back to browser speech recognition.', {
    blobSize: blob.size,
    blobType: blob.type,
  });

  if (!SpeechRecognition || typeof window === 'undefined') {
    throw new Error('Browser speech recognition is not available.');
  }

  return new Promise<string>((resolve, reject) => {
    const recognition = new SpeechRecognition();
    const objectUrl = window.URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);
    let hasSettled = false;
    let stopTimeoutId: number | null = null;
    let resolveTimeoutId: number | null = null;

    const cleanup = () => {
      if (stopTimeoutId !== null) {
        window.clearTimeout(stopTimeoutId);
      }

      if (resolveTimeoutId !== null) {
        window.clearTimeout(resolveTimeoutId);
      }

      audio.pause();
      audio.src = '';
      window.URL.revokeObjectURL(objectUrl);
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
    };

    const finish = (value: string, error?: Error) => {
      if (hasSettled) {
        return;
      }

      hasSettled = true;
      cleanup();

      if (error) {
        reject(error);
        return;
      }

      resolve(normalizeTranscriptText(value));
    };

    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results ?? [])
        .map((entry) => entry[0]?.transcript ?? '')
        .join(' ');
      debugLog('Browser speech recognition produced a transcript.', { transcript });
      finish(transcript);
    };

    recognition.onerror = (event) => {
      console.error(`${DEBUG_PREFIX} Browser speech recognition failed.`, event);
      finish(
        '',
        new Error(
          event.error
            ? `Browser speech recognition failed: ${event.error}`
            : 'Browser speech recognition failed.',
        ),
      );
    };

    recognition.onend = () => {
      debugLog('Browser speech recognition ended.');
      finish('');
    };

    audio.addEventListener(
      'ended',
      () => {
        stopTimeoutId = window.setTimeout(() => {
          try {
            recognition.stop();
          } catch {
            finish('');
          }
        }, 280);
      },
      { once: true },
    );

    resolveTimeoutId = window.setTimeout(() => {
      try {
        recognition.stop();
      } catch {
        finish('');
      }
    }, 10_000);

    try {
      debugLog('Starting browser speech recognition.');
      recognition.start();
    } catch (error) {
      finish(
        '',
        error instanceof Error
          ? error
          : new Error('Browser speech recognition could not start.'),
      );
      return;
    }

    window.setTimeout(() => {
      debugLog('Playing reversed attempt into browser speech recognition.');
      void audio.play().catch((error) => {
        try {
          recognition.abort?.();
        } catch {
          // Ignore abort cleanup failures.
        }

        finish(
          '',
          error instanceof Error ? error : new Error('Playback failed during speech recognition.'),
        );
      });
    }, 140);
  });
}

export async function warmCampaignTranscriber() {
  debugLog('Warm-up requested.');
  await loadWhisperTranscriber();
}

export async function transcribeAudio(blob: Blob) {
  const startedAt = performance.now();
  debugLog('Transcription requested.', {
    blobSize: blob.size,
    blobType: blob.type,
  });

  try {
    const transcriber = await loadWhisperTranscriber();
    const normalizedAudio = await normalizeAudioForWhisper(blob);

    debugLog('Invoking Whisper transcription with mono float32 PCM audio.');
    const output = await transcriber(normalizedAudio, {
      chunk_length_s: 10,
      stride_length_s: 2,
      return_timestamps: false,
    });
    const transcript = extractTranscriptionText(output);
    debugLog(`Whisper transcription completed in ${Math.round(performance.now() - startedAt)}ms.`, {
      transcript,
    });

    if (transcript) {
      return transcript;
    }
  } catch (error) {
    console.warn(`${DEBUG_PREFIX} Whisper transcription failed, falling back to browser speech recognition.`, error);
  }

  return transcribeWithSpeechRecognition(blob);
}
