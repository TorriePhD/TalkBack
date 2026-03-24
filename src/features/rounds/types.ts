export type RoundStatus =
  | 'created'
  | 'waiting_for_attempt'
  | 'attempted'
  | 'complete';

export interface Round {
  id: string;
  createdAt: string;
  player1Name: string;
  player2Name: string;
  correctPhrase: string;
  originalAudioBlob: Blob | null;
  reversedAudioBlob: Blob | null;
  originalAudioUrl: string | null;
  reversedAudioUrl: string | null;
  guess: string;
  attemptAudioBlob: Blob | null;
  attemptReversedBlob: Blob | null;
  attemptAudioUrl: string | null;
  attemptReversedUrl: string | null;
  score: number | null;
  status: RoundStatus;
}
