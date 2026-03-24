import { useCallback, useEffect, useRef, useState } from 'react';

type UseAudioRecorderResult = {
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  isRecording: boolean;
  audioBlob: Blob | null;
};

const MIME_TYPE = 'audio/webm';

export function useAudioRecorder(): UseAudioRecorderResult {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

  const startRecording = useCallback(async () => {
    if (isRecording) {
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;

    const mediaRecorder = new MediaRecorder(stream, { mimeType: MIME_TYPE });
    mediaRecorderRef.current = mediaRecorder;
    chunksRef.current = [];

    mediaRecorder.addEventListener('dataavailable', (event: BlobEvent) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    });

    mediaRecorder.addEventListener('stop', () => {
      const blob = new Blob(chunksRef.current, { type: MIME_TYPE });
      setAudioBlob(blob);
      chunksRef.current = [];

      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
      setIsRecording(false);
    });

    mediaRecorder.start();
    setAudioBlob(null);
    setIsRecording(true);
  }, [isRecording]);

  const stopRecording = useCallback(() => {
    const mediaRecorder = mediaRecorderRef.current;
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      return;
    }

    mediaRecorder.stop();
  }, []);

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return {
    startRecording,
    stopRecording,
    isRecording,
    audioBlob,
  };
}
