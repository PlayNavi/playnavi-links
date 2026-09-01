import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

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

test("specific proxy and Steam routes stay ahead of the static catch-all", async () => {
  const config = await readJson("../vercel.json");
  const sources = config.rewrites.map(({ source }) => source);
  assert.deepEqual(sources, [
    "/auth/steam/callback",
    "/api/share-links/:code",
    "/s/:code",
    "/surveys/:surveySlug",
    "/(.*)",
  ]);
  assert.equal(
    config.rewrites[1].destination,
    "https://irbtguncoatqfikctreq.supabase.co/functions/v1/short-links-resolve?code=:code",
  );
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
