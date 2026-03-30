import { useObjectUrl } from '../audio/hooks/useObjectUrl';
import { WaveformPlayButton } from './WaveformPlayButton';

interface AudioPlayerCardProps {
  title: string;
  description: string;
  blob?: Blob | null;
  remoteUrl?: string | null;
  onPlay?: () => void;
}

export function AudioPlayerCard({
  title,
  description,
  blob,
  remoteUrl,
  onPlay,
}: AudioPlayerCardProps) {
  const objectUrl = useObjectUrl(blob);
  const src = objectUrl ?? remoteUrl ?? null;

  return (
    <article className="audio-card">
      <div className="audio-card-head">
        <div>
          <h4>{title}</h4>
        </div>
      </div>
      <p>{description}</p>
      {src ? (
        <div className="audio-card-player-wrap">
          <WaveformPlayButton className="audio-card-player" onPlay={onPlay} size={86} src={src} />
        </div>
      ) : (
        <div className="empty-state compact-empty">No audio available yet.</div>
      )}
    </article>
  );
}
