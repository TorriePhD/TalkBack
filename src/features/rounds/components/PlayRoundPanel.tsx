import { useEffect, useMemo, useRef, useState } from 'react';
import { useAudioRecorder } from '../../../audio/hooks/useAudioRecorder';
import { reverseAudioBlob } from '../../../audio/utils/reverseAudioBlob';
import { AudioPlayerCard } from '../../../components/AudioPlayerCard';
import { StatusBadge } from '../../../components/StatusBadge';
import { saveRoundAttempt, submitRoundGuess } from '../../../lib/rounds';
import type { Round } from '../types';

interface PlayRoundPanelProps {
  round: Round | null;
  onUpdateRound: (roundId: string, updater: (round: Round) => Round) => void;
}

export function PlayRoundPanel({ round, onUpdateRound }: PlayRoundPanelProps) {
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

  const hasAttempt = Boolean(
    round &&
      (round.attemptAudioBlob || round.attemptAudioUrl) &&
      (round.attemptReversedBlob || round.attemptReversedUrl),
  );

  const canSubmitGuess = useMemo(
    () =>
      Boolean(round && hasAttempt && guess.trim()) &&
      round?.status !== 'complete' &&
      !isSavingAttempt &&
      !isSubmittingGuess,
    [guess, hasAttempt, isSavingAttempt, isSubmittingGuess, round],
  );

  const saveAttempt = async (
    currentRound: Round,
    attemptBlob: Blob,
    options: { cancelled?: () => boolean } = {},
  ) => {
    const { cancelled } = options;

    setError(null);
    setInfo(null);
    setIsSavingAttempt(true);

    try {
      const reversedAttemptBlob = await reverseAudioBlob(attemptBlob);
      if (cancelled?.()) {
        return;
      }

      const savedRound = await saveRoundAttempt({
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
    if (!round || !recorder.audioBlob || recorder.isRecording || round.status === 'complete') {
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
  }, [onUpdateRound, recorder.audioBlob, recorder.isRecording, round]);

  if (!round) {
    return (
      <section className="surface">
        <div className="empty-state">
          Select a round from the inbox to hear the reversed phrase and record an attempt.
        </div>
      </section>
    );
  }

  const handleSaveAttempt = async () => {
    if (!recorder.audioBlob || round.status === 'complete') {
      return;
    }

    await saveAttempt(round, recorder.audioBlob);
  };

  const handleSubmitGuess = async () => {
    const nextGuess = guess.trim();
    if (!nextGuess) {
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
      setInfo(updatedRound.score === 10 ? 'Exact match. Full score.' : 'Round complete. No exact match.');
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
            {round.player2Name} listens to the reversed prompt, imitates it, and guesses the
            original phrase.
          </p>
        </div>
        <StatusBadge status={round.status} />
      </div>

      <div className="panel-grid">
        <div className="stack">
          <div className="info-banner">
            <strong>{round.player1Name}</strong> recorded the original phrase for{' '}
            <strong>{round.player2Name}</strong>.
          </div>

          <div className="audio-grid">
            <AudioPlayerCard
              title="Reversed Prompt"
              description="Player 2 should imitate this strange-sounding version."
              blob={round.reversedAudioBlob}
              remoteUrl={round.reversedAudioUrl}
            />
            <AudioPlayerCard
              title="Original Phrase"
              description="Reveal and compare after the guess."
              blob={round.originalAudioBlob}
              remoteUrl={round.originalAudioUrl}
            />
            <AudioPlayerCard
              title="Latest Attempt"
              description="Player 2's raw imitation recording."
              blob={recorder.audioBlob ?? round.attemptAudioBlob}
              remoteUrl={round.attemptAudioUrl}
            />
            <AudioPlayerCard
              title="Reversed Attempt"
              description="This should sound close to the original if the imitation was good."
              blob={round.attemptReversedBlob}
              remoteUrl={round.attemptReversedUrl}
            />
          </div>
        </div>

        <div className="stack">
          <div className="surface">
            <div className="section-header">
              <div>
                <h3>Record Attempt</h3>
                <p>Capture a new imitation. It will be reversed automatically and saved to Supabase.</p>
              </div>
            </div>

            <div className="button-row">
              <button
                className="button primary"
                disabled={recorder.isRecording || recorder.isPreparing || round.status === 'complete'}
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

          <div className="surface">
            <div className="section-header">
              <div>
                <h3>Guess + Score</h3>
                <p>Score is based on Wasserstein edit distance, normalized to a 10-point scale.</p>
              </div>
            </div>

            <div className="field">
              <label htmlFor="guess">Player 2 guess</label>
              <input
                id="guess"
                value={guess}
                onChange={(event) => setGuess(event.target.value)}
                disabled={round.status === 'complete' || isSubmittingGuess}
                placeholder="What did Player 1 actually say?"
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
