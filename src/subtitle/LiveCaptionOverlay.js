import browser from "webextension-polyfill";
import {
  MSG_LOCAL_ASR_RESULT,
  MSG_LOCAL_ASR_STATE,
  MSG_LOCAL_ASR_ERROR,
} from "../config";

const ROOT_ID = "kiss-local-ai-live-caption";

function commonPrefixSuffixTrim(previous, current) {
  if (!previous || !current) return current;

  const prev = previous.trim();
  const cur = current.trim();

  // Character overlap works for Cantonese, Mandarin, and Japanese where
  // whitespace is not a reliable token boundary.
  const maxChars = Math.min(40, prev.length, cur.length);
  for (let n = maxChars; n >= 2; n--) {
    if (prev.slice(-n).toLocaleLowerCase() === cur.slice(0, n).toLocaleLowerCase()) {
      return cur.slice(n).trim() || cur;
    }
  }

  // Keep a word-level fallback for English and mixed-language speech.
  const prevWords = prev.split(/\s+/);
  const curWords = cur.split(/\s+/);
  const maxWords = Math.min(8, prevWords.length, curWords.length);
  for (let n = maxWords; n >= 1; n--) {
    if (
      prevWords.slice(-n).join(" ").toLocaleLowerCase() ===
      curWords.slice(0, n).join(" ").toLocaleLowerCase()
    ) {
      return curWords.slice(n).join(" ").trim() || cur;
    }
  }
  return cur;
}

function ensureOverlay() {
  let root = document.getElementById(ROOT_ID);
  if (root) return root;

  root = document.createElement("div");
  root.id = ROOT_ID;
  Object.assign(root.style, {
    position: "fixed",
    left: "50%",
    bottom: "9vh",
    transform: "translateX(-50%)",
    maxWidth: "min(900px, 88vw)",
    zIndex: "2147483647",
    pointerEvents: "none",
    textAlign: "center",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: "clamp(18px, 2.2vw, 34px)",
    fontWeight: "600",
    lineHeight: "1.35",
    color: "#fff",
    textShadow: "0 2px 5px rgba(0,0,0,.9)",
    background: "rgba(0,0,0,.62)",
    borderRadius: "10px",
    padding: "8px 14px",
    backdropFilter: "blur(6px)",
    display: "none",
  });
  document.documentElement.appendChild(root);
  return root;
}

export function startLiveCaptionOverlay() {
  let lastFinalText = "";
  let hideTimer = null;
  const root = ensureOverlay();

  browser.runtime.onMessage.addListener(({ action, args }) => {
    if (action === MSG_LOCAL_ASR_RESULT) {
      const raw = String(args?.text || "").trim();
      if (!raw) return;

      // Partial ASR messages replace the current in-progress line. Only a
      // completed chunk advances overlap de-duplication for the next chunk.
      const text = commonPrefixSuffixTrim(lastFinalText, raw) || raw;
      if (args?.final !== false) {
        lastFinalText = raw;
      }

      root.textContent = text;
      root.style.display = "block";
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        root.style.display = "none";
      }, 5000);
      return;
    }

    if (action === MSG_LOCAL_ASR_STATE) {
      if (args?.active) {
        root.textContent = "Local AI captions starting…";
        root.style.display = "block";
      } else {
        root.style.display = "none";
        lastFinalText = "";
      }
      return;
    }

    if (action === MSG_LOCAL_ASR_ERROR) {
      root.textContent = `Local AI captions: ${args?.message || "unknown error"}`;
      root.style.display = "block";
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        root.style.display = "none";
      }, 7000);
    }
  });
}
