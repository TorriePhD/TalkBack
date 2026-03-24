import { useEffect, useMemo, useRef, useState } from 'react';
import { useAudioRecorder } from '../../../audio/hooks/useAudioRecorder';
import { reverseAudioBlob } from '../../../audio/utils/reverseAudioBlob';
import { AudioPlayerCard } from '../../../components/AudioPlayerCard';
import { StatusBadge } from '../../../components/StatusBadge';
import { saveRoundAttempt, submitRoundGuess } from '../../../lib/rounds';
import type { Round } from '../types';

interface PlayRoundPanelProps {
  currentUserId: string;
  round: Round | null;
  onUpdateRound: (roundId: string, updater: (round: Round) => Round) => void;
}

function describeSenderView(round: Round) {
  if (round.status === 'complete') {
    return `${round.recipientEmail} finished the round.`;
  }

  if (round.status === 'attempted') {
    return `${round.recipientEmail} recorded an attempt and still needs to submit a guess.`;
  }

  return `Waiting for ${round.recipientEmail} to record an attempt.`;
}

export function PlayRoundPanel({
  currentUserId,
  round,
  onUpdateRound,
}: PlayRoundPanelProps) {
  const recorder = useAudioRecorder();
  const [guess, setGuess] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isSavingAttempt, setIsSavingAttempt] = useState(false);
  const [isSubmittingGuess, setIsSubmittingGuess] = useState(false);
  const lastSavedAttemptBlobRef = useRef<Blob | null>(null);

  useEffect(() => {
    setGuess(round?.guess ?? '');
    setError(null);
    setInfo(null);
    recorder.clearRecording();
    lastSavedAttemptBlobRef.current = null;
  }, [round?.id, recorder.clearRecording]);

  const isRecipient = Boolean(round && round.recipientId === currentUserId);
  const showOriginalReference = Boolean(round && (!isRecipient || round.status === 'complete'));
  const hasAttempt = Boolean(
    round &&
      (round.attemptAudioBlob || round.attemptAudioUrl) &&
      (round.attemptReversedBlob || round.attemptReversedUrl),
  );

  const canSubmitGuess = useMemo(
    () =>
      Boolean(round && isRecipient && hasAttempt && guess.trim()) &&
      round?.status !== 'complete' &&
      !isSavingAttempt &&
      !isSubmittingGuess,
    [guess, hasAttempt, isRecipient, isSavingAttempt, isSubmittingGuess, round],
  );

  const saveAttempt = async (
    currentRound: Round,
    attemptBlob: Blob,
    options: { cancelled?: () => boolean } = {},
  ) => {
    const { cancelled } = options;

    if (currentRound.recipientId !== currentUserId) {
      return;
    }

    setError(null);
    setInfo(null);
    setIsSavingAttempt(true);

    try {
      const reversedAttemptBlob = await reverseAudioBlob(attemptBlob);
      if (cancelled?.()) {
        return;
      }

      const savedRound = await saveRoundAttempt({
        currentUserId,
        roundId: currentRound.id,
        attemptAudioBlob: attemptBlob,
        attemptReversedBlob: reversedAttemptBlob,
      });
      if (cancelled?.()) {
        return;
      }

      onUpdateRound(currentRound.id, (existingRound) => ({
        ...savedRound,
        originalAudioBlob: existingRound.originalAudioBlob,
        reversedAudioBlob: existingRound.reversedAudioBlob,
        attemptAudioBlob: attemptBlob,
        attemptReversedBlob: reversedAttemptBlob,
      }));
      lastSavedAttemptBlobRef.current = attemptBlob;
      setInfo('Attempt recorded, reversed, and saved to Supabase.');
    } catch (caughtError) {
      if (!cancelled?.()) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Unable to reverse and save the attempt recording.',
        );
      }
    } finally {
      if (!cancelled?.()) {
        setIsSavingAttempt(false);
      }
    }
  };

  useEffect(() => {
    if (
      !round ||
      !isRecipient ||
      !recorder.audioBlob ||
      recorder.isRecording ||
      round.status === 'complete'
    ) {
      return;
    }

    const attemptBlob = recorder.audioBlob;

    if (lastSavedAttemptBlobRef.current === attemptBlob) {
      return;
    }

    let cancelled = false;

    void saveAttempt(round, attemptBlob, { cancelled: () => cancelled });

    return () => {
      cancelled = true;
    };
  }, [currentUserId, isRecipient, onUpdateRound, recorder.audioBlob, recorder.isRecording, round]);

  if (!round) {
    return (
      <section className="surface">
        <div className="empty-state">
          Select a round from your list to hear the reversed phrase and continue the game.
        </div>
      </section>
    );
  }

  const handleSaveAttempt = async () => {
    if (!recorder.audioBlob || round.status === 'complete' || !isRecipient) {
      return;
    }

    await saveAttempt(round, recorder.audioBlob);
  };

  const handleSubmitGuess = async () => {
    const nextGuess = guess.trim();
    if (!nextGuess || !isRecipient) {
      return;
    }

    setError(null);
    setInfo(null);
    setIsSubmittingGuess(true);

    try {
      const updatedRound = await submitRoundGuess({
        roundId: round.id,
        guess: nextGuess,
        correctPhrase: round.correctPhrase,
      });

      onUpdateRound(round.id, (currentRound) => ({
        ...updatedRound,
        originalAudioBlob: currentRound.originalAudioBlob,
        reversedAudioBlob: currentRound.reversedAudioBlob,
        attemptAudioBlob: currentRound.attemptAudioBlob,
        attemptReversedBlob: currentRound.attemptReversedBlob,
      }));
      setInfo(updatedRound.score === 10 ? 'Exact match. Full score.' : 'Round complete.');
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Unable to submit the guess.',
      );
    } finally {
      setIsSubmittingGuess(false);
    }
  };

  return (
    <section className="surface">
      <div className="section-header">
        <div>
          <h2>Play Round</h2>
          <p>
            {isRecipient
              ? `You received this round from ${round.senderEmail}.`
              : `You sent this round to ${round.recipientEmail}.`}
          </p>
        </div>
        <StatusBadge status={round.status} />
      </div>

      <div className="panel-grid">
        <div className="stack">
          <div className="info-banner">
            {isRecipient
              ? `Only you and ${round.senderEmail} can access this round and its audio files.`
              : `Only you and ${round.recipientEmail} can access this round and its audio files.`}
          </div>

          <div className="audio-grid">
            <AudioPlayerCard
              title="Reversed Prompt"
              description="This is the backwards-sounding clip the recipient should imitate."
              blob={round.reversedAudioBlob}
              remoteUrl={round.reversedAudioUrl}
            />
            <AudioPlayerCard
              title="Original Phrase"
              description={
                showOriginalReference
                  ? 'The original recording for comparison.'
                  : 'Locked until you finish the round.'
              }
              blob={showOriginalReference ? round.originalAudioBlob : null}
              remoteUrl={showOriginalReference ? round.originalAudioUrl : null}
            />
            <AudioPlayerCard
              title="Latest Attempt"
              description="The recipient's raw imitation recording."
              blob={recorder.audioBlob ?? round.attemptAudioBlob}
              remoteUrl={round.attemptAudioUrl}
            />
            <AudioPlayerCard
              title="Reversed Attempt"
              description="This flipped attempt should sound close to the original."
              blob={round.attemptReversedBlob}
              remoteUrl={round.attemptReversedUrl}
            />
          </div>
        </div>

        <div className="stack">
          {isRecipient ? (
            <>
              <div className="surface nested-surface">
                <div className="section-header">
                  <div>
                    <h3>Record Attempt</h3>
                    <p>Capture a new imitation. It will be reversed automatically and saved.</p>
                  </div>
                </div>

                <div className="button-row">
                  <button
                    className="button primary"
                    disabled={
                      recorder.isRecording || recorder.isPreparing || round.status === 'complete'
                    }
                    onClick={() => {
                      void recorder.startRecording();
                    }}
                    type="button"
                  >
                    {recorder.isPreparing ? 'Requesting mic...' : 'Start attempt'}
                  </button>
                  <button
                    className="button warning"
                    disabled={!recorder.isRecording}
                    onClick={recorder.stopRecording}
                    type="button"
                  >
                    Stop attempt
                  </button>
                  <button
                    className="button secondary"
                    disabled={
                      !recorder.audioBlob ||
                      isSavingAttempt ||
                      isSubmittingGuess ||
                      round.status === 'complete'
                    }
                    onClick={() => {
                      void handleSaveAttempt();
                    }}
                    type="button"
                  >
                    {isSavingAttempt ? 'Saving attempt...' : 'Reverse + save attempt'}
                  </button>
                </div>

                <div className="helper-text">
                  {recorder.isRecording
                    ? 'Attempt recording in progress.'
                    : isSavingAttempt
                      ? 'Auto-reversing and saving your latest attempt...'
                      : recorder.audioBlob
                        ? 'A fresh attempt is ready. You can retry saving it if needed.'
                        : 'Listen to the reversed prompt, then record a reply.'}
                </div>
              </div>

              <div className="surface nested-surface">
                <div className="section-header">
                  <div>
                    <h3>Guess + Score</h3>
                    <p>Submit your best guess after your attempt is saved.</p>
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="guess">Your guess</label>
                  <input
                    id="guess"
                    disabled={round.status === 'complete' || isSubmittingGuess}
                    onChange={(event) => setGuess(event.target.value)}
                    placeholder="What was the original phrase?"
                    value={guess}
                  />
                </div>

                <div className="button-row">
                  <button
                    className="button primary"
                    disabled={!canSubmitGuess}
                    onClick={() => {
                      void handleSubmitGuess();
                    }}
                    type="button"
                  >
                    {isSubmittingGuess ? 'Submitting guess...' : 'Submit guess'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="surface nested-surface">
              <div className="section-header">
                <div>
                  <h3>Recipient Progress</h3>
                  <p>Only {round.recipientEmail} can record the attempt and submit the guess.</p>
                </div>
              </div>

              <div className="info-banner">{describeSenderView(round)}</div>
              <div className="result-box">
                <p>
                  <strong>Correct phrase:</strong> {round.correctPhrase}
                </p>
                <p>
                  <strong>Recipient:</strong> {round.recipientEmail}
                </p>
              </div>
            </div>
          )}

          {recorder.error ? <div className="error-banner">{recorder.error}</div> : null}
          {error ? <div className="error-banner">{error}</div> : null}
          {info ? <div className="success-banner">{info}</div> : null}

          {round.status === 'complete' ? (
            <div className="result-box">
              <p className="score-mark">{round.score ?? 0}/10</p>
              <p>
                <strong>Correct phrase:</strong> {round.correctPhrase}
              </p>
              <p>
                <strong>Guess:</strong> {round.guess || 'No guess submitted'}
              </p>
              <div className="pill-row">
                <StatusBadge status={round.status} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
