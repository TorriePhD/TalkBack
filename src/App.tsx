import { useEffect, useMemo, useState } from 'react';
import { CreateRoundPanel } from './features/rounds/components/CreateRoundPanel';
import { InboxPanel } from './features/rounds/components/InboxPanel';
import { PlayRoundPanel } from './features/rounds/components/PlayRoundPanel';
import type { Round } from './features/rounds/types';
import { listRounds } from './lib/rounds';

type View = 'create' | 'inbox' | 'play';

function App() {
  const [view, setView] = useState<View>('create');
  const [rounds, setRounds] = useState<Round[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [isLoadingRounds, setIsLoadingRounds] = useState(true);
  const [roundsError, setRoundsError] = useState<string | null>(null);
  const showSecureContextWarning =
    typeof window !== 'undefined' && !window.isSecureContext;

  useEffect(() => {
    let isActive = true;

    const loadPersistedRounds = async () => {
      setIsLoadingRounds(true);
      setRoundsError(null);

      try {
        const nextRounds = await listRounds();

        if (!isActive) {
          return;
        }

        setRounds(nextRounds);
      } catch (error) {
        if (!isActive) {
          return;
        }

        setRoundsError(
          error instanceof Error ? error.message : 'Unable to load rounds from Supabase.',
        );
      } finally {
        if (isActive) {
          setIsLoadingRounds(false);
        }
      }
    };

    void loadPersistedRounds();

    return () => {
      isActive = false;
    };
  }, []);

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
            <strong>Supabase</strong>
            <span>Rounds and recording URLs load from the shared backend inbox.</span>
          </div>
          <div className="meta-chip">
            <strong>Storage</strong>
            <span>Prompt and attempt recordings are stored in the `audio` bucket.</span>
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

      {roundsError ? <div className="error-banner">{roundsError}</div> : null}
      {isLoadingRounds ? (
        <div className="info-banner">Loading rounds from Supabase...</div>
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
