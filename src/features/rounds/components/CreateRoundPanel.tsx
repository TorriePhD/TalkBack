import { useEffect, useMemo, useState } from 'react';
import { useAudioRecorder } from '../../../audio/hooks/useAudioRecorder';
import { reverseAudioBlob } from '../../../audio/utils/reverseAudioBlob';
import { AudioPlayerCard } from '../../../components/AudioPlayerCard';
import { uploadAudio } from '../../../lib/storage/uploadAudio';
import type { Round } from '../types';

interface CreateRoundPanelProps {
  onCreateRound: (round: Round) => void;
}

function makeRoundId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `round-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function CreateRoundPanel({ onCreateRound }: CreateRoundPanelProps) {
  const recorder = useAudioRecorder();
  const [player1Name, setPlayer1Name] = useState('');
  const [player2Name, setPlayer2Name] = useState('');
  const [correctPhrase, setCorrectPhrase] = useState('');
  const [reversedAudioBlob, setReversedAudioBlob] = useState<Blob | null>(null);
  const [reverseError, setReverseError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [originalAudioUrl, setOriginalAudioUrl] = useState<string | null>(null);
  const [reversedAudioUrl, setReversedAudioUrl] = useState<string | null>(null);
  const [isReversing, setIsReversing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    setReversedAudioBlob(null);
    setReverseError(null);
    setUploadError(null);
    setOriginalAudioUrl(null);
    setReversedAudioUrl(null);
  }, [recorder.audioBlob]);

  const canCreateRound = useMemo(
    () =>
      Boolean(
        player1Name.trim() &&
          player2Name.trim() &&
          correctPhrase.trim() &&
          recorder.audioBlob &&
          reversedAudioBlob,
      ) &&
      !isReversing &&
      !recorder.isRecording &&
      !recorder.isPreparing,
    [
      correctPhrase,
      isReversing,
      player1Name,
      player2Name,
      recorder.audioBlob,
      recorder.isPreparing,
      recorder.isRecording,
      reversedAudioBlob,
    ],
  );

  const handleReverseOriginal = async () => {
    if (!recorder.audioBlob) {
      return;
    }

    setReverseError(null);
    setIsReversing(true);

    try {
      const nextReversedAudio = await reverseAudioBlob(recorder.audioBlob);
      setReversedAudioBlob(nextReversedAudio);
    } catch (error) {
      setReverseError(
        error instanceof Error ? error.message : 'Unable to reverse the original audio.',
      );
    } finally {
      setIsReversing(false);
    }
  };

  const handleUpload = async () => {
    if (!recorder.audioBlob || !reversedAudioBlob) {
      return;
    }

    setUploadError(null);
    setIsUploading(true);

    try {
      const [uploadedOriginalUrl, uploadedReversedUrl] = await Promise.all([
        uploadAudio(recorder.audioBlob, 'original'),
        uploadAudio(reversedAudioBlob, 'reversed'),
      ]);

      setOriginalAudioUrl(uploadedOriginalUrl);
      setReversedAudioUrl(uploadedReversedUrl);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
    }
  };

  const resetForm = () => {
    setPlayer1Name('');
    setPlayer2Name('');
    setCorrectPhrase('');
    setReversedAudioBlob(null);
    setReverseError(null);
    setUploadError(null);
    setOriginalAudioUrl(null);
    setReversedAudioUrl(null);
    recorder.clearRecording();
  };

  const handleCreateRound = () => {
    if (!recorder.audioBlob || !reversedAudioBlob) {
      return;
    }

    onCreateRound({
      id: makeRoundId(),
      createdAt: new Date().toISOString(),
      player1Name: player1Name.trim(),
      player2Name: player2Name.trim(),
      correctPhrase: correctPhrase.trim(),
      originalAudioBlob: recorder.audioBlob,
      reversedAudioBlob,
      originalAudioUrl,
      reversedAudioUrl,
      guess: '',
      attemptAudioBlob: null,
      attemptReversedBlob: null,
      attemptAudioUrl: null,
      attemptReversedUrl: null,
      score: null,
      status: 'waiting_for_attempt',
    });

    resetForm();
  };

  return (
    <section className="surface">
      <div className="section-header">
        <div>
          <h2>Create Round</h2>
          <p>Record the original phrase, reverse it, and stage a new round for Player 2.</p>
        </div>
      </div>

      <div className="panel-grid">
        <div className="stack">
          <div className="field-grid two-up">
            <div className="field">
              <label htmlFor="player1Name">Player 1 name</label>
              <input
                id="player1Name"
                value={player1Name}
                onChange={(event) => setPlayer1Name(event.target.value)}
                placeholder="Who records the phrase?"
              />
            </div>
            <div className="field">
              <label htmlFor="player2Name">Player 2 name</label>
              <input
                id="player2Name"
                value={player2Name}
                onChange={(event) => setPlayer2Name(event.target.value)}
                placeholder="Who will imitate it?"
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="correctPhrase">Correct phrase</label>
            <textarea
              id="correctPhrase"
              value={correctPhrase}
              onChange={(event) => setCorrectPhrase(event.target.value)}
              placeholder="Type the phrase Player 1 is actually saying."
            />
            <div className="helper-text">
              Scoring is exact-match only in this phase, after trimming and case-folding.
            </div>
          </div>

          <div className="surface">
            <div className="section-header">
              <div>
                <h3>Original Recording</h3>
                <p>Capture a short phrase. WebM/Opus is preferred when the browser supports it.</p>
              </div>
            </div>

            <div className="button-row">
              <button
                className="button primary"
                disabled={recorder.isRecording || recorder.isPreparing}
                onClick={() => {
                  void recorder.startRecording();
                }}
                type="button"
              >
                {recorder.isPreparing ? 'Requesting mic…' : 'Start recording'}
              </button>
              <button
                className="button warning"
                disabled={!recorder.isRecording}
                onClick={recorder.stopRecording}
                type="button"
              >
                Stop recording
              </button>
              <button
                className="button ghost"
                disabled={!recorder.audioBlob && !reversedAudioBlob}
                onClick={resetForm}
                type="button"
              >
                Clear round draft
              </button>
            </div>

            <div className="helper-text">
              {recorder.isRecording
                ? 'Recording in progress.'
                : recorder.mimeType
                  ? `Recorder format: ${recorder.mimeType}`
                  : 'Ready to record.'}
            </div>
          </div>

          {recorder.error ? <div className="error-banner">{recorder.error}</div> : null}
          {reverseError ? <div className="error-banner">{reverseError}</div> : null}
          {uploadError ? <div className="error-banner">{uploadError}</div> : null}
          {originalAudioUrl || reversedAudioUrl ? (
            <div className="success-banner">Supabase Storage upload complete for the current draft.</div>
          ) : null}
        </div>

        <div className="stack">
          <div className="audio-grid">
            <AudioPlayerCard
              title="Original Phrase"
              description="This is the clean Player 1 recording."
              blob={recorder.audioBlob}
              remoteUrl={originalAudioUrl}
            />
            <AudioPlayerCard
              title="Reversed Phrase"
              description="This is the version Player 2 should imitate."
              blob={reversedAudioBlob}
              remoteUrl={reversedAudioUrl}
            />
          </div>

          <div className="button-row">
            <button
              className="button secondary"
              disabled={!recorder.audioBlob || isReversing || recorder.isRecording}
              onClick={() => {
                void handleReverseOriginal();
              }}
              type="button"
            >
              {isReversing ? 'Reversing…' : 'Reverse original audio'}
            </button>
            <button
              className="button secondary"
              disabled={!recorder.audioBlob || !reversedAudioBlob || isUploading}
              onClick={() => {
                void handleUpload();
              }}
              type="button"
            >
              {isUploading ? 'Uploading…' : 'Upload original + reversed'}
            </button>
            <button
              className="button primary"
              disabled={!canCreateRound}
              onClick={handleCreateRound}
              type="button"
            >
              Create local round
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
