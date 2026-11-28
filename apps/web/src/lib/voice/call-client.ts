/**
 * T-210: one test call, in the browser.
 *
 * The page's microphone goes straight to the Live API and her voice comes straight back: no
 * server of ours carries the audio (that is what this test measures). The server's part is the
 * call's token (which locks the model, her instructions, her voice and her tools) and her tools.
 *
 * What is timed: the delay of each of her turns, from the caller's last sound to the arrival of
 * her first piece of audio. "The caller's last sound" is heard here, from the loudness of the
 * microphone pieces, because that is the moment a caller starts waiting; the Live API's own
 * end-of-speech wait is inside the delay.
 *
 * Browser only. Nothing is stored: the results are in memory until the page is left.
 */
import type { LiveModelPrice } from '@qolumns/shared'
import { CALL_LIMIT_SECONDS, INPUT_MIME, INPUT_SAMPLE_RATE, OUTPUT_SAMPLE_RATE, WRAP_UP_NOTE, WRAP_UP_SECONDS, liveSocketUrl } from './config'
import { NO_TOKENS, addUsage, type LiveUsage } from './cost'
import type { CallResults, ToolRecord } from './results'
import type { EngineFigures } from './spoken'
import { VOICE_WORKLETS } from './worklets'

/** What the session route answers */
export interface CallStart {
  token: string
  session: string
  model: string
  voice: string
  prices: LiveModelPrice | null
  limits: { callSeconds: number; wrapUpSeconds: number }
  business: { id: string; name: string; currency: string; locale: string; timeZone: string; services: Array<{ id: string; name: string }> }
  instruction: string
}

/** Microphone pieces of 40 ms */
const CHUNK_SAMPLES = (INPUT_SAMPLE_RATE * 40) / 1000
/** A piece is the caller's voice when it is this loud, or three times the room's own noise, whichever is more */
const VOICE_FLOOR = 0.012
/** …and that many loud pieces in a row are speech, not a click */
const VOICE_RUN = 3

interface ServerMessage {
  setupComplete?: unknown
  serverContent?: {
    modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> }
    inputTranscription?: { text?: string }
    outputTranscription?: { text?: string }
    turnComplete?: boolean
    interrupted?: boolean
  }
  toolCall?: { functionCalls?: Array<{ id?: string; name?: string; args?: unknown }> }
  toolCallCancellation?: { ids?: string[] }
  usageMetadata?: LiveUsage
  goAway?: { timeLeft?: string }
}

const toBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

const fromBase64 = (data: string): ArrayBuffer => {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length + (binary.length % 2))
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export class VoiceCall {
  readonly results: CallResults
  private socket: WebSocket | null = null
  private audio: AudioContext | null = null
  private mic: MediaStream | null = null
  private playback: AudioWorkletNode | null = null
  private startedAt = 0
  private timers: Array<ReturnType<typeof setTimeout>> = []
  private ticker: ReturnType<typeof setInterval> | null = null
  private ready = false
  private over = false

  // the caller's voice, as heard here
  private noise = 0.004
  private loudRun = 0
  private lastVoiceAt: number | null = null
  private voiceNow = false
  // her turns
  private turnOpen = false
  private lastTurnAt = 0
  private waitedFor: string[] = []
  /** The next words start a new line of the transcript, even from the same speaker (a turn ended, or a tool answered) */
  private newLine = false
  private cancelled = new Set<string>()

  constructor(
    private readonly start: CallStart,
    private readonly onChange: () => void,
    browser: string
  ) {
    this.results = { business: start.business.name, model: start.model, voice: start.voice, browser, seconds: 0, status: 'starting', endedBecause: null, transcript: [], turns: [], tools: [], tokens: NO_TOKENS, problems: [] }
  }

  /** Seconds into the call */
  private now(): number {
    return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0
  }

  private problem(text: string) {
    this.results.problems.push(`${Math.floor(this.now())}s: ${text}`)
    this.onChange()
  }

  /** Open the microphone and the call. Must be called from the press that starts it (a browser asks for that). */
  async open(): Promise<void> {
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      const audio = new AudioContext({ latencyHint: 'interactive' })
      this.audio = audio
      await audio.resume()
      const source = URL.createObjectURL(new Blob([VOICE_WORKLETS], { type: 'application/javascript' }))
      try {
        await audio.audioWorklet.addModule(source)
      } finally {
        URL.revokeObjectURL(source)
      }
      const capture = new AudioWorkletNode(audio, 'voice-capture', { numberOfInputs: 1, numberOfOutputs: 0, processorOptions: { outRate: INPUT_SAMPLE_RATE, chunkSamples: CHUNK_SAMPLES } })
      capture.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => this.heard(e.data.pcm, e.data.rms)
      audio.createMediaStreamSource(this.mic).connect(capture)
      this.playback = new AudioWorkletNode(audio, 'voice-playback', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { inRate: OUTPUT_SAMPLE_RATE } })
      this.playback.connect(audio.destination)
    } catch (error) {
      this.finish(error instanceof DOMException && error.name === 'NotAllowedError' ? 'the microphone was not allowed' : `the audio could not start (${error instanceof Error ? error.name : 'unknown'})`)
      return
    }

    const socket = new WebSocket(liveSocketUrl(this.start.token))
    socket.binaryType = 'arraybuffer'
    this.socket = socket
    // The token carries the whole setup; what is sent here is ignored by the Live API. It still needs a first message.
    socket.onopen = () => socket.send(JSON.stringify({ setup: { model: `models/${this.start.model}` } }))
    socket.onmessage = (e: MessageEvent<ArrayBuffer | string>) => {
      try {
        this.receive(JSON.parse(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data)) as ServerMessage)
      } catch {
        this.problem('a message from the Live API could not be read')
      }
    }
    socket.onerror = () => this.problem('the connection reported an error')
    socket.onclose = (e) => this.finish(this.over ? null : `the Live API closed the call (${e.code}${e.reason ? `: ${e.reason}` : ''})`)
  }

  private send(message: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  /** A piece of the microphone: sent up, and listened to for the caller's voice */
  private heard(pcm: ArrayBuffer, rms: number) {
    if (!this.ready || this.over) return
    this.send({ realtimeInput: { audio: { data: toBase64(pcm), mimeType: INPUT_MIME } } })
    const loud = rms > Math.max(VOICE_FLOOR, this.noise * 3)
    if (loud) {
      this.loudRun += 1
      if (this.loudRun >= VOICE_RUN) {
        this.voiceNow = true
        this.lastVoiceAt = performance.now()
      }
    } else {
      this.loudRun = 0
      this.voiceNow = false
      // the room's own noise, followed slowly
      this.noise = this.noise * 0.95 + rms * 0.05
    }
  }

  private receive(m: ServerMessage) {
    if (m.setupComplete !== undefined && !this.ready) {
      this.ready = true
      this.startedAt = performance.now()
      this.results.status = 'live'
      this.ticker = setInterval(() => {
        this.results.seconds = this.now()
        this.onChange()
      }, 500)
      // She opens the call: the Live API waits to be spoken to, so it is told the call has connected
      this.send({ realtimeInput: { text: 'The call has connected.' } })
      this.timers.push(setTimeout(() => this.send({ realtimeInput: { text: WRAP_UP_NOTE } }), WRAP_UP_SECONDS * 1000))
      this.timers.push(setTimeout(() => this.end(`the ${CALL_LIMIT_SECONDS / 60}-minute limit`), CALL_LIMIT_SECONDS * 1000))
    }

    const content = m.serverContent
    if (content) {
      for (const part of content.modelTurn?.parts ?? []) {
        const data = part.inlineData?.data
        if (!data) continue
        if (!this.turnOpen) this.turnBegan()
        const pcm = fromBase64(data)
        this.playback?.port.postMessage({ pcm }, [pcm])
      }
      if (content.inputTranscription?.text) this.said('caller', content.inputTranscription.text)
      if (content.outputTranscription?.text) this.said('her', content.outputTranscription.text)
      if (content.interrupted) {
        this.playback?.port.postMessage({ flush: true })
        this.turnOpen = false
        this.newLine = true
      }
      if (content.turnComplete) {
        this.turnOpen = false
        this.newLine = true
      }
    }

    if (m.toolCall?.functionCalls) for (const call of m.toolCall.functionCalls) void this.tool(call)
    for (const id of m.toolCallCancellation?.ids ?? []) this.cancelled.add(id)
    if (m.usageMetadata) this.results.tokens = addUsage(this.results.tokens, m.usageMetadata)
    if (m.goAway) this.problem(`the Live API said the connection will close soon (${m.goAway.timeLeft ?? 'no time given'})`)
    this.onChange()
  }

  /** Her first piece of audio of a turn has arrived */
  private turnBegan() {
    const at = performance.now()
    this.turnOpen = true
    // Only the caller's sound since her last turn began counts: before that, she has already answered it
    const spoke = this.lastVoiceAt !== null && this.lastVoiceAt > this.lastTurnAt ? this.lastVoiceAt : null
    this.results.turns.push({ n: this.results.turns.length + 1, at: this.now(), ms: spoke === null ? null : Math.max(0, at - spoke), tools: this.waitedFor, overlapped: this.voiceNow })
    this.waitedFor = []
    this.lastTurnAt = at
  }

  private said(who: 'caller' | 'her', text: string) {
    const last = this.results.transcript[this.results.transcript.length - 1]
    // What she says after an estimate must be its own line: the price check reads her words by when they began
    if (last && last.who === who && !(who === 'her' && this.newLine)) last.text += text
    else this.results.transcript.push({ who, at: this.now(), text })
    if (who === 'her') this.newLine = false
  }

  /** One of her tool calls: passed to our server with the call's session, and the answer passed back */
  private async tool(call: { id?: string; name?: string; args?: unknown }) {
    const name = String(call.name ?? '')
    const at = this.now()
    const began = performance.now()
    let record: ToolRecord
    try {
      const response = await fetch('/api/admin/voice-test/tool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: this.start.session, name, args: call.args ?? {} }) })
      const json = (await response.json().catch(() => null)) as { ok?: boolean; response?: unknown; wouldDo?: string; engine?: EngineFigures; error?: { message?: string } } | null
      record = json && typeof json.ok === 'boolean'
        ? { at, name, args: call.args ?? {}, ok: json.ok, response: json.response, ms: Math.round(performance.now() - began), wouldDo: json.wouldDo, engine: json.engine }
        : { at, name, args: call.args ?? {}, ok: false, response: { error: json?.error?.message ?? `The tool route answered ${response.status}.` }, ms: Math.round(performance.now() - began) }
    } catch {
      record = { at, name, args: call.args ?? {}, ok: false, response: { error: 'The tool could not be reached.' }, ms: Math.round(performance.now() - began) }
    }
    this.results.tools.push(record)
    this.waitedFor.push(name)
    this.newLine = true
    if (call.id && this.cancelled.has(call.id)) this.problem(`${name} was cancelled by the Live API before its answer was sent`)
    else this.send({ toolResponse: { functionResponses: [{ id: call.id, name, response: record.response }] } })
    this.onChange()
  }

  /** End the call from the page */
  end(because = 'ended on the page') {
    this.finish(because)
  }

  private finish(because: string | null) {
    if (this.results.status === 'ended') return
    this.over = true
    if (this.startedAt) this.results.seconds = this.now()
    this.results.status = 'ended'
    this.results.endedBecause = because ?? this.results.endedBecause ?? 'ended'
    for (const timer of this.timers) clearTimeout(timer)
    if (this.ticker) clearInterval(this.ticker)
    try {
      this.socket?.close()
    } catch {
      /* already closed */
    }
    this.mic?.getTracks().forEach((track) => track.stop())
    void this.audio?.close().catch(() => undefined)
    this.onChange()
  }
}
