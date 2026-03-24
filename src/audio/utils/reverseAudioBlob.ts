import { encodeAudioBufferToWav } from './encodeWav';

type AudioContextConstructor = typeof AudioContext;

function getAudioContextConstructor(): AudioContextConstructor {
  const Context =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: AudioContextConstructor })
      .webkitAudioContext;

  if (!Context) {
    throw new Error('Web Audio is not available in this browser.');
  }

  return Context;
}

export async function reverseAudioBlob(blob: Blob): Promise<Blob> {
  const AudioContextClass = getAudioContextConstructor();
  const audioContext = new AudioContextClass();

  try {
    const sourceBuffer = await blob.arrayBuffer();
    const decodedBuffer = await audioContext.decodeAudioData(sourceBuffer.slice(0));
    const reversedBuffer = audioContext.createBuffer(
      decodedBuffer.numberOfChannels,
      decodedBuffer.length,
      decodedBuffer.sampleRate,
    );

    for (
      let channelIndex = 0;
      channelIndex < decodedBuffer.numberOfChannels;
      channelIndex += 1
    ) {
      const sourceChannel = decodedBuffer.getChannelData(channelIndex);
      const targetChannel = reversedBuffer.getChannelData(channelIndex);

      for (let sampleIndex = 0; sampleIndex < sourceChannel.length; sampleIndex += 1) {
        targetChannel[sampleIndex] =
          sourceChannel[sourceChannel.length - sampleIndex - 1];
      }
    }

    return new Blob([encodeAudioBufferToWav(reversedBuffer)], {
      type: 'audio/wav',
    });
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Unable to reverse this audio file: ${error.message}`
        : 'Unable to reverse this audio file.',
    );
  } finally {
    try {
      await audioContext.close();
    } catch {
      // Ignore close failures on browsers that already tore the context down.
    }
  }
}
