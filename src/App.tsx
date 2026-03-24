import { useEffect, useMemo, useState } from 'react';
import { CreateRoundPanel } from './features/rounds/components/CreateRoundPanel';
import { InboxPanel } from './features/rounds/components/InboxPanel';
import { PlayRoundPanel } from './features/rounds/components/PlayRoundPanel';
import { AuthPanel } from './features/auth/components/AuthPanel';
import { FriendsPanel } from './features/social/components/FriendsPanel';
import type { Round } from './features/rounds/types';
import type { FriendRequest } from './features/social/types';
import type { Friend } from './features/social/types';
import type { AppProfile } from './lib/auth';
import {
  getMyProfile,
  getSession,
  signOut,
  subscribeToAuthChanges,
} from './lib/auth';
import { listFriendRequests, listFriends } from './lib/friends';
import { listRounds } from './lib/rounds';
import { supabaseConfigError } from './lib/supabase';

type View = 'friends' | 'create' | 'inbox' | 'play';

function App() {
  const [view, setView] = useState<View>('friends');
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const showSecureContextWarning =
    typeof window !== 'undefined' && !window.isSecureContext;

  useEffect(() => {
    if (supabaseConfigError) {
      setIsAuthLoading(false);
      return;
    }

    let isActive = true;

    const loadCurrentSession = async () => {
      try {
        const session = await getSession();

        if (!isActive) {
          return;
        }

        setCurrentUserId(session?.user.id ?? null);
      } catch (error) {
        if (!isActive) {
          return;
        }

        setLoadError(
          error instanceof Error ? error.message : 'Unable to load the current session.',
        );
      } finally {
        if (isActive) {
          setIsAuthLoading(false);
        }
      }
    };

    void loadCurrentSession();

    const subscription = subscribeToAuthChanges((_event, session) => {
      setCurrentUserId(session?.user.id ?? null);
      setSignOutError(null);
    });

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  }, []);

  const refreshAppData = async () => {
    if (!currentUserId) {
      setProfile(null);
      setFriends([]);
      setRequests([]);
      setRounds([]);
      setSelectedRoundId(null);
      return;
    }

    setIsLoadingData(true);
    setLoadError(null);

    try {
      const [nextProfile, nextFriends, nextRequests, nextRounds] = await Promise.all([
        getMyProfile(),
        listFriends(currentUserId),
        listFriendRequests(currentUserId),
        listRounds(),
      ]);

      setProfile(nextProfile);
      setFriends(nextFriends);
      setRequests(nextRequests);
      setRounds(nextRounds);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Unable to load data from Supabase.',
      );
    } finally {
      setIsLoadingData(false);
    }
  };

  useEffect(() => {
    if (!currentUserId) {
      setProfile(null);
      setFriends([]);
      setRequests([]);
      setRounds([]);
      setSelectedRoundId(null);
      setView('friends');
      return;
    }

    void refreshAppData();
  }, [currentUserId]);

  useEffect(() => {
    if (selectedRoundId && !rounds.some((round) => round.id === selectedRoundId)) {
      setSelectedRoundId(null);

      if (view === 'play') {
        setView('inbox');
      }
    }
  }, [rounds, selectedRoundId, view]);

  const selectedRound = useMemo(
    () => rounds.find((round) => round.id === selectedRoundId) ?? null,
    [rounds, selectedRoundId],
  );

  const pendingIncomingCount = useMemo(
    () => requests.filter((request) => request.direction === 'incoming').length,
    [requests],
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

  const handleSignOut = async () => {
    setSignOutError(null);

    try {
      await signOut();
      setView('friends');
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Unable to sign out.');
    }
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero-card">
          <div className="hero-heading">
            <div>
              <h1>BackTalk</h1>
              <p>
                Record a phrase, reverse it, and send it to a friend. The recipient imitates the
                reversed sound, hears the imitation flipped back, and tries to guess the phrase.
              </p>
            </div>
            {profile ? (
              <button
                className="button ghost"
                onClick={() => {
                  void handleSignOut();
                }}
                type="button"
              >
                Sign out
              </button>
            ) : null}
          </div>
        </div>
        <div className="hero-meta">
          <div className="meta-chip">
            <strong>Auth</strong>
            <span>
              {profile ? `Logged in as ${profile.email}.` : 'Email/password login is required.'}
            </span>
          </div>
          <div className="meta-chip">
            <strong>Friends</strong>
            <span>
              {profile
                ? `${friends.length} confirmed friend${friends.length === 1 ? '' : 's'} and ${pendingIncomingCount} incoming request${pendingIncomingCount === 1 ? '' : 's'}.`
                : 'Add people by email and wait for them to accept your request.'}
            </span>
          </div>
          <div className="meta-chip">
            <strong>Privacy</strong>
            <span>
              {profile
                ? 'Rounds and audio are scoped to the sender and recipient with Supabase RLS.'
                : 'The app uses Supabase Auth plus row-level security for private rounds.'}
            </span>
          </div>
        </div>
      </section>

      {showSecureContextWarning ? (
        <div className="error-banner">
          This page is not running in a secure context. Microphone recording will only work on
          `localhost` or over HTTPS, so a plain LAN URL like `http://192.168.x.x:5173` can play
          audio but cannot record it.
        </div>
      ) : null}

      {signOutError ? <div className="error-banner">{signOutError}</div> : null}
      {loadError ? <div className="error-banner">{loadError}</div> : null}

      {isAuthLoading ? (
        <div className="info-banner">Checking your Supabase session...</div>
      ) : !currentUserId ? (
        <div className="stack">
          <AuthPanel />
        </div>
      ) : (
        <>
          <nav className="nav-row" aria-label="Primary">
            <button
              className={view === 'friends' ? 'active' : undefined}
              onClick={() => setView('friends')}
              type="button"
            >
              Friends ({friends.length})
            </button>
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
              My Rounds ({rounds.length})
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

          {isLoadingData ? (
            <div className="info-banner">Loading your private rounds and friend graph...</div>
          ) : null}

          <div className="stack">
            {view === 'friends' && profile ? (
              <FriendsPanel friends={friends} onRefresh={refreshAppData} requests={requests} />
            ) : null}
            {view === 'create' && profile ? (
              <CreateRoundPanel
                currentUserEmail={profile.email}
                currentUserId={profile.id}
                friends={friends}
                onCreateRound={handleCreateRound}
              />
            ) : null}
            {view === 'inbox' && currentUserId ? (
              <InboxPanel
                currentUserId={currentUserId}
                rounds={rounds}
                selectedRoundId={selectedRoundId}
                onSelectRound={handleSelectRound}
              />
            ) : null}
            {view === 'play' && currentUserId ? (
              <PlayRoundPanel
                currentUserId={currentUserId}
                round={selectedRound}
                onUpdateRound={handleUpdateRound}
              />
            ) : null}
          </div>
        </>
      )}
    </main>
  );
}

export default App;
