import { useEffect, useMemo, useRef, useState } from 'react';
import homeLogo from './assets/backtalk-logo.png';
import { StarRating } from './components/StarRating';
import { WaveformLoader } from './components/WaveformLoader';
import { AuthPanel } from './features/auth/components/AuthPanel';
import { CreateRoundPanel } from './features/rounds/components/CreateRoundPanel';
import { HomePanel } from './features/rounds/components/HomePanel';
import { PlayRoundPanel } from './features/rounds/components/PlayRoundPanel';
import type { ArchiveCompletedRoundSummary, Round } from './features/rounds/types';
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
import { archiveCompletedRound, listRounds } from './lib/rounds';
import { supabaseConfigError } from './lib/supabase';

type View = 'home' | 'thread' | 'friends';

interface ThreadSummary {
  activeRound: Round | null;
  averageStars: number | null;
  canCurrentUserStart: boolean;
  canRecipientComposeNext: boolean;
  displayRound: Round | null;
  friend: Friend;
  lastActiveAt: string | null;
  latestRound: Round | null;
  reviewRound: Round | null;
  roundCount: number;
}

const DEFAULT_SIGNED_IN_VIEW: View = 'home';

function sortNewestFirst(left: Round, right: Round) {
  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
}

function isRoundForFriend(round: Round, currentUserId: string, friendId: string) {
  return (
    (round.senderId === currentUserId && round.recipientId === friendId) ||
    (round.senderId === friendId && round.recipientId === currentUserId)
  );
}

function getThreadDescription(
  friend: Friend,
  round: Round | null,
  currentUserId: string,
  options: {
    canCurrentUserStart: boolean;
    canRecipientComposeNext: boolean;
    reviewRound: Round | null;
  },
) {
  const { canCurrentUserStart, canRecipientComposeNext, reviewRound } = options;

  if (reviewRound) {
    return `Review ${friend.username}'s imitation of your previous prompt, then continue into the next round.`;
  }

  if (!round) {
    if (canRecipientComposeNext) {
      return `Your last guess is locked in. Record the next prompt for ${friend.username}.`;
    }

    return canCurrentUserStart
      ? `There is no live round right now. Start the next prompt for ${friend.username}.`
      : `${friend.username} is up to record the next prompt.`;
  }

  if (round.status === 'complete') {
    return round.senderId === currentUserId
      ? 'Their imitation and score are ready for review.'
      : 'Your score is locked in. Record the next prompt to keep the chain moving.';
  }

  if (round.recipientId === currentUserId) {
    return round.status === 'attempted'
      ? 'Your take is saved. Submit the guess, then you will record the next prompt.'
      : 'Listen to the reversed prompt, record your imitation, and keep the chain moving.';
  }

  return round.status === 'attempted'
    ? 'They recorded a take and are finishing the guess.'
    : 'Waiting for them to imitate your prompt.';
}

function getSelectedFriendIdFromRound(round: Round | null, currentUserId: string | null) {
  if (!round || !currentUserId) {
    return null;
  }

  return round.senderId === currentUserId ? round.recipientId : round.senderId;
}

function isCurrentUserTurn(thread: ThreadSummary, currentUserId: string | null) {
  if (!currentUserId) {
    return false;
  }

  if (thread.reviewRound) {
    return true;
  }

  if (thread.activeRound) {
    return thread.activeRound.recipientId === currentUserId;
  }

  return thread.canRecipientComposeNext || thread.canCurrentUserStart;
}

function mapArchivedRoundToFriend(friend: Friend, summary: ArchiveCompletedRoundSummary): Friend {
  return {
    ...friend,
    completedRoundCount: summary.completedRoundCount,
    averageStars: summary.averageStars,
    nextSenderId: summary.nextSenderId,
    lastCompletedAt: summary.lastCompletedAt,
  };
}

function LoadingPanel({ message }: { message: string }) {
  const loaderPreviewLabel = message.toLowerCase().includes('revers')
    ? 'Reversing audio...'
    : 'Loading...';

  return (
    <section className="surface loader-panel" aria-live="polite" role="status">
      <div className="loader-panel-preview" aria-hidden="true">
        <WaveformLoader className="loader-panel-spinner" size={122} strokeWidth={4} />
        <span className="loader-panel-preview-label">{loaderPreviewLabel}</span>
      </div>
      <div>
        <strong>{message}</strong>
        <p>The waveform path itself animates, so the energy travels around the ring instead of rotating a flat asset.</p>
      </div>
    </section>
  );
}

function FullscreenLoadingScreen() {
  return (
    <main className="fullscreen-loader-screen" aria-live="polite" role="status">
      <div className="fullscreen-loader-content">
        <img alt="BackTalk" className="fullscreen-loader-logo" src={homeLogo} />
        <WaveformLoader className="fullscreen-loader-spinner" size={128} strokeWidth={4} />
        <p>Loading...</p>
      </div>
    </main>
  );
}

function DrawerButton({
  active = false,
  children,
  onClick,
}: {
  active?: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? 'active' : undefined} onClick={onClick} type="button">
      {children}
    </button>
  );
}

function WaitingThreadPanel({
  canCurrentUserStart,
  friend,
  onBack,
}: {
  canCurrentUserStart: boolean;
  friend: Friend;
  onBack: () => void;
}) {
  return (
    <section className="surface round-screen">
      <div className="round-screen-header">
        <button className="button ghost round-screen-back" onClick={onBack} type="button">
          Back
        </button>

        <div className="round-screen-copy">
          <div className="eyebrow">{canCurrentUserStart ? 'Your Send Turn' : 'Waiting'}</div>
          <h2>
            {canCurrentUserStart
              ? `Start the next round for ${friend.username}`
              : `Waiting on ${friend.username}`}
          </h2>
          <p>
            {canCurrentUserStart
              ? 'There is no live round in this thread. Record the next prompt to keep the session moving.'
              : `${friend.username} is up to send the next prompt. Once they record it, your turn will open here.`}
          </p>
        </div>

        <div className="pill-row round-screen-meta">
          <span className="badge primary">{friend.username}</span>
          <span className={`badge ${canCurrentUserStart ? 'complete' : 'waiting_for_attempt'}`}>
            {canCurrentUserStart ? 'Ready' : 'Waiting'}
          </span>
        </div>
      </div>

      <div className="round-screen-body">
        <div className="result-box">
          <div className="thread-average-score">
            <strong>Average score:</strong>
            <StarRating
              label={
                friend.averageStars === null || friend.averageStars === undefined
                  ? 'No completed rounds yet'
                  : `Average score ${friend.averageStars.toFixed(1)} out of 3`
              }
              value={friend.averageStars ?? 0}
            />
            <span>
              {friend.averageStars === null || friend.averageStars === undefined
                ? 'No completed rounds yet'
                : `${friend.averageStars.toFixed(1)} / 3`}
            </span>
          </div>
          <p>
            <strong>Completed sessions:</strong> {friend.completedRoundCount}
          </p>
          {friend.lastCompletedAt ? (
            <p>
              <strong>Last finished:</strong>{' '}
              {new Date(friend.lastCompletedAt).toLocaleString()}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function App() {
  const [view, setView] = useState<View>(DEFAULT_SIGNED_IN_VIEW);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isComposingNextRound, setIsComposingNextRound] = useState(false);
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [hasLoadedInitialData, setHasLoadedInitialData] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const initialLoadRequestIdRef = useRef(0);
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

  const refreshAppData = async (options?: {
    initialLoadRequestId?: number;
    resolveInitialLoad?: boolean;
  }) => {
    if (!currentUserId) {
      setProfile(null);
      setFriends([]);
      setRequests([]);
      setRounds([]);
      setSelectedFriendId(null);
      setIsComposingNextRound(false);
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

      if (
        options?.resolveInitialLoad &&
        options.initialLoadRequestId === initialLoadRequestIdRef.current
      ) {
        setHasLoadedInitialData(true);
      }
    }
  };

  useEffect(() => {
    if (!currentUserId) {
      setProfile(null);
      setFriends([]);
      setRequests([]);
      setRounds([]);
      setSelectedFriendId(null);
      setView(DEFAULT_SIGNED_IN_VIEW);
      setIsMenuOpen(false);
      setIsComposingNextRound(false);
      initialLoadRequestIdRef.current += 1;
      setHasLoadedInitialData(false);
      return;
    }

    initialLoadRequestIdRef.current += 1;
    const initialLoadRequestId = initialLoadRequestIdRef.current;

    setView(DEFAULT_SIGNED_IN_VIEW);
    setIsMenuOpen(false);
    setIsComposingNextRound(false);
    setHasLoadedInitialData(false);
    void refreshAppData({ initialLoadRequestId, resolveInitialLoad: true });
  }, [currentUserId]);

  useEffect(() => {
    if (!selectedFriendId) {
      return;
    }

    if (!friends.some((friend) => friend.id === selectedFriendId)) {
      setSelectedFriendId(null);
      setIsComposingNextRound(false);

      if (view === 'thread') {
        setView(DEFAULT_SIGNED_IN_VIEW);
      }
    }
  }, [friends, selectedFriendId, view]);

  const threadSummaries = useMemo(() => {
    if (!currentUserId) {
      return [] as ThreadSummary[];
    }

    return friends
      .map<ThreadSummary>((friend) => {
        const pairRounds = rounds
          .filter((round) => isRoundForFriend(round, currentUserId, friend.id))
          .sort(sortNewestFirst);
        const latestRound = pairRounds[0] ?? null;
        const activeRound = pairRounds.find((round) => round.status !== 'complete') ?? null;
        const reviewRound =
          pairRounds.find(
            (round) =>
              round.status === 'complete' &&
              round.senderId === currentUserId,
          ) ?? null;
        const canRecipientComposeNext =
          !activeRound &&
          !reviewRound &&
          Boolean(
            latestRound &&
              latestRound.status === 'complete' &&
              latestRound.recipientId === currentUserId,
          );
        const canCurrentUserStart =
          !activeRound &&
          !reviewRound &&
          !canRecipientComposeNext &&
          (!latestRound ? !friend.nextSenderId || friend.nextSenderId === currentUserId : false);
        const displayRound = reviewRound ?? activeRound ?? (canRecipientComposeNext ? latestRound : null);

        return {
          activeRound,
          averageStars: friend.averageStars ?? null,
          canCurrentUserStart,
          canRecipientComposeNext,
          displayRound,
          friend,
          lastActiveAt: latestRound?.createdAt ?? friend.lastCompletedAt ?? friend.createdAt,
          latestRound,
          reviewRound,
          roundCount: friend.completedRoundCount + pairRounds.length,
        };
      })
      .sort((left, right) => {
        const leftDate = new Date(left.lastActiveAt ?? left.friend.createdAt).getTime();
        const rightDate = new Date(right.lastActiveAt ?? right.friend.createdAt).getTime();
        return rightDate - leftDate || left.friend.username.localeCompare(right.friend.username);
      });
  }, [currentUserId, friends, rounds]);

  const selectedThread = useMemo(
    () => threadSummaries.find((thread) => thread.friend.id === selectedFriendId) ?? null,
    [selectedFriendId, threadSummaries],
  );

  const currentPageTitle = useMemo(() => {
    switch (view) {
      case 'friends':
        return 'Friends';
      case 'thread':
        return selectedThread?.friend.username ?? 'Thread';
      case 'home':
      default:
        return 'Home';
    }
  }, [selectedThread?.friend.username, view]);

  const currentPageDescription = useMemo(() => {
    if (view === 'home') {
      return 'Each friend has one running chain. Review the previous round, play the current one, then record the next prompt.';
    }

    if (view === 'friends') {
      return 'Invite people here, then jump back to Home to open their thread.';
    }

    if (selectedThread && currentUserId) {
      return getThreadDescription(selectedThread.friend, selectedThread.displayRound, currentUserId, {
        canCurrentUserStart: selectedThread.canCurrentUserStart,
        canRecipientComposeNext: selectedThread.canRecipientComposeNext,
        reviewRound: selectedThread.reviewRound,
      });
    }

    return 'Pick a friend from Home to open the current thread.';
  }, [currentUserId, selectedThread, view]);

  const handleSelectFriend = (friendId: string) => {
    setSelectedFriendId(friendId);
    setIsComposingNextRound(false);
    setView('thread');
    setIsMenuOpen(false);
  };

  const handleCreateGame = (friendId: string) => {
    setSelectedFriendId(friendId);
    setIsComposingNextRound(true);
    setView('thread');
    setIsMenuOpen(false);
  };

  const handleCreateRound = (round: Round) => {
    setRounds((currentRounds) => [round, ...currentRounds]);
    setSelectedFriendId(getSelectedFriendIdFromRound(round, currentUserId));
    setIsComposingNextRound(false);
    setView('thread');
  };

  const handleOpenFriends = () => {
    setView('friends');
    setIsMenuOpen(false);
    setIsComposingNextRound(false);
  };

  const handleOpenHome = () => {
    setView('home');
    setIsMenuOpen(false);
    setIsComposingNextRound(false);
  };

  const handleBackFromCreateRound = () => {
    if (selectedThread?.displayRound) {
      setIsComposingNextRound(false);
      return;
    }

    handleOpenHome();
  };

  const handleUpdateRound = (roundId: string, updater: (round: Round) => Round) => {
    setRounds((currentRounds) =>
      currentRounds.map((round) => (round.id === roundId ? updater(round) : round)),
    );
  };

  const handleArchiveRound = async (round: Round) => {
    if (!currentUserId) {
      return;
    }

    const archivedSummary = await archiveCompletedRound({
      currentUserId,
      roundId: round.id,
    });

    setRounds((currentRounds) =>
      currentRounds.filter((currentRound) => currentRound.id !== round.id),
    );
    setFriends((currentFriends) =>
      currentFriends.map((friend) =>
        friend.id === archivedSummary.friendId
          ? mapArchivedRoundToFriend(friend, archivedSummary)
          : friend,
      ),
    );
    setIsComposingNextRound(false);
  };

  const handleSignOut = async () => {
    setSignOutError(null);

    try {
      await signOut();
      setView(DEFAULT_SIGNED_IN_VIEW);
      setIsMenuOpen(false);
      setIsComposingNextRound(false);
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Unable to sign out.');
    }
  };

  const homeFriendRows = useMemo(
    () =>
      threadSummaries
        .filter((thread) => thread.roundCount > 0)
        .map((thread) => ({
          id: thread.friend.id,
          username: thread.friend.username,
          averageStars: thread.averageStars,
          isYourTurn: isCurrentUserTurn(thread, currentUserId),
        })),
    [currentUserId, threadSummaries],
  );

  const createGameOptions = useMemo(
    () =>
      threadSummaries
        .filter((thread) => thread.roundCount === 0 && thread.canCurrentUserStart)
        .map((thread) => ({
          id: thread.friend.id,
          username: thread.friend.username,
        })),
    [threadSummaries],
  );

  const showFullscreenLoader =
    isAuthLoading || (Boolean(currentUserId) && !hasLoadedInitialData && !loadError);

  if (showFullscreenLoader) {
    return <FullscreenLoadingScreen />;
  }

  return (
    <main className="app-shell">
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
        <LoadingPanel message="Checking your Supabase session..." />
      ) : !currentUserId ? (
        <AuthPanel />
      ) : (
        <>
          {view === 'home' ? (
            <div className="home-topbar">
              <button
                aria-label="Open menu"
                className="drawer-toggle"
                onClick={() => setIsMenuOpen(true)}
                type="button"
              >
                <span />
                <span />
                <span />
              </button>
              <img alt="BackTalk" className="home-topbar-logo" src={homeLogo} />
            </div>
          ) : (
            <section className="surface app-topbar">
              <div className="button-row hero-actions">
                <button
                  aria-label="Open menu"
                  className="drawer-toggle"
                  onClick={() => setIsMenuOpen(true)}
                  type="button"
                >
                  <span />
                  <span />
                  <span />
                </button>
              </div>

              <div>
                <div className="eyebrow">BackTalk</div>
                <h1>{currentPageTitle}</h1>
                <p>{currentPageDescription}</p>
              </div>

              <div className="app-topbar-side">
                <div className="meta-chip topbar-meta">
                  <strong>{profile?.username ? `@${profile.username}` : 'Loading profile...'}</strong>
                  <span>
                    {friends.length} friend{friends.length === 1 ? '' : 's'} connected
                  </span>
                </div>
              </div>
            </section>
          )}

          {isMenuOpen ? (
            <>
              <button
                aria-label="Close menu"
                className="shell-drawer-backdrop"
                onClick={() => setIsMenuOpen(false)}
                type="button"
              />
              <aside className="shell-drawer-panel">
                <div className="section-header compact-header">
                  <div>
                    <div className="eyebrow">Menu</div>
                    <h3>Navigate</h3>
                    <p>{profile?.username ? `@${profile.username}` : 'Signed in'}</p>
                  </div>
                </div>

                <nav className="nav-row" aria-label="Primary">
                  <DrawerButton active={view === 'home'} onClick={handleOpenHome}>
                    Home
                  </DrawerButton>
                  <DrawerButton active={view === 'friends'} onClick={handleOpenFriends}>
                    Friends
                  </DrawerButton>
                  <DrawerButton
                    onClick={() => {
                      void handleSignOut();
                    }}
                  >
                    Sign Out
                  </DrawerButton>
                </nav>
              </aside>
            </>
          ) : null}

          {isLoadingData ? (
            <LoadingPanel message="Loading your friends, threads, and scores..." />
          ) : null}

          <div className="stack">
            {view === 'home' ? (
              <HomePanel
                createGameOptions={createGameOptions}
                friends={homeFriendRows}
                onCreateGame={handleCreateGame}
                onOpenFriend={handleSelectFriend}
                onOpenFriends={handleOpenFriends}
              />
            ) : null}
            {view === 'friends' ? (
              <FriendsPanel friends={friends} onRefresh={refreshAppData} requests={requests} />
            ) : null}
            {view === 'thread' && profile && selectedThread?.displayRound && !isComposingNextRound ? (
              <PlayRoundPanel
                currentUserId={currentUserId}
                onArchiveRound={handleArchiveRound}
                onBack={handleOpenHome}
                onComposeNextRound={() => setIsComposingNextRound(true)}
                onUpdateRound={handleUpdateRound}
                round={selectedThread.displayRound}
              />
            ) : null}
            {view === 'thread' &&
            profile &&
            selectedThread &&
            (isComposingNextRound || (!selectedThread.displayRound && selectedThread.canCurrentUserStart)) ? (
              <CreateRoundPanel
                currentUserId={profile.id}
                currentUserUsername={profile.username}
                friend={selectedThread.friend}
                onBack={handleBackFromCreateRound}
                onCreateRound={handleCreateRound}
              />
            ) : null}
            {view === 'thread' &&
            selectedThread &&
            !selectedThread.displayRound &&
            !isComposingNextRound &&
            !selectedThread.canCurrentUserStart ? (
              <WaitingThreadPanel
                canCurrentUserStart={selectedThread.canCurrentUserStart}
                friend={selectedThread.friend}
                onBack={handleOpenHome}
              />
            ) : null}
          </div>
        </>
      )}
    </main>
  );
}

export default App;
