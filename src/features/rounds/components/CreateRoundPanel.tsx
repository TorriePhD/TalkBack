import { useEffect, useMemo, useRef, useState } from 'react';
import { useAudioRecorder } from '../../../audio/hooks/useAudioRecorder';
import { reverseAudioBlob } from '../../../audio/utils/reverseAudioBlob';
import { AudioPlayerCard } from '../../../components/AudioPlayerCard';
import { createRoundRecord } from '../../../lib/rounds';
import type { Round } from '../types';

interface CreateRoundPanelProps {
  onCreateRound: (round: Round) => void;
}

export function CreateRoundPanel({ onCreateRound }: CreateRoundPanelProps) {
  const recorder = useAudioRecorder();
  const [player1Name, setPlayer1Name] = useState('');
  const [player2Name, setPlayer2Name] = useState('');
  const [correctPhrase, setCorrectPhrase] = useState('');
  const [reversedAudioBlob, setReversedAudioBlob] = useState<Blob | null>(null);
  const [reverseError, setReverseError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isReversing, setIsReversing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const lastAutoReversedBlobRef = useRef<Blob | null>(null);

  useEffect(() => {
    setReversedAudioBlob(null);
    setReverseError(null);
    setSaveError(null);
    lastAutoReversedBlobRef.current = null;
  }, [recorder.audioBlob, recorder.isRecording]);

  useEffect(() => {
    if (!recorder.audioBlob || recorder.isRecording) {
      return;
    }

    const originalBlob = recorder.audioBlob;

    if (lastAutoReversedBlobRef.current === originalBlob) {
      return;
    }

    let cancelled = false;

    const autoReverseOriginal = async () => {
      setReverseError(null);
      setIsReversing(true);

      try {
        const nextReversedAudio = await reverseAudioBlob(originalBlob);
        if (cancelled) {
          return;
        }

        setReversedAudioBlob(nextReversedAudio);
        lastAutoReversedBlobRef.current = originalBlob;
      } catch (error) {
        if (!cancelled) {
          setReverseError(
            error instanceof Error ? error.message : 'Unable to reverse the original audio.',
          );
        }
      } finally {
        if (!cancelled) {
          setIsReversing(false);
        }
      }
    };

    void autoReverseOriginal();

    return () => {
      cancelled = true;
    };
  }, [recorder.audioBlob, recorder.isRecording]);

  const canCreateRound = useMemo(
    () =>
      Boolean(
        player1Name.trim() &&
          player2Name.trim() &&
          correctPhrase.trim() &&
          recorder.audioBlob &&
          reversedAudioBlob,
      ) &&
      !isReversing &&
      !isSaving &&
      !recorder.isRecording &&
      !recorder.isPreparing,
    [
      correctPhrase,
      isReversing,
      isSaving,
      player1Name,
      player2Name,
      recorder.audioBlob,
      recorder.isPreparing,
      recorder.isRecording,
      reversedAudioBlob,
    ],
  );

  const handleReverseOriginal = async () => {
    if (!recorder.audioBlob) {
      return;
    }

    setReverseError(null);
    setSaveError(null);
    setIsReversing(true);

    try {
      const nextReversedAudio = await reverseAudioBlob(recorder.audioBlob);
      setReversedAudioBlob(nextReversedAudio);
      lastAutoReversedBlobRef.current = recorder.audioBlob;
    } catch (error) {
      setReverseError(
        error instanceof Error ? error.message : 'Unable to reverse the original audio.',
      );
    } finally {
      setIsReversing(false);
    }
  };

  const resetForm = () => {
    setPlayer1Name('');
    setPlayer2Name('');
    setCorrectPhrase('');
    setReversedAudioBlob(null);
    setReverseError(null);
    setSaveError(null);
    lastAutoReversedBlobRef.current = null;
    recorder.clearRecording();
  };

  const handleCreateRound = async () => {
    if (!recorder.audioBlob || !reversedAudioBlob) {
      return;
    }

    setSaveError(null);
    setIsSaving(true);

    try {
      const nextRound = await createRoundRecord({
        player1Name: player1Name.trim(),
        player2Name: player2Name.trim(),
        correctPhrase: correctPhrase.trim(),
        originalAudioBlob: recorder.audioBlob,
        reversedAudioBlob,
      });

      onCreateRound(nextRound);
      resetForm();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to create the round.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="surface">
      <div className="section-header">
        <div>
          <h2>Create Round</h2>
          <p>Record the original phrase, reverse it, and save the round to Supabase.</p>
        </div>
      </div>

      <div className="panel-grid">
        <div className="stack">
          <div className="field-grid two-up">
            <div className="field">
              <label htmlFor="player1Name">Player 1 name</label>
              <input
                id="player1Name"
                value={player1Name}
                onChange={(event) => setPlayer1Name(event.target.value)}
                placeholder="Who records the phrase?"
              />
            </div>
            <div className="field">
              <label htmlFor="player2Name">Player 2 name</label>
              <input
                id="player2Name"
                value={player2Name}
                onChange={(event) => setPlayer2Name(event.target.value)}
                placeholder="Who will imitate it?"
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="correctPhrase">Correct phrase</label>
            <textarea
              id="correctPhrase"
              value={correctPhrase}
              onChange={(event) => setCorrectPhrase(event.target.value)}
              placeholder="Type the phrase Player 1 is actually saying."
            />
            <div className="helper-text">
              Scoring uses Wasserstein edit distance normalized to a 10-point scale.
            </div>
          </div>

          <div className="surface">
            <div className="section-header">
              <div>
                <h3>Original Recording</h3>
                <p>Capture a short phrase. WebM/Opus is preferred when the browser supports it.</p>
              </div>
            </div>

            <div className="button-row">
              <button
                className="button primary"
                disabled={recorder.isRecording || recorder.isPreparing}
                onClick={() => {
                  void recorder.startRecording();
                }}
                type="button"
              >
                {recorder.isPreparing ? 'Requesting mic...' : 'Start recording'}
              </button>
              <button
                className="button warning"
                disabled={!recorder.isRecording}
                onClick={recorder.stopRecording}
                type="button"
              >
                Stop recording
              </button>
              <button
                className="button ghost"
                disabled={!recorder.audioBlob && !reversedAudioBlob}
                onClick={resetForm}
                type="button"
              >
                Clear round draft
              </button>
            </div>

            <div className="helper-text">
              {recorder.isRecording
                ? 'Recording in progress.'
                : recorder.mimeType
                  ? `Recorder format: ${recorder.mimeType}`
                  : 'Ready to record.'}
            </div>
          </div>

          {recorder.error ? <div className="error-banner">{recorder.error}</div> : null}
          {reverseError ? <div className="error-banner">{reverseError}</div> : null}
          {saveError ? <div className="error-banner">{saveError}</div> : null}
        </div>

        <div className="stack">
          <div className="audio-grid">
            <AudioPlayerCard
              title="Original Phrase"
              description="This is the clean Player 1 recording."
              blob={recorder.audioBlob}
            />
            <AudioPlayerCard
              title="Reversed Phrase"
              description="This is the version Player 2 should imitate."
              blob={reversedAudioBlob}
            />
          </div>

          <div className="button-row">
            <button
              className="button secondary"
              disabled={!recorder.audioBlob || isReversing || recorder.isRecording || isSaving}
              onClick={() => {
                void handleReverseOriginal();
              }}
              type="button"
            >
              {isReversing ? 'Reversing...' : 'Reverse original audio'}
            </button>
            <button
              className="button primary"
              disabled={!canCreateRound}
              onClick={() => {
                void handleCreateRound();
              }}
              type="button"
            >
              {isSaving ? 'Creating round...' : 'Create shared round'}
            </button>
          </div>

          <div className="helper-text">
            {isReversing
              ? 'Auto-reversing the latest recording...'
              : reversedAudioBlob
                ? 'Reversed audio is ready. Creating the round uploads both clips to Supabase and adds the round to the shared inbox.'
                : 'Stop recording to automatically generate the reversed clip.'}
          </div>
        </div>
      </div>
    </section>
  );
}
