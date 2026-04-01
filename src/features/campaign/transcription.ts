import type { AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

const WHISPER_MODEL_ID = 'Xenova/whisper-tiny.en';
const DEBUG_PREFIX = '[Campaign][ASR]';
const TARGET_SAMPLE_RATE = 16_000;
const CAMPAIGN_ASR_LANGUAGE = 'english';
const CAMPAIGN_ASR_TASK = 'transcribe';
const WHISPER_IS_ENGLISH_ONLY = WHISPER_MODEL_ID.endsWith('.en');
const TARGET_PEAK_LEVEL = 0.92;
const SILENCE_TRIM_FLOOR = 0.003;
const SILENCE_TRIM_RATIO = 0.08;
const SILENCE_TRIM_PADDING_MS = 120;
const MIN_TRIMMED_AUDIO_MS = 250;

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

function sanitizeTranscriptText(text: string) {
  const normalized = normalizeTranscriptText(text);

  if (!normalized || isAnnotationTranscript(normalized)) {
    return '';
  }

  return normalized;
}

function isAnnotationTranscript(text: string) {
  const normalized = normalizeTranscriptText(text);

  if (!normalized) {
    return false;
  }

  return (
    /^\[[^\]]+\]$/i.test(normalized) ||
    /^\([^)]+\)$/i.test(normalized) ||
    /\bspeaking in foreign language\b/i.test(normalized) ||
    /\b(music|applause|silence)\b/i.test(normalized)
  );
}

function extractTranscriptionText(output: unknown) {
  if (typeof output === 'string') {
    return sanitizeTranscriptText(output);
  }

  if (Array.isArray(output)) {
    return sanitizeTranscriptText(
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
    return sanitizeTranscriptText(String((output as { text?: unknown }).text ?? ''));
  }

  return '';
}

function getPeakLevel(samples: Float32Array) {
  let peak = 0;

  for (let index = 0; index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(samples[index] ?? 0));
  }

  return peak;
}

function trimSilentEdges(samples: Float32Array, sampleRate: number) {
  const peak = getPeakLevel(samples);

  if (peak <= 0) {
    return {
      samples,
      trimmed: false,
      threshold: 0,
      startFrame: 0,
      endFrame: samples.length,
    };
  }

  const threshold = Math.max(SILENCE_TRIM_FLOOR, peak * SILENCE_TRIM_RATIO);
  let startFrame = 0;
  let endFrame = samples.length - 1;

  while (startFrame < samples.length && Math.abs(samples[startFrame] ?? 0) < threshold) {
    startFrame += 1;
  }

  while (endFrame >= startFrame && Math.abs(samples[endFrame] ?? 0) < threshold) {
    endFrame -= 1;
  }

  if (startFrame === 0 && endFrame === samples.length - 1) {
    return {
      samples,
      trimmed: false,
      threshold,
      startFrame: 0,
      endFrame: samples.length,
    };
  }

  const paddingFrames = Math.round((sampleRate * SILENCE_TRIM_PADDING_MS) / 1000);
  const paddedStartFrame = Math.max(0, startFrame - paddingFrames);
  const paddedEndFrame = Math.min(samples.length, endFrame + paddingFrames + 1);
  const trimmedSamples = samples.slice(paddedStartFrame, paddedEndFrame);
  const minimumLength = Math.round((sampleRate * MIN_TRIMMED_AUDIO_MS) / 1000);

  if (trimmedSamples.length < minimumLength) {
    return {
      samples,
      trimmed: false,
      threshold,
      startFrame: 0,
      endFrame: samples.length,
    };
  }

  return {
    samples: trimmedSamples,
    trimmed: true,
    threshold,
    startFrame: paddedStartFrame,
    endFrame: paddedEndFrame,
  };
}

function normalizePeakLevel(samples: Float32Array) {
  const peak = getPeakLevel(samples);

  if (peak <= 0 || peak >= TARGET_PEAK_LEVEL) {
    return {
      samples,
      originalPeak: peak,
      appliedGain: 1,
    };
  }

  const gain = TARGET_PEAK_LEVEL / peak;
  const leveledSamples = new Float32Array(samples.length);

  for (let index = 0; index < samples.length; index += 1) {
    const nextValue = (samples[index] ?? 0) * gain;
    leveledSamples[index] = Math.max(-1, Math.min(1, nextValue));
  }

  return {
    samples: leveledSamples,
    originalPeak: peak,
    appliedGain: gain,
  };
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

async function normalizeAudioForWhisper(
  blob: Blob,
  options: {
    trimSilence?: boolean;
  } = {},
) {
  const audioBuffer = await decodeAudioBlob(blob);
  const mono = mixToMono(audioBuffer);
  const trimmedAudio = options.trimSilence ? trimSilentEdges(mono, audioBuffer.sampleRate) : null;
  const speechFocusedSamples = trimmedAudio?.samples ?? mono;
  const leveledAudio = normalizePeakLevel(speechFocusedSamples);
  const resampled = resampleFloat32Linear(
    leveledAudio.samples,
    audioBuffer.sampleRate,
    TARGET_SAMPLE_RATE,
  );

  debugLog('Normalized audio for Whisper.', {
    sourceChannels: audioBuffer.numberOfChannels,
    sourceSampleRate: audioBuffer.sampleRate,
    sourceFrames: audioBuffer.length,
    trimSilence: options.trimSilence ?? false,
    trimApplied: trimmedAudio?.trimmed ?? false,
    trimThreshold: trimmedAudio?.threshold ?? null,
    trimStartFrame: trimmedAudio?.startFrame ?? 0,
    trimEndFrame: trimmedAudio?.endFrame ?? mono.length,
    leveledPeak: leveledAudio.originalPeak,
    appliedGain: leveledAudio.appliedGain,
    outputSampleRate: TARGET_SAMPLE_RATE,
    outputFrames: resampled.length,
    whisperLanguage: WHISPER_IS_ENGLISH_ONLY ? null : CAMPAIGN_ASR_LANGUAGE,
    whisperTask: WHISPER_IS_ENGLISH_ONLY ? null : CAMPAIGN_ASR_TASK,
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

      resolve(sanitizeTranscriptText(value));
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
      debugLog('Playing reversed imitation into browser speech recognition.');
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

async function transcribeWithWhisper(
  blob: Blob,
  options: {
    attemptLabel: string;
    chunkLengthS?: number;
    strideLengthS?: number;
    trimSilence?: boolean;
  },
) {
  const transcriber = await loadWhisperTranscriber();
  const normalizedAudio = await normalizeAudioForWhisper(blob, {
    trimSilence: options.trimSilence,
  });
  const generationOptions = {
    return_timestamps: false,
    ...(options.chunkLengthS && options.chunkLengthS > 0
      ? {
          chunk_length_s: options.chunkLengthS,
          stride_length_s: options.strideLengthS ?? 2,
        }
      : {}),
    ...(WHISPER_IS_ENGLISH_ONLY
      ? {}
      : {
          language: CAMPAIGN_ASR_LANGUAGE,
          task: CAMPAIGN_ASR_TASK,
        }),
  };

  debugLog('Invoking Whisper transcription with mono float32 PCM audio.', {
    attemptLabel: options.attemptLabel,
    trimSilence: options.trimSilence ?? false,
    generationOptions,
  });

  const output = await transcriber(normalizedAudio, generationOptions);
  const transcript = extractTranscriptionText(output);

  debugLog('Whisper transcription attempt completed.', {
    attemptLabel: options.attemptLabel,
    transcript,
    rawOutput: transcript ? undefined : output,
  });

  return transcript;
}

export async function transcribeAudio(blob: Blob) {
  const startedAt = performance.now();
  debugLog('Transcription requested.', {
    blobSize: blob.size,
    blobType: blob.type,
  });

  try {
    const primaryTranscript = await transcribeWithWhisper(blob, {
      attemptLabel: 'primary',
      chunkLengthS: 10,
      strideLengthS: 2,
    });

    if (primaryTranscript) {
      debugLog(
        `Whisper transcription completed in ${Math.round(performance.now() - startedAt)}ms.`,
        {
          transcript: primaryTranscript,
          attemptLabel: 'primary',
        },
      );
      return primaryTranscript;
    }

    debugLog('Primary Whisper transcription returned no transcript. Retrying with trimmed audio.');
    const trimmedRetryTranscript = await transcribeWithWhisper(blob, {
      attemptLabel: 'trimmed-retry',
      trimSilence: true,
    });

    if (trimmedRetryTranscript) {
      debugLog(
        `Whisper transcription recovered on trimmed retry in ${Math.round(performance.now() - startedAt)}ms.`,
        {
          transcript: trimmedRetryTranscript,
          attemptLabel: 'trimmed-retry',
        },
      );
      return trimmedRetryTranscript;
    }

    throw new Error('Whisper returned an empty transcript.');
  } catch (error) {
    console.warn(`${DEBUG_PREFIX} Whisper transcription failed, attempting browser fallback.`, error);
    try {
      const transcript = await transcribeWithSpeechRecognition(blob);
      debugLog(
        `Browser fallback transcription completed in ${Math.round(performance.now() - startedAt)}ms.`,
        {
          transcript,
        },
      );
      return transcript;
    } catch (fallbackError) {
      console.error(`${DEBUG_PREFIX} Browser fallback also failed.`, fallbackError);
      throw error instanceof Error ? error : new Error('Campaign speech recognition failed.');
    }
  }
}
