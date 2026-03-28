export const AUDIO_ENERGY_EVENT = 'backtalk:audio-energy';

export type AudioEnergyMode = 'playback' | 'record';

export interface AudioEnergyDetail {
  energy: number;
  mode: AudioEnergyMode;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function emitAudioEnergy(energy: number, mode: AudioEnergyMode) {
  if (typeof window === 'undefined') {
    return;
  }

  const detail: AudioEnergyDetail = {
    energy: clamp(energy, 0, 1),
    mode,
  };

  window.dispatchEvent(new CustomEvent<AudioEnergyDetail>(AUDIO_ENERGY_EVENT, { detail }));
}
