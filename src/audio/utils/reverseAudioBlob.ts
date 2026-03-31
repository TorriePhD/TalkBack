import { encodeAudioBufferToWav } from './encodeWav';
import { getSharedAudioContext } from './audioContext';

export async function reverseAudioBlob(blob: Blob): Promise<Blob> {
  const audioContext = await getSharedAudioContext();

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
  }
}
