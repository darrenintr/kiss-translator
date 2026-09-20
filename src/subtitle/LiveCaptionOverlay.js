import browser from "webextension-polyfill";
import {
  MSG_LOCAL_ASR_RESULT,
  MSG_LOCAL_ASR_STATE,
  MSG_LOCAL_ASR_ERROR,
} from "../config";

const ROOT_ID = "kiss-local-ai-live-caption";

function commonPrefixSuffixTrim(previous, current) {
  if (!previous || !current) return current;
  const prevWords = previous.trim().split(/\s+/);
  const curWords = current.trim().split(/\s+/);
  let best = 0;
  const max = Math.min(8, prevWords.length, curWords.length);
  for (let n = 1; n <= max; n++) {
    if (
      prevWords.slice(-n).join(" ").toLowerCase() ===
      curWords.slice(0, n).join(" ").toLowerCase()
    ) {
      best = n;
    }
  }
  return curWords.slice(best).join(" ");
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
  let lastText = "";
  let hideTimer = null;
  const root = ensureOverlay();

  browser.runtime.onMessage.addListener(({ action, args }) => {
    if (action === MSG_LOCAL_ASR_RESULT) {
      const raw = String(args?.text || "").trim();
      if (!raw) return;
      const text = commonPrefixSuffixTrim(lastText, raw) || raw;
      lastText = raw;
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
        lastText = "";
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
