import { t } from '../i18n/i18n.ts';
import type { NetClient } from './client.ts';
import { DEFAULT_ICE, type IceServer, type RtcSignal, type SeatInfo, type ServerMsg } from './protocol.ts';

/**
 * Room voice chat (wiki/design-multiplayer.md, "Voice"): WebRTC peer to peer between the room's seats, up to 3 connections each.
 * Signalling goes over the lobby WebSocket (`rtc` messages, the server only forwards them), audio does not touch the server.
 *
 * Key T turns *one's own microphone* on and off; teammates with a mic on are always heard — receiving needs no permission.
 * Every connection has one audio transceiver from the start (sendrecv), the mic is put in and taken out with `replaceTrack`:
 * no renegotiation, and when off the track is stopped — the browser's mic indicator goes out.
 * The lower seat makes the offer (no glare); an offer from a seat always replaces the old connection with it
 * (that seat reloaded the page — the camp → battle switch).
 *
 * The mic state survives the page switch (sessionStorage): the battle page turns it on again by itself if permission was granted
 */
const VOICE_KEY = 'malina.voice';

interface Peer {
  seat: number;
  pc: RTCPeerConnection;
  sender: RTCRtpSender | null;
  audio: HTMLAudioElement;
  /** Candidates that came before the remote description */
  pending: RTCIceCandidateInit[];
  analyser: AnalyserNode | null;
}

export class VoiceChat {
  private readonly net: NetClient;
  private readonly peers = new Map<number, Peer>();
  private mic: MediaStream | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private ctx: AudioContext | null = null;
  private ice: Promise<IceServer[]> | null = null;
  /** The mic flag the server knows: resend after a reconnect */
  private told = false;
  /** Turning on in progress (permission dialog) */
  private busy: Promise<string | null> | null = null;
  private wanted = false;
  /** Signalling is handled strictly in order: an offer and its ICE candidates never overtake each other */
  private chain: Promise<void> = Promise.resolve();
  /** Mic changed — for the HUD */
  onChange?: () => void;

  constructor(net: NetClient) {
    this.net = net;
    try { this.wanted = sessionStorage.getItem(VOICE_KEY) === '1'; } catch { /* closed storage */ }
    net.on((m) => this.handle(m));
    // autoplay is blocked until a gesture — try the silent players again on the first one
    const kick = (): void => { for (const p of this.peers.values()) if (p.audio.paused && p.audio.srcObject) void p.audio.play().catch(() => {}); void this.ctx?.resume(); };
    window.addEventListener('pointerdown', kick, true);
    window.addEventListener('keydown', kick, true);
  }

  /** The microphone is on */
  get on(): boolean { return !!this.mic; }

  /** Turn one's mic on / off; the result — an error text for a toast (null — fine) */
  async toggle(): Promise<string | null> {
    if (this.busy) return this.busy;
    if (this.mic) { this.stopMic(); this.remember(false); return null; }
    return this.start(true);
  }

  /** Sound level of a seat 0…1 (one's own seat — the mic), for the "speaking" mark */
  level(seat: number): number {
    const me = this.net.room?.you;
    const a = seat === me ? this.micAnalyser : this.peers.get(seat)?.analyser ?? null;
    if (!a) return 0;
    const buf = new Uint8Array(a.fftSize);
    a.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
    return Math.min(1, Math.sqrt(sum / buf.length) * 4);
  }

  /** Seat is talking right now */
  speaking(seat: number): boolean { return this.level(seat) > 0.08; }

  // ---------- Microphone ----------

  private start(user: boolean): Promise<string | null> {
    this.busy = (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return t('Voice needs HTTPS or localhost');
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        // turned off or left while the dialog was open
        if (!user && !this.wanted) { for (const tr of s.getTracks()) tr.stop(); return null; }
        this.mic = s;
        const track = s.getAudioTracks()[0] ?? null;
        for (const p of this.peers.values()) void p.sender?.replaceTrack(track);
        this.micAnalyser = this.analyse(s);
        this.remember(true);
        this.tell();
        this.onChange?.();
        return null;
      } catch (e) {
        if (!user) return null;
        const name = (e as { name?: string }).name;
        console.warn('voice: microphone', name, e);
        return name === 'NotAllowedError' ? t('Microphone access denied') : name === 'NotFoundError' ? t('No microphone found') : t('Microphone unavailable');
      }
    })().finally(() => { this.busy = null; });
    return this.busy;
  }

  private stopMic(): void {
    for (const p of this.peers.values()) void p.sender?.replaceTrack(null);
    for (const tr of this.mic?.getTracks() ?? []) tr.stop();
    this.mic = null;
    this.micAnalyser = null;
    this.tell();
    this.onChange?.();
  }

  private remember(on: boolean): void {
    this.wanted = on;
    try { if (on) sessionStorage.setItem(VOICE_KEY, '1'); else sessionStorage.removeItem(VOICE_KEY); } catch { /* closed storage */ }
  }

  /** Tell the room whether the mic is on (once per change and after a reconnect) */
  private tell(): void {
    const on = !!this.mic;
    if (!this.net.room || this.told === on) return;
    this.told = on;
    this.net.send({ t: 'voice', on });
  }

  // ---------- Room ----------

  private handle(m: ServerMsg): void {
    switch (m.t) {
      case 'room.state': { const { seats, you } = m; this.run(() => this.sync(seats, you)); break; }
      case 'room.left': this.run(async () => { this.closeAll(); this.told = false; }); break;
      case 'rtc': { const { from, data } = m; this.run(() => this.signal(from, data)); break; }
      default: break;
    }
  }

  private run(f: () => Promise<void>): void {
    this.chain = this.chain.then(f).catch((e: unknown) => { console.warn('voice:', e); });
  }

  /** Room changed: a connection with every other online seat, the rest closed; the mic flag to the server */
  private async sync(seats: SeatInfo[], you: number): Promise<void> {
    const mine = seats.find((x) => x.seat === you);
    if (mine) this.told = mine.voice;
    // the battle page: the mic was on in the camp — on again (no dialog if permission was granted)
    if (this.wanted && !this.mic && !this.busy) void this.start(false);
    this.tell();
    const live = new Set(seats.filter((x) => x.seat !== you && x.online).map((x) => x.seat));
    for (const seat of [...this.peers.keys()]) if (!live.has(seat)) this.close(seat);
    for (const seat of live) if (!this.peers.has(seat) && you < seat) await this.offer(seat);
  }

  private iceServers(): Promise<IceServer[]> {
    this.ice ??= fetch(`${this.net.base}/api/health`, { signal: AbortSignal.timeout(5000) })
      .then((r) => r.json() as Promise<{ ice?: IceServer[] }>)
      .then((b) => (Array.isArray(b.ice) ? b.ice : DEFAULT_ICE))
      .catch(() => DEFAULT_ICE);
    return this.ice;
  }

  private async peer(seat: number): Promise<Peer> {
    this.close(seat);
    const pc = new RTCPeerConnection({ iceServers: await this.iceServers() });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.dataset.voiceSeat = String(seat);
    audio.style.display = 'none';
    document.body.append(audio);
    const p: Peer = { seat, pc, sender: null, audio, pending: [], analyser: null };
    this.peers.set(seat, p);
    pc.onicecandidate = (e) => {
      const c = e.candidate;
      this.net.send({ t: 'rtc', to: seat, data: { k: 'ice', c: c ? { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex } : null } });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      audio.srcObject = stream;
      void audio.play().catch(() => { /* waits for a gesture */ });
      p.analyser = this.analyse(stream);
    };
    pc.onconnectionstatechange = () => {
      // ICE did not get through (network changed): the offering side starts over, the other one waits for its offer
      if (pc.connectionState === 'failed' && (this.net.room?.you ?? 0) < seat) this.run(async () => { if (this.peers.get(seat) === p) await this.offer(seat); });
    };
    return p;
  }

  private async offer(seat: number): Promise<void> {
    const p = await this.peer(seat);
    const tr = p.pc.addTransceiver('audio', { direction: 'sendrecv' });
    p.sender = tr.sender;
    if (this.mic) await tr.sender.replaceTrack(this.mic.getAudioTracks()[0] ?? null);
    await p.pc.setLocalDescription(await p.pc.createOffer());
    this.net.send({ t: 'rtc', to: seat, data: { k: 'offer', sdp: p.pc.localDescription?.sdp ?? '' } });
  }

  private async signal(from: number, d: RtcSignal): Promise<void> {
    try {
      if (from === this.net.room?.you) return;
      if (d.k === 'offer') {
        const p = await this.peer(from);
        await p.pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
        const tr = p.pc.getTransceivers()[0];
        if (tr) {
          tr.direction = 'sendrecv';
          p.sender = tr.sender;
          if (this.mic) await tr.sender.replaceTrack(this.mic.getAudioTracks()[0] ?? null);
        }
        await p.pc.setLocalDescription(await p.pc.createAnswer());
        this.net.send({ t: 'rtc', to: from, data: { k: 'answer', sdp: p.pc.localDescription?.sdp ?? '' } });
        await this.flush(p);
        return;
      }
      const p = this.peers.get(from);
      if (!p) return;
      if (d.k === 'answer') {
        if (p.pc.signalingState !== 'have-local-offer') return;
        await p.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp });
        await this.flush(p);
        return;
      }
      if (d.k !== 'ice' || !d.c) return;
      if (p.pc.remoteDescription) await p.pc.addIceCandidate(d.c);
      else p.pending.push(d.c);
    } catch (e) {
      console.warn('voice: signal', from, d.k, e);
    }
  }

  private async flush(p: Peer): Promise<void> {
    for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
  }

  private close(seat: number): void {
    const p = this.peers.get(seat);
    if (!p) return;
    this.peers.delete(seat);
    p.pc.onicecandidate = p.pc.ontrack = p.pc.onconnectionstatechange = null;
    p.pc.close();
    p.audio.srcObject = null;
    p.audio.remove();
  }

  private closeAll(): void { for (const seat of [...this.peers.keys()]) this.close(seat); }

  /** Level meter on a stream (not connected to the speakers — the sound plays through <audio>) */
  private analyse(s: MediaStream): AnalyserNode | null {
    try {
      this.ctx ??= new AudioContext();
      const a = this.ctx.createAnalyser();
      a.fftSize = 512;
      this.ctx.createMediaStreamSource(s).connect(a);
      return a;
    } catch { return null; }
  }

  // ---------- For tests ----------

  /** Connection states by seat (Playwright: tests/voice.spec.ts) */
  debug(): { on: boolean; peers: { seat: number; state: string; remote: boolean; muted: boolean | null }[] } {
    return {
      on: this.on,
      peers: [...this.peers.values()].map((p) => {
        const track = (p.audio.srcObject as MediaStream | null)?.getAudioTracks()[0] ?? null;
        return { seat: p.seat, state: p.pc.connectionState, remote: !!track && track.readyState === 'live', muted: track ? track.muted : null };
      }),
    };
  }
}
