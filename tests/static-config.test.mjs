import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

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
    "/(.*)",
  ]);
  assert.equal(
    config.rewrites[1].destination,
    "https://irbtguncoatqfikctreq.supabase.co/functions/v1/short-links-resolve?code=:code",
  );
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
