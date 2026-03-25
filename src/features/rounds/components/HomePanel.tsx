import { useMemo } from 'react';
import { StatusBadge } from '../../../components/StatusBadge';
import { getScorePresentation } from '../scorePresentation';
import type { Round } from '../types';

interface HomePanelProps {
  currentUserId: string;
  friendCount: number;
  rounds: Round[];
  selectedRoundId: string | null;
  onCreateRound: () => void;
  onOpenFriends: () => void;
  onSelectRound: (roundId: string) => void;
}

type HomeBucketId = 'your_turn' | 'waiting' | 'finished';

interface HomeBucket {
  id: HomeBucketId;
  title: string;
  description: string;
  emptyMessage: string;
  rounds: Round[];
}

function sortNewestFirst(left: Round, right: Round) {
  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
}

function getBucketId(round: Round, currentUserId: string): HomeBucketId | null {
  if (round.status === 'complete') {
    return 'finished';
  }

  if (round.recipientId === currentUserId) {
    return 'your_turn';
  }

  if (round.senderId === currentUserId) {
    return 'waiting';
  }

  return null;
}

function getRoundTitle(round: Round, currentUserId: string) {
  return round.recipientId === currentUserId
    ? `From ${round.senderEmail}`
    : `To ${round.recipientEmail}`;
}

function getRoundSummary(round: Round, currentUserId: string) {
  if (round.status === 'complete') {
    return round.score === null
      ? 'Round finished.'
      : `Round finished. Score: ${round.score}/10.`;
  }

  if (round.recipientId === currentUserId) {
    return round.status === 'attempted'
      ? 'Your attempt is saved. Drop in the guess to close it out.'
      : 'Your turn. Listen, imitate, and keep the round moving.';
  }

  return round.status === 'attempted'
    ? `${round.recipientEmail} recorded a take and still needs to guess.`
    : `Waiting for ${round.recipientEmail} to play.`;
}

function getBucketBadgeClass(bucketId: HomeBucketId) {
  switch (bucketId) {
    case 'your_turn':
      return 'attempted';
    case 'waiting':
      return 'waiting_for_attempt';
    case 'finished':
      return 'complete';
  }
}

function getBucketBadgeLabel(bucketId: HomeBucketId) {
  switch (bucketId) {
    case 'your_turn':
      return 'Ready now';
    case 'waiting':
      return 'Waiting';
    case 'finished':
      return 'Done';
  }
}

function formatRoundTime(createdAt: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(createdAt));
}

export function HomePanel({
  currentUserId,
  friendCount,
  rounds,
  selectedRoundId,
  onCreateRound,
  onOpenFriends,
  onSelectRound,
}: HomePanelProps) {
  const buckets = useMemo<HomeBucket[]>(() => {
    const grouped = {
      your_turn: [] as Round[],
      waiting: [] as Round[],
      finished: [] as Round[],
    };

    for (const round of rounds) {
      const bucketId = getBucketId(round, currentUserId);

      if (bucketId) {
        grouped[bucketId].push(round);
      }
    }

    return [
      {
        id: 'your_turn',
        title: 'Your turn',
        description: 'Rounds you can act on right now.',
        emptyMessage: 'Nothing is waiting on you right now. Start a new round whenever you want.',
        rounds: grouped.your_turn.sort(sortNewestFirst),
      },
      {
        id: 'waiting',
        title: 'Waiting on them',
        description: 'Rounds you sent that are still in motion.',
        emptyMessage: 'Nothing in flight yet. Send a round to get the game moving.',
        rounds: grouped.waiting.sort(sortNewestFirst),
      },
      {
        id: 'finished',
        title: 'Finished',
        description: 'Completed rounds and final scores.',
        emptyMessage: 'No finished rounds yet. Your medal shelf will fill in here.',
        rounds: grouped.finished.sort(sortNewestFirst),
      },
    ];
  }, [currentUserId, rounds]);

  const activeRoundCount = buckets[0].rounds.length + buckets[1].rounds.length;
  const latestFinishedRound = buckets.find((bucket) => bucket.id === 'finished')?.rounds[0] ?? null;
  const latestFinishedPresentation = latestFinishedRound
    ? getScorePresentation(latestFinishedRound.score)
    : null;
  const hasFriends = friendCount > 0;
  const visibleBuckets = buckets.filter((bucket) => bucket.rounds.length > 0);
  const focusBucket = buckets.find((bucket) => bucket.rounds.length > 0) ?? null;
  const focusRound = focusBucket?.rounds[0] ?? null;
  const focusBucketId = focusBucket?.id ?? null;

  return (
    <section className="surface">
      <div className="section-header">
        <div>
          <div className="eyebrow">Game Hub</div>
          <h2>Home</h2>
          <p>See the next thing that needs attention, then jump straight into it.</p>
        </div>
        <span className="badge primary">
          {activeRoundCount === 0 ? 'All clear' : `${activeRoundCount} live`}
        </span>
      </div>

      {!hasFriends ? (
        <div className="empty-state home-empty">
          <h3>Build your crew first</h3>
          <p>
            BackTalk starts working as soon as you have one confirmed friend. Add someone by email and your first round can go out right away.
          </p>
          <div className="button-row">
            <button className="button primary" onClick={onOpenFriends} type="button">
              Add your first friend
            </button>
          </div>
        </div>
      ) : (
        <div className="stack">
          {focusRound ? (
            <button className="focus-card" onClick={() => onSelectRound(focusRound.id)} type="button">
              <div className="focus-card-head">
                <span className={`badge ${getBucketBadgeClass(focusBucketId ?? 'your_turn')}`}>
                  {focusBucketId === 'your_turn'
                    ? 'Do this now'
                    : focusBucketId === 'waiting'
                      ? 'Still moving'
                      : 'Latest reveal'}
                </span>
                <StatusBadge status={focusRound.status} />
              </div>

              <div className="focus-card-body">
                <div>
                  <h3>{getRoundTitle(focusRound, currentUserId)}</h3>
                  <p>{getRoundSummary(focusRound, currentUserId)}</p>
                </div>
                <span className="focus-card-time">{formatRoundTime(focusRound.createdAt)}</span>
              </div>
            </button>
          ) : (
            <div className="success-banner">
              You are caught up. Start a new round to keep the game moving.
            </div>
          )}

          {visibleBuckets.map((bucket) => (
            <section className="surface nested-surface home-section" key={bucket.id}>
              <div className="section-header compact-header">
                <div>
                  <h3>{bucket.title}</h3>
                  <p>{bucket.description}</p>
                </div>
                <span className={`badge ${getBucketBadgeClass(bucket.id)}`}>{bucket.rounds.length}</span>
              </div>

              <div className="round-list">
                {bucket.rounds.map((round) => {
                  const isSelected = round.id === selectedRoundId;

                  return (
                    <button
                      className={isSelected ? 'selected' : undefined}
                      key={round.id}
                      onClick={() => onSelectRound(round.id)}
                      type="button"
                    >
                      <div className="round-row">
                        <div>
                          <h4>{getRoundTitle(round, currentUserId)}</h4>
                          <p>{formatRoundTime(round.createdAt)}</p>
                        </div>
                        <StatusBadge status={round.status} />
                      </div>

                      <div className="pill-row">
                        <span className={`badge ${getBucketBadgeClass(bucket.id)}`}>
                          {getBucketBadgeLabel(bucket.id)}
                        </span>
                      </div>

                      <p className="helper-text">{getRoundSummary(round, currentUserId)}</p>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}

          {latestFinishedRound && latestFinishedPresentation && focusBucket?.id !== 'finished' ? (
            <div className="result-box home-result-card">
              <p className={`score-mark tone-${latestFinishedPresentation.tone}`}>
                {latestFinishedPresentation.medalLabel}
              </p>
              <p>{latestFinishedPresentation.celebration}</p>
              <p>
                <strong>
                  {latestFinishedRound.recipientId === currentUserId ? 'From' : 'To'}:
                </strong>{' '}
                {latestFinishedRound.recipientId === currentUserId
                  ? latestFinishedRound.senderEmail
                  : latestFinishedRound.recipientEmail}
              </p>
              <p>
                <strong>Guess:</strong> {latestFinishedRound.guess || 'No guess submitted'}
              </p>
            </div>
          ) : null}
        </div>
      )}

      <div className="sticky-cta home-cta">
        <div className="button-row">
          <button
            className="button primary"
            onClick={hasFriends ? onCreateRound : onOpenFriends}
            type="button"
          >
            {hasFriends ? 'New Round' : 'Add Friends'}
          </button>
          <button className="button ghost" onClick={onOpenFriends} type="button">
            Friends ({friendCount})
          </button>
        </div>
      </div>
    </section>
  );
}
