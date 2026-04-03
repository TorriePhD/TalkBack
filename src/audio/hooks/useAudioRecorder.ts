import { useCallback, useEffect, useRef, useState } from 'react';
import { getPreferredAudioMimeType } from '../mime';

interface UseAudioRecorderOptions {
  audioConstraints?: MediaTrackConstraints | boolean;
  prepareOnMount?: boolean;
  preparedStreamIdleMs?: number;
  highQualityMode?: boolean;
}

interface UseAudioRecorderResult {
  prepareRecording: () => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  isRecording: boolean;
  isPreparing: boolean;
  isPrepared: boolean;
  audioBlob: Blob | null;
  clearRecording: () => void;
  error: string | null;
  mimeType: string | null;
  liveStream: MediaStream | null;
  permissionState: MicrophonePermissionState;
}

type MicrophonePermissionState = PermissionState | 'unsupported' | 'unknown';

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function getMicrophoneBlockedMessage(permissionState: MicrophonePermissionState): string {
  if (!window.isSecureContext) {
    return 'Microphone access was blocked. Many browsers require HTTPS or localhost for recording.';
  }

  if (permissionState === 'denied') {
    return 'Microphone access is blocked for this site. Open browser site settings, allow Microphone, then try again.';
  }

  return 'Microphone access was blocked before the browser granted it. Check browser site permissions and try again.';
}

function toRecorderError(
  error: unknown,
  permissionState: MicrophonePermissionState = 'unknown',
): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return getMicrophoneBlockedMessage(permissionState);
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return 'No microphone was found on this device.';
      case 'NotReadableError':
      case 'TrackStartError':
        return 'The microphone is busy or could not be started.';
      default:
        return error.message || 'Unable to start audio recording.';
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unable to start audio recording.';
}

function getRecorderEnvironmentError() {
  if (typeof window === 'undefined') {
    return null;
  }

  if (!window.isSecureContext) {
    return 'Recording requires a secure context. localhost works, but a LAN URL like http://192.168.x.x:5173 does not. Serve the app over HTTPS to record from another device.';
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return 'Audio recording is unavailable because this browser did not expose getUserMedia for the current page.';
  }

  const hasMediaRecorder = typeof MediaRecorder !== 'undefined';
  const hasWebAudioCapture =
    typeof AudioContext !== 'undefined' || typeof (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext !== 'undefined';

  if (!hasMediaRecorder && !hasWebAudioCapture) {
    return 'Audio recording is unavailable in this browser.';
  }

  return null;
}

async function getMicrophonePermissionState(): Promise<MicrophonePermissionState> {
  if (typeof window === 'undefined' || !('permissions' in navigator) || !navigator.permissions) {
    return 'unsupported';
  }

  try {
    const status = await navigator.permissions.query({
      name: 'microphone' as PermissionName,
    });

    return status.state;
  } catch {
    return 'unknown';
  }
}

export function useAudioRecorder(
  options: UseAudioRecorderOptions = {},
): UseAudioRecorderResult {
  const {
    audioConstraints = true,
    prepareOnMount = false,
    preparedStreamIdleMs = 1500,
    highQualityMode = true,
  } = options;
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const pcmSampleRateRef = useRef<number>(48_000);
  const streamRef = useRef<MediaStream | null>(null);
  const idleReleaseTimeoutRef = useRef<number | null>(null);
  const preparePromiseRef = useRef<Promise<void> | null>(null);
  const prepareSequenceRef = useRef(0);
  const recordingSessionIdRef = useRef(0);
  const startSequenceRef = useRef(0);
  const isMountedRef = useRef(true);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isPrepared, setIsPrepared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  const [permissionState, setPermissionState] =
    useState<MicrophonePermissionState>('unknown');

  const refreshPermissionState = useCallback(async () => {
    const nextPermissionState = await getMicrophonePermissionState();
    if (isMountedRef.current) {
      setPermissionState(nextPermissionState);
    }
    return nextPermissionState;
  }, []);

  const clearRecording = useCallback(() => {
    setAudioBlob(null);
    setError(null);
  }, []);

  const clearIdleReleaseTimeout = useCallback(() => {
    if (typeof window === 'undefined' || idleReleaseTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(idleReleaseTimeoutRef.current);
    idleReleaseTimeoutRef.current = null;
  }, []);

  const stopRecording = useCallback(() => {
    startSequenceRef.current += 1;
    const workletNode = workletNodeRef.current;

    if (workletNode) {
      workletNode.port.postMessage({ type: 'stop' });
      setIsRecording(false);
      return;
    }

    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      return;
    }

    if (recorder.state === 'recording') {
      try {
        recorder.requestData();
      } catch {
        // Some browsers throw if requestData is called at an awkward time.
      }
    }

    recorder.stop();
  }, []);

  const releaseRecordingResources = useCallback(() => {
    clearIdleReleaseTimeout();
    recordingSessionIdRef.current += 1;
    workletNodeRef.current?.disconnect();
    sourceNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    sourceNodeRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {
        // Ignore close errors during cleanup.
      });
    }
    audioContextRef.current = null;
    pcmChunksRef.current = [];
    recorderRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    preparePromiseRef.current = null;

    if (isMountedRef.current) {
      setIsPrepared(false);
      setIsRecording(false);
      setIsPreparing(false);
      setLiveStream(null);
    }
  }, [clearIdleReleaseTimeout]);

  const schedulePreparedStreamRelease = useCallback(() => {
    clearIdleReleaseTimeout();

    if (typeof window === 'undefined' || preparedStreamIdleMs < 0 || !streamRef.current) {
      return;
    }

    idleReleaseTimeoutRef.current = window.setTimeout(() => {
      idleReleaseTimeoutRef.current = null;

      const recorder = recorderRef.current;
      if (recorder && recorder.state === 'recording') {
        return;
      }

      if (streamRef.current) {
        releaseRecordingResources();
      }
    }, preparedStreamIdleMs);
  }, [clearIdleReleaseTimeout, preparedStreamIdleMs, releaseRecordingResources]);

  const prepareRecording = useCallback(async () => {
    if (typeof window === 'undefined') {
      return;
    }

    const environmentError = getRecorderEnvironmentError();
    if (environmentError) {
      setError(environmentError);
      return;
    }

    if (streamRef.current) {
      setError(null);
      setIsPrepared(true);
      schedulePreparedStreamRelease();
      return;
    }

    if (preparePromiseRef.current) {
      await preparePromiseRef.current;
      return;
    }

    const sequenceId = ++prepareSequenceRef.current;

    const nextPromise = (async () => {
      setError(null);
      setIsPreparing(true);

      try {
        if (permissionState === 'denied') {
          throw new DOMException('Microphone permission denied.', 'NotAllowedError');
        }

        // Call getUserMedia immediately from the user-triggered path so mobile
        // browsers keep the permission prompt tied to the original gesture.
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
        });
        streamRef.current = stream;
        if (isMountedRef.current) {
          setLiveStream(stream);
          setPermissionState('granted');
        }
        schedulePreparedStreamRelease();

        if (isMountedRef.current) {
          setIsPrepared(true);
        }
      } catch (caughtError) {
        const nextPermissionState = await refreshPermissionState();
        if (isMountedRef.current) {
          setError(toRecorderError(caughtError, nextPermissionState));
        }
        releaseRecordingResources();
      } finally {
        if (prepareSequenceRef.current === sequenceId) {
          preparePromiseRef.current = null;
        }

        if (isMountedRef.current) {
          setIsPreparing(false);
        }
      }
    })();

    preparePromiseRef.current = nextPromise;
    await nextPromise;
  }, [
    audioConstraints,
    permissionState,
    refreshPermissionState,
    releaseRecordingResources,
    schedulePreparedStreamRelease,
  ]);

  const createRecorder = useCallback((stream: MediaStream) => {
    const preferredMimeType = getPreferredAudioMimeType();
    let recorder: MediaRecorder;

    try {
      recorder = new MediaRecorder(
        stream,
        preferredMimeType ? { mimeType: preferredMimeType } : undefined,
      );
    } catch (preferredMimeError) {
      if (!preferredMimeType) {
        throw preferredMimeError;
      }

      recorder = new MediaRecorder(stream);
    }

    const sessionId = ++recordingSessionIdRef.current;
    const sessionChunks: Blob[] = [];
    recorderRef.current = recorder;
    clearIdleReleaseTimeout();
    setMimeType(recorder.mimeType || preferredMimeType || null);

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) {
        sessionChunks.push(event.data);
      }
    });

    recorder.addEventListener('stop', () => {
      const blobType = recorder.mimeType || preferredMimeType || 'audio/webm';
      const nextBlob =
        sessionChunks.length > 0
          ? new Blob(sessionChunks, { type: blobType })
          : null;

      if (recordingSessionIdRef.current !== sessionId) {
        return;
      }

      if (isMountedRef.current) {
        const hasCapturedAudio = Boolean(nextBlob && nextBlob.size > 0);

        setAudioBlob(hasCapturedAudio ? nextBlob : null);
        setIsRecording(false);
        setError(
          hasCapturedAudio ? null : 'No audio was captured. Try recording again.',
        );
      }

      recorderRef.current = null;
      schedulePreparedStreamRelease();
    });

    recorder.addEventListener('error', (event) => {
      if (recordingSessionIdRef.current !== sessionId) {
        return;
      }

      const recorderError =
        'error' in event && event.error instanceof Error
          ? event.error.message
          : 'Recording failed.';

      if (isMountedRef.current) {
        setError(recorderError);
      }
      releaseRecordingResources();
    });

    return recorder;
  }, [clearIdleReleaseTimeout, releaseRecordingResources, schedulePreparedStreamRelease]);

  const createWavBlobFromPcm = useCallback((pcmChunks: Float32Array[], sampleRate: number) => {
    const sampleCount = pcmChunks.reduce((total, chunk) => total + chunk.length, 0);
    if (sampleCount <= 0) {
      return null;
    }

    const pcm16 = new Int16Array(sampleCount);
    let offset = 0;
    for (const chunk of pcmChunks) {
      for (let index = 0; index < chunk.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, chunk[index]));
        pcm16[offset] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
        offset += 1;
      }
    }

    const dataBytes = pcm16.length * 2;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);
    const writeString = (byteOffset: number, value: string) => {
      for (let i = 0; i < value.length; i += 1) {
        view.setUint8(byteOffset + i, value.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataBytes, true);

    let pcmByteOffset = 44;
    for (let i = 0; i < pcm16.length; i += 1) {
      view.setInt16(pcmByteOffset, pcm16[i], true);
      pcmByteOffset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }, []);

  const createHighQualityRecorder = useCallback(async (stream: MediaStream) => {
    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor || typeof AudioWorkletNode === 'undefined') {
      return null;
    }

    const context = new AudioContextCtor();
    await context.audioWorklet.addModule(
      new URL('../worklets/pcmCaptureProcessor.js', import.meta.url),
    );

    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, 'pcm-capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
    });

    const silenceGain = context.createGain();
    silenceGain.gain.value = 0;

    source.connect(node);
    node.connect(silenceGain);
    silenceGain.connect(context.destination);

    const sessionId = ++recordingSessionIdRef.current;
    pcmChunksRef.current = [];
    pcmSampleRateRef.current = context.sampleRate;
    audioContextRef.current = context;
    sourceNodeRef.current = source;
    workletNodeRef.current = node;
    clearIdleReleaseTimeout();
    setMimeType('audio/wav');

    node.port.onmessage = (event: MessageEvent<{ type: string; samples?: Float32Array }>) => {
      if (recordingSessionIdRef.current !== sessionId) {
        return;
      }

      if (event.data.type === 'data' && event.data.samples?.length) {
        pcmChunksRef.current.push(event.data.samples);
        return;
      }

      if (event.data.type !== 'stopped') {
        return;
      }

      const blob = createWavBlobFromPcm(pcmChunksRef.current, pcmSampleRateRef.current);
      if (isMountedRef.current) {
        const hasCapturedAudio = Boolean(blob && blob.size > 44);
        setAudioBlob(hasCapturedAudio ? blob : null);
        setIsRecording(false);
        setError(hasCapturedAudio ? null : 'No audio was captured. Try recording again.');
      }

      workletNodeRef.current = null;
      sourceNodeRef.current = null;
      node.disconnect();
      source.disconnect();
      void context.close().catch(() => {
        // Ignore close errors; cleanup can race during teardown.
      });
      audioContextRef.current = null;
      schedulePreparedStreamRelease();
    };

    return node;
  }, [clearIdleReleaseTimeout, createWavBlobFromPcm, schedulePreparedStreamRelease]);

  const startRecording = useCallback(async () => {
    if (typeof window === 'undefined') {
      return;
    }

    const environmentError = getRecorderEnvironmentError();
    if (environmentError) {
      setError(environmentError);
      return;
    }

    if (recorderRef.current && recorderRef.current.state === 'recording') {
      return;
    }

    const startSequenceId = ++startSequenceRef.current;

    setError(null);
    setAudioBlob(null);

    if (!streamRef.current) {
      await prepareRecording();
    } else if (preparePromiseRef.current) {
      await preparePromiseRef.current;
    }

    const stream = streamRef.current;
    if (!stream || startSequenceRef.current !== startSequenceId) {
      return;
    }

    try {
      if (highQualityMode) {
        const worklet = await createHighQualityRecorder(stream);
        if (worklet) {
          worklet.port.postMessage({ type: 'start' });
          if (isMountedRef.current) {
            setIsRecording(true);
          }
          return;
        }
      }

      const recorder = createRecorder(stream);
      recorder.start(250);

      if (startSequenceRef.current !== startSequenceId) {
        try {
          recorder.stop();
        } catch {
          // Ignore cleanup errors after a canceled start.
        }
        return;
      }

      if (isMountedRef.current) {
        setIsRecording(true);
      }
    } catch (caughtError) {
      setError(toRecorderError(caughtError));
      releaseRecordingResources();
    }
  }, [createHighQualityRecorder, createRecorder, highQualityMode, prepareRecording, releaseRecordingResources]);

  useEffect(() => {
    // Strict Mode remounts this hook in development, so mount state must reset on setup.
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;

      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }

      releaseRecordingResources();
    };
  }, [releaseRecordingResources]);

  useEffect(() => {
    let cancelled = false;
    let permissionStatus: PermissionStatus | null = null;
    let removeChangeListener: (() => void) | null = null;

    void (async () => {
      const currentPermissionState = await refreshPermissionState();
      if (!cancelled && isMountedRef.current) {
        setPermissionState(currentPermissionState);
      }

      if (
        typeof window === 'undefined' ||
        !('permissions' in navigator) ||
        !navigator.permissions
      ) {
        return;
      }

      try {
        permissionStatus = await navigator.permissions.query({
          name: 'microphone' as PermissionName,
        });
      } catch {
        return;
      }

      const handlePermissionChange = () => {
        if (!isMountedRef.current) {
          return;
        }

        setPermissionState(permissionStatus?.state ?? 'unknown');
      };

      if (typeof permissionStatus.addEventListener === 'function') {
        permissionStatus.addEventListener('change', handlePermissionChange);
        removeChangeListener = () => {
          permissionStatus?.removeEventListener('change', handlePermissionChange);
        };
        return;
      }

      permissionStatus.onchange = handlePermissionChange;
      removeChangeListener = () => {
        if (permissionStatus) {
          permissionStatus.onchange = null;
        }
      };
    })();

    return () => {
      cancelled = true;
      removeChangeListener?.();
    };
  }, [refreshPermissionState]);

  useEffect(() => {
    if (!prepareOnMount) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const permissionState = await getMicrophonePermissionState();
      if (cancelled || permissionState !== 'granted') {
        return;
      }

      await prepareRecording();
    })();

    return () => {
      cancelled = true;
    };
  }, [prepareOnMount, prepareRecording]);

  return {
    prepareRecording,
    startRecording,
    stopRecording,
    isRecording,
    isPreparing,
    isPrepared,
    audioBlob,
    clearRecording,
    error,
    mimeType,
    liveStream,
    permissionState,
  };
}
