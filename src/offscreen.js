import browser from "webextension-polyfill";
import {
  MSG_LOCAL_ASR_OFFSCREEN_START,
  MSG_LOCAL_ASR_OFFSCREEN_STOP,
  MSG_LOCAL_ASR_RESULT,
  MSG_LOCAL_ASR_ERROR,
} from "./config";

globalThis.__KISS_CONTEXT__ = "offscreen";

const ASR_URL = "http://127.0.0.1:8082/v1/audio/transcriptions";
const TARGET_SAMPLE_RATE = 16000;

let session = null;

function concatFloat32(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function downsample(input, inputRate, outputRate = TARGET_SAMPLE_RATE) {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end && j < input.length; j++) sum += input[j];
    output[i] = sum / Math.max(1, Math.min(end, input.length) - start);
  }
  return output;
}

function encodeWav(samples, sampleRate = TARGET_SAMPLE_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function transcribe(wav, language) {
  const form = new FormData();
  form.append("file", wav, "live.wav");
  form.append("response_format", "json");
  form.append("temperature", "0");
  if (language && language !== "auto") form.append("language", language);

  const response = await fetch(ASR_URL, {
    method: "POST",
    body: form,
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`ASR HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  const json = await response.json();
  return String(json?.text || json?.content || "").trim();
}

async function processQueue(current) {
  if (current.processing) return;
  current.processing = true;
  try {
    while (current.queue.length && session === current) {
      const item = current.queue.shift();
      try {
        const text = await transcribe(item.wav, current.language);
        if (text && session === current) {
          await browser.runtime.sendMessage({
            action: MSG_LOCAL_ASR_RESULT,
            args: {
              tabId: current.tabId,
              text,
              startedAt: item.startedAt,
              endedAt: item.endedAt,
              final: true,
            },
          });
        }
      } catch (err) {
        if (session === current) {
          await browser.runtime.sendMessage({
            action: MSG_LOCAL_ASR_ERROR,
            args: { tabId: current.tabId, message: err?.message || String(err) },
          }).catch(() => undefined);
        }
      }
    }
  } finally {
    current.processing = false;
  }
}

function enqueueChunk(current, floatSamples, startedAt, endedAt) {
  const pcm16k = downsample(floatSamples, current.audioContext.sampleRate);
  const wav = encodeWav(pcm16k);
  current.queue.push({ wav, startedAt, endedAt });
  while (current.queue.length > 2) current.queue.shift();
  processQueue(current);
}

async function stopSession() {
  const current = session;
  session = null;
  if (!current) return;

  try { current.processor?.disconnect(); } catch {}
  try { current.source?.disconnect(); } catch {}
  try { current.stream?.getTracks()?.forEach((track) => track.stop()); } catch {}
  try { await current.audioContext?.close(); } catch {}
}

async function startSession({ streamId, tabId, chunkMs = 2200, overlapMs = 300, language = "auto" }) {
  await stopSession();

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  const audioContext = new AudioContext();
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);

  // Capturing a tab can otherwise mute it. Route the captured stream back to output.
  source.connect(audioContext.destination);
  source.connect(processor);
  processor.connect(audioContext.destination);

  const current = {
    stream,
    audioContext,
    source,
    processor,
    tabId,
    language,
    chunkMs,
    overlapMs,
    chunks: [],
    sampleCount: 0,
    queue: [],
    processing: false,
    chunkStartedAt: performance.now(),
  };
  session = current;

  processor.onaudioprocess = (event) => {
    if (session !== current) return;
    const input = event.inputBuffer.getChannelData(0);
    current.chunks.push(new Float32Array(input));
    current.sampleCount += input.length;

    const needed = Math.floor((current.chunkMs / 1000) * audioContext.sampleRate);
    if (current.sampleCount < needed) return;

    const combined = concatFloat32(current.chunks);
    const endedAt = performance.now();
    enqueueChunk(current, combined, current.chunkStartedAt, endedAt);

    const overlapSamples = Math.min(
      combined.length,
      Math.floor((current.overlapMs / 1000) * audioContext.sampleRate)
    );
    const overlap = combined.slice(combined.length - overlapSamples);
    current.chunks = overlap.length ? [overlap] : [];
    current.sampleCount = overlap.length;
    current.chunkStartedAt = endedAt - current.overlapMs;
  };
}

browser.runtime.onMessage.addListener(({ action, args }) => {
  if (action === MSG_LOCAL_ASR_OFFSCREEN_START) {
    return startSession(args || {}).then(() => ({ ok: true }));
  }
  if (action === MSG_LOCAL_ASR_OFFSCREEN_STOP) {
    return stopSession().then(() => ({ ok: true }));
  }
  return undefined;
});
