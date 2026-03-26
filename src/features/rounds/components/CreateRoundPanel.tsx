import { useEffect, useMemo, useRef, useState } from 'react';
import { useAudioRecorder } from '../../../audio/hooks/useAudioRecorder';
import { reverseAudioBlob } from '../../../audio/utils/reverseAudioBlob';
import { AudioPlayerCard } from '../../../components/AudioPlayerCard';
import { HoldToRecordButton } from '../../../components/HoldToRecordButton';
import { createRoundRecord } from '../../../lib/rounds';
import type { Friend } from '../../social/types';
import { promptCatalog } from '../promptCatalog';
import type { Round } from '../types';

interface CreateRoundPanelProps {
  currentUserEmail: string;
  currentUserId: string;
  friend: Friend;
  onBack: () => void;
  onCreateRound: (round: Round) => void;
}

type CreateStage = 'phrase' | 'record';

export function CreateRoundPanel({
  currentUserEmail,
  currentUserId,
  friend,
  onBack,
  onCreateRound,
}: CreateRoundPanelProps) {
  const recorder = useAudioRecorder({ prepareOnMount: true });
  const [stage, setStage] = useState<CreateStage>('phrase');
  const [selectedPromptId, setSelectedPromptId] = useState(promptCatalog[0]?.id ?? '');
  const [customPhrase, setCustomPhrase] = useState('');
  const [isCustomPhrase, setIsCustomPhrase] = useState(false);
  const [correctPhrase, setCorrectPhrase] = useState(promptCatalog[0]?.phrase ?? '');
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

  const selectedPrompt = useMemo(
    () => promptCatalog.find((prompt) => prompt.id === selectedPromptId) ?? null,
    [selectedPromptId],
  );
  const recordingStateLabel = recorder.isRecording
    ? 'Recording now'
    : recorder.audioBlob
      ? 'Take captured'
      : 'Waiting on your take';
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

  const enableCustomPhrase = () => {
    const seedPhrase = customPhrase.trim() || correctPhrase || selectedPrompt?.phrase || '';
    setCustomPhrase(seedPhrase);
    setIsCustomPhrase(true);
    setCorrectPhrase(seedPhrase);
  };

  const selectPrompt = (promptId: string) => {
    const nextPrompt = promptCatalog.find((prompt) => prompt.id === promptId);
    if (!nextPrompt) {
      return;
    }

    setSelectedPromptId(promptId);
    setIsCustomPhrase(false);
    setCorrectPhrase(nextPrompt.phrase);
  };

  const resetRecording = () => {
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
          <h2>{stage === 'phrase' ? 'Pick the phrase' : 'Record the prompt'}</h2>
          <p>
            {stage === 'phrase'
              ? `This round goes to ${friend.email}. Once they finish, the next turn flips back.`
              : 'Hold to record, release to save, and send the reversed clip.'}
          </p>
        </div>

        <div className="pill-row round-screen-meta">
          <span className="badge primary">{friend.email}</span>
          <span className={`badge ${recorder.audioBlob ? 'complete' : 'waiting_for_attempt'}`}>
            {recordingStateLabel}
          </span>
        </div>
      </div>

      <div className="round-screen-body">
        {stage === 'phrase' ? (
          <div className="round-screen-step">
            <div className="section-header compact-header">
              <div>
                <h3>Choose what they will imitate</h3>
                <p>Keep it short so the whole screen stays simple on mobile.</p>
              </div>
            </div>

            <div className="phrase-chip-row">
              {promptCatalog.map((prompt) => (
                <button
                  className={`phrase-chip ${
                    selectedPromptId === prompt.id && !isCustomPhrase ? 'selected' : ''
                  }`}
                  key={prompt.id}
                  onClick={() => selectPrompt(prompt.id)}
                  type="button"
                >
                  {prompt.label}
                </button>
              ))}
              <button
                className={`phrase-chip ${isCustomPhrase ? 'selected' : ''}`}
                onClick={enableCustomPhrase}
                type="button"
              >
                Write my own
              </button>
            </div>

            {isCustomPhrase ? (
              <div className="field">
                <label htmlFor="correctPhrase">Custom phrase</label>
                <textarea
                  id="correctPhrase"
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setCustomPhrase(nextValue);
                    setCorrectPhrase(nextValue);
                  }}
                  placeholder="Type your phrase."
                  value={customPhrase}
                />
              </div>
            ) : (
              <div className="result-box">
                <p className="fine-print">Selected phrase</p>
                <p>
                  <strong>{selectedPrompt?.phrase}</strong>
                </p>
              </div>
            )}
          </div>
        ) : null}

        {stage === 'record' ? (
          <div className="round-screen-step">
            <div className="result-box round-screen-summary">
              <p>
                <strong>From:</strong> {currentUserEmail}
              </p>
              <p>
                <strong>To:</strong> {friend.email}
              </p>
              <p>
                <strong>Phrase:</strong> {correctPhrase.trim() || 'Choose a phrase first'}
              </p>
            </div>

            <div className="button-row round-record-actions">
              <HoldToRecordButton
                disabled={isSaving}
                isPrepared={recorder.isPrepared}
                isPreparing={recorder.isPreparing}
                isRecording={recorder.isRecording}
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

            <div className="helper-text round-screen-helper">
              {isReversing
                ? 'Turning your take backward now...'
                : recorder.mimeType
                  ? `Release to save. Format: ${recorder.mimeType}`
                  : 'The microphone warms up on open so recording starts fast.'}
            </div>

            <AudioPlayerCard
              title={reversedAudioBlob ? 'What your friend will hear' : 'Latest take'}
              description={
                reversedAudioBlob
                  ? 'This flipped clip is the one that gets sent.'
                  : 'Record once and the preview will appear here.'
              }
              blob={reversedAudioBlob ?? recorder.audioBlob}
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
              onClick={() => setStage('record')}
              type="button"
            >
              Record prompt
            </button>
          </div>
        ) : (
          <div className="button-row">
            <button className="button ghost" onClick={() => setStage('phrase')} type="button">
              Change phrase
            </button>
            <button
              className="button primary"
              disabled={!canCreateRound}
              onClick={() => {
                void handleCreateRound();
              }}
              type="button"
            >
              {isSaving ? 'Sending...' : `Send to ${friend.email}`}
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
