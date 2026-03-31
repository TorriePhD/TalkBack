import { useEffect, useRef, useState } from 'react';
import { useAudioRecorder } from '../../../audio/hooks/useAudioRecorder';
import { reverseAudioBlob } from '../../../audio/utils/reverseAudioBlob';
import { AudioPlayerCard } from '../../../components/AudioPlayerCard';
import { StarRating } from '../../../components/StarRating';
import { ToggleRecordButton } from '../../../components/ToggleRecordButton';
import { WaveformLoader } from '../../../components/WaveformLoader';
import { useCoins } from '../../resources/ResourceProvider';
import { difficultyMultiplier } from '../../../lib/rounds';
import { awardCoins } from '../../../lib/singlePlayerRewards';
import type { WordPack, WordPackWithWords } from '../../../lib/wordPacks';
import { calculateGuessSimilarity } from '../../rounds/utils';
import {
  getDefaultPackId,
  getThreeOptions,
  getWordPackOptions,
  loadRoundWordPacks,
  rememberPresentedPhrase,
  type WordOption,
} from '../../rounds/wordPacks';
import {
  formatDifficultyLabel,
  getSinglePlayerStars,
  mapOptionsByDifficulty,
  type SinglePlayerPhase,
} from '../game';
import { transcribeAudio, warmSinglePlayerTranscriber } from '../transcription';

interface SinglePlayerPanelProps {
  currentUserId: string;
  onBack: () => void;
}

type AsrWarmStatus = 'warming' | 'ready' | 'error';

function createRewardKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `single-player-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatScore(score: number) {
  return score.toFixed(2);
}

function getActiveStep(phase: SinglePlayerPhase) {
  if (phase === 'selecting') {
    return 0;
  }

  if (phase === 'recording-original') {
    return 1;
  }

  if (phase === 'playing-reversed') {
    return 2;
  }

  if (phase === 'recording-imitation') {
    return 3;
  }

  return 4;
}

const PROGRESS_STEPS = [
  {
    title: 'Pick challenge',
    description: 'Choose easy, medium, or hard from the active pack.',
  },
  {
    title: 'Record phrase',
    description: 'Say the phrase normally in one short take.',
  },
  {
    title: 'Listen backward',
    description: 'Play the reversed prompt and lock onto the rhythm.',
  },
  {
    title: 'Imitate backward',
    description: 'Record your best copy of the reversed clip.',
  },
  {
    title: 'Score round',
    description: 'ASR compares your flipped take and awards BB Coins.',
  },
];

export function SinglePlayerPanel({
  currentUserId,
  onBack,
}: SinglePlayerPanelProps) {
  const originalRecorder = useAudioRecorder({ preparedStreamIdleMs: 0 });
  const imitationRecorder = useAudioRecorder({ preparedStreamIdleMs: 0 });
  const { refreshCoins } = useCoins();
  const rewardKeyRef = useRef(createRewardKey());
  const processingStageRef = useRef('idle');
  const processingSessionIdRef = useRef(0);
  const [phase, setPhase] = useState<SinglePlayerPhase>('selecting');
  const [packs, setPacks] = useState<WordPack[]>([]);
  const [selectedPackId, setSelectedPackId] = useState<string>('');
  const [selectedPack, setSelectedPack] = useState<WordPackWithWords | null>(null);
  const [options, setOptions] = useState<WordOption[]>([]);
  const [optionSeed, setOptionSeed] = useState(0);
  const [selectedOption, setSelectedOption] = useState<WordOption | null>(null);
  const [originalRecording, setOriginalRecording] = useState<Blob | null>(null);
  const [reversedOriginalRecording, setReversedOriginalRecording] = useState<Blob | null>(null);
  const [imitationRecording, setImitationRecording] = useState<Blob | null>(null);
  const [reversedImitationRecording, setReversedImitationRecording] = useState<Blob | null>(null);
  const [asrText, setAsrText] = useState('');
  const [score, setScore] = useState(0);
  const [stars, setStars] = useState(0);
  const [coinsEarned, setCoinsEarned] = useState(0);
  const [packsError, setPacksError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isLoadingPacks, setIsLoadingPacks] = useState(true);
  const [isReversingOriginal, setIsReversingOriginal] = useState(false);
  const [isProcessingRound, setIsProcessingRound] = useState(false);
  const [lockedDifficulty, setLockedDifficulty] = useState<WordOption['displayDifficulty'] | null>(
    null,
  );
  const [asrWarmStatus, setAsrWarmStatus] = useState<AsrWarmStatus>('warming');
  const [asrWarmError, setAsrWarmError] = useState<string | null>(null);

  const optionMap = mapOptionsByDifficulty(options);
  const activeStep = getActiveStep(phase);

  useEffect(() => {
    console.debug('[SinglePlayer] Phase changed.', {
      phase,
      selectedDifficulty: selectedOption?.displayDifficulty ?? null,
      selectedPhrase: selectedOption?.text ?? null,
    });
  }, [phase, selectedOption]);

  useEffect(() => {
    if (!isProcessingRound || phase !== 'processing') {
      return;
    }

    const sessionId = processingSessionIdRef.current;
    const intervalId = window.setInterval(() => {
      console.debug(`[SinglePlayer][Process ${sessionId}] Still processing.`, {
        stage: processingStageRef.current,
      });
    }, 5_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isProcessingRound, phase]);

  function clearRoundState() {
    console.debug('[SinglePlayer] Clearing round state.');
    rewardKeyRef.current = createRewardKey();
    processingStageRef.current = 'idle';
    setSelectedOption(null);
    setOriginalRecording(null);
    setReversedOriginalRecording(null);
    setImitationRecording(null);
    setReversedImitationRecording(null);
    setAsrText('');
    setScore(0);
    setStars(0);
    setCoinsEarned(0);
    setStatusError(null);
    setLockedDifficulty(null);
    setIsReversingOriginal(false);
    setIsProcessingRound(false);
    originalRecorder.clearRecording();
    imitationRecorder.clearRecording();
  }

  function restartRound() {
    clearRoundState();
    setPhase('selecting');
    setOptionSeed((current) => current + 1);
  }

  function resetToOriginalRecording() {
    setStatusError(null);
    setOriginalRecording(null);
    setReversedOriginalRecording(null);
    originalRecorder.clearRecording();
    setPhase('recording-original');
    void originalRecorder.prepareRecording();
  }

  useEffect(() => {
    let cancelled = false;

    const loadPackState = async () => {
      console.debug('[SinglePlayer] Loading pack state.', {
        requestedPackId: selectedPackId || null,
      });
      setIsLoadingPacks(true);
      const result = await loadRoundWordPacks(selectedPackId || null);

      if (cancelled) {
        return;
      }

      console.debug('[SinglePlayer] Pack state loaded.', {
        packCount: result.packs.length,
        selectedPackId: result.selectedPackId,
        selectedPackName: result.selectedPack.name,
        wordCount: result.selectedPack.words.length,
      });
      setPacks(result.packs);
      setSelectedPack(result.selectedPack);
      setSelectedPackId(result.selectedPackId);
      setPacksError(result.error);
      setIsLoadingPacks(false);
    };

    void loadPackState();

    return () => {
      cancelled = true;
    };
  }, [selectedPackId]);

  useEffect(() => {
    if (!selectedPack) {
      setOptions([]);
      return;
    }

    const nextOptions = getThreeOptions(selectedPack.words);
    console.debug('[SinglePlayer] Generated difficulty options.', {
      packId: selectedPack.id,
      options: nextOptions.map((option) => ({
        difficulty: option.displayDifficulty,
        sourceDifficulty: option.difficulty,
        text: option.text,
      })),
    });
    setOptions(nextOptions);
    setSelectedOption(null);
  }, [selectedPack, optionSeed]);

  useEffect(() => {
    let cancelled = false;

    const warmAsr = async () => {
      console.debug('[SinglePlayer] Warming ASR model.');
      setAsrWarmStatus('warming');
      setAsrWarmError(null);

      try {
        await warmSinglePlayerTranscriber();

        if (!cancelled) {
          console.debug('[SinglePlayer] ASR warm-up complete.');
          setAsrWarmStatus('ready');
        }
      } catch (error) {
        if (!cancelled) {
          console.error('[SinglePlayer] ASR warm-up failed.', error);
          setAsrWarmStatus('error');
          setAsrWarmError(
            error instanceof Error
              ? error.message
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
    const originalBlob = originalRecorder.audioBlob;

    if (!originalBlob || originalRecorder.isRecording || phase !== 'recording-original') {
      return;
    }

    let cancelled = false;

    const prepareReversedPrompt = async () => {
      const startedAt = performance.now();
      console.debug('[SinglePlayer] Reversing original prompt.', {
        blobSize: originalBlob.size,
        blobType: originalBlob.type,
      });
      setStatusError(null);
      setIsReversingOriginal(true);

      try {
        const nextReversedOriginal = await reverseAudioBlob(originalBlob);

        if (cancelled) {
          return;
        }

        console.debug(
          `[SinglePlayer] Original prompt reversed in ${Math.round(performance.now() - startedAt)}ms.`,
          {
            reversedBlobSize: nextReversedOriginal.size,
            reversedBlobType: nextReversedOriginal.type,
          },
        );
        setOriginalRecording(originalBlob);
        setReversedOriginalRecording(nextReversedOriginal);
        setPhase('playing-reversed');
      } catch (error) {
        if (!cancelled) {
          console.error('[SinglePlayer] Reversing original prompt failed.', error);
          setStatusError(
            error instanceof Error
              ? error.message
              : 'Unable to reverse the original recording.',
          );
        }
      } finally {
        if (!cancelled) {
          setIsReversingOriginal(false);
        }
      }
    };

    void prepareReversedPrompt();

    return () => {
      cancelled = true;
    };
  }, [originalRecorder.audioBlob, originalRecorder.isRecording, phase]);

  useEffect(() => {
    const imitationBlob = imitationRecorder.audioBlob;

    if (!imitationBlob || imitationRecorder.isRecording || phase !== 'recording-imitation') {
      return;
    }

    let cancelled = false;

    const processRound = async () => {
      if (!selectedOption) {
        return;
      }

      const processSessionId = ++processingSessionIdRef.current;
      const startedAt = performance.now();
      let nextReversedImitation: Blob | null = null;
      let nextTranscript = '';
      let nextCoinsEarned = 0;
      let nextStatusError: string | null = null;
      let nextScore = 0;
      let nextStars = 0;

      processingStageRef.current = 'starting';
      console.debug(`[SinglePlayer][Process ${processSessionId}] Starting round processing.`, {
        blobSize: imitationBlob.size,
        blobType: imitationBlob.type,
        difficulty: selectedOption.displayDifficulty,
        phrase: selectedOption.text,
        rewardKey: rewardKeyRef.current,
      });
      setStatusError(null);
      setIsProcessingRound(true);
      setPhase('processing');

      try {
        processingStageRef.current = 'reversing-imitation';
        nextReversedImitation = await reverseAudioBlob(imitationBlob);
        console.debug(`[SinglePlayer][Process ${processSessionId}] Reversed imitation.`, {
          reversedBlobSize: nextReversedImitation.size,
          reversedBlobType: nextReversedImitation.type,
        });

        try {
          processingStageRef.current = 'transcribing';
          nextTranscript = await transcribeAudio(nextReversedImitation);
          console.debug(`[SinglePlayer][Process ${processSessionId}] Transcription finished.`, {
            transcript: nextTranscript,
          });
          setAsrWarmStatus('ready');
          setAsrWarmError(null);
        } catch (error) {
          console.error(`[SinglePlayer][Process ${processSessionId}] Transcription failed.`, error);
          nextStatusError =
            error instanceof Error
              ? error.message
              : 'The round was scored without a usable transcription.';
          nextTranscript = '';
        }

        nextScore = nextTranscript
          ? calculateGuessSimilarity(nextTranscript, selectedOption.text)
          : 0;
        nextStars = getSinglePlayerStars(nextScore);
        console.debug(`[SinglePlayer][Process ${processSessionId}] Scoring completed.`, {
          score: nextScore,
          stars: nextStars,
        });

        try {
          processingStageRef.current = 'awarding-coins';
          nextCoinsEarned = await awardCoins({
            userId: currentUserId,
            rewardKey: rewardKeyRef.current,
            stars: nextStars,
            difficulty: selectedOption.displayDifficulty,
            phrase: selectedOption.text,
            transcript: nextTranscript,
            score: nextScore,
          });
          console.debug(`[SinglePlayer][Process ${processSessionId}] Reward RPC finished.`, {
            nextCoinsEarned,
          });
        } catch (error) {
          console.error(`[SinglePlayer][Process ${processSessionId}] Reward RPC failed.`, error);
          nextStatusError =
            nextStatusError ??
            (error instanceof Error
              ? error.message
              : 'Unable to award BB Coins for this round.');
          nextCoinsEarned = 0;
        }

        try {
          processingStageRef.current = 'refreshing-coins';
          await refreshCoins();
          console.debug(`[SinglePlayer][Process ${processSessionId}] Coin refresh finished.`);
        } catch (error) {
          console.warn('Unable to refresh BB Coins after a single-player reward.', error);
        }

        if (cancelled) {
          return;
        }

        setImitationRecording(imitationBlob);
        setReversedImitationRecording(nextReversedImitation);
        setAsrText(nextTranscript);
        setScore(nextScore);
        setStars(nextStars);
        setCoinsEarned(nextCoinsEarned);
        setStatusError(nextStatusError);
        console.debug(
          `[SinglePlayer][Process ${processSessionId}] Round processing completed in ${Math.round(performance.now() - startedAt)}ms.`,
          {
            coinsEarned: nextCoinsEarned,
            score: nextScore,
            stars: nextStars,
            transcript: nextTranscript,
          },
        );
        setPhase('result');
      } catch (error) {
        if (!cancelled) {
          console.error(`[SinglePlayer][Process ${processSessionId}] Round processing failed.`, error);
          setImitationRecording(imitationBlob);
          setReversedImitationRecording(nextReversedImitation);
          setAsrText('');
          setScore(0);
          setStars(0);
          setCoinsEarned(0);
          setStatusError(
            error instanceof Error ? error.message : 'Unable to finish this single-player round.',
          );
          setPhase('result');
        }
      } finally {
        processingStageRef.current = 'idle';
        if (!cancelled) {
          setIsProcessingRound(false);
        }
      }
    };

    void processRound();

    return () => {
      cancelled = true;
    };
  }, [
    currentUserId,
    imitationRecorder.audioBlob,
    imitationRecorder.isRecording,
    refreshCoins,
    selectedOption,
  ]);

  return (
    <section className="surface round-screen single-player-screen">
      <div className="round-screen-header">
        <button className="button ghost round-screen-back" onClick={onBack} type="button">
          Back
        </button>

        <div className="round-screen-copy">
          <div className="eyebrow">Single Player</div>
          <h2>
            {phase === 'selecting'
              ? 'Choose your challenge'
              : phase === 'recording-original'
                ? 'Record the phrase normally'
                : phase === 'playing-reversed'
                  ? 'Listen to the reversed prompt'
                  : phase === 'recording-imitation'
                    ? 'Imitate the backward audio'
                    : phase === 'processing'
                      ? 'Scoring your round'
                      : 'Round results'}
          </h2>
          <p>
            {phase === 'selecting'
              ? 'Pick one phrase from the active pack. Each card represents easy, medium, or hard for this round.'
              : phase === 'recording-original'
                ? 'Use one short, clean take. Aim for roughly two to four seconds so the reversal and ASR stay fast.'
                : phase === 'playing-reversed'
                  ? 'Replay the flipped clip until the cadence feels familiar, then move on to your imitation take.'
                  : phase === 'recording-imitation'
                    ? 'Say what you hear in the reversed clip. The app flips this attempt back before transcription.'
                    : phase === 'processing'
                      ? 'Reversing your imitation, running speech recognition, and settling BB Coins.'
                      : 'The result compares the phrase with the ASR transcript from your reversed imitation.'}
          </p>
        </div>

        <div className="pill-row round-screen-meta">
          {selectedOption ? (
            <span className={`badge ${selectedOption.displayDifficulty}`}>
              {formatDifficultyLabel(selectedOption.displayDifficulty)}
            </span>
          ) : null}
          <span className="badge primary">
            Pack: {selectedPack?.name ?? 'Loading'}
          </span>
        </div>
      </div>

      <div className="round-screen-body">
        <div className="progress-rail single-player-progress">
          {PROGRESS_STEPS.map((step, index) => {
            const isActive = activeStep === index;
            const isDone = activeStep > index;

            return (
              <div
                className={`progress-pill${isActive ? ' progress-pill-active' : ''}${isDone ? ' progress-pill-done' : ''}`}
                key={step.title}
              >
                <span className="progress-pill-number">{index + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  <span>{step.description}</span>
                </div>
              </div>
            );
          })}
        </div>

        {phase === 'selecting' ? (
          <div className="round-screen-step">
            <div className="field">
              <label htmlFor="singlePlayerPackSelect">Word pack</label>
              <select
                id="singlePlayerPackSelect"
                onChange={(event) => {
                  clearRoundState();
                  setPhase('selecting');
                  setSelectedPackId(event.target.value);
                }}
                value={selectedPackId || getDefaultPackId(packs)}
              >
                {getWordPackOptions(packs).map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {pack.name} {pack.isFree ? '(Free)' : '(Paid)'}
                  </option>
                ))}
              </select>
            </div>

            {selectedPack ? (
              <div className="result-box">
                <p>
                  <strong>Pack:</strong> {selectedPack.name}
                </p>
                <p>
                  <strong>Phrases loaded:</strong> {selectedPack.words.length}
                </p>
                {selectedPack.description ? <p>{selectedPack.description}</p> : null}
              </div>
            ) : null}

            <div className="single-player-option-grid">
              {(['easy', 'medium', 'hard'] as const).map((difficulty) => {
                const option = optionMap[difficulty];

                if (!option) {
                  return null;
                }

                const isSelected = lockedDifficulty === difficulty;

                return (
                  <button
                    className={`single-player-option-card${isSelected ? ' is-selected' : ''}`}
                    disabled={isLoadingPacks || lockedDifficulty !== null}
                    key={`${difficulty}-${option.id}`}
                    onClick={() => {
                      console.debug('[SinglePlayer] Challenge selected.', {
                        difficulty,
                        phrase: option.text,
                        sourceDifficulty: option.difficulty,
                      });
                      clearRoundState();
                      rememberPresentedPhrase(option.text);
                      setSelectedOption(option);
                      setLockedDifficulty(difficulty);
                      setPhase('recording-original');
                      void originalRecorder.prepareRecording().finally(() => {
                        setLockedDifficulty(null);
                      });
                    }}
                    type="button"
                  >
                    <span className="single-player-option-topline">
                      <span className={`badge ${difficulty}`}>
                        {formatDifficultyLabel(difficulty)}
                      </span>
                      <span className="single-player-option-multiplier">
                        x{difficultyMultiplier[difficulty]}
                        <img
                          alt=""
                          aria-hidden="true"
                          src={`${import.meta.env.BASE_URL}bbcoin.png`}
                        />
                      </span>
                    </span>
                    <strong>{option.text}</strong>
                    <span className="single-player-option-note">
                      {difficulty === option.difficulty
                        ? 'Matched directly from this difficulty bucket.'
                        : `Fallback pick because the ${difficulty} bucket was sparse.`}
                    </span>
                  </button>
                );
              })}
            </div>

            {isLoadingPacks ? (
              <div className="round-loader-callout" aria-live="polite" role="status">
                <WaveformLoader
                  className="round-loader-callout-spinner"
                  size={92}
                  strokeWidth={3.6}
                />
                <div>
                  <strong>Loading packs...</strong>
                  <p>Pulling phrases from Supabase and reusing the local cache.</p>
                </div>
              </div>
            ) : null}

            {asrWarmStatus === 'warming' ? (
              <div className="info-banner">
                <strong>Preparing speech recognition</strong>
                <p>The first single-player round may take a little longer while Whisper warms up.</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {phase === 'recording-original' ? (
          <div className="round-screen-step">
            <div className="result-box round-screen-summary">
              <p>
                <strong>Phrase:</strong> {selectedOption?.text ?? 'Choose a challenge first'}
              </p>
              <p>
                <strong>Difficulty:</strong>{' '}
                {selectedOption ? formatDifficultyLabel(selectedOption.displayDifficulty) : 'Not selected'}
              </p>
            </div>

            <div className="button-row round-record-actions">
              <ToggleRecordButton
                disabled={isReversingOriginal}
                isPreparing={originalRecorder.isPreparing}
                isRecording={originalRecorder.isRecording}
                liveStream={originalRecorder.liveStream}
                onStart={originalRecorder.startRecording}
                onStop={originalRecorder.stopRecording}
              />
              <button
                className="button ghost"
                disabled={!originalRecorder.audioBlob}
                onClick={() => {
                  setStatusError(null);
                  setOriginalRecording(null);
                  setReversedOriginalRecording(null);
                  originalRecorder.clearRecording();
                }}
                type="button"
              >
                Clear take
              </button>
              <button
                className="button ghost"
                onClick={() => {
                  clearRoundState();
                  setPhase('selecting');
                }}
                type="button"
              >
                Change challenge
              </button>
            </div>

            {isReversingOriginal ? (
              <div className="round-loader-callout" aria-live="polite" role="status">
                <WaveformLoader
                  className="round-loader-callout-spinner"
                  size={92}
                  strokeWidth={3.6}
                />
                <div>
                  <strong>Building the reversed prompt...</strong>
                  <p>Your normal take is being flipped for the imitation step.</p>
                </div>
              </div>
            ) : null}

            <AudioPlayerCard
              title="Normal take"
              description={
                originalRecorder.audioBlob
                  ? 'This is the straight recording you just made.'
                  : 'Record once and the normal take preview appears here.'
              }
              blob={originalRecorder.audioBlob}
            />
          </div>
        ) : null}

        {phase === 'playing-reversed' ? (
          <div className="round-screen-step">
            <div className="result-box round-screen-summary">
              <p>
                <strong>Phrase:</strong> {selectedOption?.text}
              </p>
              <p>
                <strong>Next:</strong> Listen to the reversed take, then record your imitation.
              </p>
            </div>

            <div className="audio-grid">
              <AudioPlayerCard
                title="Original phrase"
                description="Replay your clean phrase if you need to reset before listening backward."
                blob={originalRecording}
              />
              <AudioPlayerCard
                title="Reversed prompt"
                description="This is the backward clip you will imitate in the next step."
                blob={reversedOriginalRecording}
              />
            </div>

            <div className="button-row">
              <button
                className="button ghost"
                onClick={resetToOriginalRecording}
                type="button"
              >
                Record original again
              </button>
              <button
                className="button primary"
                disabled={!reversedOriginalRecording}
                onClick={() => {
                  imitationRecorder.clearRecording();
                  setImitationRecording(null);
                  setReversedImitationRecording(null);
                  setStatusError(null);
                  setPhase('recording-imitation');
                  void imitationRecorder.prepareRecording();
                }}
                type="button"
              >
                Imitate the reversed clip
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'recording-imitation' ? (
          <div className="round-screen-step">
            <div className="audio-grid">
              <AudioPlayerCard
                title="Reversed prompt"
                description="Play this as many times as you need before recording your imitation."
                blob={reversedOriginalRecording}
              />
              <AudioPlayerCard
                title="Imitation take"
                description={
                  imitationRecorder.audioBlob
                    ? 'Your backward imitation is ready to process.'
                    : 'Press record, copy the reversed prompt, and stop when finished.'
                }
                blob={imitationRecorder.audioBlob}
              />
            </div>

            <div className="button-row round-record-actions">
              <ToggleRecordButton
                isPreparing={imitationRecorder.isPreparing}
                isRecording={imitationRecorder.isRecording}
                liveStream={imitationRecorder.liveStream}
                onStart={imitationRecorder.startRecording}
                onStop={imitationRecorder.stopRecording}
              />
              <button
                className="button ghost"
                disabled={!imitationRecorder.audioBlob}
                onClick={() => {
                  setStatusError(null);
                  imitationRecorder.clearRecording();
                }}
                type="button"
              >
                Clear take
              </button>
              <button
                className="button ghost"
                onClick={() => {
                  setStatusError(null);
                  imitationRecorder.clearRecording();
                  setPhase('playing-reversed');
                }}
                type="button"
              >
                Back to reversed prompt
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'processing' ? (
          <div className="round-screen-step">
            <div className="round-loader-callout" aria-live="polite" role="status">
              <WaveformLoader
                className="round-loader-callout-spinner"
                size={108}
                strokeWidth={3.8}
              />
              <div>
                <strong>Processing your round...</strong>
                <p>Reversing the imitation, running ASR, and calculating your reward.</p>
              </div>
            </div>
          </div>
        ) : null}

        {phase === 'result' ? (
          <div className="round-screen-step">
            <div className="single-player-result-card">
              <div className="single-player-result-hero">
                <div>
                  <div className="eyebrow">Round Complete</div>
                  <h3>{selectedOption?.text}</h3>
                  <p>
                    {asrText
                      ? `Whisper heard "${asrText}".`
                      : 'No usable transcription came back, so this round scored as zero.'}
                  </p>
                </div>

                <div className="single-player-result-stars">
                  <StarRating label={`${stars} stars`} large value={stars} />
                  <strong>{coinsEarned > 0 ? `+${coinsEarned} BB Coins` : 'No BB Coins this round'}</strong>
                </div>
              </div>

              <div className="single-player-metric-grid">
                <div className="single-player-metric">
                  <span>Difficulty</span>
                  <strong>
                    {selectedOption ? formatDifficultyLabel(selectedOption.displayDifficulty) : 'None'}
                  </strong>
                </div>
                <div className="single-player-metric">
                  <span>Score</span>
                  <strong>{formatScore(score)}</strong>
                </div>
                <div className="single-player-metric">
                  <span>Transcript</span>
                  <strong>{asrText || 'No speech detected'}</strong>
                </div>
              </div>
            </div>

            <div className="audio-grid">
              <AudioPlayerCard
                title="Original phrase"
                description="Your normal reference take."
                blob={originalRecording}
              />
              <AudioPlayerCard
                title="Reversed imitation"
                description="This flipped version is what the speech model transcribed."
                blob={reversedImitationRecording}
              />
            </div>

            <div className="button-row">
              <button
                className="button secondary"
                onClick={restartRound}
                type="button"
              >
                Play again
              </button>
              <button className="button ghost" onClick={onBack} type="button">
                Back to home
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="round-screen-footer">
        {phase === 'result' ? (
          <p className="single-player-footer-copy">
            Easy pays x1, medium x2, and hard x3 based on the stars you earned.
          </p>
        ) : null}
      </div>

      <div className="stack">
        {packsError ? <div className="error-banner">{packsError}</div> : null}
        {asrWarmError ? <div className="info-banner">{asrWarmError}</div> : null}
        {originalRecorder.error ? <div className="error-banner">{originalRecorder.error}</div> : null}
        {imitationRecorder.error ? <div className="error-banner">{imitationRecorder.error}</div> : null}
        {statusError ? <div className="error-banner">{statusError}</div> : null}
      </div>
    </section>
  );
}
