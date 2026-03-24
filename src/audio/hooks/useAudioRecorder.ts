import { useCallback, useEffect, useRef, useState } from 'react';
import { getPreferredAudioMimeType } from '../mime';

interface UseAudioRecorderResult {
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  isRecording: boolean;
  isPreparing: boolean;
  audioBlob: Blob | null;
  clearRecording: () => void;
  error: string | null;
  mimeType: string | null;
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

export function useAudioRecorder(): UseAudioRecorderResult {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string | null>(null);

  const clearRecording = useCallback(() => {
    setAudioBlob(null);
    setError(null);
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      return;
    }

    recorder.stop();
  }, []);

  const startRecording = useCallback(async () => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!window.isSecureContext) {
      setError(
        'Recording requires a secure context. localhost works, but a LAN URL like http://192.168.x.x:5173 does not. Serve the app over HTTPS to record from another device.',
      );
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        'Audio recording is unavailable because this browser did not expose getUserMedia for the current page.',
      );
      return;
    }

    if (typeof MediaRecorder === 'undefined') {
      setError('MediaRecorder is not available in this browser.');
      return;
    }

    if (isRecording || isPreparing) {
      return;
    }

    setError(null);
    setAudioBlob(null);
    setIsPreparing(true);

    let stream: MediaStream | null = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const preferredMimeType = getPreferredAudioMimeType();
      const recorder = new MediaRecorder(
        stream,
        preferredMimeType ? { mimeType: preferredMimeType } : undefined,
      );

      chunksRef.current = [];
      recorderRef.current = recorder;
      setMimeType(recorder.mimeType || preferredMimeType || null);

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener('stop', () => {
        const blobType = recorder.mimeType || preferredMimeType || 'audio/webm';
        const nextBlob =
          chunksRef.current.length > 0
            ? new Blob(chunksRef.current, { type: blobType })
            : null;

        setAudioBlob(nextBlob);
        setIsRecording(false);
        setIsPreparing(false);
        chunksRef.current = [];
        recorderRef.current = null;
        stopStream(streamRef.current);
        streamRef.current = null;
      });

      recorder.addEventListener('error', (event) => {
        const recorderError =
          'error' in event && event.error instanceof Error
            ? event.error.message
            : 'Recording failed.';

        setError(recorderError);
        setIsRecording(false);
        setIsPreparing(false);
        recorderRef.current = null;
        chunksRef.current = [];
        stopStream(streamRef.current);
        streamRef.current = null;
      });

      recorder.start();
      setIsRecording(true);
      setIsPreparing(false);
    } catch (caughtError) {
      setError(toRecorderError(caughtError));
      setIsRecording(false);
      setIsPreparing(false);
      recorderRef.current = null;
      chunksRef.current = [];
      stopStream(stream ?? streamRef.current);
      streamRef.current = null;
    }
  }, [isPreparing, isRecording]);

  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }

      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  return {
    startRecording,
    stopRecording,
    isRecording,
    isPreparing,
    audioBlob,
    clearRecording,
    error,
    mimeType,
  };
}
