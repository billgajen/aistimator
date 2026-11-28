/**
 * T-210, T-211: one test call, in the browser.
 *
 * The page's microphone goes straight to the voice engine and her voice comes straight back: no
 * server of ours carries the audio (that is what this test measures). The server's part is
 * opening the call (which fixes the model, her instructions, her voice and her tools) and running
 * her tools.
 *
 * Two engines, one call (T-211). What differs between them is how sound and events travel:
 *   - Gemini Live: a WebSocket. The microphone goes up as 16 kHz PCM and her voice comes down as
 *     24 kHz PCM, both through the two small worklets.
 *   - OpenAI GPT-Live: WebRTC. Sound travels on media tracks and events on a data channel. The
 *     offer is made here and answered through our server, which holds the key.
 * Everything else is the same code: the delay of each turn, the transcript, her tool calls, the
 * silence prompts, the wrap-up note, her `end_call`, the 8-minute stop.
 *
 * What is timed: the delay of each of her turns, from the caller's last sound to her first sound.
 * "The caller's last sound" is heard here, from the loudness of the microphone, because that is
 * the moment a caller starts waiting; the engine's own end-of-speech wait is inside the delay.
 *
 * Browser only. Nothing is stored: the results are in memory until the page is left.
 */
import type { LiveMinutePrice, LiveModelPrice, ModelPrice } from '@qolumns/shared'
import { CALL_LIMIT_SECONDS, CONNECTED_NOTE, DEVICE_COOKIE, DEVICE_KEY, INPUT_MIME, INPUT_SAMPLE_RATE, OUTPUT_SAMPLE_RATE, SILENT_NOTE, STILL_SILENT_NOTE, WRAP_UP_NOTE, WRAP_UP_SECONDS, liveSocketUrl, type Engine } from './config'
import { NO_MINUTES, NO_TOKENS, addUsage, type LiveUsage } from './cost'
import type { GuardStatus } from './guard'
import type { EndReason } from './guard-config'
import { systemNote } from './instructions'
import type { CallPrices, CallResults, ToolRecord } from './results'
import type { CallContact } from './session'
import type { EngineFigures } from './spoken'
import { VOICE_WORKLETS } from './worklets'

/** What the session route answers */
export interface CallStart {
  engine: Engine
  session: string
  model: string
  voice: string
  contact: CallContact
  notice: string
  limits: { callSeconds: number; wrapUpSeconds: number; silenceAskSeconds: number; silenceEndSeconds: number; lastWordsSeconds: number }
  guard: GuardStatus
  humanCheck: string
  area: string
  business: { id: string; name: string; currency: string; locale: string; timeZone: string; services: Array<{ id: string; name: string }> }
  instruction: string
  // Gemini Live
  token?: string
  prices?: LiveModelPrice | null
  tuning?: { endOfSpeechMs: number; memory: { triggerTokens: number; slidingWindow: { targetTokens: number } } }
  // OpenAI GPT-Live
  sdp?: string
  backendModel?: string
  minutePrice?: LiveMinutePrice | null
  backendPrice?: ModelPrice | null
}

export const pricesOf = (start: CallStart | null): CallPrices => ({ live: start?.prices ?? null, minute: start?.minutePrice ?? null, backend: start?.backendPrice ?? null })

/** The id this browser is counted by: kept in localStorage and in a cookie, so that clearing one does not make a new visitor */
export function deviceId(): string {
  const fromCookie = document.cookie.split('; ').find((c) => c.startsWith(`${DEVICE_COOKIE}=`))?.slice(DEVICE_COOKIE.length + 1)
  let id: string | null = null
  try {
    id = localStorage.getItem(DEVICE_KEY)
  } catch {
    /* storage is off: the cookie alone */
  }
  id = id || fromCookie || crypto.randomUUID()
  try {
    localStorage.setItem(DEVICE_KEY, id)
  } catch {
    /* storage is off */
  }
  document.cookie = `${DEVICE_COOKIE}=${id}; path=/; max-age=${400 * 24 * 60 * 60}; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`
  return id
}

/** Microphone pieces of 40 ms */
const CHUNK_SAMPLES = (INPUT_SAMPLE_RATE * 40) / 1000
/** A piece is the caller's voice when it is this loud, or three times the room's own noise, whichever is more */
const VOICE_FLOOR = 0.012
/** …and that many loud pieces in a row are speech, not a click */
const VOICE_RUN = 3
/** Her voice on a WebRTC track: this loud is her speaking, and this long quiet is the end of her turn */
const HER_FLOOR = 0.006
const HER_QUIET_MS = 700
/** How often what her tools have answered is put back in her memory */
const REMIND_EVERY_MS = 60_000

type Note = 'connected' | 'silent' | 'still_silent' | 'wrap_up'
const NOTE_TEXT: Record<Note, string> = { connected: CONNECTED_NOTE, silent: SILENT_NOTE, still_silent: STILL_SILENT_NOTE, wrap_up: WRAP_UP_NOTE }

interface HerCall {
  id?: string
  name: string
  args: unknown
}

/** How one engine carries a call. The call itself (below) is the same for both. */
interface Transport {
  /** Tell her something that is not the caller speaking */
  note(kind: Note): void
  /** Put something in her memory without asking her to speak or answer */
  remember(text: string): void
  /** Answer one of her tool calls. `more` = other answers are still to come for the same turn. */
  answer(call: HerCall, response: unknown, more: boolean): void
  /** A piece of the microphone, when the engine takes it from here (Gemini) */
  microphone?(pcm: ArrayBuffer): void
  close(): void
}

interface GeminiMessage {
  setupComplete?: unknown
  serverContent?: {
    modelTurn?: { parts?: Array<{ inlineData?: { data?: string } }> }
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
  private start: CallStart | null = null
  private session = ''
  private transport: Transport | null = null
  private audio: AudioContext | null = null
  private mic: MediaStream | null = null
  private playback: AudioWorkletNode | null = null
  private peer: RTCPeerConnection | null = null
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
  private herPlaying = false
  private herQuietSince = 0
  private waitedFor: string[] = []
  /** When the caller last spoke before each turn (the start of that turn's wait); and the turn still waiting for her answer after a tool */
  private spokeAt: Array<number | null> = []
  private answerDue: number | null = null
  private cancelled = new Set<string>()
  /** The next words start a new line of the transcript, even from the same speaker (a turn ended, or a tool answered) */
  private newLine = false
  // her tool calls, one at a time: each may hand back a newer session for the next
  private queue: Promise<void> = Promise.resolve()
  private waiting = 0
  // silence
  private askedAt: number | null = null
  private toldStillSilent = false
  // her end_call
  private ending: EndReason | null = null
  /** end_call has been answered: her goodbye came before it, and anything after it is not played */
  private hushed = false
  private herPlayer: HTMLAudioElement | null = null
  /** What her tools have answered so far in the call, as the server last gave it; and when it was last put back in her memory */
  private soFar = ''
  private remindedAt = 0

  constructor(
    private readonly engine: Engine,
    private readonly onChange: () => void,
    browser: string
  ) {
    this.results = {
      business: '', engine, model: '', voice: '', browser, seconds: 0, status: 'starting', endedBecause: null, endReason: null,
      transcript: [], turns: [], tools: [], tokens: NO_TOKENS, contexts: [], minutes: NO_MINUTES, guard: null,
      contact: { name: '', email: null, phone: null }, corrected: [], problems: [],
    }
  }

  /** Seconds into the call */
  private now(): number {
    return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0
  }

  private problem(text: string) {
    this.results.problems.push(`${Math.floor(this.now())}s: ${text}`)
    this.onChange()
  }

  /**
   * Open the microphone and the audio. Must be called from the press that starts the call (a
   * browser asks for that). For the WebRTC engine it answers the offer that the server needs to
   * open the session. Null = it could not start; the reason is in the results.
   */
  async prepare(): Promise<{ sdp?: string } | null> {
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
      // The microphone is listened to here for both engines: it is how the page knows when the caller stopped speaking
      const capture = new AudioWorkletNode(audio, 'voice-capture', { numberOfInputs: 1, numberOfOutputs: 0, processorOptions: { outRate: INPUT_SAMPLE_RATE, chunkSamples: CHUNK_SAMPLES } })
      capture.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => this.heard(e.data.pcm, e.data.rms)
      audio.createMediaStreamSource(this.mic).connect(capture)

      if (this.engine === 'gemini') {
        this.playback = new AudioWorkletNode(audio, 'voice-playback', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { inRate: OUTPUT_SAMPLE_RATE } })
        this.playback.port.onmessage = (e: MessageEvent<{ playing?: boolean }>) => {
          if (typeof e.data.playing === 'boolean') this.herSound(e.data.playing)
        }
        this.playback.connect(audio.destination)
        return {}
      }
      return { sdp: await this.offer() }
    } catch (error) {
      this.finish(error instanceof DOMException && error.name === 'NotAllowedError' ? 'the microphone was not allowed' : `the audio could not start (${error instanceof Error ? error.name : 'unknown'})`)
      return null
    }
  }

  /** The call the server opened: connect to it */
  connect(start: CallStart) {
    this.start = start
    this.session = start.session
    Object.assign(this.results, { business: start.business.name, model: start.model, voice: start.voice, guard: start.guard, contact: start.contact })
    if (this.engine === 'gemini') this.openSocket(start)
    else void this.acceptAnswer(start)
    this.onChange()
  }

  // ---------- Gemini Live: a WebSocket ----------

  private openSocket(start: CallStart) {
    const socket = new WebSocket(liveSocketUrl(start.token ?? ''))
    socket.binaryType = 'arraybuffer'
    const send = (message: unknown) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    }
    this.transport = {
      note: (kind) => send({ realtimeInput: { text: systemNote(NOTE_TEXT[kind]) } }),
      // A turn that is not complete is added to her memory and starts no answer (probed 28 Nov 2026)
      remember: (text) => send({ clientContent: { turns: [{ role: 'user', parts: [{ text: systemNote(text) }] }], turnComplete: false } }),
      answer: (call, response) => send({ toolResponse: { functionResponses: [{ id: call.id, name: call.name, response }] } }),
      microphone: (pcm) => send({ realtimeInput: { audio: { data: toBase64(pcm), mimeType: INPUT_MIME } } }),
      close: () => {
        try {
          socket.close()
        } catch {
          /* already closed */
        }
      },
    }
    // The token carries the whole setup; what is sent here is ignored by the Live API. It still needs a first message.
    socket.onopen = () => send({ setup: { model: `models/${start.model}` } })
    socket.onmessage = (e: MessageEvent<ArrayBuffer | string>) => {
      try {
        this.fromGemini(JSON.parse(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data)) as GeminiMessage)
      } catch {
        this.problem('a message from the Live API could not be read')
      }
    }
    socket.onerror = () => this.problem('the connection reported an error')
    socket.onclose = (e) => this.finish(this.over ? null : `the Live API closed the call (${e.code}${e.reason ? `: ${e.reason}` : ''})`)
  }

  private fromGemini(m: GeminiMessage) {
    if (m.setupComplete !== undefined) this.began(true)
    const content = m.serverContent
    if (content) {
      for (const part of content.modelTurn?.parts ?? []) {
        const data = part.inlineData?.data
        if (!data || this.hushed) continue
        if (!this.turnOpen) this.turnBegan()
        this.answered()
        const pcm = fromBase64(data)
        this.playback?.port.postMessage({ pcm }, [pcm])
      }
      if (content.inputTranscription?.text) this.said('caller', content.inputTranscription.text)
      if (content.outputTranscription?.text && !this.hushed) this.said('her', content.outputTranscription.text)
      if (content.interrupted) {
        this.playback?.port.postMessage({ flush: true })
        this.turnEnded()
      }
      if (content.turnComplete) this.turnEnded()
    }
    for (const call of m.toolCall?.functionCalls ?? []) this.asked({ id: call.id, name: String(call.name ?? ''), args: call.args ?? {} })
    for (const id of m.toolCallCancellation?.ids ?? []) this.cancelled.add(id)
    if (m.usageMetadata) {
      this.results.tokens = addUsage(this.results.tokens, m.usageMetadata)
      if (typeof m.usageMetadata.promptTokenCount === 'number') this.results.contexts.push(m.usageMetadata.promptTokenCount)
    }
    if (m.goAway) this.problem(`the Live API said the connection will close soon (${m.goAway.timeLeft ?? 'no time given'})`)
    this.onChange()
  }

  // ---------- OpenAI GPT-Live: WebRTC ----------

  /** The offer the server needs to open the session: a peer connection with the microphone and the events channel */
  private async offer(): Promise<string> {
    const peer = new RTCPeerConnection()
    this.peer = peer
    for (const track of this.mic!.getAudioTracks()) peer.addTrack(track, this.mic!)
    peer.ontrack = (e) => this.herTrack(e.streams[0] ?? new MediaStream([e.track]))
    // The events channel is made before the offer, as OpenAI's guide asks
    const channel = peer.createDataChannel('oai-events')
    let n = 0
    const send = (event: Record<string, unknown>) => {
      if (channel.readyState === 'open') channel.send(JSON.stringify({ event_id: `evt_${++n}`, ...event }))
    }
    this.transport = {
      note: (kind) => {
        // She opens by herself (the session was told the call had connected). The rest are said or kept as context.
        if (kind === 'silent') send({ type: 'session.commentary.append', delegation_id: null, content: 'Ask, once and briefly, whether the caller is still there.' })
        else if (kind === 'still_silent') send({ type: 'session.commentary.append', delegation_id: null, content: 'Say a short goodbye: nobody seems to be there.' })
        else if (kind === 'wrap_up') send({ type: 'session.thinking.append', delegation_id: null, content: systemNote(WRAP_UP_NOTE) })
      },
      remember: (text) => send({ type: 'session.thinking.append', delegation_id: null, content: systemNote(text) }),
      answer: (call, response, more) => {
        send({ type: 'response.item.create', item: { type: 'function_call_output', call_id: call.id, output: JSON.stringify(response) } })
        // The backend carries on only once every answer it is waiting for has been given
        if (!more) send({ type: 'response.create' })
      },
      close: () => {
        send({ type: 'session.close' })
        setTimeout(() => peer.close(), 1500)
      },
    }
    channel.onmessage = (e: MessageEvent<string>) => {
      try {
        this.fromOpenAi(JSON.parse(e.data) as Record<string, unknown>)
      } catch {
        this.problem('an event from the engine could not be read')
      }
    }
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed' || peer.connectionState === 'closed') this.finish(this.over ? null : `the connection ${peer.connectionState}`)
    }
    await peer.setLocalDescription(await peer.createOffer())
    // Wait for the connection candidates to be gathered (ten seconds at most), then send the whole offer
    if (peer.iceGatheringState !== 'complete') {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 10_000)
        peer.addEventListener('icegatheringstatechange', () => {
          if (peer.iceGatheringState === 'complete') {
            clearTimeout(timer)
            resolve()
          }
        })
      })
    }
    return peer.localDescription?.sdp ?? ''
  }

  private async acceptAnswer(start: CallStart) {
    try {
      await this.peer?.setRemoteDescription({ type: 'answer', sdp: start.sdp ?? '' })
    } catch (error) {
      this.finish(`the call's answer could not be used (${error instanceof Error ? error.name : 'unknown'})`)
    }
  }

  /** Her voice arrives on a media track: it is played, and listened to for when she starts and stops */
  private herTrack(stream: MediaStream) {
    const player = new Audio()
    this.herPlayer = player
    player.srcObject = stream
    player.autoplay = true
    void player.play().catch(() => this.problem('the browser would not play her voice'))
    if (!this.audio) return
    const analyser = this.audio.createAnalyser()
    analyser.fftSize = 1024
    this.audio.createMediaStreamSource(stream).connect(analyser)
    const samples = new Float32Array(analyser.fftSize)
    const watch = setInterval(() => {
      if (this.over) return clearInterval(watch)
      analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!
      const loud = Math.sqrt(sum / samples.length) > HER_FLOOR
      if (loud) {
        this.herQuietSince = 0
        if (!this.turnOpen) this.turnBegan()
        this.answered()
        this.herSound(true)
      } else if (this.herPlaying) {
        if (!this.herQuietSince) this.herQuietSince = performance.now()
        else if (performance.now() - this.herQuietSince > HER_QUIET_MS) {
          this.herSound(false)
          this.turnEnded()
          this.onChange()
        }
      }
    }, 20)
  }

  private fromOpenAi(m: Record<string, unknown>) {
    const type = String(m.type ?? '')
    if (type === 'session.started') this.began(false)
    else if (type === 'session.input_transcript.delta' && typeof m.delta === 'string') this.said('caller', m.delta)
    else if (type === 'session.output_transcript.delta' && typeof m.delta === 'string' && !this.hushed) this.said('her', m.delta)
    else if (type === 'session.usage.updated' || type === 'session.closed') {
      const seconds = (m.usage as { seconds?: unknown } | undefined)?.seconds
      if (typeof seconds === 'number') this.results.minutes = { ...this.results.minutes, seconds }
      if (type === 'session.closed') this.finish(this.over ? null : `the engine closed the call (${String(m.reason ?? 'no reason given')})`)
    } else if (type === 'response.event') {
      // The backend model's own events come wrapped: its tool calls, and what each of its answers used
      const event = (m.event ?? {}) as { type?: string; item?: { type?: string; call_id?: string; name?: string; arguments?: string }; response?: { usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } } }
      if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
        let args: unknown = {}
        try {
          args = JSON.parse(event.item.arguments || '{}')
        } catch {
          this.problem(`${event.item.name ?? 'a tool'} was called with arguments that could not be read`)
        }
        this.asked({ id: event.item.call_id, name: String(event.item.name ?? ''), args })
      } else if (event.type === 'response.completed' && event.response?.usage) {
        const used = event.response.usage
        this.results.minutes = { ...this.results.minutes, backendIn: this.results.minutes.backendIn + (used.input_tokens ?? 0), backendCachedIn: this.results.minutes.backendCachedIn + (used.input_tokens_details?.cached_tokens ?? 0), backendOut: this.results.minutes.backendOut + (used.output_tokens ?? 0) }
      }
    } else if (type === 'error') this.problem(`the engine reported an error (${String((m.error as { code?: unknown } | undefined)?.code ?? m.code ?? 'no code')})`)
    this.onChange()
  }

  // ---------- the call, the same for both engines ----------

  /** The engine says the call is open */
  private began(tellHer: boolean) {
    if (this.ready) return
    this.ready = true
    this.startedAt = performance.now()
    this.results.status = 'live'
    this.ticker = setInterval(() => this.tick(), 500)
    // She opens the call: an engine that waits to be spoken to is told the call has connected
    if (tellHer) this.transport?.note('connected')
    this.timers.push(setTimeout(() => this.transport?.note('wrap_up'), WRAP_UP_SECONDS * 1000))
    this.timers.push(setTimeout(() => this.end(`the ${CALL_LIMIT_SECONDS / 60}-minute limit`), CALL_LIMIT_SECONDS * 1000))
    this.onChange()
  }

  /** Twice a second: the clock, the silence prompts, and her last words after end_call */
  private tick() {
    this.results.seconds = this.now()
    // Her memory of the call is trimmed as it goes on. What her tools answered is put back, quietly, once a minute.
    if (this.soFar && !this.over && !this.herPlaying && this.waiting === 0 && performance.now() - this.remindedAt > REMIND_EVERY_MS) {
      this.remindedAt = performance.now()
      this.transport?.remember(`for your notes, so far in this call: ${this.soFar}`)
    }
    const limits = this.start?.limits
    if (limits && !this.over && !this.ending) {
      const at = performance.now()
      // Silence is counted from the caller's last sound, or from the end of what she last said, whichever is later
      const since = Math.max(this.lastVoiceAt ?? this.startedAt, this.lastTurnAt, this.herPlaying ? at : this.herStoppedAt)
      if (this.askedAt === null) {
        if (!this.herPlaying && this.waiting === 0 && at - since >= limits.silenceAskSeconds * 1000) {
          this.askedAt = at
          this.transport?.note('silent')
        }
      } else if (this.lastVoiceAt !== null && this.lastVoiceAt > this.askedAt) {
        // the caller spoke: there is someone there
        this.askedAt = null
        this.toldStillSilent = false
      } else if (!this.toldStillSilent && !this.herPlaying && at - Math.max(this.askedAt, this.herStoppedAt) >= limits.silenceEndSeconds * 1000) {
        this.toldStillSilent = true
        this.transport?.note('still_silent')
        // If she does not end the call herself after that, the page does
        this.timers.push(setTimeout(() => !this.ending && this.hangUp('silent'), limits.lastWordsSeconds * 1000))
      }
    }
    this.onChange()
  }

  private herStoppedAt = 0

  /** Her voice started or stopped being heard */
  private herSound(playing: boolean) {
    if (playing === this.herPlaying) return
    this.herPlaying = playing
    if (!playing) {
      this.herStoppedAt = performance.now()
      // After end_call the page waits for exactly this: her last sentence has been heard
      if (this.ending) setTimeout(() => !this.herPlaying && this.finish(`she ended the call (${this.ending})`), 400)
    }
  }

  /** A piece of the microphone: sent up when the engine takes it from here, and listened to for the caller's voice */
  private heard(pcm: ArrayBuffer, rms: number) {
    if (!this.ready || this.over) return
    this.transport?.microphone?.(pcm)
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

  /** Her first sound of a turn */
  private turnBegan() {
    const at = performance.now()
    this.turnOpen = true
    // Only the caller's sound since her last turn began counts: before that, she has already answered it
    const spoke = this.lastVoiceAt !== null && this.lastVoiceAt > this.lastTurnAt ? this.lastVoiceAt : null
    const waited = spoke === null ? null : Math.max(0, at - spoke)
    // Tools she ran before saying anything are inside this turn's delay: its first words are the answer
    this.results.turns.push({ n: this.results.turns.length + 1, at: this.now(), ms: waited, answerMs: this.waitedFor.length > 0 ? waited : null, tools: this.waitedFor, overlapped: this.voiceNow })
    this.spokeAt.push(spoke)
    this.waitedFor = []
    this.lastTurnAt = at
  }

  /** Her sound after a tool has answered: the turn that was waiting for it has its answer */
  private answered() {
    if (this.answerDue === null || this.waiting > 0) return
    const turn = this.results.turns[this.answerDue]
    const spoke = this.spokeAt[this.answerDue] ?? null
    if (turn && spoke !== null) turn.answerMs = Math.max(0, performance.now() - spoke)
    this.answerDue = null
  }

  private turnEnded() {
    this.turnOpen = false
    this.newLine = true
  }

  private said(who: 'caller' | 'her', text: string) {
    const last = this.results.transcript[this.results.transcript.length - 1]
    // What she says after a price must be its own line: the price check reads her words by when they began
    if (last && last.who === who && !(who === 'her' && this.newLine)) last.text += text
    else this.results.transcript.push({ who, at: this.now(), text })
    if (who === 'her') this.newLine = false
  }

  /** She called a tool: they are run one at a time, in the order she asked */
  private asked(call: HerCall) {
    this.waiting += 1
    this.queue = this.queue.then(() => this.tool(call))
  }

  /** One of her tool calls: passed to our server with the call's session, and the answer passed back */
  private async tool(call: HerCall) {
    const at = this.now()
    const began = performance.now()
    const args = call.args ?? {}
    let record: ToolRecord
    let end: EndReason | undefined
    try {
      const response = await fetch('/api/admin/voice-test/tool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: this.session, name: call.name, args }) })
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean; response?: unknown; session?: string; wouldDo?: string; engine?: EngineFigures; typical?: ToolRecord['typical']
        contact?: CallContact; end?: EndReason; guard?: { blocked: boolean; blockedUntil: number | null; strikes: number; recorded: boolean }; error?: { message?: string }
      } | null
      const took = Math.round(performance.now() - began)
      if (json && typeof json.ok === 'boolean') {
        record = { at, name: call.name, args, ok: json.ok, response: json.response, ms: took, wouldDo: json.wouldDo, engine: json.engine, typical: json.typical }
        // The server hands back a newer session when the call's own state changed: the next tool call must carry it
        if (json.session) this.session = json.session
        if (json.session) this.remindedAt = performance.now()
        if (json.contact) {
          const field = String((args as { field?: unknown }).field ?? '')
          this.results.corrected.push({ at, field, value: String((json.contact as unknown as Record<string, string | null>)[field] ?? '') })
          this.results.contact = json.contact
        }
        // What her tools have answered so far: kept, to be put back in her memory as the call's old turns are trimmed
        const soFar = (json.response as { callSoFar?: unknown } | undefined)?.callSoFar
        if (soFar) this.soFar = JSON.stringify(soFar)
        if (json.guard && this.results.guard) this.results.guard = { ...this.results.guard, blocked: json.guard.blocked, blockedUntil: json.guard.blockedUntil, strikes: json.guard.strikes, unavailable: !json.guard.recorded }
        end = json.end
      } else record = { at, name: call.name, args, ok: false, response: { error: json?.error?.message ?? `The tool route answered ${response.status}.` }, ms: took }
    } catch {
      record = { at, name: call.name, args, ok: false, response: { error: 'The tool could not be reached.' }, ms: Math.round(performance.now() - began) }
    }
    this.results.tools.push(record)
    // If she has already said something since the caller last spoke ("one moment"), the tool belongs to that turn,
    // and the turn's answer is her next sound. Otherwise it is inside the wait for her next turn.
    const current = this.results.turns.length - 1
    if (current >= 0 && (this.lastVoiceAt === null || this.lastVoiceAt <= this.lastTurnAt)) {
      this.results.turns[current]!.tools = [...this.results.turns[current]!.tools, call.name]
      this.answerDue = current
    } else this.waitedFor.push(call.name)
    this.newLine = true
    this.waiting -= 1
    if (call.id && this.cancelled.has(call.id)) this.problem(`${call.name} was cancelled by the engine before its answer was sent`)
    else this.transport?.answer(call, record.response, this.waiting > 0)
    if (end) {
      // Her goodbye came before end_call. What she says once it is answered is not for the caller.
      this.hushed = true
      if (this.herPlayer) setTimeout(() => this.herPlayer && (this.herPlayer.muted = true), 2500)
      this.hangUp(end)
    }
    this.onChange()
  }

  /** She ended the call (or silence did): her last sentence is let finish, then the page disconnects */
  private hangUp(reason: EndReason) {
    if (this.ending || this.over) return
    this.ending = reason
    this.results.endReason = reason
    const patience = (this.start?.limits.lastWordsSeconds ?? 8) * 1000
    // If nothing of hers is sounding now, give her a moment to start; then the end of her sound (herSound) closes the call
    this.timers.push(setTimeout(() => !this.herPlaying && this.finish(`she ended the call (${reason})`), 1500))
    this.timers.push(setTimeout(() => this.finish(`she ended the call (${reason})`), patience))
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
    this.transport?.close()
    this.mic?.getTracks().forEach((track) => track.stop())
    void this.audio?.close().catch(() => undefined)
    this.onChange()
  }
}
