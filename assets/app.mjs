import {
  ResolveError,
  canonicalTargetFromPath,
  resolveShortLink,
  shortCodeFromPath,
} from "./link-routing.mjs";

const APP_STORE_URL = "https://apps.apple.com/jp/app/playnavi/id6756201875";
const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.playnavilab.playnavi.app";
const IOS_OPEN_APP_ORIGIN = "https://playnavi-links.vercel.app";
const LAUNCH_TIMEOUT_MS = 2000;
const RESOLVE_TIMEOUT_MS = 10000;

const elements = {
  spinner: document.getElementById("spinner"),
  heading: document.getElementById("heading"),
  description: document.getElementById("description"),
  primary: document.getElementById("primary-btn"),
  retry: document.getElementById("retry-btn"),
  stores: document.getElementById("store-buttons"),
  iosStore: document.getElementById("ios-store-btn"),
  androidStore: document.getElementById("android-store-btn"),
};

function detectPlatform(ua) {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

const platform = detectPlatform(navigator.userAgent || "");

function setVisible(element, visible) {
  if (element) element.classList.toggle("hidden", !visible);
}

function setContent({ heading, description, loading = false }) {
  if (elements.heading) elements.heading.textContent = heading;
  if (elements.description) elements.description.textContent = description;
  setVisible(elements.spinner, loading);
}

function configurePrimary(label, href) {
  if (!elements.primary) return;
  elements.primary.textContent = label;
  elements.primary.href = href;
  setVisible(elements.primary, true);
}

function hideActions() {
  setVisible(elements.primary, false);
  setVisible(elements.retry, false);
  setVisible(elements.stores, false);
}

function showStores() {
  if (elements.iosStore) elements.iosStore.href = APP_STORE_URL;
  if (elements.androidStore) elements.androidStore.href = PLAY_STORE_URL;
  setVisible(elements.iosStore, platform !== "android");
  setVisible(elements.androidStore, platform !== "ios");
  setVisible(elements.stores, true);
}

function showHome() {
  hideActions();
  setContent({
    heading: "ゲームとの出会いを、もっと楽しく",
    description: "PlayNaviは、ゲーム探しやプレイ記録を楽しむためのアプリです。",
  });
  configurePrimary("PlayNaviアプリを開く", "playnavi://");
  showStores();
}

function showFailure(kind, retry) {
  hideActions();
  setContent(
    kind === "unavailable"
      ? {
          heading: "リンクを開けません",
          description: "リンクが無効になっているか、公開されていない可能性があります。",
        }
      : {
          heading: "一時的にリンクを開けません",
          description: "通信状況をご確認のうえ、もう一度お試しください。",
        },
  );
  if (kind === "temporary" && elements.retry) {
    elements.retry.onclick = retry;
    setVisible(elements.retry, true);
  } else {
    configurePrimary("PlayNaviについて", "/");
  }
}

function manualHrefForCanonical(target) {
  // Preserve the existing iOS cross-domain handoff for canonical links. The
  // alternate host ultimately opens the same allowlisted playnavi:// target.
  if (platform === "ios" && window.location.origin !== IOS_OPEN_APP_ORIGIN) {
    return `${IOS_OPEN_APP_ORIGIN}${target.canonicalPath}`;
  }
  return target.schemeUrl;
}

function openCanonicalTarget(target) {
  hideActions();
  setContent({
    heading: "PlayNaviを起動しています…",
    description:
      "自動的に開かない場合は、下のボタンをタップしてください。未ログインの場合は、ログイン後にこのリンクをもう一度開く必要があることがあります。",
    loading: true,
  });
  configurePrimary("PlayNaviアプリで開く", manualHrefForCanonical(target));

  if (platform === "other") {
    setContent({
      heading: "PlayNaviでリンクを開く",
      description:
        "スマートフォンでこのリンクを開いてください。未ログインの場合は、ログイン後にこのリンクをもう一度開く必要があることがあります。",
    });
    setVisible(elements.primary, false);
    showStores();
    return;
  }

  let appLaunched = false;
  const markLaunched = () => {
    appLaunched = true;
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) markLaunched();
  });
  window.addEventListener("pagehide", markLaunched, { once: true });
  window.addEventListener("blur", markLaunched, { once: true });

  window.location.href = target.schemeUrl;
  window.setTimeout(() => {
    if (appLaunched) return;
    setContent({
      heading: "PlayNaviでリンクを開く",
      description:
        "「PlayNaviアプリで開く」をタップしてください。未ログインの場合は、ログイン後にこのリンクをもう一度開く必要があることがあります。",
    });
    showStores();
  }, LAUNCH_TIMEOUT_MS);
}

async function openShortLink(code) {
  hideActions();
  setContent({
    heading: "リンクを確認しています…",
    description: "そのままお待ちください。",
    loading: true,
  });

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
  try {
    const target = await resolveShortLink(code, { signal: controller.signal });
    window.clearTimeout(timeout);

    // Make the exact resolved target available as an explicit custom-scheme
    // action before attempting the canonical Universal/App Link handoff.
    setContent({
      heading: "PlayNaviでリンクを開く",
      description:
        "自動的に開かない場合は、下のボタンをタップしてください。未ログインの場合は、ログイン後にこのリンクをもう一度開く必要があることがあります。",
    });
    configurePrimary("PlayNaviアプリで開く", target.schemeUrl);

    // A distributed app already understands links.playnavilab.com canonical
    // routes. Never hand `/s/{code}` to the custom scheme.
    window.setTimeout(() => window.location.replace(target.canonicalUrl), 50);
  } catch (error) {
    window.clearTimeout(timeout);
    const kind = error instanceof ResolveError ? error.kind : "temporary";
    showFailure(kind, () => openShortLink(code));
  }
}

function start() {
  const path = window.location.pathname;
  if (path === "/" || path === "") {
    showHome();
    return;
  }

  if (path.startsWith("/s/")) {
    const code = shortCodeFromPath(path);
    if (!code) {
      showFailure("unavailable");
      return;
    }
    openShortLink(code);
    return;
  }

  const target = canonicalTargetFromPath(`${path}${window.location.search}`);
  if (target) {
    openCanonicalTarget(target);
    return;
  }

  showFailure("unavailable");
}

start();
