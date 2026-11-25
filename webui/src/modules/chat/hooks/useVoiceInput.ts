import { useCallback, useEffect, useRef, useState } from 'react';

import { transcribeVoice } from '@/shared/api';
import type { VoiceInputState } from '@/shared/types';

// Mobile-safe recording: iOS Safari 18.4+ supports webm/opus; older iOS needs mp4.
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

function pickMime(): string {
  for (const t of MIME_CANDIDATES) {
    try {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* isTypeSupported can throw on some iOS versions */
    }
  }
  return '';
}


type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognitionConstructor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

/**
 * Push-to-talk dictation. Supports browser-native SpeechRecognition (zero-config)
 * as well as MediaRecorder -> /api/voice/transcribe.
 */
export function useVoiceInput(
  onTranscript: (text: string, send?: boolean) => void,
  onError?: (msg: string) => void,
) {
  const [state, setState] = useState<VoiceInputState>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const speechBufferRef = useRef('');
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);
  const startingRef = useRef(false);
  // Whether the in-progress stop should auto-send the transcript (vs just fill the box).
  const sendRef = useRef(false);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Stop the mic if the component unmounts mid-recording.
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      startingRef.current = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    if (startingRef.current || (recorderRef.current && recorderRef.current.state !== 'inactive')) return;
    startingRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (cancelledRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = pickMime();
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      rec.onstop = async () => {
        stopTracks();
        if (cancelledRef.current) return;
        // Capture and clear the send intent for this stop before any async work.
        const shouldSend = sendRef.current;
        sendRef.current = false;
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size < 800) {
          setState('idle');
          onError?.('录音时间太短');
          return;
        }
        setState('transcribing');
        try {
          const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
          const res = await transcribeVoice(blob, `recording.${ext}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (cancelledRef.current) return;
          const text = String(data?.text || '').trim();
          if (text) onTranscript(text, shouldSend);
          else onError?.('未检测到语音内容');
        } catch (e) {
          if (!cancelledRef.current) {
            onError?.(`语音转写失败: ${e instanceof Error ? e.message : String(e)}`);
          }
        } finally {
          if (!cancelledRef.current) setState('idle');
        }
      };

      rec.start();
      setState('recording');
    } catch (e) {
      recorderRef.current = null;
      stopTracks();
      if (cancelledRef.current) return;

      // 若 MediaRecorder 受限但浏览器支持原生 SpeechRecognition，自动降级为原生实时听写
      const SpeechCtor = getSpeechRecognitionConstructor();
      if (SpeechCtor) {
        try {
          const recognition = new SpeechCtor();
          recognition.lang = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'zh-CN';
          recognition.continuous = true;
          recognition.interimResults = true;
          speechBufferRef.current = '';
          speechRef.current = recognition;

          recognition.onresult = (event) => {
            let finalStr = '';
            for (let i = 0; i < event.results.length; i += 1) {
              const item = event.results[i];
              if (item && item[0]?.transcript) {
                finalStr += item[0].transcript;
              }
            }
            speechBufferRef.current = finalStr.trim();
          };
          recognition.onerror = (ev) => {
            speechRef.current = null;
            if (!cancelledRef.current) {
              const code = ev?.error || '未知错误';
              const friendly =
                code === 'not-allowed' || code === 'service-not-allowed'
                  ? '麦克风未授权（请检查系统权限或使用 HTTPS 访问）'
                  : `语音识别异常: ${code}`;
              onError?.(friendly);
              setState('idle');
            }
          };
          recognition.onend = () => {
            speechRef.current = null;
            if (cancelledRef.current) return;
            const shouldSend = sendRef.current;
            sendRef.current = false;
            const text = speechBufferRef.current.trim();
            speechBufferRef.current = '';
            if (text) onTranscript(text, shouldSend);
            setState('idle');
          };

          recognition.start();
          setState('recording');
          return;
        } catch (_) {
          speechRef.current = null;
        }
      }

      const err = e as { name?: string; message?: string };
      let msg = `麦克风错误: ${err?.message || e}`;
      if (err?.name === 'NotAllowedError') msg = '请先允许麦克风权限';
      else if (err?.name === 'NotFoundError') msg = '未检测到麦克风设备';
      onError?.(msg);
      setState('idle');
    } finally {
      startingRef.current = false;
    }
  }, [onTranscript, onError]);

  // Stop recording. Pass { send: true } to auto-send the transcript once it's ready.
  // Guard on the recorder's own state (not React state) so a double tap, or the mic
  // and Send buttons both firing, can't call stop() on an already-inactive recorder.
  const stop = useCallback((opts?: { send?: boolean }) => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      sendRef.current = opts?.send ?? false;
      rec.stop();
      return;
    }
    const speech = speechRef.current;
    if (speech) {
      sendRef.current = opts?.send ?? false;
      speech.stop();
    }
  }, []);

  const toggle = useCallback(() => {
    if (state === 'recording') stop();
    else if (state === 'idle') start();
  }, [state, start, stop]);

  return { state, toggle, stop };
}
