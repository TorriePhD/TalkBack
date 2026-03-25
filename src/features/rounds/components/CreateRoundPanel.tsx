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
  friends: Friend[];
  onCreateRound: (round: Round) => void;
  onOpenFriends: () => void;
}

export function CreateRoundPanel({
  currentUserEmail,
  currentUserId,
  friends,
  onCreateRound,
  onOpenFriends,
}: CreateRoundPanelProps) {
  const recorder = useAudioRecorder({ prepareOnMount: true });
  const [recipientId, setRecipientId] = useState('');
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
    if (!friends.length) {
      setRecipientId('');
      return;
    }

    setRecipientId((currentRecipientId) =>
      friends.some((friend) => friend.id === currentRecipientId)
        ? currentRecipientId
        : friends[0].id,
    );
  }, [friends]);

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

  const selectedFriend = useMemo(
    () => friends.find((friend) => friend.id === recipientId) ?? null,
    [friends, recipientId],
  );
  const selectedPrompt = useMemo(
    () => promptCatalog.find((prompt) => prompt.id === selectedPromptId) ?? null,
    [selectedPromptId],
  );
  const phraseLabel = isCustomPhrase ? 'Custom phrase' : selectedPrompt?.label ?? 'Preset';
  const recordingStateLabel = recorder.isRecording
    ? 'Recording now'
    : recorder.audioBlob
      ? 'Take captured'
      : 'Waiting on your take';

  const canCreateRound = useMemo(
    () =>
      Boolean(recipientId && correctPhrase.trim() && recorder.audioBlob && reversedAudioBlob) &&
      !isReversing &&
      !isSaving &&
      !recorder.isRecording &&
      !recorder.isPreparing,
    [
      correctPhrase,
      isReversing,
      isSaving,
      recipientId,
      recorder.audioBlob,
      recorder.isPreparing,
      recorder.isRecording,
      reversedAudioBlob,
    ],
  );

  const selectPrompt = (promptId: string) => {
    const nextPrompt = promptCatalog.find((prompt) => prompt.id === promptId);
    if (!nextPrompt) {
      return;
    }

    setSelectedPromptId(promptId);
    setIsCustomPhrase(false);
    setCorrectPhrase(nextPrompt.phrase);
  };

  const enableCustomPhrase = () => {
    const seedPhrase = customPhrase.trim() || correctPhrase || selectedPrompt?.phrase || '';
    setCustomPhrase(seedPhrase);
    setIsCustomPhrase(true);
    setCorrectPhrase(seedPhrase);
  };

  const resetForm = () => {
    const firstPrompt = promptCatalog[0];
    setSelectedPromptId(firstPrompt?.id ?? '');
    setCustomPhrase('');
    setIsCustomPhrase(false);
    setCorrectPhrase(firstPrompt?.phrase ?? '');
    setReversedAudioBlob(null);
    setReverseError(null);
    setSaveError(null);
    lastAutoReversedBlobRef.current = null;
    recorder.clearRecording();
  };

  const handleCreateRound = async () => {
    if (!recorder.audioBlob || !reversedAudioBlob || !recipientId) {
      return;
    }

    setSaveError(null);
    setIsSaving(true);

    try {
      const nextRound = await createRoundRecord({
        currentUserId,
        recipientId,
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

  if (!friends.length) {
    return (
      <section className="surface">
        <div className="section-header">
          <div>
            <div className="eyebrow">New Round</div>
            <h2>Create Round</h2>
            <p>Rounds can only be sent to confirmed friends.</p>
          </div>
        </div>

        <div className="empty-state home-empty">
          <h3>Need someone to send chaos to?</h3>
          <p>
            Add a friend first. Once someone accepts your request, they will show up here as a round recipient.
          </p>
          <div className="button-row">
            <button className="button primary" onClick={onOpenFriends} type="button">
              Add friends
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="surface">
      <div className="section-header">
        <div>
          <div className="eyebrow">New Round</div>
          <h2>Create Round</h2>
          <p>Pick a friend, choose a phrase, then record a quick clip and send it.</p>
        </div>
      </div>

      <div className="badge-row">
        <span className="badge primary">{selectedFriend?.email ?? 'Pick a friend'}</span>
        <span className="badge created">{phraseLabel}</span>
        <span className={`badge ${recorder.audioBlob ? 'complete' : 'waiting_for_attempt'}`}>
          {recordingStateLabel}
        </span>
      </div>

      <div className="stack">
        <div className="surface nested-surface">
          <div className="section-header compact-header">
            <div>
              <h3>1. Choose friend</h3>
              <p>Only confirmed friends can receive a round.</p>
            </div>
          </div>

          <div className="field">
            <label htmlFor="recipientId">Send to friend</label>
            <select
              id="recipientId"
              onChange={(event) => setRecipientId(event.target.value)}
              value={recipientId}
            >
              {friends.map((friend) => (
                <option key={friend.id} value={friend.id}>
                  {friend.email}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="surface nested-surface">
          <div className="section-header compact-header">
            <div>
              <h3>2. Choose phrase</h3>
              <p>Use a preset or write your own phrase.</p>
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
                placeholder="Type your secret phrase."
                value={customPhrase}
              />
            </div>
          ) : (
            <div className="result-box">
              <p className="fine-print">Current phrase</p>
              <p>
                <strong>{selectedPrompt?.phrase}</strong>
              </p>
              <p className="helper-text">Switch to Write my own if you want something custom.</p>
            </div>
          )}
        </div>

        <div className="surface nested-surface">
          <div className="section-header">
            <div>
              <h3>3. Record and send</h3>
              <p>Hold to record, then release to save the take.</p>
            </div>
          </div>

          <div className="result-box create-summary-card">
            <p>
              <strong>From:</strong> {currentUserEmail}
            </p>
            <p>
              <strong>To:</strong> {selectedFriend?.email ?? 'Pick a friend'}
            </p>
            <p>
              <strong>Phrase:</strong> {correctPhrase.trim() || 'Choose a phrase'}
            </p>
            <p>
              <strong>Status:</strong> {recordingStateLabel}
            </p>
          </div>

          <div className="button-row">
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
              onClick={resetForm}
              type="button"
            >
              Reset draft
            </button>
          </div>

          <div className="helper-text">
            {isReversing
              ? 'Turning your take backward...'
              : recorder.mimeType
                ? `Release to save. Format: ${recorder.mimeType}`
                : 'The microphone warms up on page load so recording can start as soon as you press.'}
          </div>

          {recorder.error ? <div className="error-banner">{recorder.error}</div> : null}
          {reverseError ? <div className="error-banner">{reverseError}</div> : null}
          {saveError ? <div className="error-banner">{saveError}</div> : null}
        </div>

        {recorder.audioBlob || reversedAudioBlob ? (
          <div className="audio-grid">
            <AudioPlayerCard
              title="Replay your take"
              description="Use this only if you want a quick confidence check."
              blob={recorder.audioBlob}
            />
            <AudioPlayerCard
              title="Replay the flipped take"
              description="This backward clip is exactly what your friend will hear."
              blob={reversedAudioBlob}
            />
          </div>
        ) : (
          <div className="empty-state compact-empty">
            Record a take and the preview clips will appear here.
          </div>
        )}
      </div>

      <div className="mobile-cta-bar">
        <div className="button-row">
          <button
            className="button primary"
            disabled={!canCreateRound}
            onClick={() => {
              void handleCreateRound();
            }}
            type="button"
          >
            {isSaving ? 'Sending...' : `Send round to ${selectedFriend?.email ?? 'friend'}`}
          </button>
        </div>
      </div>
    </section>
  );
}
