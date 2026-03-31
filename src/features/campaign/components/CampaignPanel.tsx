import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAudioRecorder } from '../../../audio/hooks/useAudioRecorder';
import { reverseAudioBlob } from '../../../audio/utils/reverseAudioBlob';
import { AudioPlayerCard } from '../../../components/AudioPlayerCard';
import { StarRating } from '../../../components/StarRating';
import { ToggleRecordButton } from '../../../components/ToggleRecordButton';
import { WaveformLoader } from '../../../components/WaveformLoader';
import {
  completeCampaignChallenge,
  consumeCampaignAttempt,
  listCampaignLeaderboard,
  loadActiveCampaignState,
} from '../../../lib/campaigns';
import { useCoins } from '../../resources/ResourceProvider';
import { calculateGuessSimilarity } from '../../rounds/utils';
import { buildBackwardPhraseExample, formatDifficultyLabel, getCampaignStars } from '../scoring';
import { transcribeAudio, warmCampaignTranscriber } from '../transcription';

interface CampaignPanelProps {
  currentUserId: string;
  onBack: () => void;
}

type CampaignStage =
  | 'overview'
  | 'briefing'
  | 'recording-original'
  | 'guide'
  | 'recording-attempt'
  | 'attempt-ready'
  | 'processing'
  | 'result';

type CampaignState = NonNullable<Awaited<ReturnType<typeof loadActiveCampaignState>>>;
type CampaignChallenge = CampaignState['challenges'][number];

const FLOATING_EGGS = [
  { top: '5%', left: '4%', size: 36, delay: '0s' },
  { top: '12%', left: '80%', size: 54, delay: '1.2s' },
  { top: '28%', left: '12%', size: 44, delay: '2.1s' },
  { top: '35%', left: '88%', size: 34, delay: '0.6s' },
  { top: '52%', left: '6%', size: 48, delay: '1.8s' },
  { top: '62%', left: '84%', size: 40, delay: '2.8s' },
  { top: '76%', left: '18%', size: 30, delay: '0.9s' },
  { top: '84%', left: '74%', size: 52, delay: '2.3s' },
] as const;

function LeaderboardIcon() {
  return (
    <svg aria-hidden="true" className="campaign-side-action-svg" fill="none" viewBox="0 0 24 24">
      <path
        d="M6 18V9m6 9V6m6 12v-5M4 20h16"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function getAssetValue(state: CampaignState | null, key: string) {
  const assets = (
    state as { assets?: Record<string, string> | Array<{ key: string; value: string }> } | null
  )?.assets;

  if (!assets) {
    return null;
  }

  if (Array.isArray(assets)) {
    return assets.find((entry) => entry.key === key)?.value ?? null;
  }

  return assets[key] ?? null;
}

function isToday(value: string | null | undefined) {
  return Boolean(value && value.slice(0, 10) === new Date().toISOString().slice(0, 10));
}

function getRetryCost(attemptState: unknown) {
  const retryCost = Number((attemptState as { retryCost?: unknown } | null)?.retryCost ?? 10);
  return Number.isFinite(retryCost) ? retryCost : 10;
}

function isPaidRetry(attemptState: unknown) {
  const attemptsToday = Number((attemptState as { attemptsToday?: unknown } | null)?.attemptsToday ?? 0);
  const lastAttemptDate = (attemptState as { lastAttemptDate?: unknown } | null)?.lastAttemptDate;
  return attemptsToday >= 1 && typeof lastAttemptDate === 'string' && isToday(lastAttemptDate);
}

function getChallengeState(index: number, currentIndex: number, completedCount: number) {
  if (index <= completedCount) {
    return 'completed';
  }

  if (index === currentIndex) {
    return 'current';
  }

  return 'locked';
}

function getAttemptSummary(attemptState: unknown) {
  return isPaidRetry(attemptState)
    ? `Free attempt used today. Next retry costs ${getRetryCost(attemptState)} BB Coins.`
    : '1 free attempt per challenge each day. Extra retries cost 10 BB Coins.';
}

function formatThemeName(value: string | null | undefined) {
  if (!value) {
    return '';
  }

  return value
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatCampaignTitle(state: CampaignState | null) {
  const themeName = formatThemeName(state?.campaign.theme);

  if (themeName) {
    return `${themeName} Campaign`;
  }

  const rawTitle = getAssetValue(state, 'title') ?? state?.campaign.name ?? 'Monthly Campaign';
  const trimmedTitle = rawTitle.trim();
  const campaignMatch = trimmedTitle.match(/^(.*?\bcampaign)\b/i);

  return campaignMatch?.[1]?.trim() || trimmedTitle || 'Monthly Campaign';
}

function formatCampaignDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(parsedDate);
}

function buildCampaignSummary(state: CampaignState | null, challengeCount: number) {
  if (!state) {
    return 'Complete each challenge in order. You need 3 stars to unlock the next egg.';
  }

  return `${challengeCount} Easter challenges. Earn 3 stars to open the next egg. Each challenge gives you one free try per day.`;
}

function buildRoadWindow(challenges: CampaignChallenge[], currentIndex: number) {
  const currentChallenge =
    challenges.find((challenge) => challenge.challengeIndex === currentIndex) ?? null;

  if (!currentChallenge) {
    return challenges.slice(-4).reverse();
  }

  return challenges
    .filter(
      (challenge) =>
        challenge.challengeIndex >= currentIndex && challenge.challengeIndex < currentIndex + 4,
    )
    .reverse();
}

function getRoadNodeTop(index: number, total: number) {
  if (total <= 1) {
    return '74%';
  }

  const start = 16;
  const end = 74;
  const step = (end - start) / (total - 1);
  return `${start + index * step}%`;
}

export function CampaignPanel({ currentUserId, onBack }: CampaignPanelProps) {
  const originalRecorder = useAudioRecorder({ preparedStreamIdleMs: 0 });
  const attemptRecorder = useAudioRecorder({ preparedStreamIdleMs: 0 });
  const { refreshCoins, setCoinBalance } = useCoins();
  const [campaignState, setCampaignState] = useState<CampaignState | null>(null);
  const [stage, setStage] = useState<CampaignStage>('overview');
  const [isLoadingCampaign, setIsLoadingCampaign] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [originalRecording, setOriginalRecording] = useState<Blob | null>(null);
  const [guideRecording, setGuideRecording] = useState<Blob | null>(null);
  const [attemptRecording, setAttemptRecording] = useState<Blob | null>(null);
  const [reversedAttemptRecording, setReversedAttemptRecording] = useState<Blob | null>(null);
  const [transcript, setTranscript] = useState('');
  const [score, setScore] = useState(0);
  const [stars, setStars] = useState(0);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [leaderboardFriendsOnly, setLeaderboardFriendsOnly] = useState(false);
  const [leaderboardEntries, setLeaderboardEntries] = useState<Array<Record<string, unknown>>>([]);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState(false);
  const [asrWarmError, setAsrWarmError] = useState<string | null>(null);

  const resetFlow = useCallback(() => {
    setStage('overview');
    setOriginalRecording(null);
    setGuideRecording(null);
    setAttemptRecording(null);
    setReversedAttemptRecording(null);
    setTranscript('');
    setScore(0);
    setStars(0);
    setError(null);
    setInfo(null);
    originalRecorder.clearRecording();
    attemptRecorder.clearRecording();
  }, [attemptRecorder, originalRecorder]);

  const refreshCampaign = useCallback(async () => {
    setIsLoadingCampaign(true);
    setError(null);

    try {
      const nextState = (await loadActiveCampaignState(currentUserId)) as CampaignState | null;
      setCampaignState(nextState);
      return nextState;
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'Unable to load the active campaign.',
      );
      return null;
    } finally {
      setIsLoadingCampaign(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    void refreshCampaign();
  }, [refreshCampaign]);

  useEffect(() => {
    let cancelled = false;

    const warmAsr = async () => {
      try {
        await warmCampaignTranscriber();
      } catch (caughtError) {
        if (!cancelled) {
          setAsrWarmError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to warm the speech model.',
          );
        }
      }
    };

    void warmAsr();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!campaignState?.challenges.length) {
      setStage('overview');
      return;
    }

    const activeChallengeExists = campaignState.challenges.some(
      (challenge) => challenge.challengeIndex === campaignState.progress.currentIndex,
    );

    if (!activeChallengeExists && stage !== 'overview') {
      setStage('overview');
    }
  }, [campaignState, stage]);

  useEffect(() => {
    if (
      !originalRecorder.audioBlob ||
      originalRecorder.isRecording ||
      stage !== 'recording-original'
    ) {
      return;
    }

    let cancelled = false;

    const buildGuide = async () => {
      try {
        const nextGuide = await reverseAudioBlob(originalRecorder.audioBlob as Blob);

        if (cancelled) {
          return;
        }

        setOriginalRecording(originalRecorder.audioBlob);
        setGuideRecording(nextGuide);
        setStage('guide');
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to reverse the guide recording.',
          );
        }
      }
    };

    void buildGuide();

    return () => {
      cancelled = true;
    };
  }, [originalRecorder.audioBlob, originalRecorder.isRecording, stage]);

  useEffect(() => {
    if (
      !attemptRecorder.audioBlob ||
      attemptRecorder.isRecording ||
      stage !== 'recording-attempt'
    ) {
      return;
    }

    setAttemptRecording(attemptRecorder.audioBlob);
    setStage('attempt-ready');
  }, [attemptRecorder.audioBlob, attemptRecorder.isRecording, stage]);

  const challenges = campaignState?.challenges ?? [];
  const currentIndex = campaignState?.progress.currentIndex ?? 1;
  const completedCount = campaignState?.progress.completedCount ?? 0;
  const currentChallenge =
    challenges.find((challenge) => challenge.challengeIndex === currentIndex) ?? null;
  const currentAttemptState = currentChallenge ? campaignState?.attemptState ?? null : null;
  const challengeState = currentChallenge
    ? getChallengeState(currentChallenge.challengeIndex, currentIndex, completedCount)
    : 'completed';
  const title = formatCampaignTitle(campaignState);
  const subtitle = buildCampaignSummary(campaignState, challenges.length);
  const bannerImage = getAssetValue(campaignState, 'banner_image');
  const challengeIcon = getAssetValue(campaignState, 'challenge_icon');
  const endDateLabel = formatCampaignDate(campaignState?.campaign.endDate);
  const roadChallenges = useMemo(
    () => buildRoadWindow(challenges, currentIndex),
    [challenges, currentIndex],
  );

  const startOriginalRecording = useCallback(async () => {
    await originalRecorder.prepareRecording();
    await originalRecorder.startRecording();
  }, [originalRecorder]);

  const startAttemptRecording = useCallback(async () => {
    await attemptRecorder.prepareRecording();
    await attemptRecorder.startRecording();
  }, [attemptRecorder]);

  const openAttemptStep = useCallback(() => {
    setError(null);
    setInfo(null);
    setAttemptRecording(null);
    setReversedAttemptRecording(null);
    setTranscript('');
    setScore(0);
    setStars(0);
    attemptRecorder.clearRecording();
    setStage('recording-attempt');
  }, [attemptRecorder]);

  const openChallengeBriefing = useCallback(() => {
    if (!currentChallenge) {
      return;
    }

    setError(null);
    setInfo(null);
    setStage('briefing');
  }, [currentChallenge]);

  const handleProcessAttempt = useCallback(async () => {
    if (!currentChallenge || !attemptRecording) {
      return;
    }

    const costsCoins = isPaidRetry(currentAttemptState);
    const retryCost = getRetryCost(currentAttemptState);

    if (costsCoins && typeof window !== 'undefined') {
      const confirmed = window.confirm(`This retry costs ${retryCost} BB Coins. Continue?`);

      if (!confirmed) {
        return;
      }
    }

    setStage('processing');
    setError(null);
    setInfo(null);

    try {
      const consumeResult = await consumeCampaignAttempt(currentChallenge.id);
      const currentBalance = (consumeResult as { currentBalance?: unknown } | null)?.currentBalance;

      if (typeof currentBalance === 'number') {
        setCoinBalance(currentBalance);
      } else {
        await refreshCoins();
      }

      const nextReversedAttempt = await reverseAudioBlob(attemptRecording);
      const nextTranscript = await transcribeAudio(nextReversedAttempt);
      const nextScore = calculateGuessSimilarity(nextTranscript, currentChallenge.phrase);
      const nextStars = getCampaignStars(nextScore);
      const completionResult = await completeCampaignChallenge({
        challengeId: currentChallenge.id,
        stars: nextStars,
        transcript: nextTranscript,
        score: nextScore,
      });
      const progress =
        ((completionResult as { progress?: unknown } | null)?.progress ??
          completionResult) as CampaignState['progress'] | null;

      setCampaignState((current) =>
        current
          ? {
              ...current,
              progress: progress ?? current.progress,
              attemptState:
                ((consumeResult as { attemptState?: unknown } | null)?.attemptState ??
                  consumeResult) as CampaignState['attemptState'],
            }
          : current,
      );
      setReversedAttemptRecording(nextReversedAttempt);
      setTranscript(nextTranscript);
      setScore(nextScore);
      setStars(nextStars);
      setStage('result');

      if ((consumeResult as { charged?: unknown } | null)?.charged) {
        setInfo(`Retry charged: -${retryCost} BB Coins.`);
      }

      if (nextStars >= 3) {
        await refreshCampaign();
        setInfo('Challenge cleared. The next egg is ready on the road.');
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to score this campaign attempt.',
      );
      setStage('attempt-ready');
    }
  }, [
    attemptRecording,
    currentAttemptState,
    currentChallenge,
    refreshCampaign,
    refreshCoins,
    setCoinBalance,
  ]);

  useEffect(() => {
    if (!leaderboardOpen || !campaignState) {
      return;
    }

    let cancelled = false;

    const loadLeaderboard = async () => {
      setIsLoadingLeaderboard(true);
      setLeaderboardError(null);

      try {
        const nextEntries = (await listCampaignLeaderboard(campaignState.campaign.id, {
          friendsOnly: leaderboardFriendsOnly,
        })) as Array<Record<string, unknown>>;

        if (!cancelled) {
          setLeaderboardEntries(nextEntries);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setLeaderboardError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to load the leaderboard.',
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingLeaderboard(false);
        }
      }
    };

    void loadLeaderboard();

    return () => {
      cancelled = true;
    };
  }, [campaignState, leaderboardFriendsOnly, leaderboardOpen]);

  const renderChallengeBody = () => {
    if (!currentChallenge) {
      return (
        <div className="campaign-step-stack">
          <div className="campaign-result-card">
            <div className="campaign-result-hero">
              <div>
                <h3>Campaign Complete</h3>
                <p>You cleared every egg in this month&apos;s campaign.</p>
              </div>
            </div>
          </div>
          <div className="button-row">
            <button className="button primary" onClick={resetFlow} type="button">
              Back To Road
            </button>
          </div>
        </div>
      );
    }

    if (stage === 'briefing') {
      return (
        <div className="campaign-step-stack">
          <div className="result-box campaign-phrase-card">
            <span className="campaign-phrase-label">Challenge Phrase</span>
            <strong>{currentChallenge.phrase}</strong>
            <p className="campaign-reverse-example">
              {currentChallenge.mode === 'reverse_only'
                ? `Say it backwards out loud. Example: "${currentChallenge.phrase}" -> "${buildBackwardPhraseExample(currentChallenge.phrase)}"`
                : 'Record the phrase normally, listen to the reversed guide, then imitate it.'}
            </p>
          </div>
          <div className="campaign-attempt-pill">
            <strong>Attempt Rules</strong>
            <span>{getAttemptSummary(currentAttemptState)}</span>
          </div>
          <div className="button-row">
            <button className="button secondary" onClick={resetFlow} type="button">
              Back To Road
            </button>
            <button
              className="button primary"
              onClick={() => {
                setError(null);
                setInfo(null);
                setStage(
                  currentChallenge.mode === 'reverse_only'
                    ? 'recording-attempt'
                    : 'recording-original',
                );
              }}
              type="button"
            >
              {currentChallenge.mode === 'reverse_only' ? 'Start Reverse Attempt' : 'Start Challenge'}
            </button>
          </div>
        </div>
      );
    }

    if (stage === 'recording-original') {
      return (
        <div className="campaign-step-stack">
          <div className="result-box campaign-phrase-card">
            <span className="campaign-phrase-label">Speak this phrase normally</span>
            <strong>{currentChallenge.phrase}</strong>
          </div>
          <ToggleRecordButton
            disabled={false}
            isPreparing={originalRecorder.isPreparing}
            isRecording={originalRecorder.isRecording}
            liveStream={originalRecorder.liveStream}
            onStart={startOriginalRecording}
            onStop={originalRecorder.stopRecording}
          />
        </div>
      );
    }

    if (stage === 'guide') {
      return (
        <div className="campaign-step-stack">
          <div className="audio-grid">
            <AudioPlayerCard
              blob={originalRecording}
              description="Your forward recording."
              title="Forward Phrase"
            />
            <AudioPlayerCard
              blob={guideRecording}
              description="Use this reversed clip as the guide."
              title="Reversed Guide"
            />
          </div>
          <div className="button-row">
            <button className="button secondary" onClick={resetFlow} type="button">
              Back To Road
            </button>
            <button className="button primary" onClick={openAttemptStep} type="button">
              Record Imitation
            </button>
          </div>
        </div>
      );
    }

    if (stage === 'recording-attempt') {
      const backwardExample = buildBackwardPhraseExample(currentChallenge.phrase);

      return (
        <div className="campaign-step-stack">
          <div className="result-box campaign-phrase-card">
            <span className="campaign-phrase-label">
              {currentChallenge.mode === 'reverse_only'
                ? 'Say this phrase backwards out loud'
                : 'Imitate the reversed guide'}
            </span>
            <strong>{currentChallenge.phrase}</strong>
            {currentChallenge.mode === 'reverse_only' ? (
              <p className="campaign-reverse-example">
                Example: "{currentChallenge.phrase}" {'->'} "{backwardExample}"
              </p>
            ) : null}
          </div>
          <ToggleRecordButton
            disabled={false}
            isPreparing={attemptRecorder.isPreparing}
            isRecording={attemptRecorder.isRecording}
            liveStream={attemptRecorder.liveStream}
            onStart={startAttemptRecording}
            onStop={attemptRecorder.stopRecording}
          />
        </div>
      );
    }

    if (stage === 'attempt-ready') {
      return (
        <div className="campaign-step-stack">
          <AudioPlayerCard
            blob={attemptRecording}
            description="Replay your latest attempt before it is scored."
            title="Attempt Preview"
          />
          <div className="button-row">
            <button className="button secondary" onClick={openAttemptStep} type="button">
              Record Again
            </button>
            <button className="button primary" onClick={() => void handleProcessAttempt()} type="button">
              Score Challenge
            </button>
          </div>
        </div>
      );
    }

    if (stage === 'processing') {
      return (
        <div className="round-loader-callout" aria-live="polite" role="status">
          <WaveformLoader className="round-loader-callout-spinner" size={92} strokeWidth={3.6} />
          <div>
            <strong>Scoring challenge...</strong>
            <p>Reversing audio, transcribing speech, and checking whether you earned 3 stars.</p>
          </div>
        </div>
      );
    }

    if (stage === 'result') {
      return (
        <div className="campaign-step-stack">
          <div className="campaign-result-card">
            <div className="campaign-result-hero">
              <div>
                <h3>{stars >= 3 ? 'Challenge Cleared' : 'Try Again'}</h3>
                <p>
                  {stars >= 3
                    ? 'You earned the full 3 stars and unlocked the next egg.'
                    : 'You need all 3 stars to open the next challenge.'}
                </p>
              </div>
              <div className="campaign-result-stars">
                <strong>{stars} / 3 stars</strong>
                <StarRating label={`Campaign result ${stars} out of 3 stars`} value={stars} />
              </div>
            </div>
            <div className="campaign-result-metrics">
              <div className="campaign-result-metric">
                <span>Target Phrase</span>
                <strong>{currentChallenge.phrase}</strong>
              </div>
              <div className="campaign-result-metric">
                <span>ASR Transcript</span>
                <strong>{transcript || 'No transcript returned'}</strong>
              </div>
              <div className="campaign-result-metric">
                <span>Similarity</span>
                <strong>{Math.round(score * 100)}%</strong>
              </div>
            </div>
          </div>
          <div className="audio-grid">
            <AudioPlayerCard
              blob={attemptRecording}
              description="Your recorded attempt."
              title="Attempt Audio"
            />
            <AudioPlayerCard
              blob={reversedAttemptRecording}
              description="This reversed clip was sent to speech recognition."
              title="ASR Input Audio"
            />
          </div>
          <div className="button-row">
            <button className="button secondary" onClick={resetFlow} type="button">
              Back To Road
            </button>
            {stars < 3 ? (
              <button className="button primary" onClick={openAttemptStep} type="button">
                Try Again
              </button>
            ) : null}
          </div>
        </div>
      );
    }

    return (
      <div className="campaign-step-stack">
        <div className="empty-state compact-empty">
          Press start from the road to begin the next challenge.
        </div>
      </div>
    );
  };

  return (
    <>
      <section className="surface round-screen campaign-screen">
        <div aria-hidden="true" className="campaign-floating-field">
          {FLOATING_EGGS.map((egg) => (
            <span
              className="campaign-floating-egg"
              key={`${egg.top}-${egg.left}`}
              style={{
                top: egg.top,
                left: egg.left,
                width: `${egg.size}px`,
                height: `${egg.size * 1.2}px`,
                animationDelay: egg.delay,
              }}
            >
              {challengeIcon ? (
                <img alt="" aria-hidden="true" src={challengeIcon} />
              ) : (
                <span className="campaign-floating-egg-shape" />
              )}
            </span>
          ))}
        </div>

        {stage === 'overview' ? (
          <div className="campaign-road-page">
            <div className="campaign-topbar">
              <button className="button ghost round-screen-back" onClick={onBack} type="button">
                Back
              </button>
            </div>

            {error ? <div className="error-banner">{error}</div> : null}
            {info ? <div className="success-banner">{info}</div> : null}
            {asrWarmError ? <div className="error-banner">{asrWarmError}</div> : null}

            {isLoadingCampaign ? (
              <div className="round-loader-callout" aria-live="polite" role="status">
                <WaveformLoader className="round-loader-callout-spinner" size={92} strokeWidth={3.6} />
                <div>
                  <strong>Loading campaign...</strong>
                  <p>Fetching the active month, challenge road, and your progress.</p>
                </div>
              </div>
            ) : !campaignState ? (
              <div className="empty-state compact-empty">No active campaign is available.</div>
            ) : (
              <>
                <div className="campaign-hero-card">
                  <div className="campaign-hero-copy">
                    <div className="campaign-hero-topline">
                      <span className="badge primary">
                        {formatThemeName(campaignState.campaign.theme) || 'Campaign'}
                      </span>
                      <span>{endDateLabel ? `Ends ${endDateLabel}` : `${challenges.length} challenges`}</span>
                    </div>
                    <h2>{title}</h2>
                    <p>{subtitle}</p>
                    <div className="campaign-hero-stats">
                      <div className="campaign-hero-stat">
                        <span>Road Progress</span>
                        <strong>
                          {Math.min(currentIndex, challenges.length || currentIndex)} / {challenges.length || 0}
                        </strong>
                      </div>
                      <div className="campaign-hero-stat">
                        <span>Cleared</span>
                        <strong>{completedCount}</strong>
                      </div>
                      <div className="campaign-hero-stat">
                        <span>Advance Rule</span>
                        <strong>3 stars</strong>
                      </div>
                    </div>
                  </div>

                  <div className="campaign-hero-art">
                    {bannerImage ? (
                      <div
                        aria-hidden="true"
                        className="campaign-hero-art-image"
                        style={{ backgroundImage: `url("${bannerImage}")` }}
                      />
                    ) : null}
                    <div className="campaign-hero-emblem">
                      {challengeIcon ? <img alt="" aria-hidden="true" src={challengeIcon} /> : null}
                    </div>
                  </div>
                </div>

                <div className="campaign-road-stage">
                  <button
                    aria-label="Open leaderboard"
                    className="campaign-side-action"
                    onClick={() => setLeaderboardOpen(true)}
                    type="button"
                  >
                    <LeaderboardIcon />
                    <span>Ranks</span>
                  </button>

                  <div className="campaign-road-viewer">
                    <div className="campaign-road-line" />

                    {roadChallenges.map((challenge, index) => {
                      const state = getChallengeState(
                        challenge.challengeIndex,
                        currentIndex,
                        completedCount,
                      );
                      const isCurrent = challenge.challengeIndex === currentIndex;

                      return (
                        <div
                          className={`campaign-road-node campaign-road-node-${state}${isCurrent ? ' is-active' : ''}`}
                          key={challenge.id}
                          style={{ top: getRoadNodeTop(index, roadChallenges.length) }}
                        >
                          <div className="campaign-road-node-shell">
                            <span className="campaign-road-node-icon">
                              {challengeIcon ? (
                                <img alt="" aria-hidden="true" src={challengeIcon} />
                              ) : null}
                              <strong>{challenge.challengeIndex}</strong>
                            </span>
                          </div>

                          {isCurrent ? (
                            <div className="campaign-road-node-caption">
                              <span>{formatDifficultyLabel(challenge.difficulty)}</span>
                              <strong>
                                {challenge.mode === 'reverse_only' ? 'Reverse Only' : 'Normal'}
                              </strong>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="campaign-road-cta">
                  <button
                    className="campaign-start-button"
                    disabled={!currentChallenge}
                    onClick={openChallengeBriefing}
                    type="button"
                  >
                    {currentChallenge ? `Start Challenge ${currentIndex}` : 'Campaign Complete'}
                  </button>
                  <button
                    className="campaign-refresh-link"
                    onClick={() => void refreshCampaign()}
                    type="button"
                  >
                    Refresh Road
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="campaign-play-page">
            <div className="campaign-topbar">
              <button
                className="button ghost round-screen-back"
                disabled={stage === 'processing'}
                onClick={resetFlow}
                type="button"
              >
                Back To Road
              </button>
            </div>

            {error ? <div className="error-banner">{error}</div> : null}
            {info ? <div className="success-banner">{info}</div> : null}
            {asrWarmError ? <div className="error-banner">{asrWarmError}</div> : null}

            {currentChallenge ? (
              <div className="campaign-play-hero">
                <div className="campaign-play-copy">
                  <div className="eyebrow">Challenge {currentChallenge.challengeIndex}</div>
                  <h2>{title}</h2>
                  <p>
                    {challengeState === 'current'
                      ? 'This is your next live challenge. Finish it with 3 stars to unlock the next egg.'
                      : 'Campaign progress has already moved past this challenge.'}
                  </p>
                </div>

                <div className="campaign-play-badges">
                  <span className={`badge ${currentChallenge.difficulty}`}>
                    {formatDifficultyLabel(currentChallenge.difficulty)}
                  </span>
                  <span className="badge attempted">
                    {currentChallenge.mode === 'reverse_only' ? 'Reverse Only' : 'Normal'}
                  </span>
                </div>

                <div className="campaign-play-icon">
                  {challengeIcon ? <img alt="" aria-hidden="true" src={challengeIcon} /> : null}
                  <strong>{currentChallenge.challengeIndex}</strong>
                </div>
              </div>
            ) : null}

            <div className="campaign-focus-card campaign-play-card">{renderChallengeBody()}</div>
          </div>
        )}
      </section>

      {leaderboardOpen && campaignState ? (
        <div
          className="campaign-leaderboard-backdrop"
          onClick={() => setLeaderboardOpen(false)}
          role="presentation"
        >
          <div
            aria-modal="true"
            className="campaign-leaderboard-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="campaign-leaderboard-header">
              <div>
                <div className="eyebrow">Leaderboard</div>
                <h3>{title}</h3>
                <p>Ranked by completed challenge count.</p>
              </div>
              <button className="button ghost" onClick={() => setLeaderboardOpen(false)} type="button">
                Close
              </button>
            </div>

            <div className="campaign-leaderboard-filters">
              <button
                className={`button ${leaderboardFriendsOnly ? 'secondary' : 'primary'}`}
                onClick={() => setLeaderboardFriendsOnly(false)}
                type="button"
              >
                Global
              </button>
              <button
                className={`button ${leaderboardFriendsOnly ? 'primary' : 'secondary'}`}
                onClick={() => setLeaderboardFriendsOnly(true)}
                type="button"
              >
                Friends
              </button>
            </div>

            {leaderboardError ? <div className="error-banner">{leaderboardError}</div> : null}

            {isLoadingLeaderboard ? (
              <div className="round-loader-callout" aria-live="polite" role="status">
                <WaveformLoader className="round-loader-callout-spinner" size={82} strokeWidth={3.4} />
                <div>
                  <strong>Loading leaderboard...</strong>
                </div>
              </div>
            ) : (
              <div className="campaign-leaderboard-list" role="list">
                {leaderboardEntries.map((entry, index) => {
                  const username =
                    typeof entry.username === 'string'
                      ? entry.username
                      : typeof entry.user_username === 'string'
                        ? entry.user_username
                        : 'player';
                  const progress =
                    typeof entry.completedCount === 'number'
                      ? entry.completedCount
                      : Number(entry.completed_count ?? 0);

                  return (
                    <div className="campaign-leaderboard-row" key={`${username}-${index}`} role="listitem">
                      <span className="campaign-leaderboard-rank">#{index + 1}</span>
                      <strong>{username}</strong>
                      <span>{progress} cleared</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
