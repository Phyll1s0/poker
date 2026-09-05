import type { MultiplayerChatReactionTone } from "./multiplayer-chat.ts";

type Vowel = "a" | "e" | "u" | "m";
type Gesture = Readonly<{
  at: number;
  duration: number;
  pitch: readonly [number, number];
  vowel: Vowel;
  energy: number;
  breath: number;
  roughness: number;
}>;

/** Original wordless cartoon gestures, not speech or samples from another game.
 * Laughs use two high-to-low /ha/ attacks (hà! hà!), not flat TTS.
 * A bright register and soft formants keep the character light, not bassy.
 */
export const MULTIPLAYER_REACTION_VOICE_GESTURES: Readonly<Record<MultiplayerChatReactionTone, readonly Gesture[]>> = {
  praise: [
    { at: 0, duration: 0.17, pitch: [270, 365], vowel: "m", energy: 0.65, breath: 0.04, roughness: 0 },
    { at: 0.22, duration: 0.22, pitch: [440, 290], vowel: "a", energy: 0.85, breath: 0.2, roughness: 0.04 },
  ],
  lucky: [
    { at: 0, duration: 0.22, pitch: [440, 235], vowel: "a", energy: 0.94, breath: 0.28, roughness: 0.1 },
    { at: 0.32, duration: 0.25, pitch: [415, 215], vowel: "a", energy: 1, breath: 0.25, roughness: 0.1 },
  ],
  frustrated: [
    { at: 0, duration: 0.3, pitch: [305, 255], vowel: "m", energy: 0.88, breath: 0.16, roughness: 0.85 },
    { at: 0.36, duration: 0.19, pitch: [330, 235], vowel: "u", energy: 0.82, breath: 0.62, roughness: 0.65 },
  ],
  taunt: [
    { at: 0, duration: 0.14, pitch: [355, 275], vowel: "e", energy: 0.78, breath: 0.12, roughness: 0.15 },
    { at: 0.21, duration: 0.15, pitch: [395, 285], vowel: "e", energy: 0.88, breath: 0.15, roughness: 0.15 },
    { at: 0.43, duration: 0.17, pitch: [430, 290], vowel: "a", energy: 0.75, breath: 0.25, roughness: 0.12 },
  ],
  surprised: [
    { at: 0, duration: 0.34, pitch: [275, 500], vowel: "a", energy: 0.9, breath: 0.48, roughness: 0.02 },
  ],
  thinking: [
    { at: 0, duration: 0.4, pitch: [270, 350], vowel: "m", energy: 0.66, breath: 0.06, roughness: 0 },
  ],
};

const VARIANTS = [0.97, 1, 1.04] as const;
const FORMANTS: Record<Vowel, readonly (readonly [number, number, number])[]> = {
  a: [[900, 150, 1], [1450, 210, 0.7], [2850, 300, 0.24]],
  e: [[620, 150, 1], [2050, 230, 0.6], [3100, 320, 0.2]],
  u: [[400, 120, 1], [1050, 180, 0.5], [2500, 280, 0.16]],
  m: [[310, 160, 1], [1150, 230, 0.2], [2250, 300, 0.09]],
};

/** FNV-1a also accepts server ids larger than Number.MAX_SAFE_INTEGER. */
export function multiplayerReactionVoiceIndex(tone: MultiplayerChatReactionTone, messageId: string) {
  let hash = 0x811c9dc5;
  const source = `${tone}:${messageId}`;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % VARIANTS.length;
}

/** A small source/filter vocal synthesizer. No words, network, device voices,
 * microphones, or third-party recordings. PCM can also be rendered offline
 * for listening and waveform checks using scripts/render-reaction-audio.mjs.
 */
export function renderMultiplayerReactionVoice(
  tone: MultiplayerChatReactionTone,
  messageId: string,
  sampleRate = 24000,
) {
  if (!Number.isInteger(sampleRate) || sampleRate < 16000 || sampleRate > 96000) {
    throw new RangeError("Reaction sample rate must be between 16000 and 96000 Hz");
  }
  const gestures = MULTIPLAYER_REACTION_VOICE_GESTURES[tone];
  if (!gestures) throw new RangeError("Unknown reaction tone");
  const variant = multiplayerReactionVoiceIndex(tone, messageId);
  const pitchScale = VARIANTS[variant];
  const duration = Math.max(...gestures.map((gesture) => gesture.at + gesture.duration)) + 0.045;
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  let randomState = 0x6d2b79f5 + variant;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 0x80000000 - 1;
  };

  for (const gesture of gestures) {
    const filters = FORMANTS[gesture.vowel].map(([frequency, bandwidth, gain]) => {
      const omega = 2 * Math.PI * frequency * pitchScale / sampleRate;
      const alpha = Math.sin(omega) / (2 * frequency / bandwidth);
      return {
        b: alpha / (1 + alpha), a1: -2 * Math.cos(omega) / (1 + alpha), a2: (1 - alpha) / (1 + alpha),
        gain, x1: 0, x2: 0, y1: 0, y2: 0,
      };
    });
    const start = Math.round(gesture.at * sampleRate);
    const length = Math.round(gesture.duration * sampleRate);
    let phase = 0;
    let breathLowpass = 0;
    for (let i = 0; i < length; i += 1) {
      const t = i / sampleRate;
      const progress = i / Math.max(1, length - 1);
      const pitch = gesture.pitch[0] * Math.pow(gesture.pitch[1] / gesture.pitch[0], progress)
        * pitchScale * (1 + 0.008 * Math.sin(t * 2 * Math.PI * 7) + gesture.roughness * 0.015 * random());
      phase += 2 * Math.PI * pitch / sampleRate;
      let voiced = 0;
      // A falling harmonic spectrum replaces the old buzzy sawtooth source.
      for (let harmonic = 1; harmonic <= 16 && harmonic * pitch < sampleRate * 0.44; harmonic += 1) {
        voiced += Math.sin(phase * harmonic) / Math.pow(harmonic, 1.4);
      }
      const breath = random();
      breathLowpass += 0.38 * (breath - breathLowpass);
      const hAttack = gesture.vowel === "m" ? 0 : Math.exp(-t / 0.028);
      const voicingOnset = gesture.vowel === "m" ? 1 : Math.min(1, t / 0.04);
      const flutter = 1 - gesture.roughness * 0.3 * (0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 34));
      const excitation = voiced * voicingOnset * flutter
        + breathLowpass * (gesture.breath * 0.13 + hAttack * 1.5);
      let value = 0;
      for (const filter of filters) {
        const y = filter.b * excitation - filter.b * filter.x2 - filter.a1 * filter.y1 - filter.a2 * filter.y2;
        filter.x2 = filter.x1; filter.x1 = excitation;
        filter.y2 = filter.y1; filter.y1 = y;
        value += y * filter.gain;
      }
      const attack = Math.min(1, t / 0.014);
      const release = Math.min(1, (gesture.duration - t) / 0.055);
      const envelope = attack * release * (0.92 - progress * 0.3) * gesture.energy;
      samples[start + i] += Math.tanh(value * 2.2) * envelope;
    }
  }
  // Remove DC and bound the peak; silence between gestures remains silence.
  let previousInput = 0;
  let previousOutput = 0;
  let peak = 0;
  let squareSum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const input = samples[i];
    const value = input - previousInput + 0.995 * previousOutput;
    previousInput = input;
    previousOutput = value;
    samples[i] = value;
    peak = Math.max(peak, Math.abs(value));
    squareSum += value * value;
  }
  // Nasal hums concentrate energy in fewer harmonics. Match their average
  // loudness to the laughs instead of making every tone equally peak-loud.
  const rms = Math.sqrt(squareSum / samples.length);
  const gain = Math.min(0.78 / Math.max(0.01, peak), 0.22 / Math.max(0.01, rms));
  for (let i = 0; i < samples.length; i += 1) samples[i] *= gain;
  return { samples, sampleRate, duration: samples.length / sampleRate, variant };
}
