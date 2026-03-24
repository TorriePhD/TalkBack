import { useEffect, useMemo, useRef, useState } from 'react';
import { useAudioRecorder } from '../../../audio/hooks/useAudioRecorder';
import { reverseAudioBlob } from '../../../audio/utils/reverseAudioBlob';
import { AudioPlayerCard } from '../../../components/AudioPlayerCard';
import type { Friend } from '../../social/types';
import { createRoundRecord } from '../../../lib/rounds';
import type { Round } from '../types';

interface CreateRoundPanelProps {
  currentUserEmail: string;
  currentUserId: string;
  friends: Friend[];
  onCreateRound: (round: Round) => void;
}

export function CreateRoundPanel({
  currentUserEmail,
  currentUserId,
  friends,
  onCreateRound,
}: CreateRoundPanelProps) {
  const recorder = useAudioRecorder();
  const [recipientId, setRecipientId] = useState('');
  const [correctPhrase, setCorrectPhrase] = useState('');
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
      friends.some((friend) => friend.id === currentRecipientId) ? currentRecipientId : friends[0].id,
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
    setCorrectPhrase('');
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
            <h2>Create Round</h2>
            <p>Rounds can only be sent to confirmed friends.</p>
          </div>
        </div>

        <div className="empty-state">
          Add a friend first. Once someone accepts your request, they will appear here as a round
          recipient.
        </div>
      </section>
    );
  }

  return (
    <section className="surface">
      <div className="section-header">
        <div>
          <h2>Create Round</h2>
          <p>Record the phrase, reverse it, and send the round to one of your confirmed friends.</p>
        </div>
      </div>

      <div className="panel-grid">
        <div className="stack">
          <div className="field-grid two-up">
            <div className="field">
              <label htmlFor="senderEmail">From</label>
              <input id="senderEmail" readOnly value={currentUserEmail} />
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

          <div className="field">
            <label htmlFor="correctPhrase">Correct phrase</label>
            <textarea
              id="correctPhrase"
              onChange={(event) => setCorrectPhrase(event.target.value)}
              placeholder="Type the phrase your friend will try to decode."
              value={correctPhrase}
            />
            <div className="helper-text">
              The phrase stays private to the round participants and scoring uses a normalized edit
              distance on a 10-point scale.
            </div>
          </div>

          <div className="surface nested-surface">
            <div className="section-header">
              <div>
                <h3>Original Recording</h3>
                <p>Capture the phrase that {selectedFriend?.email ?? 'your friend'} will decode.</p>
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
              description="Your clean recording before any processing."
              blob={recorder.audioBlob}
            />
            <AudioPlayerCard
              title="Reversed Phrase"
              description="This is what your friend will hear when the round arrives."
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
              {isSaving ? 'Sending round...' : 'Send round'}
            </button>
          </div>

          <div className="helper-text">
            {isReversing
              ? 'Auto-reversing the latest recording...'
              : reversedAudioBlob
                ? `The reversed prompt is ready. Sending this round will upload both clips to private Supabase Storage and assign the round to ${selectedFriend?.email ?? 'your friend'}.`
                : 'Stop recording to automatically generate the reversed clip.'}
          </div>
        </div>
      </div>
    </section>
  );
}
