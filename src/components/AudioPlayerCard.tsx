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
      <h4>{title}</h4>
      <p>{description}</p>
      {src ? (
        <audio ref={audioRef} controls preload="metadata" src={src} />
      ) : (
        <div className="helper-text">No audio available yet.</div>
      )}
      {remoteUrl ? (
        <div className="fine-print">Uploaded copy available from Supabase Storage.</div>
      ) : null}
    </article>
  );
}
