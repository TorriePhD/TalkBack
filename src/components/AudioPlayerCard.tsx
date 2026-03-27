import { useEffect, useRef } from 'react';
import { useObjectUrl } from '../audio/hooks/useObjectUrl';

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
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement) {
      return;
    }

    audioElement.pause();

    if (src) {
      audioElement.src = src;
    } else {
      audioElement.removeAttribute('src');
    }

    audioElement.load();
  }, [src]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
        audioRef.current.load();
      }
    };
  }, []);

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
        <audio key={src} ref={audioRef} controls preload="metadata" />
      ) : (
        <div className="empty-state compact-empty">No audio available yet.</div>
      )}
    </article>
  );
}
