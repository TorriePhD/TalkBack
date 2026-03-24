import { useMemo, useState } from 'react';
import { CreateRoundPanel } from './features/rounds/components/CreateRoundPanel';
import { InboxPanel } from './features/rounds/components/InboxPanel';
import { PlayRoundPanel } from './features/rounds/components/PlayRoundPanel';
import type { Round } from './features/rounds/types';

type View = 'create' | 'inbox' | 'play';

function App() {
  const [view, setView] = useState<View>('create');
  const [rounds, setRounds] = useState<Round[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const showSecureContextWarning =
    typeof window !== 'undefined' && !window.isSecureContext;

  const selectedRound = useMemo(
    () => rounds.find((round) => round.id === selectedRoundId) ?? null,
    [rounds, selectedRoundId],
  );

  const handleCreateRound = (round: Round) => {
    setRounds((currentRounds) => [round, ...currentRounds]);
    setSelectedRoundId(round.id);
    setView('inbox');
  };

  const handleSelectRound = (roundId: string) => {
    setSelectedRoundId(roundId);
    setView('play');
  };

  const handleUpdateRound = (roundId: string, updater: (round: Round) => Round) => {
    setRounds((currentRounds) =>
      currentRounds.map((round) => (round.id === roundId ? updater(round) : round)),
    );
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero-card">
          <h1>TalkBack</h1>
          <p>
            One player records a phrase. The app reverses it. The second player imitates the
            reversed sound, then hears that imitation flipped back and tries to guess the phrase.
          </p>
        </div>
        <div className="hero-meta">
          <div className="meta-chip">
            <strong>Phase 1</strong>
            <span>All round state stays in frontend React state only.</span>
          </div>
          <div className="meta-chip">
            <strong>Storage Ready</strong>
            <span>Supabase is wired for optional audio uploads, with no tables or auth yet.</span>
          </div>
        </div>
      </section>

      <nav className="nav-row" aria-label="Primary">
        <button
          className={view === 'create' ? 'active' : undefined}
          onClick={() => setView('create')}
          type="button"
        >
          Create Round
        </button>
        <button
          className={view === 'inbox' ? 'active' : undefined}
          onClick={() => setView('inbox')}
          type="button"
        >
          Inbox ({rounds.length})
        </button>
        <button
          className={view === 'play' ? 'active' : undefined}
          disabled={!selectedRound}
          onClick={() => setView('play')}
          type="button"
        >
          Play Round
        </button>
      </nav>

      {showSecureContextWarning ? (
        <div className="error-banner">
          This page is not running in a secure context. Microphone recording will only work on
          `localhost` or over HTTPS, so a plain LAN URL like `http://192.168.x.x:5173` can play
          audio but cannot record it.
        </div>
      ) : null}

      <div className="stack">
        {view === 'create' ? <CreateRoundPanel onCreateRound={handleCreateRound} /> : null}
        {view === 'inbox' ? (
          <InboxPanel
            rounds={rounds}
            selectedRoundId={selectedRoundId}
            onSelectRound={handleSelectRound}
          />
        ) : null}
        {view === 'play' ? (
          <PlayRoundPanel round={selectedRound} onUpdateRound={handleUpdateRound} />
        ) : null}
      </div>
    </main>
  );
}

export default App;
