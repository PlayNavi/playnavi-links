import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

class FakeElement {
  constructor(hidden = false) {
    this.hidden = hidden;
    this.textContent = "";
    this.href = "";
    this.onclick = null;
    this.classList = {
      toggle: (name, force) => {
        if (name === "hidden") this.hidden = force;
      },
    };
  }
}

function installBrowser(pathname) {
  const initiallyHidden = new Set([
    "primary-btn",
    "retry-btn",
    "store-buttons",
    "ios-store-btn",
    "android-store-btn",
    "survey-view",
    "survey-login",
    "survey-form",
    "survey-result",
    "survey-retry",
  ]);
  const elements = new Map();
  const getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, new FakeElement(initiallyHidden.has(id)));
    return elements.get(id);
  };
  for (const id of initiallyHidden) getElementById(id);
  const location = {
    pathname,
    search: "",
    hash: "",
    origin: "https://links.playnavilab.com",
    href: "",
    reloadCalled: false,
    replace() {},
    reload() {
      this.reloadCalled = true;
    },
  };
  const previous = {
    document: globalThis.document,
    navigator: globalThis.navigator,
    window: globalThis.window,
  };
  Object.defineProperties(globalThis, {
    document: {
      configurable: true,
      value: {
        hidden: false,
        getElementById,
        addEventListener() {},
      },
    },
    navigator: { configurable: true, value: { userAgent: "node-test" } },
    window: {
      configurable: true,
      value: {
        location,
        history: { replaceState() {} },
        matchMedia: () => ({ matches: false }),
        addEventListener() {},
        setTimeout,
      },
    },
  });
  return {
    elements,
    location,
    restore() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key];
        else Object.defineProperty(globalThis, key, { configurable: true, value });
      }
    },
  };
}

async function importEntrypointWithoutSurvey(pathname) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "playnavi-links-entrypoint-"));
  await copyFile(new URL("../assets/app.mjs", import.meta.url), path.join(temp, "app.mjs"));
  await copyFile(
    new URL("../assets/link-routing.mjs", import.meta.url),
    path.join(temp, "link-routing.mjs"),
  );
  const browser = installBrowser(pathname);
  try {
    await import(`${pathToFileURL(path.join(temp, "app.mjs")).href}?case=${Date.now()}`);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    return { browser, temp };
  } catch (error) {
    browser.restore();
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
}

test("home route starts even when the Survey module is unavailable", async () => {
  const { browser, temp } = await importEntrypointWithoutSurvey("/");
  try {
    assert.equal(browser.elements.get("heading").textContent, "ゲームとの出会いを、もっと楽しく");
    assert.equal(browser.elements.get("primary-btn").hidden, false);
    assert.equal(browser.elements.get("survey-view").hidden, true);
  } finally {
    browser.restore();
    await rm(temp, { recursive: true, force: true });
  }
});

test("survey route contains a missing Survey module and offers a page reload", async () => {
  const { browser, temp } = await importEntrypointWithoutSurvey("/surveys/campaign-2026");
  try {
    assert.equal(browser.elements.get("link-view").hidden, true);
    assert.equal(browser.elements.get("survey-view").hidden, false);
    assert.equal(browser.elements.get("survey-loading").hidden, true);
    assert.equal(browser.elements.get("survey-login").hidden, true);
    assert.equal(browser.elements.get("survey-form").hidden, true);
    assert.equal(browser.elements.get("survey-result").hidden, true);
    assert.equal(browser.elements.get("survey-title").textContent, "アンケートを開けません");
    assert.equal(browser.elements.get("survey-retry").hidden, false);
    browser.elements.get("survey-retry").onclick();
    assert.equal(browser.location.reloadCalled, true);
  } finally {
    browser.restore();
    await rm(temp, { recursive: true, force: true });
  }
});
