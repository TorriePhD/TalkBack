import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudioRecorder } from '../../../audio/hooks/useAudioRecorder';
import { reverseAudioBlob } from '../../../audio/utils/reverseAudioBlob';
import { AudioPlayerCard } from '../../../components/AudioPlayerCard';
import { StarRating } from '../../../components/StarRating';
import { ToggleRecordButton } from '../../../components/ToggleRecordButton';
import { useCoins } from '../../resources/ResourceProvider';
import { claimReward, getRoundReward } from '../../../lib/roundRewards';
import { markRoundResultsViewed, saveRoundAttempt, submitRoundGuess } from '../../../lib/rounds';
import { getRoundSummary, getScorePresentation } from '../scorePresentation';
import type { Round, RoundReward } from '../types';
import { RoundRewardSequence } from './RoundRewardSequence';

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

function getRewardAnimationStorageKey(userId: string, roundId: string) {
  return `backtalk:round-reward:${userId}:${roundId}`;
}

function hasStartedRewardAnimation(userId: string, roundId: string) {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.sessionStorage.getItem(getRewardAnimationStorageKey(userId, roundId)) === 'started';
}

function markRewardAnimationStarted(userId: string, roundId: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(getRewardAnimationStorageKey(userId, roundId), 'started');
}

function clearRewardAnimationState(userId: string, roundId: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.removeItem(getRewardAnimationStorageKey(userId, roundId));
}

function formatDifficultyLabel(difficulty: RoundReward['difficulty']) {
  return difficulty.toUpperCase();
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
  const { coins, isLoadingCoins, refreshCoins, setCoinBalance, setCoinPreview } = useCoins();
  const [guess, setGuess] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isSavingAttempt, setIsSavingAttempt] = useState(false);
  const [isSubmittingGuess, setIsSubmittingGuess] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isLoadingReward, setIsLoadingReward] = useState(false);
  const [isAnimatingReward, setIsAnimatingReward] = useState(false);
  const [isClaimingReward, setIsClaimingReward] = useState(false);
  const [roundReward, setRoundReward] = useState<RoundReward | null>(null);
  const [localCoinGain, setLocalCoinGain] = useState(0);
  const [displayedTotalCoins, setDisplayedTotalCoins] = useState(0);
  const [hasConfirmedListen, setHasConfirmedListen] = useState(false);
  const lastSavedAttemptBlobRef = useRef<Blob | null>(null);
  const rewardBaseCoinsRef = useRef(0);
  const loadedRewardRoundIdRef = useRef<string | null>(null);

  useEffect(() => {
    setGuess(round?.guess ?? '');
    setError(null);
    setInfo(null);
    setHasConfirmedListen(false);
    recorder.clearRecording();
    lastSavedAttemptBlobRef.current = null;
    setRoundReward(null);
    setIsLoadingReward(false);
    setIsAnimatingReward(false);
    setIsClaimingReward(false);
    setLocalCoinGain(0);
    setDisplayedTotalCoins(coins);
    rewardBaseCoinsRef.current = coins;
    loadedRewardRoundIdRef.current = null;
    setCoinPreview(null);
  }, [currentUserId, round?.id, recorder.clearRecording, setCoinPreview]);

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
  const isRewardBusy = isAnimatingReward || isClaimingReward;

  const updateRewardPreview = useCallback(
    (nextDisplayedCoins: number) => {
      setDisplayedTotalCoins(nextDisplayedCoins);
      setLocalCoinGain(Math.max(0, nextDisplayedCoins - rewardBaseCoinsRef.current));
      setCoinPreview(nextDisplayedCoins);
    },
    [setCoinPreview],
  );

  const settleClaimedReward = useCallback(
    async (rewardToSettle: RoundReward, options: { claimedNow: boolean; currentBalance: number | null }) => {
      if (options.currentBalance !== null) {
        setCoinBalance(options.currentBalance);
        setDisplayedTotalCoins(options.currentBalance);
      } else {
        try {
          const refreshedCoins = await refreshCoins();
          setDisplayedTotalCoins(refreshedCoins);
        } catch (refreshError) {
          console.warn('Unable to refresh BB Coins after claiming a round reward.', refreshError);
        }
      }

      setRoundReward({ ...rewardToSettle, claimed: true });
      setLocalCoinGain(0);
      setIsAnimatingReward(false);
      setIsClaimingReward(false);
      setCoinPreview(null);
      clearRewardAnimationState(currentUserId, rewardToSettle.roundId);
      setInfo(
        rewardToSettle.rewardAmount > 0 && options.claimedNow
          ? `Reward claimed. +${rewardToSettle.rewardAmount} BB Coins.`
          : 'Reward already settled for this round.',
      );
    },
    [currentUserId, refreshCoins, setCoinBalance, setCoinPreview],
  );

  const finalizePendingRewardClaim = useCallback(
    async (rewardToClaim: RoundReward) => {
      setIsAnimatingReward(false);
      setIsClaimingReward(true);

      try {
        const claimResult = await claimReward(currentUserId, rewardToClaim.roundId);

        if (!claimResult) {
          setRoundReward(null);
          setLocalCoinGain(0);
          setDisplayedTotalCoins(rewardBaseCoinsRef.current);
          setIsClaimingReward(false);
          setCoinPreview(null);
          clearRewardAnimationState(currentUserId, rewardToClaim.roundId);
          return;
        }

        await settleClaimedReward(claimResult.reward, {
          claimedNow: claimResult.claimedNow,
          currentBalance: claimResult.currentBalance,
        });
      } catch (caughtError) {
        setIsClaimingReward(false);
        setCoinPreview(null);
        setDisplayedTotalCoins(rewardBaseCoinsRef.current);
        setLocalCoinGain(0);
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : 'Unable to claim the round reward.',
        );
      }
    },
    [currentUserId, settleClaimedReward, setCoinPreview],
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

  useEffect(() => {
    if (!round || round.status !== 'complete' || !currentUserId || isLoadingCoins) {
      return;
    }

    if (loadedRewardRoundIdRef.current === round.id) {
      return;
    }

    loadedRewardRoundIdRef.current = round.id;
    let cancelled = false;

    const loadRoundReward = async () => {
      setIsLoadingReward(true);

      try {
        try {
          await markRoundResultsViewed(round.id);
        } catch (markViewedError) {
          console.warn('Unable to mark the completed round as viewed.', markViewedError);
        }

        const reward = await getRoundReward(currentUserId, round.id);

        if (cancelled) {
          return;
        }

        setRoundReward(reward);
        rewardBaseCoinsRef.current = coins;
        setDisplayedTotalCoins(coins);
        setLocalCoinGain(0);

        if (!reward) {
          setCoinPreview(null);
          return;
        }

        if (reward.claimed) {
          setCoinPreview(null);
          clearRewardAnimationState(currentUserId, round.id);
          return;
        }

        if (hasStartedRewardAnimation(currentUserId, round.id)) {
          updateRewardPreview(coins + reward.rewardAmount);
          await finalizePendingRewardClaim(reward);
          return;
        }

        updateRewardPreview(coins);
        markRewardAnimationStarted(currentUserId, round.id);
        setIsAnimatingReward(true);
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to load the round reward.',
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingReward(false);
        }
      }
    };

    void loadRoundReward();

    return () => {
      cancelled = true;
    };
  }, [
    coins,
    currentUserId,
    finalizePendingRewardClaim,
    isLoadingCoins,
    round,
    updateRewardPreview,
    setCoinPreview,
  ]);

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
        difficulty: round.difficulty,
      });

      onUpdateRound(round.id, (currentRound) => ({
        ...updatedRound,
        originalAudioBlob: currentRound.originalAudioBlob,
        reversedAudioBlob: currentRound.reversedAudioBlob,
        attemptAudioBlob: currentRound.attemptAudioBlob,
        attemptReversedBlob: currentRound.attemptReversedBlob,
      }));
      setInfo('Score revealed. Your BB Coin reward will lock in on this results screen.');
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Unable to submit the guess.',
      );
    } finally {
      setIsSubmittingGuess(false);
    }
  };

  const handleReadyToImitate = async () => {
    await recorder.prepareRecording();
    setHasConfirmedListen(true);
  };

  const handleArchiveRound = async () => {
    if (isRewardBusy) {
      return;
    }

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

  const rewardStatusCard =
    round.status === 'complete' ? (
      <div className="result-box reward-status-box">
        <div className="reward-status-header">
          <div>
            <strong>BB Coin reward</strong>
            <p>
              {isRecipient
                ? 'This reward is only claimed for you when you open the results reveal.'
                : 'Your reward settles here independently from your friend’s timeline.'}
            </p>
          </div>
          {roundReward ? (
            <span className={`badge ${roundReward.claimed ? 'complete' : 'attempted'}`}>
              {roundReward.claimed ? 'Claimed' : isRewardBusy ? 'Locking in' : 'Pending'}
            </span>
          ) : null}
        </div>

        {isLoadingReward ? <p>Checking your reward state...</p> : null}

        {!isLoadingReward && roundReward ? (
          <>
            <div className="reward-status-metrics">
              <span className="reward-status-pill">{roundReward.stars} stars</span>
              <span className="reward-status-pill">{formatDifficultyLabel(roundReward.difficulty)}</span>
              <span className="reward-status-pill">
                +{roundReward.rewardAmount.toLocaleString()} BB Coins
              </span>
            </div>
            <p>
              <strong>Wallet total:</strong> {displayedTotalCoins.toLocaleString()} BB Coins
              {localCoinGain > 0 ? ` (+${localCoinGain.toLocaleString()} in motion)` : ''}
            </p>
            <p>
              {roundReward.claimed
                ? 'This reward has already been collected for your account.'
                : isAnimatingReward
                  ? 'Reward reveal in progress.'
                  : isClaimingReward
                    ? 'Finalizing your BB Coins...'
                    : 'Your reward is ready the moment this results view opens.'}
            </p>
          </>
        ) : null}

        {!isLoadingReward && !roundReward ? (
          <p>Reward data is missing for this round, so no BB Coin payout can be shown here.</p>
        ) : null}

        {!isRecipient && round.status === 'complete' ? (
          <p className="reward-status-note">
            Continue thread unlocks only after both players have opened the results screen.
          </p>
        ) : null}
      </div>
    ) : null;

  return (
    <section className="surface round-screen">
      <div className="round-screen-header">
        <div className="round-screen-copy">
          <div className="eyebrow">{isRecipient ? getRecipientStepLabel(recipientStage) : 'Round Review'}</div>
          <h2>{roundSummary?.headline ?? 'Round'}</h2>
          <p>{roundSummary?.description}</p>
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
                  liveStream={recorder.liveStream}
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
                {scorePresentation.starCount === null ? (
                  <p className={`score-mark tone-${scorePresentation.tone}`}>{scorePresentation.starLabel}</p>
                ) : (
                  <StarRating
                    label={scorePresentation.starLabel}
                    large
                    value={scorePresentation.starCount}
                  />
                )}
                <p>
                  <strong>You guessed:</strong> {round.guess || 'No guess submitted'}
                </p>
                <p>
                  <strong>{round.senderUsername} said:</strong> {round.correctPhrase}
                </p>
              </div>

              {rewardStatusCard}

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
                title="Your prompt reversed"
                description="This is the flipped clip your friend is hearing while they record."
                blob={round.reversedAudioBlob}
                remoteUrl={round.reversedAudioUrl}
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
                {scorePresentation.starCount === null ? (
                  <p className={`score-mark tone-${scorePresentation.tone}`}>{scorePresentation.starLabel}</p>
                ) : (
                  <StarRating
                    label={scorePresentation.starLabel}
                    large
                    value={scorePresentation.starCount}
                  />
                )}
                <p>
                  <strong>You said:</strong> {round.correctPhrase}
                </p>
                <p>
                  <strong>{round.recipientUsername} guessed:</strong> {round.guess || 'No guess submitted'}
                </p>
              </div>

              {rewardStatusCard}

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
                void handleReadyToImitate();
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
              disabled={isRewardBusy}
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
              disabled={isArchiving || isRewardBusy || isLoadingReward}
              onClick={() => {
                void handleArchiveRound();
              }}
              type="button"
            >
              {isArchiving
                ? 'Continuing...'
                : isLoadingReward
                  ? 'Checking reward...'
                  : 'Continue thread'}
            </button>
          </div>
        ) : null}
      </div>

      {isAnimatingReward && roundReward ? (
        <RoundRewardSequence
          baseCoins={rewardBaseCoinsRef.current}
          onDisplayedCoinsChange={updateRewardPreview}
          onSequenceComplete={() => finalizePendingRewardClaim(roundReward)}
          reward={roundReward}
        />
      ) : null}

      {isClaimingReward && !isAnimatingReward ? (
        <div className="reward-claiming-overlay" role="status" aria-live="polite">
          <div className="reward-claiming-card">
            <strong>Finalizing BB Coins</strong>
            <p>Your reward is being committed to your wallet now.</p>
          </div>
        </div>
      ) : null}

      <div className="stack">
        {recorder.error ? <div className="error-banner">{recorder.error}</div> : null}
        {error ? <div className="error-banner">{error}</div> : null}
        {info ? <div className="success-banner">{info}</div> : null}
      </div>
    </section>
  );
}
