import { useCallback, useEffect, useRef, useState } from 'react';

interface HoldToRecordButtonProps {
  disabled?: boolean;
  isPrepared?: boolean;
  isPreparing: boolean;
  isRecording: boolean;
  onStart: () => Promise<void> | void;
  onStop: () => void;
}

export function HoldToRecordButton({
  disabled = false,
  isPrepared = false,
  isPreparing,
  isRecording,
  onStart,
  onStop,
}: HoldToRecordButtonProps) {
  const [isPressed, setIsPressed] = useState(false);
  const isHoldingRef = useRef(false);

  const stopHold = useCallback(() => {
    if (!isHoldingRef.current) {
      return;
    }

    isHoldingRef.current = false;
    setIsPressed(false);
    onStop();
  }, [onStop]);

  const startHold = useCallback(() => {
    if (disabled || isHoldingRef.current) {
      return;
    }

    isHoldingRef.current = true;
    setIsPressed(true);
    void onStart();
  }, [disabled, onStart]);

  useEffect(() => {
    if (isRecording && !isHoldingRef.current) {
      onStop();
    }
  }, [isRecording, onStop]);

  useEffect(() => {
    if (disabled) {
      stopHold();
    }
  }, [disabled, stopHold]);

  useEffect(() => stopHold, [stopHold]);

  return (
    <button
      aria-pressed={isRecording || isPressed}
      className={`button primary record-button ${isRecording || isPressed ? 'recording' : ''}`}
      disabled={disabled}
      onBlur={stopHold}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
      onKeyDown={(event) => {
        if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
          event.preventDefault();
          startHold();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          stopHold();
        }
      }}
      onLostPointerCapture={stopHold}
      onPointerCancel={stopHold}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) {
          return;
        }

        event.preventDefault();
        startHold();

        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Some mobile browsers do not fully support pointer capture here.
        }
      }}
      onPointerUp={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) {
          return;
        }

        stopHold();

        try {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        } catch {
          // Ignore capture cleanup failures on browsers with partial support.
        }
      }}
      type="button"
    >
      {isPreparing
        ? isPressed
          ? 'Keep holding...'
          : isPrepared
            ? 'Hold to record'
            : 'Hold to wake mic'
        : isRecording || isPressed
          ? 'Release to save take'
          : isPrepared
            ? 'Hold to record'
            : 'Hold to wake mic'}
    </button>
  );
}
