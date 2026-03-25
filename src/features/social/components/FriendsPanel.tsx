import { useMemo, useState } from 'react';
import type { FriendRequest } from '../types';
import type { Friend } from '../types';
import { respondToFriendRequest, sendFriendRequestByEmail } from '../../../lib/friends';

interface FriendsPanelProps {
  friends: Friend[];
  requests: FriendRequest[];
  onRefresh: () => Promise<void>;
}

export function FriendsPanel({ friends, requests, onRefresh }: FriendsPanelProps) {
  const [friendEmail, setFriendEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);

  const incomingRequests = useMemo(
    () => requests.filter((request) => request.direction === 'incoming'),
    [requests],
  );
  const outgoingRequests = useMemo(
    () => requests.filter((request) => request.direction === 'outgoing'),
    [requests],
  );

  const handleSendRequest = async () => {
    setError(null);
    setInfo(null);
    setIsSending(true);

    try {
      await sendFriendRequestByEmail(friendEmail);
      setFriendEmail('');
      setInfo('Friend request sent.');
      await onRefresh();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to send the friend request.',
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleRespondToRequest = async (requestId: string, accept: boolean) => {
    setError(null);
    setInfo(null);
    setActiveRequestId(requestId);

    try {
      await respondToFriendRequest(requestId, accept);
      setInfo(accept ? 'Friend request accepted.' : 'Friend request rejected.');
      await onRefresh();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Unable to update the friend request.',
      );
    } finally {
      setActiveRequestId(null);
    }
  };

  return (
    <section className="surface">
      <div className="eyebrow">Crew</div>
      <div className="section-header">
        <div>
          <h2>Invite your people</h2>
          <p>Friends unlock round sending. Add someone by email, then wait for the link-up.</p>
        </div>
      </div>

      <div className="stack">
        <div className="surface nested-surface">
          <div className="section-header">
            <div>
              <h3>Add a friend</h3>
              <p>Both people need an account before a request can go out.</p>
            </div>
          </div>

          <div className="field-row">
            <div className="field flex-field">
              <label htmlFor="friendEmail">Friend email</label>
              <input
                id="friendEmail"
                onChange={(event) => setFriendEmail(event.target.value)}
                placeholder="friend@example.com"
                type="email"
                value={friendEmail}
              />
            </div>
            <button
              className="button primary"
              disabled={!friendEmail.trim() || isSending}
              onClick={() => {
                void handleSendRequest();
              }}
              type="button"
            >
              {isSending ? 'Sending...' : 'Send invite'}
            </button>
          </div>
        </div>

        <div className="split-panel">
          <div className="surface nested-surface">
            <div className="section-header compact-header">
              <div>
                <h3>Incoming</h3>
                <p>Tap accept to unlock round sending.</p>
              </div>
            </div>

            {incomingRequests.length === 0 ? (
              <div className="empty-state compact-empty">No incoming invites right now.</div>
            ) : (
              <div className="stack mini-stack">
                {incomingRequests.map((request) => (
                  <div className="list-card" key={request.id}>
                    <div>
                      <strong>{request.otherUserEmail}</strong>
                      <p className="helper-text">
                        Sent {new Date(request.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="button-row">
                      <button
                        className="button primary"
                        disabled={activeRequestId === request.id}
                        onClick={() => {
                          void handleRespondToRequest(request.id, true);
                        }}
                        type="button"
                      >
                        Accept
                      </button>
                      <button
                        className="button ghost"
                        disabled={activeRequestId === request.id}
                        onClick={() => {
                          void handleRespondToRequest(request.id, false);
                        }}
                        type="button"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="surface nested-surface">
            <div className="section-header compact-header">
              <div>
                <h3>Outgoing</h3>
                <p>These invites are still waiting on the other person.</p>
              </div>
            </div>

            {outgoingRequests.length === 0 ? (
              <div className="empty-state compact-empty">No outgoing invites yet.</div>
            ) : (
              <div className="stack mini-stack">
                {outgoingRequests.map((request) => (
                  <div className="list-card" key={request.id}>
                    <div>
                      <strong>{request.otherUserEmail}</strong>
                      <p className="helper-text">
                        Sent {new Date(request.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span className="badge waiting_for_attempt">Pending</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="surface nested-surface">
          <div className="section-header compact-header">
            <div>
              <h3>Friend List</h3>
              <p>Only confirmed friends appear here and can receive rounds.</p>
            </div>
          </div>

          {friends.length === 0 ? (
            <div className="empty-state compact-empty">
              No friends yet. Send an invite and wait for the accept.
            </div>
          ) : (
            <div className="stack mini-stack">
              {friends.map((friend) => (
                <div className="list-card" key={friend.id}>
                  <div>
                    <strong>{friend.email}</strong>
                    <p className="helper-text">
                      Friends since {new Date(friend.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="badge complete">Locked in</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {error ? <div className="error-banner">{error}</div> : null}
        {info ? <div className="success-banner">{info}</div> : null}
      </div>
    </section>
  );
}
