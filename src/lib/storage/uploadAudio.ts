import { supabase, supabaseConfigError } from '../supabase';

const AUDIO_BUCKET = 'audio';
const DEFAULT_PREFIX = 'rounds';
const DELIVERY_MODE: 'public' | 'signed' = 'public';

function sanitizePathSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

function buildAudioPath(prefix?: string) {
  const safePrefix = sanitizePathSegment(prefix || DEFAULT_PREFIX) || DEFAULT_PREFIX;
  const randomPart =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);

  return `${safePrefix}/${Date.now()}-${randomPart}.wav`;
}

async function resolveUploadedAudioUrl(path: string) {
  if (!supabase) {
    throw new Error(supabaseConfigError || 'Supabase is not configured.');
  }

  if (DELIVERY_MODE === 'public') {
    const {
      data: { publicUrl },
    } = supabase.storage.from(AUDIO_BUCKET).getPublicUrl(path);

    if (!publicUrl) {
      throw new Error('The upload succeeded, but no public URL was returned.');
    }

    return publicUrl;
  }

  const { data, error } = await supabase.storage
    .from(AUDIO_BUCKET)
    .createSignedUrl(path, 60 * 60);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Unable to create a signed URL.');
  }

  return data.signedUrl;
}

export async function uploadAudio(blob: Blob, prefix?: string): Promise<string> {
  if (!supabase) {
    throw new Error(supabaseConfigError || 'Supabase is not configured.');
  }

  const path = buildAudioPath(prefix);
  const contentType = blob.type || 'audio/wav';
  const { error } = await supabase.storage.from(AUDIO_BUCKET).upload(path, blob, {
    contentType,
    upsert: false,
    cacheControl: '3600',
  });

  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }

  return resolveUploadedAudioUrl(path);
}
