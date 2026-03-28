import { useEffect, useMemo, useRef, useState } from 'react';
import { useAudioRecorder } from '../../../audio/hooks/useAudioRecorder';
import { reverseAudioBlob } from '../../../audio/utils/reverseAudioBlob';
import { AudioPlayerCard } from '../../../components/AudioPlayerCard';
import { ToggleRecordButton } from '../../../components/ToggleRecordButton';
import { WaveformLoader } from '../../../components/WaveformLoader';
import { createRoundRecord } from '../../../lib/rounds';
import type { Friend } from '../../social/types';
import type { Round } from '../types';

interface CreateRoundPanelProps {
  currentUserId: string;
  currentUserUsername: string;
  friend: Friend;
  onBack: () => void;
  onCreateRound: (round: Round) => void;
}

type CreateStage = 'phrase' | 'record';

export function CreateRoundPanel({
  currentUserId,
  currentUserUsername,
  friend,
  onBack,
  onCreateRound,
}: CreateRoundPanelProps) {
  const recorder = useAudioRecorder({ preparedStreamIdleMs: 0 });
  const [stage, setStage] = useState<CreateStage>('phrase');
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

  const canContinueToRecord = Boolean(correctPhrase.trim());
  const canCreateRound = useMemo(
    () =>
      Boolean(correctPhrase.trim() && recorder.audioBlob && reversedAudioBlob) &&
      !isReversing &&
      !isSaving &&
      !recorder.isRecording &&
      !recorder.isPreparing,
    [
      correctPhrase,
      isReversing,
      isSaving,
      recorder.audioBlob,
      recorder.isPreparing,
      recorder.isRecording,
      reversedAudioBlob,
    ],
  );

  const resetRecording = () => {
    setReversedAudioBlob(null);
    setReverseError(null);
    setSaveError(null);
    lastAutoReversedBlobRef.current = null;
    recorder.clearRecording();
  };

  const handleEnterRecordStage = async () => {
    await recorder.prepareRecording();
    setStage('record');
  };

  const handleCreateRound = async () => {
    if (!recorder.audioBlob || !reversedAudioBlob) {
      return;
    }

    setSaveError(null);
    setIsSaving(true);

    try {
      const nextRound = await createRoundRecord({
        currentUserId,
        recipientId: friend.id,
        correctPhrase: correctPhrase.trim(),
        originalAudioBlob: recorder.audioBlob,
        reversedAudioBlob,
      });

      onCreateRound(nextRound);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to create the round.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="surface round-screen">
      <div className="round-screen-header">
        <button className="button ghost round-screen-back" onClick={onBack} type="button">
          Back
        </button>

        <div className="round-screen-copy">
          <div className="eyebrow">Your Send Turn</div>
          <h2>{stage === 'phrase' ? 'Write the phrase' : 'Record the prompt'}</h2>
          <p>
            {stage === 'phrase'
              ? `This round goes to ${friend.username}. Once they finish, the next turn flips back.`
              : 'Start recording when ready, stop to save the take, then send it when you are happy with your normal playback.'}
          </p>
        </div>

        <div className="pill-row round-screen-meta">
          <span className="badge primary">{friend.username}</span>
        </div>
      </div>

      <div className="round-screen-body">
        {stage === 'phrase' ? (
          <div className="round-screen-step">
            <div className="section-header compact-header">
              <div>
                <h3>Write what they will imitate</h3>
                <p>Keep it short so the whole screen stays simple on mobile.</p>
              </div>
            </div>

            <div className="field">
              <label htmlFor="correctPhrase">Phrase</label>
              <textarea
                id="correctPhrase"
                onChange={(event) => {
                  setCorrectPhrase(event.target.value);
                }}
                placeholder="Type the phrase you want them to imitate."
                value={correctPhrase}
              />
            </div>
          </div>
        ) : null}

        {stage === 'record' ? (
          <div className="round-screen-step">
            <div className="result-box round-screen-summary">
              <p>
                <strong>From:</strong> {currentUserUsername}
              </p>
              <p>
                <strong>To:</strong> {friend.username}
              </p>
              <p>
                <strong>Phrase:</strong> {correctPhrase.trim() || 'Choose a phrase first'}
              </p>
            </div>

            <div className="button-row round-record-actions">
              <ToggleRecordButton
                disabled={isSaving}
                isPreparing={recorder.isPreparing}
                isRecording={recorder.isRecording}
                liveStream={recorder.liveStream}
                onStart={recorder.startRecording}
                onStop={recorder.stopRecording}
              />
              <button
                className="button ghost"
                disabled={!recorder.audioBlob && !reversedAudioBlob}
                onClick={resetRecording}
                type="button"
              >
                Clear take
              </button>
            </div>

            {isReversing ? (
              <div className="round-loader-callout" aria-live="polite" role="status">
                <WaveformLoader
                  className="round-loader-callout-spinner"
                  size={92}
                  strokeWidth={3.6}
                />
                <div>
                  <strong>Reversing audio...</strong>
                  <p>Building the flipped clip your friend will hear in the round.</p>
                </div>
              </div>
            ) : null}

            <AudioPlayerCard
              title="Latest take"
              description={
                recorder.audioBlob
                  ? 'Replay your normal recording before you send.'
                  : 'Record once and the preview will appear here.'
              }
              blob={recorder.audioBlob}
            />
          </div>
        ) : null}
      </div>

      <div className="round-screen-footer">
        {stage === 'phrase' ? (
          <div className="button-row">
            <button
              className="button primary"
              disabled={!canContinueToRecord}
              onClick={() => {
                void handleEnterRecordStage();
              }}
              type="button"
            >
              Record prompt
            </button>
          </div>
        ) : (
          <div className="button-row">
            <button className="button ghost" onClick={() => setStage('phrase')} type="button">
              Edit phrase
            </button>
            <button
              className="button primary"
              disabled={!canCreateRound}
              onClick={() => {
                void handleCreateRound();
              }}
              type="button"
            >
              {isSaving ? 'Sending...' : `Send to ${friend.username}`}
            </button>
          </div>
        )}
      </div>

      <div className="stack">
        {recorder.error ? <div className="error-banner">{recorder.error}</div> : null}
        {reverseError ? <div className="error-banner">{reverseError}</div> : null}
        {saveError ? <div className="error-banner">{saveError}</div> : null}
      </div>
    </section>
  );
}
