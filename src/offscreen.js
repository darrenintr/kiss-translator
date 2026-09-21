import browser from "webextension-polyfill";
import {
  MSG_LOCAL_ASR_OFFSCREEN_START,
  MSG_LOCAL_ASR_OFFSCREEN_STOP,
  MSG_LOCAL_ASR_RESULT,
  MSG_LOCAL_ASR_ERROR,
} from "./config";

globalThis.__KISS_CONTEXT__ = "offscreen";

const ASR_URL = "http://127.0.0.1:8082/v1/audio/transcriptions";
const GEMMA4_URL = "http://127.0.0.1:8083/v1/chat/completions";
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

const ASR_LANGUAGE_CODES = new Map([
  ["chinese", "zh"],
  ["english", "en"],
  ["cantonese", "yue"],
  ["arabic", "ar"],
  ["german", "de"],
  ["french", "fr"],
  ["spanish", "es"],
  ["portuguese", "pt"],
  ["indonesian", "id"],
  ["italian", "it"],
  ["korean", "ko"],
  ["russian", "ru"],
  ["thai", "th"],
  ["vietnamese", "vi"],
  ["japanese", "ja"],
  ["turkish", "tr"],
  ["hindi", "hi"],
  ["malay", "ms"],
  ["dutch", "nl"],
  ["swedish", "sv"],
  ["danish", "da"],
  ["finnish", "fi"],
  ["polish", "pl"],
  ["czech", "cs"],
  ["filipino", "fil"],
  ["persian", "fa"],
  ["greek", "el"],
  ["hungarian", "hu"],
  ["macedonian", "mk"],
  ["romanian", "ro"],
]);

function normalizeAsrLanguage(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (ASR_LANGUAGE_CODES.has(lower)) return ASR_LANGUAGE_CODES.get(lower);
  if (/^[a-z]{2,3}(?:-[a-z0-9]+)?$/i.test(raw)) return lower;
  return "";
}

function parseAsrResponse(json) {
  const rawText = String(json?.text || json?.content || "").trim();
  const tagged = rawText.match(
    /^language\s+([^<\n]+)<asr_text>([\s\S]*)$/i
  );
  const languageName = String(
    json?.language || tagged?.[1] || ""
  ).trim();
  return {
    text: String(tagged?.[2] ?? rawText).trim(),
    detectedLanguage: normalizeAsrLanguage(languageName),
    detectedLanguageName: languageName,
  };
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function parseGemma4Response(json) {
  const raw = String(json?.choices?.[0]?.message?.content || "").trim();
  if (!raw) return { text: "", translation: "" };

  const fenced = raw.match(/\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`/i);
  const candidate = String(fenced?.[1] || raw).trim();
  try {
    const parsed = JSON.parse(candidate);
    return {
      text: String(parsed?.transcript || parsed?.text || "").trim(),
      translation: String(
        parsed?.translation || parsed?.traditional_chinese || ""
      ).trim(),
      detectedLanguage: normalizeAsrLanguage(parsed?.language || ""),
      detectedLanguageName: String(parsed?.language || "").trim(),
    };
  } catch {
    const transcript = raw.match(
      /(?:^|\n)\s*(?:transcript|original)\s*:\s*([^\n]+)/i
    )?.[1];
    const translation = raw.match(
      /(?:^|\n)\s*(?:translation|traditional chinese|繁體中文)\s*:\s*([^\n]+)/i
    )?.[1];
    return {
      text: String(transcript || raw).trim(),
      translation: String(translation || "").trim(),
      detectedLanguage: "",
      detectedLanguageName: "",
    };
  }
}

async function transcribeWithGemma4(wav, language) {
  const audio = await blobToBase64(wav);
  const languageHint =
    language && language !== "auto"
      ? `The expected spoken language code is ${language}. `
      : "";

  const response = await fetch(GEMMA4_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      temperature: 0,
      max_tokens: 160,
      response_format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            language: { type: "string" },
            transcript: { type: "string" },
            translation: { type: "string" },
          },
          required: ["language", "transcript", "translation"],
          additionalProperties: false,
        },
      },
      messages: [
        {
          role: "user",
          content: [
            // Match llama.cpp's own multimodal CLI ordering: media first,
            // instruction second. Gemma 4 is sensitive to the media marker
            // position and can otherwise behave as if no audio was provided.
            {
              type: "input_audio",
              input_audio: {
                data: audio,
                format: "wav",
              },
            },
            {
              type: "text",
              text:
                languageHint +
                "Transcribe the spoken words in the audio exactly. Then translate that transcript naturally into Traditional Chinese used in Taiwan. Keep product names, interface names, units, numbers, and technical terminology accurate. Return only the requested JSON object.",
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Gemma 4 HTTP ${response.status}: ${body.slice(0, 300)}`
    );
  }
  return parseGemma4Response(await response.json());
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
  return parseAsrResponse(await response.json());
}

async function processQueue(current) {
  if (current.processing) return;
  current.processing = true;
  try {
    while (current.queue.length && session === current) {
      const item = current.queue.shift();
      try {
        const result =
          current.engine === "gemma4"
            ? await transcribeWithGemma4(item.wav, current.language)
            : await transcribe(item.wav, current.language);
        if (result.text && session === current) {
          await browser.runtime.sendMessage({
            action: MSG_LOCAL_ASR_RESULT,
            args: {
              tabId: current.tabId,
              text: result.text,
              detectedLanguage: result.detectedLanguage,
              detectedLanguageName: result.detectedLanguageName,
              translation: result.translation || "",
              engine: current.engine,
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

async function startSession({
  streamId,
  tabId,
  chunkMs = 2200,
  overlapMs = 300,
  language = "auto",
  engine = "gemma4",
}) {
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
    engine,
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
