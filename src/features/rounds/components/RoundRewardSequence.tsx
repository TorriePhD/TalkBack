import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { StarRating } from '../../../components/StarRating';
import { difficultyMultiplier } from '../../../lib/rounds';
import type { RoundReward } from '../types';

interface RoundRewardSequenceProps {
  baseCoins: number;
  reward: RoundReward;
  onDisplayedCoinsChange: (amount: number) => void;
  onAnimationComplete?: () => void;
  startCompleted?: boolean;
}

interface Point {
  x: number;
  y: number;
}

interface ParticleSpec {
  id: string;
  lift: number;
  delay: number;
  duration: number;
  size: number;
  endOffsetX: number;
  endOffsetY: number;
  spin: number;
}

interface ParticleRender {
  id: string;
  style: CSSProperties;
}

const STAR_DURATION_MS = 720;
const DIFFICULTY_DURATION_MS = 320;
const FORMULA_DURATION_MS = 260;
const BURST_DURATION_MS = 560;
const TARGET_MARKER_SIZE_PX = 44;
const TOTAL_DURATION_MS =
  STAR_DURATION_MS + DIFFICULTY_DURATION_MS + FORMULA_DURATION_MS + BURST_DURATION_MS;

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function easeOutCubic(value: number) {
  const nextValue = 1 - Math.pow(1 - value, 3);
  return clamp(nextValue);
}

function easeOutBack(value: number, overshoot = 1.24) {
  const adjustedValue = clamp(value) - 1;
  return adjustedValue * adjustedValue * ((overshoot + 1) * adjustedValue + overshoot) + 1;
}

function quadraticBezier(start: number, control: number, end: number, progress: number) {
  const inverseProgress = 1 - progress;
  return (
    inverseProgress * inverseProgress * start +
    2 * inverseProgress * progress * control +
    progress * progress * end
  );
}

function getDifficultyLabel(difficulty: RoundReward['difficulty']) {
  return difficulty.toUpperCase();
}

function getCenterPoint(element: HTMLElement | null): Point | null {
  if (!element) {
    return null;
  }

  const rect = element.getBoundingClientRect();

  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function getCoinDisplayTargetPoint() {
  const exactTarget = document.querySelector<HTMLElement>('[data-coin-display-target="true"]');

  if (exactTarget) {
    return getCenterPoint(exactTarget);
  }

  const fallbackTarget = document.querySelector<HTMLElement>('[data-coin-display="true"]');
  return getCenterPoint(fallbackTarget);
}

function pointsEqual(left: Point | null, right: Point | null) {
  if (!left || !right) {
    return left === right;
  }

  return left.x === right.x && left.y === right.y;
}

function createParticleSpecs(rewardAmount: number) {
  const count = rewardAmount === 0 ? 0 : Math.max(10, Math.min(18, rewardAmount + 8));

  return Array.from({ length: count }, (_, index): ParticleSpec => ({
    id: `reward-particle-${index}`,
    lift: 90 + (index % 5) * 16,
    delay: index * 18,
    duration: 310 + (index % 4) * 48,
    size: 18 + (index % 3) * 4,
    endOffsetX: (index % 2 === 0 ? -1 : 1) * (12 + (index % 4) * 7),
    endOffsetY: -10 + (index % 5) * 6,
    spin: (index % 2 === 0 ? -1 : 1) * (80 + index * 11),
  }));
}

export function RoundRewardSequence({
  baseCoins,
  reward,
  onDisplayedCoinsChange,
  onAnimationComplete,
  startCompleted = false,
}: RoundRewardSequenceProps) {
  const [elapsedMs, setElapsedMs] = useState(startCompleted ? TOTAL_DURATION_MS : 0);
  const [burstOrigin, setBurstOrigin] = useState<Point | null>(null);
  const [targetPoint, setTargetPoint] = useState<Point | null>(null);
  const sequenceCardRef = useRef<HTMLDivElement | null>(null);
  const formulaRef = useRef<HTMLDivElement | null>(null);
  const hasCompletedAnimationRef = useRef(startCompleted);

  const starsProgress = clamp(elapsedMs / STAR_DURATION_MS);
  const difficultyProgress = clamp((elapsedMs - STAR_DURATION_MS) / DIFFICULTY_DURATION_MS);
  const formulaProgress = clamp(
    (elapsedMs - STAR_DURATION_MS - DIFFICULTY_DURATION_MS) / FORMULA_DURATION_MS,
  );
  const burstProgress = clamp(
    (elapsedMs - STAR_DURATION_MS - DIFFICULTY_DURATION_MS - FORMULA_DURATION_MS) /
      BURST_DURATION_MS,
  );
  const difficultyMultiplierValue = difficultyMultiplier[reward.difficulty];
  const displayedStarValue = reward.stars * easeOutBack(starsProgress, 1.18);
  const isSequenceFinished = elapsedMs >= TOTAL_DURATION_MS;
  const stageLabel =
    isSequenceFinished
      ? 'Reward Ready'
      : burstProgress > 0
        ? 'Banking BB Coins'
        : formulaProgress > 0
          ? 'Calculating Reward'
          : difficultyProgress > 0
            ? 'Locking Difficulty'
            : 'Counting Stars';
  const starCounterLabel =
    starsProgress < 1 && reward.stars > 0
      ? displayedStarValue.toFixed(1)
      : `${reward.stars}`;
  const difficultyDrop = 1 - easeOutBack(difficultyProgress, 1.34);
  const formulaReveal = easeOutCubic(formulaProgress);
  const targetPulseScale = 0.94 + burstProgress * 0.32;
  const particles = useMemo(() => createParticleSpecs(reward.rewardAmount), [reward.rewardAmount]);
  const displayedCoinTotal =
    reward.rewardAmount === 0
      ? baseCoins
      : baseCoins + Math.round(reward.rewardAmount * easeOutCubic(burstProgress));
  const displayedCoinGain = Math.max(0, displayedCoinTotal - baseCoins);

  useEffect(() => {
    if (startCompleted) {
      setElapsedMs(TOTAL_DURATION_MS);
      hasCompletedAnimationRef.current = true;
      return;
    }

    let animationFrameId = 0;
    let startTimeMs = 0;

    const animate = (timestampMs: number) => {
      if (!startTimeMs) {
        startTimeMs = timestampMs;
      }

      const nextElapsedMs = Math.min(timestampMs - startTimeMs, TOTAL_DURATION_MS);
      setElapsedMs(nextElapsedMs);

      if (nextElapsedMs < TOTAL_DURATION_MS) {
        animationFrameId = window.requestAnimationFrame(animate);
      }
    };

    animationFrameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [startCompleted]);

  useEffect(() => {
    onDisplayedCoinsChange(displayedCoinTotal);
  }, [displayedCoinTotal, onDisplayedCoinsChange]);

  useEffect(() => {
    if (elapsedMs < TOTAL_DURATION_MS || hasCompletedAnimationRef.current) {
      return;
    }

    hasCompletedAnimationRef.current = true;
    onAnimationComplete?.();
  }, [elapsedMs, onAnimationComplete]);

  useEffect(() => {
    if (burstProgress === 0 && burstOrigin && targetPoint) {
      return;
    }

    if (burstProgress === 0) {
      return;
    }

    const originElement = formulaRef.current ?? sequenceCardRef.current;
    const nextOrigin = getCenterPoint(originElement);
    const nextTarget = getCoinDisplayTargetPoint();

    if (nextOrigin && !pointsEqual(nextOrigin, burstOrigin)) {
      setBurstOrigin(nextOrigin);
    }

    if (nextTarget && !pointsEqual(nextTarget, targetPoint)) {
      setTargetPoint(nextTarget);
    }
  }, [burstOrigin, burstProgress, targetPoint]);

  const particleStyles = useMemo<ParticleRender[]>(() => {
    if (!burstOrigin || !targetPoint || burstProgress === 0) {
      return [];
    }

    const burstElapsedMs = burstProgress * BURST_DURATION_MS;

    return particles.reduce<ParticleRender[]>((result, particle) => {
      const progress = clamp((burstElapsedMs - particle.delay) / particle.duration);

      if (progress <= 0) {
        return result;
      }

      const easedProgress = easeOutCubic(progress);
      const endX = targetPoint.x + particle.endOffsetX;
      const endY = targetPoint.y + particle.endOffsetY;
      const controlX = (burstOrigin.x + endX) / 2 + particle.endOffsetX * 0.4;
      const controlY = Math.min(burstOrigin.y, endY) - particle.lift;
      const x = quadraticBezier(burstOrigin.x, controlX, endX, easedProgress);
      const y = quadraticBezier(burstOrigin.y, controlY, endY, easedProgress);
      const opacity = progress > 0.84 ? 1 - (progress - 0.84) / 0.16 : 1;
      const scale = 0.82 + (1 - progress) * 0.28;

      result.push({
        id: particle.id,
        style: {
          width: `${particle.size}px`,
          height: `${particle.size}px`,
          opacity,
          transform: `translate(${x - particle.size / 2}px, ${y - particle.size / 2}px) scale(${scale}) rotate(${particle.spin * easedProgress}deg)`,
        },
      });

      return result;
    }, []);
  }, [burstOrigin, burstProgress, particles, targetPoint]);

  return (
    <div
      className={`reward-sequence-inline${difficultyProgress > 0.68 && difficultyProgress < 0.98 ? ' is-shaking' : ''}`}
      role="presentation"
    >
      {!isSequenceFinished && targetPoint ? (
        <div
          className="reward-sequence-target"
          style={{
            width: `${TARGET_MARKER_SIZE_PX}px`,
            height: `${TARGET_MARKER_SIZE_PX}px`,
            transform: `translate(${targetPoint.x - TARGET_MARKER_SIZE_PX / 2}px, ${targetPoint.y - TARGET_MARKER_SIZE_PX / 2}px) scale(${targetPulseScale})`,
          }}
        />
      ) : null}

      <div className="reward-sequence-card" ref={sequenceCardRef}>
        <div className="eyebrow">BB Coin Reward</div>
        <div className="reward-sequence-stage">{stageLabel}</div>

        <div className="reward-sequence-stars">
          <div>
            <div className="reward-sequence-value">{starCounterLabel}</div>
            <div className="reward-sequence-subtitle">
              {reward.stars === 1 ? 'star earned' : 'stars earned'}
            </div>
          </div>
          <StarRating large label={`${reward.stars} stars`} value={displayedStarValue} />
        </div>

        <div
          className={`reward-sequence-difficulty${difficultyProgress > 0 ? ' is-visible' : ''}`}
          style={{
            opacity: difficultyProgress === 0 ? 0 : 1,
            transform: `translate3d(0, ${-130 * difficultyDrop}px, 0) scale(${0.92 + difficultyProgress * 0.08})`,
          }}
        >
          {getDifficultyLabel(reward.difficulty)}
        </div>

        <div
          className={`reward-sequence-formula${formulaProgress > 0 ? ' is-visible' : ''}`}
          ref={formulaRef}
          style={{
            opacity: formulaReveal,
            transform: `translate3d(0, ${(1 - formulaReveal) * 20}px, 0) scale(${0.96 + formulaReveal * 0.04})`,
          }}
        >
          <span>{reward.stars} stars</span>
          <span aria-hidden="true">x</span>
          <span>{getDifficultyLabel(reward.difficulty)} x{difficultyMultiplierValue}</span>
          <span aria-hidden="true">=</span>
          <strong>{reward.rewardAmount.toLocaleString()} BB Coins</strong>
        </div>

        <div className="reward-sequence-total">
          <span className="reward-sequence-total-label">Wallet total</span>
          <strong className="reward-sequence-total-value">
            {displayedCoinTotal.toLocaleString()} BB Coins
          </strong>
          {displayedCoinGain > 0 ? (
            <span className="reward-sequence-total-gain">
              +{displayedCoinGain.toLocaleString()} in motion
            </span>
          ) : null}
        </div>

        <p className="reward-sequence-caption">
          {isSequenceFinished
            ? reward.rewardAmount > 0
              ? 'Your payout is ready. Use the action below the round to continue.'
              : 'No BB Coins were earned this round. Use the action below the round to continue.'
            : reward.rewardAmount > 0
              ? 'Watch the payout lock in, then continue to bank it.'
              : 'This round banks no BB Coins, but the result still gets locked for your profile.'}
        </p>
      </div>

      {!isSequenceFinished
        ? particleStyles.map((particle) => (
            <img
              alt=""
              aria-hidden="true"
              className="reward-coin-particle"
              key={particle.id}
              src={`${import.meta.env.BASE_URL}bbcoin.png`}
              style={particle.style}
            />
          ))
        : null}
    </div>
  );
}
