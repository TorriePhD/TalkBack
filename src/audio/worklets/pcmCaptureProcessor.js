class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.isRecording = false;
    this.port.onmessage = (event) => {
      if (event.data?.type === 'start') {
        this.isRecording = true;
      } else if (event.data?.type === 'stop') {
        this.isRecording = false;
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }

  process(inputs) {
    if (!this.isRecording) {
      return true;
    }

    const input = inputs[0];
    if (!input?.length) {
      return true;
    }

    const channelData = input[0];
    if (!channelData?.length) {
      return true;
    }

    const samples = new Float32Array(channelData);
    this.port.postMessage(
      {
        type: 'data',
        samples,
      },
      [samples.buffer],
    );

    return true;
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
