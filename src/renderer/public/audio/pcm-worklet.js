// Forwards raw mono Float32 PCM frames (one render quantum, 128 samples)
// from the mic input to the main thread. No processing here — resampling,
// batching, and format conversion happen in mic.ts, since AudioWorkletGlobalScope
// has no access to the DOM/IPC bridge.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (input && input[0]) {
      // Copy — the engine reuses/clears the underlying buffer next quantum.
      this.port.postMessage(input[0].slice())
    }
    return true
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor)
