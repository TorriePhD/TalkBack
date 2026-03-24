import { useEffect, useMemo, useRef, useState } from 'react';
import { useAudioRecorder } from '../../../audio/hooks/useAudioRecorder';
import { reverseAudioBlob } from '../../../audio/utils/reverseAudioBlob';
import { AudioPlayerCard } from '../../../components/AudioPlayerCard';
import { StatusBadge } from '../../../components/StatusBadge';
import { uploadAudio } from '../../../lib/storage/uploadAudio';
import type { Round } from '../types';
import { scoreGuess } from '../utils';

interface PlayRoundPanelProps {
  round: Round | null;
  onUpdateRound: (roundId: string, updater: (round: Round) => Round) => void;
}

export function PlayRoundPanel({ round, onUpdateRound }: PlayRoundPanelProps) {
  const recorder = useAudioRecorder();
  const [guess, setGuess] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isReversingAttempt, setIsReversingAttempt] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const lastAutoReversedAttemptBlobRef = useRef<Blob | null>(null);

  useEffect(() => {
    setGuess(round?.guess ?? '');
    setError(null);
    setInfo(null);
    recorder.clearRecording();
    lastAutoReversedAttemptBlobRef.current = null;
  }, [round?.id, recorder.clearRecording]);

  const hasAttempt = Boolean(round?.attemptAudioBlob && round.attemptReversedBlob);
  const canSubmitGuess = useMemo(
    () =>
      Boolean(round && hasAttempt && guess.trim()) &&
      round?.status !== 'complete' &&
      !isUploading &&
      !isReversingAttempt,
    [guess, hasAttempt, isReversingAttempt, isUploading, round],
  );

  if (!round) {
    return (
      <section className="surface">
        <div className="empty-state">
          Select a round from the inbox to hear the reversed phrase and record an attempt.
        </div>
      </section>
    );
  }

  useEffect(() => {
    if (!round || !recorder.audioBlob || recorder.isRecording || round.status === 'complete') {
      return;
    }

    const attemptBlob = recorder.audioBlob;

    if (lastAutoReversedAttemptBlobRef.current === attemptBlob) {
      return;
    }

    let cancelled = false;

    const autoReverseAttempt = async () => {
      setIsReversingAttempt(true);
      setError(null);
      setInfo(null);

      try {
        const reversedAttemptBlob = await reverseAudioBlob(attemptBlob);
        if (cancelled) {
          return;
        }

        onUpdateRound(round.id, (currentRound) => ({
          ...currentRound,
          attemptAudioBlob: attemptBlob,
          attemptReversedBlob: reversedAttemptBlob,
          attemptAudioUrl: null,
          attemptReversedUrl: null,
          score: currentRound.status === 'complete' ? currentRound.score : null,
          status: 'attempted',
        }));
        lastAutoReversedAttemptBlobRef.current = attemptBlob;
        setInfo('Attempt recorded and reversed automatically. Player 2 can now submit a guess.');
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to reverse the attempt recording.',
          );
        }
      } finally {
        if (!cancelled) {
          setIsReversingAttempt(false);
        }
      }
    };

    void autoReverseAttempt();

    return () => {
      cancelled = true;
    };
  }, [onUpdateRound, recorder.audioBlob, recorder.isRecording, round]);

  const handleUpload = async () => {
    if (!round.attemptAudioBlob || !round.attemptReversedBlob) {
      return;
    }

    setError(null);
    setInfo(null);
    setIsUploading(true);

    try {
      const [attemptAudioUrl, attemptReversedUrl] = await Promise.all([
        uploadAudio(round.attemptAudioBlob, 'attempt'),
        uploadAudio(round.attemptReversedBlob, 'attempt-reversed'),
      ]);

      onUpdateRound(round.id, (currentRound) => ({
        ...currentRound,
        attemptAudioUrl,
        attemptReversedUrl,
      }));
      setInfo('Attempt audio uploaded to Supabase Storage.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmitGuess = () => {
    const nextGuess = guess.trim();
    if (!nextGuess) {
      return;
    }

    const score = scoreGuess(nextGuess, round.correctPhrase);
    onUpdateRound(round.id, (currentRound) => ({
      ...currentRound,
      guess: nextGuess,
      score,
      status: 'complete',
    }));
    setInfo(score === 10 ? 'Exact match. Full score.' : 'Round complete. No exact match.');
  };

  return (
    <section className="surface">
      <div className="section-header">
        <div>
          <h2>Play Round</h2>
          <p>
            {round.player2Name} listens to the reversed prompt, imitates it, and guesses the
            original phrase.
          </p>
        </div>
        <StatusBadge status={round.status} />
      </div>

      <div className="panel-grid">
        <div className="stack">
          <div className="info-banner">
            <strong>{round.player1Name}</strong> recorded the original phrase for{' '}
            <strong>{round.player2Name}</strong>.
          </div>

          <div className="audio-grid">
            <AudioPlayerCard
              title="Reversed Prompt"
              description="Player 2 should imitate this strange-sounding version."
              blob={round.reversedAudioBlob}
              remoteUrl={round.reversedAudioUrl}
            />
            <AudioPlayerCard
              title="Original Phrase"
              description="Reveal and compare after the guess."
              blob={round.originalAudioBlob}
              remoteUrl={round.originalAudioUrl}
            />
            <AudioPlayerCard
              title="Latest Attempt"
              description="Player 2's raw imitation recording."
              blob={recorder.audioBlob ?? round.attemptAudioBlob}
              remoteUrl={round.attemptAudioUrl}
            />
            <AudioPlayerCard
              title="Reversed Attempt"
              description="This should sound close to the original if the imitation was good."
              blob={round.attemptReversedBlob}
              remoteUrl={round.attemptReversedUrl}
            />
          </div>
        </div>

        <div className="stack">
          <div className="surface">
            <div className="section-header">
              <div>
                <h3>Record Attempt</h3>
                <p>Capture a new imitation. It will be reversed automatically for playback.</p>
              </div>
            </div>

            <div className="button-row">
              <button
                className="button primary"
                disabled={recorder.isRecording || recorder.isPreparing || round.status === 'complete'}
                onClick={() => {
                  void recorder.startRecording();
                }}
                type="button"
              >
                {recorder.isPreparing ? 'Requesting mic…' : 'Start attempt'}
              </button>
              <button
                className="button warning"
                disabled={!recorder.isRecording}
                onClick={recorder.stopRecording}
                type="button"
              >
                Stop attempt
              </button>
            </div>

            <div className="helper-text">
              {recorder.isRecording
                ? 'Attempt recording in progress.'
                : isReversingAttempt
                  ? 'Auto-reversing your latest attempt…'
                  : recorder.audioBlob
                    ? 'A fresh attempt is ready.'
                  : 'Listen to the reversed prompt, then record a reply.'}
            </div>
          </div>

          <div className="surface">
            <div className="section-header">
              <div>
                <h3>Guess + Score</h3>
                <p>Score is based on Wasserstein edit distance, normalized to 10 points.</p>
              </div>
            </div>

            <div className="field">
              <label htmlFor="guess">Player 2 guess</label>
              <input
                id="guess"
                value={guess}
                onChange={(event) => setGuess(event.target.value)}
                disabled={round.status === 'complete'}
                placeholder="What did Player 1 actually say?"
              />
            </div>

            <div className="button-row">
              <button
                className="button secondary"
                disabled={!hasAttempt || isUploading}
                onClick={() => {
                  void handleUpload();
                }}
                type="button"
              >
                {isUploading ? 'Uploading…' : 'Upload attempt + reversed'}
              </button>
              <button
                className="button primary"
                disabled={!canSubmitGuess}
                onClick={handleSubmitGuess}
                type="button"
              >
                Submit guess
              </button>
            </div>
          </div>

          {recorder.error ? <div className="error-banner">{recorder.error}</div> : null}
          {error ? <div className="error-banner">{error}</div> : null}
          {info ? <div className="success-banner">{info}</div> : null}

          {round.status === 'complete' ? (
            <div className="result-box">
              <p className="score-mark">{round.score ?? 0}/10</p>
              <p>
                <strong>Correct phrase:</strong> {round.correctPhrase}
              </p>
              <p>
                <strong>Guess:</strong> {round.guess || 'No guess submitted'}
              </p>
              <div className="pill-row">
                <StatusBadge status={round.status} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
