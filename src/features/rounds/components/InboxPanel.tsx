import { StatusBadge } from '../../../components/StatusBadge';
import type { Round } from '../types';

interface InboxPanelProps {
  rounds: Round[];
  selectedRoundId: string | null;
  onSelectRound: (roundId: string) => void;
}

export function InboxPanel({
  rounds,
  selectedRoundId,
  onSelectRound,
}: InboxPanelProps) {
  return (
    <section className="surface">
      <div className="section-header">
        <div>
          <h2>Inbox</h2>
          <p>Locally created rounds wait here until Player 2 opens one and records an attempt.</p>
        </div>
      </div>

      {rounds.length === 0 ? (
        <div className="empty-state">
          Create a round first. New rounds stay in frontend React state only for this phase.
        </div>
      ) : (
        <div className="round-list">
          {rounds.map((round) => (
            <button
              key={round.id}
              className={round.id === selectedRoundId ? 'selected' : undefined}
              onClick={() => onSelectRound(round.id)}
              type="button"
            >
              <div className="round-row">
                <div>
                  <h4>
                    {round.player1Name} to {round.player2Name}
                  </h4>
                  <p>{new Date(round.createdAt).toLocaleString()}</p>
                </div>
                <StatusBadge status={round.status} />
              </div>
              <p className="helper-text">
                Phrase length: {round.correctPhrase.length} characters
              </p>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
