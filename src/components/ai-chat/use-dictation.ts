"use client";
// Refs read during render (pattern from the original project): no automatic memoization
"use no memo";

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';

/**
 * Voice dictation with Whisper, run in the browser. This choice comes from a
 * simple constraint: native speech recognition does not exist in Firefox
 * and often refuses to work elsewhere. Here, the browser only records -
 * which all of them can do - and transcription runs locally, without any
 * audio leaving the device.
 */

/** The microphone and recording are enough: nothing depends on a custom speech engine anymore. */
export const DICTATION_AVAILABLE =
  typeof window !== 'undefined' &&
  typeof MediaRecorder !== 'undefined' &&
  Boolean(navigator.mediaDevices);

/** Current step, so the screen always says where things stand. */
export type DictationStep = 'idle' | 'microphone' | 'loading' | 'listening' | 'transcribing';

/** Known permission state, when the browser can tell. */
async function microphonePermission(): Promise<'granted' | 'denied' | 'prompt' | null> {
  try {
    const permission = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
    return (permission?.state as 'granted' | 'denied' | 'prompt' | undefined) ?? null;
  } catch {
    // Safari does not support this query: we will find out by trying
    return null;
  }
}

/**
 * Pace of partial transcriptions while speaking. Whisper processes
 * slices, not a stream: the text therefore arrives in bursts. Three and a half
 * seconds give a live preview on an accelerated machine, and the safeguard
 * below cuts the preview on machines that cannot keep up.
 */
const PARTIAL_INTERVAL = 3500;
/** Beyond this, partials stop: re-transcribing from the start would cost too much. */
const PARTIAL_MAX_DURATION = 45_000;
/** A pass longer than this will never keep up with speech. */
const PARTIAL_GIVE_UP_THRESHOLD = 6000;

/**
 * Automatic stop on silence, in two steps: the user must first have
 * actually spoken - otherwise a few seconds of thinking would cut the
 * dictation before the first word -, then stay silent long enough for it not
 * to be a mere breath between two sentences.
 */
const VOICE_THRESHOLD = 0.06;
const VOICE_DURATION = 300;
const SILENCE_DURATION = 3000;

/** Converts the recording into a 16 kHz mono signal, the only format Whisper accepts. */
async function toSignal(chunks: Blob[]): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate: 16_000 });
  try {
    const buffer = await context.decodeAudioData(await new Blob(chunks).arrayBuffer());
    return buffer.getChannelData(0);
  } finally {
    void context.close().catch(() => undefined);
  }
}

/**
 * @param onText  writes the text into the input field
 * @param currentValue  actual field content, to detect the user taking over with the keyboard
 */
export function useDictation(onText: (text: string) => void, currentValue = '') {
  const t = useTranslations('aiChat.dictation');
  /** Whisper transcribes in the interface language. */
  const language = useLocale();
  const [step, setStep] = useState<DictationStep>('idle');
  const [percent, setPercent] = useState(0);
  /** True when the large model is picked: the download is then longer. */
  const [accurate, setAccurate] = useState(false);
  /** Is the model in memory? Until it is, no transcription is possible. */
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const [level, setLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(new Map<number, (text: string) => void>());
  const counterRef = useRef(0);
  /** Number of the last request sent: only it is allowed to write. */
  const latestRef = useRef(0);
  const partialTimerRef = useRef<number | null>(null);
  const partialsEnabledRef = useRef(true);
  const busyRef = useRef(false);
  const startRef = useRef(0);
  const baseRef = useRef('');
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  /** Actual field content and the last text dictation wrote into it. */
  const valueRef = useRef(currentValue);
  valueRef.current = currentValue;
  const writtenRef = useRef('');
  /** Has a word been spoken? Stopping on silence only makes sense after that. */
  const hasSpokenRef = useRef(false);
  /** Live reference to the stop function, called from the audio loop. */
  const stopRef = useRef<(() => Promise<void>) | null>(null);

  /** Writes the dictated text while keeping track of what was written. */
  const write = useCallback((text: string) => {
    writtenRef.current = text;
    onTextRef.current(text);
  }, []);

  /** The transcription worker is only created on the first dictation. */
  const getWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const instance = new Worker(new URL('./whisper.worker.ts', import.meta.url), {
      type: 'module',
    });
    instance.onmessage = (
      event: MessageEvent<{
        type: string;
        id?: number;
        text?: string;
        percent?: number;
        message?: string;
        accurate?: boolean;
      }>,
    ) => {
      const message = event.data;
      if (message.type === 'quality') {
        setAccurate(Boolean(message.accurate));
        return;
      }
      if (message.type === 'loading') {
        setPercent(message.percent ?? 0);
        return;
      }
      if (message.type === 'ready') {
        setPercent(100);
        readyRef.current = true;
        setReady(true);
        return;
      }
      if (message.type === 'text' && message.id !== undefined) {
        pendingRef.current.get(message.id)?.(message.text ?? '');
        pendingRef.current.delete(message.id);
        return;
      }
      if (message.type === 'error') {
        toast.error(t('transcriptionFailed', { detail: message.message ?? t('unknownError') }));
        pendingRef.current.get(message.id ?? -1)?.('');
        pendingRef.current.delete(message.id ?? -1);
      }
    };
    // A worker that dies while loading sends no message: without this
    // listener, dictation would stay silent with nothing to explain it.
    instance.onerror = (event) => {
      toast.error(t('engineUnavailable', { detail: event.message || t('loadFailed') }));
      pendingRef.current.forEach((resolve) => resolve(''));
      pendingRef.current.clear();
    };
    workerRef.current = instance;
    return instance;
  }, [t]);

  /**
   * Transcription of a recording. Each request carries a number, and only
   * the most recent one may write: a preview coming back after the
   * final transcription would put an outdated sentence back into the field.
   */
  const transcribe = useCallback(
    async (chunks: Blob[]): Promise<{ id: number; text: string }> => {
      const audio = await toSignal(chunks);
      const id = (counterRef.current += 1);
      latestRef.current = id;
      return new Promise<{ id: number; text: string }>((resolve) => {
        pendingRef.current.set(id, (text) => resolve({ id, text }));
        getWorker().postMessage({ id, audio, language }, [audio.buffer as ArrayBuffer]);
      });
    },
    [getWorker, language],
  );

  /**
   * Has the user taken over with the keyboard since our last
   * write? If so, what they left becomes the new base and
   * recording starts over: without this, the next preview - which
   * re-transcribes all the audio from the start - would rewrite the sentence they just
   * erased. The user has the last word on their text.
   */
  const rebaseIfEdited = useCallback(() => {
    if (valueRef.current === writtenRef.current) return;

    baseRef.current = valueRef.current.trim() ? `${valueRef.current.trimEnd()} ` : '';
    writtenRef.current = valueRef.current;
    chunksRef.current = [];

    // New recorder: the chunks already captured can no longer be decoded
    // alone, their header being in the first of them.
    const stream = streamRef.current;
    const previous = recorderRef.current;
    if (!stream || !previous) return;
    if (previous.state === 'recording') previous.stop();

    const fresh = new MediaRecorder(stream);
    fresh.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    fresh.start(1000);
    recorderRef.current = fresh;
    startRef.current = Date.now();
  }, []);

  const release = useCallback(() => {
    if (partialTimerRef.current !== null) clearInterval(partialTimerRef.current);
    partialTimerRef.current = null;
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioRef.current?.close().catch(() => undefined);
    audioRef.current = null;
    setLevel(0);
  }, []);

  useEffect(
    () => () => {
      release();
      workerRef.current?.terminate();
    },
    [release],
  );

  /** Sound level snapshot: the on-screen wave really follows the voice. */
  const trackSound = (stream: MediaStream) => {
    const context = new AudioContext();
    audioRef.current = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    let lastRender = 0;
    /** Since when have we been in the current state, speech or silence? */
    let wasSpeaking = false;
    let since = 0;

    const loop = (timestamp: number) => {
      animationRef.current = requestAnimationFrame(loop);
      // About fifteen frames per second is enough for the eye and keeps typing smooth
      if (timestamp - lastRender < 66) return;
      lastRender = timestamp;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const sample of data) {
        const deviation = (sample - 128) / 128;
        sum += deviation * deviation;
      }
      const currentLevel = Math.min(1, Math.sqrt(sum / data.length) * 5);
      setLevel(currentLevel);

      // Automatic stop: first detect speech, then silence
      const speaking = currentLevel > VOICE_THRESHOLD;
      if (speaking !== wasSpeaking) {
        wasSpeaking = speaking;
        since = timestamp;
      }
      if (speaking) {
        if (!hasSpokenRef.current && timestamp - since > VOICE_DURATION) hasSpokenRef.current = true;
      } else if (hasSpokenRef.current && timestamp - since > SILENCE_DURATION) {
        hasSpokenRef.current = false;
        void stopRef.current?.();
      }
    };
    animationRef.current = requestAnimationFrame(loop);
  };

  const stop = useCallback(async () => {
    // Same rule on stop: what the user corrected or erased takes precedence
    rebaseIfEdited();
    const chunks = chunksRef.current;
    release();
    if (!chunks.length) {
      setStep('idle');
      return;
    }
    setStep('transcribing');
    try {
      const { id, text } = await transcribe(chunks);
      if (text && id === latestRef.current) write(baseRef.current + text);
    } catch (error) {
      toast.error(t('transcriptionFailed', { detail: error instanceof Error ? error.message : String(error) }));
    } finally {
      setStep('idle');
    }
  }, [write, rebaseIfEdited, release, transcribe, t]);

  const start = useCallback(
    async (value: string) => {
      // First action, without awaiting anything before: this is what triggers the
      // browser permission request at the moment the user clicks.
      const request = navigator.mediaDevices?.getUserMedia({ audio: true });
      if (!request) {
        toast.error(t('noMicrophoneApi'));
        return;
      }
      setStep('microphone');

      let stream: MediaStream;
      try {
        stream = await request;
      } catch (error) {
        const name = error instanceof DOMException ? error.name : '';
        /**
         * An already blocked site triggers no prompt: the browser
         * refuses silently. We must then say where to lift the block, otherwise
         * the user waits for a permission that will never come.
         */
        const blocked = name === 'NotAllowedError' && (await microphonePermission()) === 'denied';
        toast.error(
          blocked
            ? t('microphoneBlocked')
            : name === 'NotAllowedError'
              ? t('microphoneDenied')
              : name === 'NotFoundError'
                ? t('noMicrophone')
                : t('microphoneUnavailable'),
          { duration: 12_000 },
        );
        setStep('idle');
        return;
      }

      streamRef.current = stream;
      baseRef.current = value.trim() ? `${value.trimEnd()} ` : '';
      writtenRef.current = value;
      chunksRef.current = [];
      startRef.current = Date.now();
      partialsEnabledRef.current = true;
      hasSpokenRef.current = false;
      trackSound(stream);
      /**
       * The model is requested on press, without waiting for the first
       * transcription: it downloads while the user speaks, and the screen
       * can honestly announce that nothing will be transcribed before the end.
       */
      getWorker().postMessage({ preload: true });

      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      setStep('listening');

      /**
       * Partial transcriptions: re-transcribe from the start rather than
       * stitching chunks together, which avoids words cut at the joins.
       * Only one at a time, otherwise requests pile up faster than they
       * complete.
       */
      partialTimerRef.current = window.setInterval(() => {
        rebaseIfEdited();
        if (
          !readyRef.current ||
          busyRef.current ||
          partialsEnabledRef.current === false ||
          !chunksRef.current.length
        )
          return;
        if (Date.now() - startRef.current > PARTIAL_MAX_DURATION) return;
        busyRef.current = true;
        const startedAt = Date.now();
        void transcribe([...chunksRef.current])
          .then(({ id, text }) => {
            // Stale if a more recent request was sent in the meantime
            if (text && recorderRef.current && id === latestRef.current) {
              write(baseRef.current + text);
            }
            /**
             * On a machine without acceleration, a pass may last longer
             * than the interval: the preview would fall behind and
             * never catch up. It is dropped, since the full text arrives
             * on stop anyway.
             */
            if (Date.now() - startedAt > PARTIAL_GIVE_UP_THRESHOLD) partialsEnabledRef.current = false;
          })
          .catch(() => {
            partialsEnabledRef.current = false;
          })
          .finally(() => {
            busyRef.current = false;
          });
      }, PARTIAL_INTERVAL);
    },
    [getWorker, transcribe, t],
  );

  stopRef.current = stop;

  return {
    step,
    percent,
    accurate,
    ready,
    level,
    start,
    stop,
    listening: step === 'listening',
  };
}
