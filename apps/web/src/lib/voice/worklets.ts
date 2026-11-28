/**
 * T-210: the two small audio worklets of a test call, as source text.
 *
 * A worklet runs on the audio thread and is loaded from its own script. These two are short and
 * are loaded from a Blob made of this text, so the test adds no public file to the site.
 *
 * - `voice-capture` takes the microphone at the device's own rate, brings it to 16 kHz (straight
 *   lines between samples, carried across blocks), and posts 16-bit PCM in pieces of 40 ms with
 *   each piece's loudness (which the page uses to tell when the caller stopped speaking).
 * - `voice-playback` takes her 24 kHz 16-bit PCM as it arrives, brings it to the device's rate
 *   and plays it in order. `{ flush: true }` drops what is waiting (she was interrupted).
 *
 * Plain JavaScript on purpose: it is not compiled, so it must not use anything the build adds.
 */
export const VOICE_WORKLETS = `
class VoiceCapture extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const o = options.processorOptions
    this.step = sampleRate / o.outRate
    this.pos = 0
    this.last = 0
    this.chunk = new Int16Array(o.chunkSamples)
    this.fill = 0
    this.sumSq = 0
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0]
    if (!input || input.length === 0) return true
    const n = input.length
    let pos = this.pos
    while (pos < n - 1) {
      const i = Math.floor(pos)
      const a = i < 0 ? this.last : input[i]
      const s = Math.max(-1, Math.min(1, a + (input[i + 1] - a) * (pos - i)))
      this.chunk[this.fill++] = s < 0 ? s * 0x8000 : s * 0x7fff
      this.sumSq += s * s
      if (this.fill === this.chunk.length) {
        const pcm = this.chunk.slice().buffer
        this.port.postMessage({ pcm, rms: Math.sqrt(this.sumSq / this.fill) }, [pcm])
        this.fill = 0
        this.sumSq = 0
      }
      pos += this.step
    }
    this.last = input[n - 1]
    this.pos = pos - n
    return true
  }
}
registerProcessor('voice-capture', VoiceCapture)

class VoicePlayback extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.step = options.processorOptions.inRate / sampleRate
    this.queue = []
    this.head = null
    this.offset = 0
    this.playing = false
    this.port.onmessage = (e) => {
      if (e.data.flush) {
        this.queue = []
        this.head = null
        this.offset = 0
      } else if (e.data.pcm) this.queue.push(new Int16Array(e.data.pcm))
    }
  }
  process(inputs, outputs) {
    const out = outputs[0][0]
    let wrote = false
    for (let k = 0; k < out.length; k++) {
      while (this.head === null || this.offset >= this.head.length) {
        if (this.head !== null) this.offset -= this.head.length
        this.head = this.queue.length > 0 ? this.queue.shift() : null
        if (this.head === null) break
      }
      if (this.head === null) {
        this.offset = 0
        out[k] = 0
        continue
      }
      const i = Math.floor(this.offset)
      const a = this.head[i]
      const b = i + 1 < this.head.length ? this.head[i + 1] : this.queue.length > 0 ? this.queue[0][0] : a
      out[k] = (a + (b - a) * (this.offset - i)) / 32768
      this.offset += this.step
      wrote = true
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out)
    if (wrote !== this.playing) {
      this.playing = wrote
      this.port.postMessage({ playing: wrote })
    }
    return true
  }
}
registerProcessor('voice-playback', VoicePlayback)
`
