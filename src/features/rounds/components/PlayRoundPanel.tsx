import { useEffect, useMemo, useRef, useState } from 'react';
import { useAudioRecorder } from '../../../audio/hooks/useAudioRecorder';
import { reverseAudioBlob } from '../../../audio/utils/reverseAudioBlob';
import { AudioPlayerCard } from '../../../components/AudioPlayerCard';
import { ToggleRecordButton } from '../../../components/ToggleRecordButton';
import { StatusBadge } from '../../../components/StatusBadge';
import { saveRoundAttempt, submitRoundGuess } from '../../../lib/rounds';
import { getRoundSummary, getScorePresentation } from '../scorePresentation';
import type { Round } from '../types';

interface PlayRoundPanelProps {
  currentUserId: string;
  round: Round | null;
  onArchiveRound: (round: Round) => Promise<void>;
  onBack: () => void;
  onComposeNextRound: () => void;
  onUpdateRound: (roundId: string, updater: (round: Round) => Round) => void;
}

type RecipientStage = 'listen' | 'record' | 'guess' | 'reveal';

function getRecipientStage(options: {
  hasAttempt: boolean;
  hasConfirmedListen: boolean;
  hasUnsavedAttempt: boolean;
  isSavingAttempt: boolean;
  isRecording: boolean;
  isComplete: boolean;
}): RecipientStage {
  const {
    hasAttempt,
    hasConfirmedListen,
    hasUnsavedAttempt,
    isSavingAttempt,
    isRecording,
    isComplete,
  } = options;

  if (isComplete) {
    return 'reveal';
  }

  if (hasAttempt) {
    return 'guess';
  }

  if (isRecording || hasUnsavedAttempt || isSavingAttempt || hasConfirmedListen) {
    return 'record';
  }

  return 'listen';
}

function getRecipientStepLabel(stage: RecipientStage) {
  switch (stage) {
    case 'listen':
      return 'Step 1 of 4';
    case 'record':
      return 'Step 2 of 4';
    case 'guess':
      return 'Step 3 of 4';
    case 'reveal':
      return 'Step 4 of 4';
  }
}

export function PlayRoundPanel({
  currentUserId,
  round,
  onArchiveRound,
  onBack,
  onComposeNextRound,
  onUpdateRound,
}: PlayRoundPanelProps) {
  const recorder = useAudioRecorder({ preparedStreamIdleMs: 0 });
  const [guess, setGuess] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isSavingAttempt, setIsSavingAttempt] = useState(false);
  const [isSubmittingGuess, setIsSubmittingGuess] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [hasConfirmedListen, setHasConfirmedListen] = useState(false);
  const lastSavedAttemptBlobRef = useRef<Blob | null>(null);

  useEffect(() => {
    setGuess(round?.guess ?? '');
    setError(null);
    setInfo(null);
    setHasConfirmedListen(false);
    recorder.clearRecording();
    lastSavedAttemptBlobRef.current = null;
  }, [round?.id, recorder.clearRecording]);

  const isRecipient = Boolean(round && round.recipientId === currentUserId);
  const hasAttempt = Boolean(
    round &&
      (round.attemptAudioBlob || round.attemptAudioUrl) &&
      (round.attemptReversedBlob || round.attemptReversedUrl),
  );
  const hasUnsavedAttempt = Boolean(
    recorder.audioBlob && lastSavedAttemptBlobRef.current !== recorder.audioBlob,
  );
  const scorePresentation = round ? getScorePresentation(round.score) : null;
  const roundSummary = round ? getRoundSummary(round, isRecipient) : null;
  const recipientStage = round
    ? getRecipientStage({
        hasAttempt,
        hasConfirmedListen,
        hasUnsavedAttempt,
        isSavingAttempt,
        isRecording: recorder.isRecording,
        isComplete: round.status === 'complete',
      })
    : 'listen';

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
      recorder.clearRecording();
      setInfo('Take saved. Your guess step is open now.');
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
      <section className="surface round-screen">
        <div className="round-screen-header">
          <button className="button ghost round-screen-back" onClick={onBack} type="button">
            Back
          </button>
          <div className="round-screen-copy">
            <div className="eyebrow">Round</div>
            <h2>No active round</h2>
            <p>Pick a friend from home to open the current thread.</p>
          </div>
        </div>
      </section>
    );
  }

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
      setInfo(getScorePresentation(updatedRound.score).celebration);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Unable to submit the guess.',
      );
    } finally {
      setIsSubmittingGuess(false);
    }
  };

  const handleArchiveRound = async () => {
    setError(null);
    setInfo(null);
    setIsArchiving(true);

    try {
      await onArchiveRound(round);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to continue the thread right now.',
      );
      setIsArchiving(false);
      return;
    }

    setIsArchiving(false);
  };

  const reviewAudioGrid = (
    <div className="audio-grid">
      <AudioPlayerCard
        title="Your original prompt"
        description="The forward recording that started this round."
        blob={round.originalAudioBlob}
        remoteUrl={round.originalAudioUrl}
      />
      <AudioPlayerCard
        title="Your reversed prompt"
        description="The backward clip your friend heard before imitating it."
        blob={round.reversedAudioBlob}
        remoteUrl={round.reversedAudioUrl}
      />
      <AudioPlayerCard
        title="Their imitation"
        description="Your friend's attempt at copying the reversed prompt."
        blob={round.attemptAudioBlob}
        remoteUrl={round.attemptAudioUrl}
      />
      <AudioPlayerCard
        title="Their imitation reversed"
        description="The flipped version they used when making their guess."
        blob={round.attemptReversedBlob}
        remoteUrl={round.attemptReversedUrl}
      />
    </div>
  );

  return (
    <section className="surface round-screen">
      <div className="round-screen-header">
        <button className="button ghost round-screen-back" onClick={onBack} type="button">
          Back
        </button>

        <div className="round-screen-copy">
          <div className="eyebrow">{isRecipient ? getRecipientStepLabel(recipientStage) : 'Round Review'}</div>
          <h2>{roundSummary?.headline ?? 'Round'}</h2>
          <p>{roundSummary?.description}</p>
        </div>

        <div className="pill-row round-screen-meta">
          <span className="badge primary">
            {isRecipient ? `From ${round.senderUsername}` : `To ${round.recipientUsername}`}
          </span>
          <StatusBadge status={round.status} />
        </div>
      </div>

      {isRecipient ? (
        <div className="round-screen-body">
          {recipientStage === 'listen' ? (
            <div className="round-screen-step">
              <AudioPlayerCard
                title="Reversed prompt"
                description="Replay this clip until you are ready to imitate it."
                blob={round.reversedAudioBlob}
                remoteUrl={round.reversedAudioUrl}
              />

              <div className="helper-text round-screen-helper">
                Nothing else opens until you confirm you are ready to record.
              </div>
            </div>
          ) : null}

          {recipientStage === 'record' ? (
            <div className="round-screen-step">
              <div className="button-row round-record-actions">
                <ToggleRecordButton
                  disabled={round.status === 'complete' || isSavingAttempt}
                  isPreparing={recorder.isPreparing}
                  isRecording={recorder.isRecording}
                  stream={recorder.stream}
                  onStart={recorder.startRecording}
                  onStop={recorder.stopRecording}
                />
                {recorder.audioBlob ? (
                  <button
                    className="button ghost"
                    disabled={recorder.isRecording || isSavingAttempt}
                    onClick={recorder.clearRecording}
                    type="button"
                  >
                    Clear take
                  </button>
                ) : null}
              </div>

              <AudioPlayerCard
                title="Latest take"
                description={
                  recorder.audioBlob
                    ? 'Replay the take you just made.'
                    : 'Your saved imitation appears here after recording.'
                }
                blob={recorder.audioBlob ?? round.attemptAudioBlob}
                remoteUrl={round.attemptAudioUrl}
              />
            </div>
          ) : null}

          {recipientStage === 'guess' ? (
            <div className="round-screen-step">
              <AudioPlayerCard
                title="Reversed take"
                description="Your imitation is locked in. Type the original phrase."
                blob={round.attemptReversedBlob}
                remoteUrl={round.attemptReversedUrl}
              />

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
            </div>
          ) : null}

          {recipientStage === 'reveal' && scorePresentation ? (
            <div className="round-screen-step">
              <div className="result-box">
                <p className={`score-mark tone-${scorePresentation.tone}`}>
                  {scorePresentation.starLabel}
                </p>
                <p>{scorePresentation.celebration}</p>
                <p>{scorePresentation.description}</p>
                <p>
                  <strong>Guess:</strong> {round.guess || 'No guess submitted'}
                </p>
                <p>
                  <strong>Original phrase:</strong> {round.correctPhrase}
                </p>
              </div>

              <AudioPlayerCard
                title="Original prompt"
                description="This is the forward clip that started the round you just finished."
                blob={round.originalAudioBlob}
                remoteUrl={round.originalAudioUrl}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="round-screen-body">
          {round.status === 'waiting_for_attempt' ? (
            <div className="round-screen-step">
              <div className="result-box">
                <p>
                  <strong>Phrase:</strong> {round.correctPhrase}
                </p>
                <p>{roundSummary?.callToAction}</p>
              </div>

              <AudioPlayerCard
                title="Your prompt"
                description="This is the forward clip your friend is about to imitate."
                blob={round.originalAudioBlob}
                remoteUrl={round.originalAudioUrl}
              />
            </div>
          ) : null}

          {round.status === 'attempted' ? (
            <div className="round-screen-step">
              <div className="result-box">
                <p>
                  <strong>Phrase:</strong> {round.correctPhrase}
                </p>
                <p>{roundSummary?.callToAction}</p>
              </div>

              {reviewAudioGrid}
            </div>
          ) : null}

          {round.status === 'complete' && scorePresentation ? (
            <div className="round-screen-step">
              <div className="result-box">
                <p className={`score-mark tone-${scorePresentation.tone}`}>
                  {scorePresentation.starLabel}
                </p>
                <p>{scorePresentation.celebration}</p>
                <p>{scorePresentation.description}</p>
                <p>
                  <strong>Guess:</strong> {round.guess || 'No guess submitted'}
                </p>
                <p>
                  <strong>Original phrase:</strong> {round.correctPhrase}
                </p>
              </div>

              {reviewAudioGrid}
            </div>
          ) : null}
        </div>
      )}

      <div className="round-screen-footer">
        {isRecipient && recipientStage === 'listen' ? (
          <div className="button-row">
            <button
              className="button primary"
              onClick={() => {
                setHasConfirmedListen(true);
              }}
              type="button"
            >
              Ready to imitate
            </button>
          </div>
        ) : null}

        {isRecipient && recipientStage === 'guess' ? (
          <div className="button-row">
            <button
              className="button primary"
              disabled={!canSubmitGuess}
              onClick={() => {
                void handleSubmitGuess();
              }}
              type="button"
            >
              {isSubmittingGuess ? 'Revealing...' : 'Reveal stars'}
            </button>
          </div>
        ) : null}

        {isRecipient && recipientStage === 'reveal' ? (
          <div className="button-row">
            <button
              className="button primary"
              onClick={onComposeNextRound}
              type="button"
            >
              Record next prompt
            </button>
          </div>
        ) : null}

        {!isRecipient && round.status === 'complete' ? (
          <div className="button-row">
            <button
              className="button primary"
              disabled={isArchiving}
              onClick={() => {
                void handleArchiveRound();
              }}
              type="button"
            >
              {isArchiving ? 'Continuing...' : 'Continue thread'}
            </button>
          </div>
        ) : null}
      </div>

      <div className="stack">
        {recorder.error ? <div className="error-banner">{recorder.error}</div> : null}
        {error ? <div className="error-banner">{error}</div> : null}
        {info ? <div className="success-banner">{info}</div> : null}
      </div>
    </section>
  );
}
