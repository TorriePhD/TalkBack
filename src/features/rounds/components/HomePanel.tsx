import { useMemo, useState } from 'react';

interface HomeFriendSummary {
  id: string;
  username: string;
  averageStars: number | null;
  isYourTurn: boolean;
}

interface CreateGameOption {
  id: string;
  username: string;
}

interface HomePanelProps {
  friends: HomeFriendSummary[];
  createGameOptions?: CreateGameOption[];
  onCreateGame?: (friendId: string) => void;
  onOpenFriend?: (friendId: string) => void;
  onOpenFriends?: () => void;
}

function formatAverageScore(averageStars: number | null) {
  if (averageStars === null) {
    return 'No score yet';
  }

  return `${averageStars.toFixed(1)} / 3`;
}

function PlayIcon() {
  return (
    <svg
      aria-hidden="true"
      className="game-action-icon"
      fill="currentColor"
      viewBox="0 0 12 12"
    >
      <path d="M3 2.25v7.5L9 6 3 2.25Z" />
    </svg>
  );
}

export function HomePanel({
  friends,
  createGameOptions,
  onCreateGame,
  onOpenFriend,
  onOpenFriends,
}: HomePanelProps) {
  const [isChoosingFriend, setIsChoosingFriend] = useState(false);
  const sortedCreateGameOptions = useMemo(
    () =>
      [...(createGameOptions ?? [])].sort((left, right) =>
        left.username.localeCompare(right.username),
      ),
    [createGameOptions],
  );

  const handleCreateGameClick = () => {
    if (!sortedCreateGameOptions.length) {
      onOpenFriends?.();
      return;
    }

    if (!onCreateGame) {
      return;
    }

    if (sortedCreateGameOptions.length === 1) {
      onCreateGame(sortedCreateGameOptions[0].id);
      setIsChoosingFriend(false);
      return;
    }

    setIsChoosingFriend((current) => !current);
  };

  const handleSelectCreateGameFriend = (friendId: string) => {
    if (!onCreateGame) {
      return;
    }

    setIsChoosingFriend(false);
    onCreateGame(friendId);
  };

  return (
    <section className="surface home-shell">
      <div className="home-panel-header">
        <h2>Current Games</h2>
      </div>

      {friends.length === 0 ? (
        <div className="empty-state home-empty">
          <h3>No current games</h3>
          <p>Create a game to start your first one.</p>
        </div>
      ) : (
        <div className="game-list" role="list">
          {friends.map((friend) => (
            <div className="game-row" key={friend.id} role="listitem">
              <div className="game-row-main">
                <div className="game-row-copy">
                  <strong>{friend.username}</strong>
                </div>

                <div
                  className="game-score"
                  aria-label={`Average score ${formatAverageScore(friend.averageStars)}`}
                >
                  <span className="game-score-label">Average Score</span>
                  <span className="game-score-value">
                    {formatAverageScore(friend.averageStars)}
                  </span>
                </div>
              </div>

              {friend.isYourTurn ? (
                <div className="game-actions">
                  <button
                    className="button primary game-action-button"
                    onClick={() => {
                      onOpenFriend?.(friend.id);
                    }}
                    type="button"
                  >
                    <PlayIcon />
                    <span>Take Turn</span>
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {isChoosingFriend ? (
        <div className="surface nested-surface home-create-picker">
          <h3>Create Game</h3>
          <div className="home-create-options">
            {sortedCreateGameOptions.map((friend) => (
              <button
                className="home-create-option"
                key={friend.id}
                onClick={() => {
                  handleSelectCreateGameFriend(friend.id);
                }}
                type="button"
              >
                <span>{friend.username}</span>
                <span>Start</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="home-footer">
        <div className="button-row">
          <button className="button primary" onClick={handleCreateGameClick} type="button">
            Create game
          </button>
        </div>
      </div>
    </section>
  );
}
