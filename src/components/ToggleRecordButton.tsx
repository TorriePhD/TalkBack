import { useCallback, useEffect, useState } from 'react';
import { WaveformRecordButton } from './WaveformRecordButton';

interface ToggleRecordButtonProps {
  disabled?: boolean;
  isPreparing: boolean;
  isRecording: boolean;
  stream?: MediaStream | null;
  onStart: () => Promise<void> | void;
  onStop: () => void;
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function ToggleRecordButton({
  disabled = false,
  isPreparing,
  isRecording,
  stream = null,
  onStart,
  onStop,
}: ToggleRecordButtonProps) {
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);

  const handleClick = useCallback(() => {
    if (disabled || isPreparing) {
      return;
    }

    if (isRecording) {
      onStop();
      return;
    }

    void onStart();
  }, [disabled, isPreparing, isRecording, onStart, onStop]);

  useEffect(() => {
    if (typeof window === 'undefined' || !isRecording) {
      setRecordingDurationMs(0);
      return;
    }

    const startedAt = Date.now();
    setRecordingDurationMs(0);

    const timerId = window.setInterval(() => {
      setRecordingDurationMs(Date.now() - startedAt);
    }, 200);

    return () => {
      window.clearInterval(timerId);
    };
  }, [isRecording]);

  return (
    <div className="round-record-button-stack">
      <WaveformRecordButton
        className="record-button"
        disabled={disabled || isPreparing}
        isRecording={isRecording}
        onClick={handleClick}
        stream={stream}
      />

      <div className="record-button-status" aria-live="polite" role="status">
        {isPreparing ? (
          <span className="record-button-message">Starting microphone...</span>
        ) : isRecording ? (
          <>
            <span className="record-button-timer">{formatDuration(recordingDurationMs)}</span>
            <span className="record-button-message">Recording, press to stop</span>
          </>
        ) : (
          <span className="record-button-message">Press to Record</span>
        )}
      </div>
    </div>
  );
}
