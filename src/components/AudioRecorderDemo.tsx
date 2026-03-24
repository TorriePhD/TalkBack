import { useEffect, useRef, useState } from 'react';

import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { reverseAudioBlob } from '../utils/reverseAudioBlob';

const AUTO_RECORDING_MS = 3000;

export function AudioRecorderDemo() {
  const { startRecording, stopRecording, isRecording, audioBlob } = useAudioRecorder();
  const [isReverseFlowPending, setIsReverseFlowPending] = useState(false);
  const playbackUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!audioBlob) {
      return;
    }

    console.log('Recorded blob size:', audioBlob.size, 'bytes');
  }, [audioBlob]);

  useEffect(() => {
    if (!audioBlob || !isReverseFlowPending) {
      return;
    }

    const runReversePlayback = async () => {
      const reversedBlob = await reverseAudioBlob(audioBlob);
      const reversedUrl = URL.createObjectURL(reversedBlob);

      if (playbackUrlRef.current) {
        URL.revokeObjectURL(playbackUrlRef.current);
      }
      playbackUrlRef.current = reversedUrl;

      const audio = new Audio(reversedUrl);
      await audio.play();
      setIsReverseFlowPending(false);
    };

    runReversePlayback().catch((error) => {
      console.error('Failed to reverse or play audio:', error);
      setIsReverseFlowPending(false);
    });
  }, [audioBlob, isReverseFlowPending]);

  useEffect(() => {
    return () => {
      if (playbackUrlRef.current) {
        URL.revokeObjectURL(playbackUrlRef.current);
      }
    };
  }, []);

  const handleRecordToggle = async () => {
    if (isRecording) {
      stopRecording();
      return;
    }

    await startRecording();
  };

  const handleRecordReverseAndPlay = async () => {
    if (isRecording) {
      return;
    }

    setIsReverseFlowPending(true);
    await startRecording();
    window.setTimeout(() => {
      stopRecording();
    }, AUTO_RECORDING_MS);
  };

  return (
    <div>
      <button onClick={handleRecordToggle} type="button">
        {isRecording ? 'Stop recording' : 'Start recording'}
      </button>

      <button onClick={handleRecordReverseAndPlay} type="button" disabled={isRecording}>
        Record, reverse, and play
      </button>
    </div>
  );
}
