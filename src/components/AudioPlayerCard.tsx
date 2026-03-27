import { useObjectUrl } from '../audio/hooks/useObjectUrl';
import { WaveformPlayButton } from './WaveformPlayButton';

interface AudioPlayerCardProps {
  title: string;
  description: string;
  blob?: Blob | null;
  remoteUrl?: string | null;
}

export function AudioPlayerCard({
  title,
  description,
  blob,
  remoteUrl,
}: AudioPlayerCardProps) {
  const objectUrl = useObjectUrl(blob);
  const src = objectUrl ?? remoteUrl ?? null;

  return (
    <article className="audio-card">
      <div className="audio-card-head">
        <div>
          <div className="card-kicker">Audio clip</div>
          <h4>{title}</h4>
        </div>
        <span className={`badge ${src ? 'complete' : 'waiting_for_attempt'}`}>
          {src ? 'Ready' : 'Locked'}
        </span>
      </div>
      <p>{description}</p>
      {src ? (
        <div className="audio-card-player-wrap">
          <WaveformPlayButton className="audio-card-player" size={86} src={src} />
        </div>
      ) : (
        <div className="empty-state compact-empty">No audio available yet.</div>
      )}
    </article>
  );
}
