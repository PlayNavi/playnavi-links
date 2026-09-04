import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const sha256 = async (path) => createHash("sha256")
  .update(await readFile(new URL(path, import.meta.url)))
  .digest("hex");

test("survey login reuses the reviewed App provider marks byte-for-byte", async () => {
  assert.equal(
    await sha256("../assets/icons/apple.png"),
    "ebc00067f204c9f44dda5d99def910e7d884556f46570092bf6fb75dc2ed7f91",
  );
  assert.equal(
    await sha256("../assets/icons/google.png"),
    "a0f46b17437d558e91660b02e9613d9feb746bb1cf6ed34c4c3b325b6762f983",
  );
});

test("survey login mirrors the App button and warning visual contract", async () => {
  const css = await readFile(new URL("../assets/site.css", import.meta.url), "utf8");
  assert.match(css, /#survey-title\s*\{[\s\S]*font-size: clamp\(32px, 8vw, 40px\)/);
  assert.match(css, /#survey-title::after\s*\{[\s\S]*background: linear-gradient/);
  assert.match(css, /\.oauth-actions\s*\{[^}]*width: min\(92vw, 420px\);[^}]*gap: 14px/);
  assert.match(css, /\.oauth\s*\{[^}]*height: 52px;[^}]*border: 2px solid #d6e0e5;[^}]*border-radius: 14px;[^}]*background: #f2f4f6;/);
  assert.match(css, /\.oauth-icon\s*\{[^}]*width: 30px;[^}]*height: 25px;[^}]*margin-right: 8px/);
  assert.match(css, /#survey-description\.auth-warning\s*\{[^}]*color: var\(--warning\);[^}]*font-weight: 700/);
});

test("Android association uses the reviewed Play App Signing certificate", async () => {
  const assetLinks = await readJson("../.well-known/assetlinks.json");
  assert.deepEqual(assetLinks[0].target.sha256_cert_fingerprints, [
    "FA:AD:DE:14:4B:F6:6C:23:C4:4A:4B:65:5D:CD:4A:2F:76:94:38:60:FD:DB:DE:C7:DC:04:1A:82:DF:7B:E4:A7",
  ]);
});

test("AASA includes short links without removing canonical routes", async () => {
  const aasa = await readJson("../.well-known/apple-app-site-association");
  assert.deepEqual(aasa.applinks.details[0].paths, [
    "/s/*",
    "/users/*",
    "/catalogs/*",
    "/game/*",
  ]);
});

test("production-only legacy routes stay ahead of safe fallbacks and the SPA", async () => {
  const config = await readJson("../vercel.json");
  const sources = config.rewrites.map(({ source }) => source);
  assert.deepEqual(sources, [
    "/auth/steam/callback",
    "/auth/steam/callback",
    "/auth/steam/callback",
    "/api/share-links/:code",
    "/api/share-links/:code",
    "/api/share-links/:code",
    "/api/surveys/:surveySlug/responses",
    "/api/surveys/:surveySlug",
    "/s/:code",
    "/surveys/:surveySlug",
    "/(.*)",
  ]);

  const productionHosts = ["links.playnavilab.com", "playnavi-links.vercel.app"];
  for (const source of ["/auth/steam/callback", "/api/share-links/:code"]) {
    const routes = config.rewrites.filter((route) => route.source === source);
    assert.deepEqual(
      routes.slice(0, 2).map((route) => route.has),
      productionHosts.map((host) => [{ type: "host", value: host }]),
    );
    assert.match(routes[0].destination, /^https:\/\/irbtguncoatqfikctreq\.supabase\.co\//);
    assert.equal(routes[1].destination, routes[0].destination);
    assert.equal(routes[2].destination, "/api/legacy-route-disabled");
    assert.equal(routes[2].has, undefined);
  }
});

test("dynamic survey API routes are explicitly mapped before the SPA fallback", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const routes = config.rewrites;
  const responseRoute = routes.findIndex(
    (entry) => entry.source === "/api/surveys/:surveySlug/responses",
  );
  const readRoute = routes.findIndex(
    (entry) => entry.source === "/api/surveys/:surveySlug",
  );
  const spaRoute = routes.findIndex((entry) => entry.source === "/(.*)");

  assert.ok(responseRoute >= 0);
  assert.ok(readRoute >= 0);
  assert.ok(spaRoute >= 0);
  assert.equal(routes[responseRoute].destination, "/api/surveys/[surveySlug]/responses");
  assert.equal(routes[readRoute].destination, "/api/surveys/[surveySlug]");
  assert.ok(responseRoute < readRoute);
  assert.ok(readRoute < spaRoute);
});

test("survey pages receive strict privacy and script policies", async () => {
  const config = await readJson("../vercel.json");
  const surveyHeaders = Object.fromEntries(
    config.headers.find((entry) => entry.source === "/surveys/(.*)").headers
      .map(({ key, value }) => [key, value]),
  );
  assert.equal(surveyHeaders["Cache-Control"], "no-store");
  assert.equal(surveyHeaders["Referrer-Policy"], "no-referrer");
  assert.match(surveyHeaders["Content-Security-Policy"], /script-src 'self'/);
  assert.doesNotMatch(surveyHeaders["Content-Security-Policy"], /unsafe-inline|https?:/);

  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /<style|<script(?![^>]*\bsrc=)/);
});

test("short-link documents and proxy responses are not cached or indexed", async () => {
  const config = await readJson("../vercel.json");
  for (const source of ["/s/(.*)", "/api/share-links/(.*)"]) {
    const headers = Object.fromEntries(
      config.headers.find((entry) => entry.source === source).headers.map(({ key, value }) => [key, value]),
    );
    assert.equal(headers["Cache-Control"], "no-store");
    assert.equal(headers["Referrer-Policy"], "no-referrer");
    assert.equal(headers["X-Robots-Tag"], "noindex, nofollow");
  }
});

test("user copy avoids version labels and store navigation remains explicit", async () => {
  const app = await readFile(new URL("../assets/app.mjs", import.meta.url), "utf8");
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(`${app}\n${html}`, /新版|旧版|旧Store/);
  assert.match(
    app,
    /未ログインの場合は、ログイン後にこのリンクをもう一度開く必要があることがあります。/,
  );
  assert.doesNotMatch(app, /window\.location\.(?:href|replace)\s*=.*(?:APP_STORE|PLAY_STORE)/);
});

test("survey code loads only on survey routes and login copy matches stored-data behavior", async () => {
  const app = await readFile(new URL("../assets/app.mjs", import.meta.url), "utf8");
  const surveyApp = await readFile(new URL("../assets/survey-app.mjs", import.meta.url), "utf8");
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.doesNotMatch(app, /import\s*\{\s*startSurvey\s*\}\s*from/);
  assert.match(app, /const \{ startSurvey \} = await import\("\.\/survey-app\.mjs"\)/);
  assert.match(
    app,
    /if \(surveyMatch\) \{\s*void startSurveyRoute\(surveyMatch\[1\]\);\s*return;/,
  );
  assert.match(app, /showSurveyBootstrapFailure/);

  assert.match(
    html,
    /アカウントに紐づく報酬をご提供するため、ログインをお願いします。/,
  );
  assert.match(
    html,
    /回答内容は他のユーザーには公開されず、個人が分からない形で集計・利用します。/,
  );
  const loginNotice = html.match(/<ul class="login-notice">([\s\S]*?)<\/ul>/)?.[1] || "";
  const noticeItems = [...loginNotice.matchAll(/<li(?: [^>]*)?>(.*?)<\/li>/g)].map((match) => match[1].trim());
  assert.deepEqual(noticeItems, [
    "アカウントに紐づく報酬をご提供するため、ログインをお願いします。",
    "回答内容は他のユーザーには公開されず、個人が分からない形で集計・利用します。",
    "",
  ]);
  assert.match(html, /<li id="survey-guide" class="hidden"><\/li>/);
  assert.match(html, /<img class="oauth-icon google-icon" src="\/assets\/icons\/google\.png" alt="" aria-hidden="true">/);
  assert.match(html, /<img class="oauth-icon apple-icon" src="\/assets\/icons\/apple\.png" alt="" aria-hidden="true">/);
  assert.match(html, /報酬なしでログインせずに回答する/);
  assert.match(surveyApp, /title: preview\?\.title \|\| "アンケート"/);
  assert.ok(html.indexOf('id="apple-login"') < html.indexOf('id="google-login"'));
  assert.match(surveyApp, /descriptionTone: failed \? "warning" : "default"/);
  assert.match(surveyApp, /classList\.toggle\("auth-warning", descriptionTone === "warning"\)/);
  assert.match(surveyApp, /setAttribute\("role", "alert"\)/);
  assert.match(surveyApp, /removeAttribute\("role"\)/);
  assert.doesNotMatch(html, /PlayNaviの登録時と同じログイン方法/);
  assert.doesNotMatch(html, /アンケート内容は匿名での回答になります。/);
});
