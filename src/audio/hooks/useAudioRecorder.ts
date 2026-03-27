import { useCallback, useEffect, useRef, useState } from 'react';
import { getPreferredAudioMimeType } from '../mime';

interface UseAudioRecorderOptions {
  prepareOnMount?: boolean;
  preparedStreamIdleMs?: number;
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
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function toRecorderError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return window.isSecureContext
          ? 'Microphone access was blocked. Check browser permissions and try again.'
          : 'Microphone access was blocked. Many browsers require HTTPS or localhost for recording.';
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

  if (typeof MediaRecorder === 'undefined') {
    return 'MediaRecorder is not available in this browser.';
  }

  return null;
}

async function getMicrophonePermissionState(): Promise<PermissionState | null> {
  if (typeof window === 'undefined' || !('permissions' in navigator) || !navigator.permissions) {
    return null;
  }

  try {
    const status = await navigator.permissions.query({
      name: 'microphone' as PermissionName,
    });

    return status.state;
  } catch {
    return null;
  }
}

export function useAudioRecorder(
  options: UseAudioRecorderOptions = {},
): UseAudioRecorderResult {
  const { prepareOnMount = false, preparedStreamIdleMs = 1500 } = options;
  const recorderRef = useRef<MediaRecorder | null>(null);
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
    recorderRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    setLiveStream(null);
    preparePromiseRef.current = null;

    if (isMountedRef.current) {
      setIsPrepared(false);
      setIsRecording(false);
      setIsPreparing(false);
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
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        setLiveStream(stream);
        schedulePreparedStreamRelease();

        if (isMountedRef.current) {
          setIsPrepared(true);
        }
      } catch (caughtError) {
        if (isMountedRef.current) {
          setError(toRecorderError(caughtError));
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
  }, [releaseRecordingResources, schedulePreparedStreamRelease]);

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
  }, [createRecorder, prepareRecording, releaseRecordingResources]);

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
  };
}
