import { supabase, supabaseConfigError } from '../supabase';

const AUDIO_BUCKET = 'audio';
const DEFAULT_PREFIX = 'rounds';

interface UploadAudioOptions {
  roundId?: string;
  label?: string;
}

export interface UploadedAudioAsset {
  path: string;
  url: string;
}

function sanitizePathSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

function buildAudioPath({ roundId, label }: UploadAudioOptions = {}) {
  const safePrefix = sanitizePathSegment(DEFAULT_PREFIX) || DEFAULT_PREFIX;
  const safeRoundId = sanitizePathSegment(roundId || 'draft') || 'draft';
  const safeLabel = sanitizePathSegment(label || 'audio') || 'audio';
  const randomPart =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);

  return `${safePrefix}/${safeRoundId}/${safeLabel}-${Date.now()}-${randomPart}.wav`;
}

export function resolveAudioUrl(path: string | null | undefined) {
  if (!path || !supabase) {
    return null;
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(AUDIO_BUCKET).getPublicUrl(path);

  return publicUrl || null;
}

export async function uploadAudio(
  blob: Blob,
  options?: UploadAudioOptions,
): Promise<UploadedAudioAsset> {
  if (!supabase) {
    throw new Error(supabaseConfigError || 'Supabase is not configured.');
  }

  const path = buildAudioPath(options);
  const contentType = blob.type || 'audio/wav';
  const { error } = await supabase.storage.from(AUDIO_BUCKET).upload(path, blob, {
    contentType,
    upsert: false,
    cacheControl: '3600',
  });

  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }

  const url = resolveAudioUrl(path);

  if (!url) {
    throw new Error('The upload succeeded, but no public URL was returned.');
  }

  return { path, url };
}
