import { useMemo } from 'react';
import type { Round } from '../types';

type FriendStatusTone = 'primary' | 'waiting' | 'active' | 'complete';

interface HomeFriendSummary {
  id: string;
  username: string;
  createdAt: string;
  averageStars?: number | null;
  statusLabel?: string;
  statusTone?: FriendStatusTone;
  roundCount?: number;
  lastActiveAt?: string | null;
  activeRoundId?: string | null;
}

interface HomePanelProps {
  currentUserId?: string;
  friendCount?: number;
  rounds?: Round[];
  selectedRoundId?: string | null;
  onCreateRound?: () => void;
  onOpenFriends?: () => void;
  onOpenFriend?: (friendId: string) => void;
  onSelectRound?: (roundId: string) => void;
  friends?: HomeFriendSummary[];
}

interface FriendRow {
  id: string;
  username: string;
  createdAt: string | null;
  averageStars: number | null;
  statusLabel: string;
  statusTone: FriendStatusTone;
  roundCount: number;
  lastActiveAt: string | null;
  activeRoundId: string | null;
}

function sortNewestFirst(left: Round, right: Round) {
  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
}

function scoreToStars(score: number | null): 0 | 1 | 2 | 3 | null {
  if (score === null) {
    return null;
  }

  if (score >= 10) {
    return 3;
  }

  if (score >= 8) {
    return 2;
  }

  if (score >= 5) {
    return 1;
  }

  return 0;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function getStatusTone(round: Round | null, isCurrentUserTurn: boolean): FriendStatusTone {
  if (!round) {
    return 'primary';
  }

  if (round.status === 'complete') {
    return 'complete';
  }

  if (round.status === 'attempted') {
    return isCurrentUserTurn ? 'active' : 'waiting';
  }

  return isCurrentUserTurn ? 'primary' : 'waiting';
}

function getStatusLabel(round: Round | null, isCurrentUserTurn: boolean) {
  if (!round) {
    return 'Ready to start';
  }

  if (round.status === 'complete') {
    return 'Ready to continue';
  }

  if (round.status === 'attempted') {
    return isCurrentUserTurn ? 'Review take' : 'Take saved';
  }

  return isCurrentUserTurn ? 'Your turn' : 'Waiting';
}

function getThreadSubtitle(roundCount: number, lastActiveAt: string | null) {
  if (!roundCount) {
    return 'No rounds yet. Tap to start the first session.';
  }

  const dateLabel = formatDateTime(lastActiveAt);
  return dateLabel
    ? `${roundCount} session${roundCount === 1 ? '' : 's'} total, last active ${dateLabel}`
    : `${roundCount} session${roundCount === 1 ? '' : 's'} total`;
}

function buildDerivedFriendRows(
  friends: HomeFriendSummary[] | undefined,
  rounds: Round[] | undefined,
  currentUserId: string | undefined,
) {
  if (friends?.length) {
    return friends.map<FriendRow>((friend) => ({
      id: friend.id,
      username: friend.username,
      createdAt: friend.createdAt ?? null,
      averageStars: friend.averageStars ?? null,
      statusLabel: friend.statusLabel ?? 'Ready to start',
      statusTone: friend.statusTone ?? 'primary',
      roundCount: friend.roundCount ?? 0,
      lastActiveAt: friend.lastActiveAt ?? friend.createdAt ?? null,
      activeRoundId: friend.activeRoundId ?? null,
    }));
  }

  if (!rounds?.length || !currentUserId) {
    return [];
  }

  const peers = new Map<
    string,
    {
      id: string;
      username: string;
      createdAt: string | null;
      rounds: Round[];
    }
  >();

  for (const round of rounds) {
    const isSender: boolean = round.senderId === currentUserId;
    const peerId: string = isSender ? round.recipientId : round.senderId;
    const peerUsername: string = isSender ? round.recipientUsername : round.senderUsername;

    if (!peerId || peerId === currentUserId) {
      continue;
    }

    const existing = peers.get(peerId);
    if (existing) {
      existing.rounds.push(round);
      continue;
    }

    peers.set(peerId, {
      id: peerId,
      username: peerUsername,
      createdAt: round.createdAt,
      rounds: [round],
    });
  }

  return Array.from(peers.values())
    .map<FriendRow>((peer) => {
      const threadRounds = [...peer.rounds].sort(sortNewestFirst);
      const latestRound = threadRounds[0] ?? null;
      const completedStars = threadRounds
        .filter((threadRound) => threadRound.status === 'complete' && threadRound.score !== null)
        .map((threadRound) => scoreToStars(threadRound.score))
        .filter((value): value is 0 | 1 | 2 | 3 => value !== null);
      const averageStars = completedStars.length
        ? completedStars.reduce<number>((sum, value) => sum + value, 0) / completedStars.length
        : null;
      const isCurrentUserTurn = latestRound ? latestRound.recipientId === currentUserId : false;

      return {
        id: peer.id,
        username: peer.username,
        createdAt: peer.createdAt,
        averageStars,
        statusLabel: getStatusLabel(latestRound, isCurrentUserTurn),
        statusTone: getStatusTone(latestRound, isCurrentUserTurn),
        roundCount: threadRounds.length,
        lastActiveAt: latestRound?.createdAt ?? peer.createdAt,
        activeRoundId: latestRound?.id ?? null,
      };
    })
    .sort((left, right) => {
      const leftDate = new Date(left.lastActiveAt ?? left.createdAt ?? 0).getTime();
      const rightDate = new Date(right.lastActiveAt ?? right.createdAt ?? 0).getTime();
      return rightDate - leftDate || left.username.localeCompare(right.username);
    });
}

function formatAverageStars(averageStars: number | null) {
  if (averageStars === null) {
    return '0.0 / 3';
  }

  return `${averageStars.toFixed(1)} / 3`;
}

function renderStars(averageStars: number | null) {
  const filledStars = averageStars === null ? 0 : Math.round(averageStars);
  return '***'.slice(0, filledStars).padEnd(3, '-');
}

export function HomePanel({
  currentUserId,
  friendCount,
  rounds,
  selectedRoundId,
  onCreateRound,
  onOpenFriends,
  onOpenFriend,
  onSelectRound,
  friends,
}: HomePanelProps) {
  const friendRows = useMemo(
    () => buildDerivedFriendRows(friends, rounds, currentUserId),
    [currentUserId, friends, rounds],
  );

  const totalFriends = friendRows.length || friendCount || 0;
  const selectedFriendId = useMemo(() => {
    if (!selectedRoundId || !rounds?.length || !currentUserId) {
      return null;
    }

    const selectedRound = rounds.find((round) => round.id === selectedRoundId);
    if (!selectedRound) {
      return null;
    }

    return selectedRound.senderId === currentUserId
      ? selectedRound.recipientId
      : selectedRound.senderId;
  }, [currentUserId, rounds, selectedRoundId]);

  const hasFriendRows = friendRows.length > 0;

  const handleOpenFriend = (friend: FriendRow) => {
    if (onOpenFriend) {
      onOpenFriend(friend.id);
      return;
    }

    if (friend.activeRoundId && onSelectRound) {
      onSelectRound(friend.activeRoundId);
      return;
    }

    if (onCreateRound) {
      onCreateRound();
      return;
    }

    onOpenFriends?.();
  };

  return (
    <section className="surface home-shell">
      <div className="section-header">
        <div>
          <div className="eyebrow">Friends</div>
          <h2>Home</h2>
          <p>Tap a person to continue the thread. Average stars are shown per friend.</p>
        </div>
        <span className="badge primary">
          {totalFriends === 0 ? 'No friends yet' : `${totalFriends} connected`}
        </span>
      </div>

      {!hasFriendRows ? (
        <div className="empty-state home-empty">
          <h3>Add your first friend</h3>
          <p>
            Once your friends list is populated, each row becomes the entry point for that pair's
            thread. New rounds can start from the same place.
          </p>
          <div className="button-row">
            <button
              className="button primary"
              onClick={() => {
                onOpenFriends?.();
              }}
              type="button"
            >
              Manage friends
            </button>
            {onCreateRound ? (
              <button
                className="button ghost"
                onClick={() => {
                  onCreateRound();
                }}
                type="button"
              >
                Start a round
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="friend-list" role="list">
          {friendRows.map((friend) => {
            const isSelected = friend.id === selectedFriendId;

            return (
              <button
                className={`friend-row${isSelected ? ' selected' : ''}`}
                key={friend.id}
                onClick={() => {
                  handleOpenFriend(friend);
                }}
                type="button"
              >
                <div className="friend-avatar" aria-hidden="true">
                  {friend.username.slice(0, 1).toUpperCase()}
                </div>

                <div className="friend-copy">
                  <div className="friend-headline">
                    <strong>{friend.username}</strong>
                    <span className={`friend-status friend-status-${friend.statusTone}`}>
                      {friend.statusLabel}
                    </span>
                  </div>

                  <p>{getThreadSubtitle(friend.roundCount, friend.lastActiveAt)}</p>
                </div>

                <div className="friend-metrics">
                  <div
                    className="star-meter"
                    aria-label={`Average ${formatAverageStars(friend.averageStars)}`}
                  >
                    <span className="star-meter-value">{formatAverageStars(friend.averageStars)}</span>
                    <span className="star-meter-stars" aria-hidden="true">
                      {renderStars(friend.averageStars)}
                    </span>
                  </div>

                  <span className="friend-open-hint">
                    {friend.roundCount > 0 ? 'Open thread' : 'Start thread'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="home-footer">
        <div className="button-row">
          {onOpenFriends ? (
            <button className="button ghost" onClick={onOpenFriends} type="button">
              Invite or manage friends
            </button>
          ) : null}
          {onCreateRound ? (
            <button className="button primary" onClick={onCreateRound} type="button">
              Start a round
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
