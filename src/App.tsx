import { useEffect, useMemo, useState } from 'react';
import { AuthPanel } from './features/auth/components/AuthPanel';
import { CreateRoundPanel } from './features/rounds/components/CreateRoundPanel';
import { HomePanel } from './features/rounds/components/HomePanel';
import { PlayRoundPanel } from './features/rounds/components/PlayRoundPanel';
import type { Round } from './features/rounds/types';
import { FriendsPanel } from './features/social/components/FriendsPanel';
import type { Friend, FriendRequest } from './features/social/types';
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

type View = 'home' | 'create' | 'round' | 'friends';

const DEFAULT_SIGNED_IN_VIEW: View = 'home';

function App() {
  const [view, setView] = useState<View>(DEFAULT_SIGNED_IN_VIEW);
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
      setView(DEFAULT_SIGNED_IN_VIEW);
      return;
    }

    setView(DEFAULT_SIGNED_IN_VIEW);
    void refreshAppData();
  }, [currentUserId]);

  useEffect(() => {
    if (selectedRoundId && !rounds.some((round) => round.id === selectedRoundId)) {
      setSelectedRoundId(null);

      if (view === 'round') {
        setView(DEFAULT_SIGNED_IN_VIEW);
      }
    }
  }, [rounds, selectedRoundId, view]);

  const selectedRound = useMemo(
    () => rounds.find((round) => round.id === selectedRoundId) ?? null,
    [rounds, selectedRoundId],
  );
  const actionableRoundCount = useMemo(
    () =>
      currentUserId
        ? rounds.filter(
            (round) => round.recipientId === currentUserId && round.status !== 'complete',
          ).length
        : 0,
    [currentUserId, rounds],
  );
  const waitingRoundCount = useMemo(
    () =>
      currentUserId
        ? rounds.filter((round) => round.senderId === currentUserId && round.status !== 'complete')
            .length
        : 0,
    [currentUserId, rounds],
  );
  const finishedRoundCount = useMemo(
    () => rounds.filter((round) => round.status === 'complete').length,
    [rounds],
  );
  const liveRoundCount = actionableRoundCount + waitingRoundCount;

  const handleCreateRound = (round: Round) => {
    setRounds((currentRounds) => [round, ...currentRounds]);
    setSelectedRoundId(round.id);
    setView('round');
  };

  const handleSelectRound = (roundId: string) => {
    setSelectedRoundId(roundId);
    setView('round');
  };

  const handleOpenCreate = () => {
    setView('create');
  };

  const handleOpenFriends = () => {
    setView('friends');
  };

  const handleOpenHome = () => {
    setView('home');
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
      setView(DEFAULT_SIGNED_IN_VIEW);
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Unable to sign out.');
    }
  };

  return (
    <main className="app-shell">
      {!currentUserId && !isAuthLoading ? (
        <section className="hero welcome-shell">
          <div className="hero-card welcome-card">
            <div className="hero-heading">
              <div>
                <div className="eyebrow">Private Voice Rounds</div>
                <h1>BackTalk</h1>
                <p>
                  Record a phrase, flip it backward, and challenge a friend in a quick mobile-first round.
                </p>
              </div>
            </div>

            <div className="badge-row">
              <span className="badge created">Fast rounds</span>
              <span className="badge waiting">Hold to record</span>
              <span className="badge complete">Big reveals</span>
            </div>
          </div>

          <div className="hero-meta">
            <div className="meta-chip">
              <strong>One hand friendly</strong>
              <span>Short flows, large buttons, and a cleaner mobile layout.</span>
            </div>
            <div className="meta-chip">
              <strong>Private by default</strong>
              <span>Rounds only move between you and confirmed friends.</span>
            </div>
            <div className="meta-chip">
              <strong>Score at the end</strong>
              <span>The result stays hidden until the guess is submitted.</span>
            </div>
          </div>
        </section>
      ) : null}

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
          <section className="surface app-topbar">
            <div>
              <div className="eyebrow">Private Voice Rounds</div>
              <h1>BackTalk</h1>
              <p>
                {actionableRoundCount > 0
                  ? `${actionableRoundCount} round${actionableRoundCount === 1 ? '' : 's'} are waiting on you right now.`
                  : 'You are caught up. Start a new round or check what is still in flight.'}
              </p>
            </div>

            <div className="app-topbar-side">
              <div className="meta-chip topbar-meta">
                <strong>{profile?.email ?? 'Loading profile...'}</strong>
                <span>
                  {friends.length} friend{friends.length === 1 ? '' : 's'} connected
                </span>
              </div>

              <div className="button-row hero-actions">
                <button
                  className={`button ${view === 'friends' ? 'secondary' : 'ghost'}`}
                  onClick={handleOpenFriends}
                  type="button"
                >
                  Friends
                </button>
                <button
                  className="button ghost"
                  onClick={() => {
                    void handleSignOut();
                  }}
                  type="button"
                >
                  Sign out
                </button>
              </div>
            </div>
          </section>

          <section className="status-strip" aria-label="Round snapshot">
            <article className="status-tile status-tile-hot">
              <span className="card-kicker">Ready now</span>
              <strong>{actionableRoundCount}</strong>
              <p>{actionableRoundCount === 0 ? 'Nothing urgent' : 'Needs a move'}</p>
            </article>
            <article className="status-tile status-tile-cool">
              <span className="card-kicker">Live</span>
              <strong>{liveRoundCount}</strong>
              <p>{waitingRoundCount === 0 ? 'No rounds waiting on them' : `${waitingRoundCount} still in flight`}</p>
            </article>
            <article className="status-tile status-tile-finish">
              <span className="card-kicker">Finished</span>
              <strong>{finishedRoundCount}</strong>
              <p>{finishedRoundCount === 0 ? 'No medals yet' : 'Completed reveals'}</p>
            </article>
          </section>

          <nav className="nav-row" aria-label="Primary">
            <button
              className={view === 'home' ? 'active' : undefined}
              onClick={handleOpenHome}
              type="button"
            >
              Home
            </button>
            <button
              className={view === 'create' ? 'active' : undefined}
              onClick={handleOpenCreate}
              type="button"
            >
              Create
            </button>
            <button
              className={view === 'friends' ? 'active' : undefined}
              onClick={handleOpenFriends}
              type="button"
            >
              Friends
            </button>
            <button
              className={view === 'round' ? 'active' : undefined}
              disabled={!selectedRound}
              onClick={() => setView('round')}
              type="button"
            >
              Round
            </button>
          </nav>

          {isLoadingData ? (
            <div className="info-banner">Shuffling your rounds, friends, and score shelf...</div>
          ) : null}

          <div className="stack">
            {view === 'home' ? (
              <HomePanel
                currentUserId={currentUserId}
                friendCount={friends.length}
                rounds={rounds}
                selectedRoundId={selectedRoundId}
                onCreateRound={handleOpenCreate}
                onOpenFriends={handleOpenFriends}
                onSelectRound={handleSelectRound}
              />
            ) : null}
            {view === 'friends' && profile ? (
              <FriendsPanel friends={friends} onRefresh={refreshAppData} requests={requests} />
            ) : null}
            {view === 'create' && profile ? (
              <CreateRoundPanel
                currentUserEmail={profile.email}
                currentUserId={profile.id}
                friends={friends}
                onCreateRound={handleCreateRound}
                onOpenFriends={handleOpenFriends}
              />
            ) : null}
            {view === 'round' && currentUserId ? (
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
