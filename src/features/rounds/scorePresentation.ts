import type { Round } from './types';

type MedalTone = 'bronze' | 'silver' | 'gold' | 'platinum' | 'pending';

export interface ScorePresentation {
  medalLabel: string;
  description: string;
  celebration: string;
  tone: MedalTone;
}

export interface RoundSummary {
  headline: string;
  description: string;
  callToAction: string;
}

function buildScorePresentation(score: number): ScorePresentation {
  if (score === 10) {
    return {
      medalLabel: 'Platinum',
      description: 'Exact match. Nothing got lost in the noise.',
      celebration: 'Perfect score. That was spotless.',
      tone: 'platinum',
    };
  }

  if (score >= 8) {
    return {
      medalLabel: 'Gold',
      description: 'Very close. Your imitation landed cleanly.',
      celebration: 'Gold tier. Tiny details made the difference.',
      tone: 'gold',
    };
  }

  if (score >= 5) {
    return {
      medalLabel: 'Silver',
      description: 'A solid attempt with a few wobble points.',
      celebration: 'Silver energy. You were in the pocket.',
      tone: 'silver',
    };
  }

  return {
    medalLabel: 'Bronze',
    description: 'A brave first pass. The shape is there.',
    celebration: 'Bronze earned. The next round can only get sharper.',
    tone: 'bronze',
  };
}

export function getScorePresentation(score: number | null): ScorePresentation {
  if (score === null) {
    return {
      medalLabel: 'Pending',
      description: 'Submit the guess to reveal the score.',
      celebration: 'The reveal is waiting.',
      tone: 'pending',
    };
  }

  return buildScorePresentation(score);
}

export function getRoundSummary(round: Round, isRecipient: boolean): RoundSummary {
  if (isRecipient) {
    if (round.status === 'complete') {
      return {
        headline: 'Round complete. See how close you got.',
        description: 'Your final score is ready and the original phrase is unlocked.',
        callToAction: 'Replay the clips any time.',
      };
    }

    if (round.status === 'attempted') {
      return {
        headline: 'Your take is saved. Time to guess.',
        description: 'The imitation is locked in. Now type the phrase you think you heard.',
        callToAction: 'Tap reveal score when you are ready.',
      };
    }

    return {
      headline: `Your turn against ${round.senderEmail}.`,
      description: 'Listen to the reversed prompt, record your imitation, then make your guess.',
      callToAction: 'Start with the reversed prompt.',
    };
  }

  if (round.status === 'complete') {
    return {
      headline: `${round.recipientEmail} finished the round.`,
      description: 'The reveal is unlocked and the score is in.',
      callToAction: 'Check the final result below.',
    };
  }

  if (round.status === 'attempted') {
    return {
      headline: `${round.recipientEmail} is on the last step.`,
      description: 'Their take is saved and they still need to submit a guess.',
      callToAction: 'The final reveal is close.',
    };
  }

  return {
    headline: `Waiting on ${round.recipientEmail}.`,
    description: 'They need to record an imitation before the round can finish.',
    callToAction: 'They will play the reversed prompt next.',
  };
}
