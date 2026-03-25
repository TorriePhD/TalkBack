import { useEffect, useMemo, useRef, useState } from 'react';
import { useAudioRecorder } from '../../../audio/hooks/useAudioRecorder';
import { reverseAudioBlob } from '../../../audio/utils/reverseAudioBlob';
import { AudioPlayerCard } from '../../../components/AudioPlayerCard';
import { HoldToRecordButton } from '../../../components/HoldToRecordButton';
import { StatusBadge } from '../../../components/StatusBadge';
import { saveRoundAttempt, submitRoundGuess } from '../../../lib/rounds';
import { getRoundSummary, getScorePresentation } from '../scorePresentation';
import type { Round } from '../types';

interface PlayRoundPanelProps {
  currentUserId: string;
  round: Round | null;
  onUpdateRound: (roundId: string, updater: (round: Round) => Round) => void;
}

type GuidedStepState = 'pending' | 'active' | 'done';
type RecipientStage = 'listen' | 'record' | 'guess' | 'reveal';

interface GuidedStep {
  id: string;
  title: string;
  description: string;
  state: GuidedStepState;
}

const RECIPIENT_STAGE_ORDER: RecipientStage[] = ['listen', 'record', 'guess', 'reveal'];

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

function getRecipientSteps(activeStage: RecipientStage): GuidedStep[] {
  const activeIndex = RECIPIENT_STAGE_ORDER.indexOf(activeStage);

  return [
    {
      id: 'listen',
      title: 'Listen',
      description: 'Replay the backward prompt until you are ready.',
      state: activeIndex > 0 ? 'done' : 'active',
    },
    {
      id: 'record',
      title: 'Record',
      description: 'Hold to record your imitation.',
      state: activeIndex > 1 ? 'done' : activeIndex === 1 ? 'active' : 'pending',
    },
    {
      id: 'guess',
      title: 'Guess',
      description: 'Type the phrase you think you heard.',
      state: activeIndex > 2 ? 'done' : activeIndex === 2 ? 'active' : 'pending',
    },
    {
      id: 'reveal',
      title: 'Reveal',
      description: 'See the medal, score, and original phrase.',
      state: activeIndex === 3 ? 'active' : 'pending',
    },
  ];
}

function getSenderSteps(round: Round): GuidedStep[] {
  if (round.status === 'complete') {
    return [
      {
        id: 'sent',
        title: 'Sent',
        description: 'The round went out successfully.',
        state: 'done',
      },
      {
        id: 'played',
        title: 'Played',
        description: `${round.recipientEmail} finished the challenge.`,
        state: 'done',
      },
      {
        id: 'reveal',
        title: 'Reveal',
        description: 'The final result is unlocked.',
        state: 'active',
      },
    ];
  }

  if (round.status === 'attempted') {
    return [
      {
        id: 'sent',
        title: 'Sent',
        description: 'Your round is already live.',
        state: 'done',
      },
      {
        id: 'played',
        title: 'Played',
        description: `${round.recipientEmail} recorded a take.`,
        state: 'active',
      },
      {
        id: 'reveal',
        title: 'Reveal',
        description: 'They still need to submit a guess.',
        state: 'pending',
      },
    ];
  }

  return [
    {
      id: 'sent',
      title: 'Sent',
      description: 'The round is live.',
      state: 'done',
    },
    {
      id: 'waiting',
      title: 'Waiting',
      description: `${round.recipientEmail} has not recorded yet.`,
      state: 'active',
    },
    {
      id: 'reveal',
      title: 'Reveal',
      description: 'The score appears after their guess.',
      state: 'pending',
    },
  ];
}

export function PlayRoundPanel({
  currentUserId,
  round,
  onUpdateRound,
}: PlayRoundPanelProps) {
  const recorder = useAudioRecorder({ prepareOnMount: true });
  const [guess, setGuess] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isSavingAttempt, setIsSavingAttempt] = useState(false);
  const [isSubmittingGuess, setIsSubmittingGuess] = useState(false);
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
  const recipientSteps = round ? getRecipientSteps(recipientStage) : [];
  const senderSteps = round ? getSenderSteps(round) : [];
  const activeRecipientStepIndex = recipientSteps.findIndex((step) => step.state === 'active');
  const activeRecipientStep = recipientSteps[activeRecipientStepIndex] ?? null;

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
      setInfo('Take saved. Move on to your guess.');
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
          Select a round from home to start the listen, record, guess, and reveal flow.
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

  return (
    <section className="surface">
      <div className="section-header">
        <div>
          <div className="eyebrow">{isRecipient ? 'Your Turn' : 'Sent Round'}</div>
          <h2>{isRecipient ? 'Play Round' : 'Round Progress'}</h2>
          <p>{roundSummary?.headline ?? 'Tap a round to begin.'}</p>
        </div>
        <StatusBadge status={round.status} />
      </div>

      {isRecipient ? (
        <div className="stack round-stage-shell">
          <div className="progress-rail" aria-label="Round steps">
            {recipientSteps.map((step, index) => (
              <div
                className={`progress-pill progress-pill-${step.state}`}
                key={step.id}
              >
                <span className="progress-pill-number">{index + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  <span>{step.description}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="surface nested-surface round-focus-panel">
            <div className="section-header">
              <div>
                <div className="eyebrow">
                  Step {Math.max(activeRecipientStepIndex + 1, 1)} of {recipientSteps.length}
                </div>
                <h3>{activeRecipientStep?.title ?? 'Round step'}</h3>
                <p>{activeRecipientStep?.description ?? roundSummary?.description}</p>
              </div>
            </div>

            {recipientStage === 'listen' ? (
              <div className="stack">
                <AudioPlayerCard
                  title="Reversed prompt"
                  description="Replay this clip until you are ready to imitate it."
                  blob={round.reversedAudioBlob}
                  remoteUrl={round.reversedAudioUrl}
                />

                <div className="button-row">
                  <button
                    className="button primary"
                    onClick={() => {
                      void recorder.prepareRecording();
                      setHasConfirmedListen(true);
                    }}
                    type="button"
                  >
                    Ready to imitate
                  </button>
                </div>

                <div className="helper-text">
                  Nothing else is on screen until you move to the recording step.
                </div>
              </div>
            ) : null}

            {recipientStage === 'record' ? (
              <div className="stack">
                <AudioPlayerCard
                  title="Replay the prompt"
                  description="Use this if you need another listen before recording."
                  blob={round.reversedAudioBlob}
                  remoteUrl={round.reversedAudioUrl}
                />

                <div className="button-row">
                  <HoldToRecordButton
                    disabled={round.status === 'complete' || isSavingAttempt}
                    isPrepared={recorder.isPrepared}
                    isPreparing={recorder.isPreparing}
                    isRecording={recorder.isRecording}
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
                      : 'Your most recent take will show up here after recording.'
                  }
                  blob={recorder.audioBlob ?? round.attemptAudioBlob}
                  remoteUrl={round.attemptAudioUrl}
                />

                <div className="helper-text">
                  {recorder.isRecording
                    ? 'Recording now. Release when you want to save the take.'
                    : isSavingAttempt
                      ? 'Saving and reversing your take now...'
                      : 'The mic is warmed up on open so recording can start as soon as you press.'}
                </div>
              </div>
            ) : null}

            {recipientStage === 'guess' ? (
              <div className="stack">
                <AudioPlayerCard
                  title="Reversed take"
                  description="Your imitation is locked in and flipped back. Type the original phrase."
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

                <div className="button-row">
                  <button
                    className="button primary"
                    disabled={!canSubmitGuess}
                    onClick={() => {
                      void handleSubmitGuess();
                    }}
                    type="button"
                  >
                    {isSubmittingGuess ? 'Revealing...' : 'Reveal score'}
                  </button>
                </div>
              </div>
            ) : null}

            {recipientStage === 'reveal' && scorePresentation ? (
              <div className="stack">
                <div className="result-box">
                  <p className={`score-mark tone-${scorePresentation.tone}`}>
                    {scorePresentation.medalLabel}
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

                <div className="audio-grid">
                  <AudioPlayerCard
                    title="Original prompt"
                    description="This is the forward version that started the round."
                    blob={round.originalAudioBlob}
                    remoteUrl={round.originalAudioUrl}
                  />
                  <AudioPlayerCard
                    title="Your imitation"
                    description="Replay the take that was scored."
                    blob={round.attemptAudioBlob}
                    remoteUrl={round.attemptAudioUrl}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="surface nested-surface round-side-card">
            <div className="section-header compact-header">
              <div>
                <h3>Round summary</h3>
                <p>{roundSummary?.description}</p>
              </div>
            </div>

            <div className="result-box">
              <p>
                <strong>From:</strong> {round.senderEmail}
              </p>
              <p>{roundSummary?.callToAction}</p>
              <p>
                {round.status === 'complete'
                  ? 'The reveal is unlocked, so you can replay the clips or go start another round.'
                  : 'Complete the current step and the next one opens automatically.'}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="stack round-stage-shell">
          <div className="progress-rail" aria-label="Round status">
            {senderSteps.map((step, index) => (
              <div
                className={`progress-pill progress-pill-${step.state}`}
                key={step.id}
              >
                <span className="progress-pill-number">{index + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  <span>{step.description}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="surface nested-surface round-focus-panel">
            <div className="section-header">
              <div>
                <h3>Round progress</h3>
                <p>{roundSummary?.description}</p>
              </div>
              <StatusBadge status={round.status} />
            </div>

            <div className="result-box">
              <p>
                <strong>Recipient:</strong> {round.recipientEmail}
              </p>
              <p>
                <strong>Phrase:</strong> {round.correctPhrase}
              </p>
              {round.status === 'complete' && scorePresentation ? (
                <>
                  <p className={`score-mark tone-${scorePresentation.tone}`}>
                    {scorePresentation.medalLabel}
                  </p>
                  <p>{scorePresentation.celebration}</p>
                  <p>{scorePresentation.description}</p>
                  <p>
                    <strong>Guess:</strong> {round.guess || 'No guess submitted'}
                  </p>
                </>
              ) : (
                <p>{roundSummary?.callToAction}</p>
              )}
            </div>

            <div className="audio-grid">
              <AudioPlayerCard
                title="Original prompt"
                description="Your forward recording for this round."
                blob={round.originalAudioBlob}
                remoteUrl={round.originalAudioUrl}
              />
              <AudioPlayerCard
                title="Saved imitation"
                description="This unlocks once the recipient records a take."
                blob={round.attemptAudioBlob}
                remoteUrl={round.attemptAudioUrl}
              />
            </div>
          </div>
        </div>
      )}

      <div className="stack">
        {recorder.error ? <div className="error-banner">{recorder.error}</div> : null}
        {error ? <div className="error-banner">{error}</div> : null}
        {info ? <div className="success-banner">{info}</div> : null}
      </div>
    </section>
  );
}
