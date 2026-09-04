import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { importSPKI, jwtVerify } from "jose";

import {
  createAppleClientSecret,
  createAuthorization,
  exchangeProviderCode,
  readOAuthState,
  setOAuthState,
} from "../api/_lib/auth.mjs";
import {
  isSurveyKey,
  parseCookies,
  safeReturnPath,
  serializeCookie,
} from "../api/_lib/http.mjs";
import legacyRouteDisabled from "../api/legacy-route-disabled.mjs";

function mockResponse() {
  const headers = new Map();
  return {
    getHeader: (name) => headers.get(name.toLowerCase()),
    setHeader: (name, value) => headers.set(name.toLowerCase(), value),
    headers,
  };
}

test("non-production hosts cannot reach production legacy backends", () => {
  const response = mockResponse();
  response.status = (status) => {
    response.statusCode = status;
    return response;
  };
  response.json = (payload) => {
    response.payload = payload;
    return response;
  };

  legacyRouteDisabled({}, response);

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.payload, { status: "not_found" });
  assert.equal(response.getHeader("Cache-Control"), "private, no-store, max-age=0");
});

test("cookie helpers preserve Host-prefix invariants", () => {
  const cookie = serializeCookie("__Host-pn_survey_session", "opaque_token", {
    path: "/",
    maxAge: 300,
  });
  assert.match(cookie, /^__Host-pn_survey_session=opaque_token; Path=\/;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.equal(parseCookies("__Host-pn_survey_session=opaque_token")["__Host-pn_survey_session"], "opaque_token");
  assert.throws(() => serializeCookie("__Host-bad", "x", { path: "/api" }));
});

test("survey slug matches the App, DB, and Edge lowercase contract", () => {
  assert.equal(isSurveyKey("launch-2026"), true);
  assert.equal(isSurveyKey("a".repeat(63)), true);
  for (const invalid of ["Launch-2026", "launch_2026", "-launch", "a".repeat(64)]) {
    assert.equal(isSurveyKey(invalid), false, invalid);
  }
  assert.equal(safeReturnPath("/surveys/launch-2026"), "/surveys/launch-2026");
  assert.equal(safeReturnPath("/surveys/Launch-2026"), null);
});

test("OAuth state is short-lived, Host-only, and readable only from its cookie", () => {
  const response = mockResponse();
  const authorization = createAuthorization("google", {
    clientId: "google-client-id",
    clientSecret: "server-only",
  }, "https://links.playnavilab.com/api/auth/callback", "/surveys/launch-2026");
  setOAuthState(response, authorization.state);

  const redirect = new URL(authorization.url);
  assert.equal(redirect.origin, "https://accounts.google.com");
  assert.equal(redirect.searchParams.get("code_challenge_method"), "S256");
  assert.equal(redirect.searchParams.get("nonce"), authorization.state.nonce);
  assert.notEqual(redirect.searchParams.get("code_challenge"), authorization.state.codeVerifier);

  const cookie = response.getHeader("Set-Cookie");
  assert.equal(typeof cookie, "string");
  assert.match(cookie, /^__Host-pn_oauth_state=/);
  assert.match(cookie, /Max-Age=600/);
  assert.match(cookie, /Path=\/;/);
  const cookiePair = cookie.split(";", 1)[0];
  assert.deepEqual(readOAuthState({ headers: { cookie: cookiePair } }), authorization.state);
});

test("Apple uses only documented authorization parameters", () => {
  const authorization = createAuthorization("apple", {
    clientId: "com.playnavi.web",
    clientSecret: "server-only",
  }, "https://links.playnavilab.com/api/auth/callback", "/surveys/launch-2026");
  const redirect = new URL(authorization.url);
  assert.equal(redirect.origin, "https://appleid.apple.com");
  assert.equal(redirect.searchParams.get("response_type"), "code");
  assert.equal(redirect.searchParams.get("response_mode"), "query");
  assert.equal(redirect.searchParams.get("scope"), null);
  assert.equal(redirect.searchParams.get("code_challenge"), null);
});

test("Apple client secrets are generated just in time from the long-lived private key", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const providerConfig = {
    clientId: "com.playnavilab.playnavi.survey.stg",
    teamId: "9GSX6744M2",
    keyId: "A1B2C3D4E5",
    privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
  const issuedAt = 1_800_000_000;
  const clientSecret = await createAppleClientSecret(providerConfig, issuedAt);
  const verificationKey = await importSPKI(
    publicKey.export({ format: "pem", type: "spki" }).toString(),
    "ES256",
  );
  const { payload, protectedHeader } = await jwtVerify(clientSecret, verificationKey, {
    algorithms: ["ES256"],
    audience: "https://appleid.apple.com",
    issuer: providerConfig.teamId,
    subject: providerConfig.clientId,
  });

  assert.deepEqual(protectedHeader, { alg: "ES256", kid: providerConfig.keyId });
  assert.equal(payload.iat, issuedAt);
  assert.equal(payload.exp, issuedAt + 300);
});

test("Apple token exchange sends a newly signed five-minute client secret", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const providerConfig = {
    clientId: "com.playnavilab.playnavi.survey.stg",
    teamId: "9GSX6744M2",
    keyId: "A1B2C3D4E5",
    privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
  const verificationKey = await importSPKI(
    publicKey.export({ format: "pem", type: "spki" }).toString(),
    "ES256",
  );
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ id_token: "apple-id-token" }) };
  };

  try {
    const before = Math.floor(Date.now() / 1_000);
    const idToken = await exchangeProviderCode(
      "apple",
      providerConfig,
      "https://survey-stg.playnavilab.com/api/auth/callback",
      "authorization-code",
      {},
    );
    const after = Math.floor(Date.now() / 1_000);
    assert.equal(idToken, "apple-id-token");
    assert.equal(request.url, "https://appleid.apple.com/auth/token");
    assert.equal(request.options.method, "POST");
    const form = new URLSearchParams(request.options.body);
    assert.equal(form.get("client_id"), providerConfig.clientId);
    assert.equal(form.get("redirect_uri"), "https://survey-stg.playnavilab.com/api/auth/callback");
    assert.equal(form.get("grant_type"), "authorization_code");
    assert.equal(form.get("code"), "authorization-code");
    const { payload, protectedHeader } = await jwtVerify(
      form.get("client_secret"),
      verificationKey,
      {
        algorithms: ["ES256"],
        audience: "https://appleid.apple.com",
        issuer: providerConfig.teamId,
        subject: providerConfig.clientId,
      },
    );
    assert.deepEqual(protectedHeader, { alg: "ES256", kid: providerConfig.keyId });
    assert.ok(payload.iat >= before && payload.iat <= after);
    assert.equal(payload.exp - payload.iat, 300);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OAuth implementation has no Supabase signup or persisted provider session", async () => {
  const source = await readFile(new URL("../api/_lib/auth.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /supabase-js|signInWithOAuth|exchangeCodeForSession|getUser/);
  assert.match(source, /jwtVerify/);
  assert.match(source, /payload\.nonce !== nonce/);
  assert.doesNotMatch(source, /serializeCookie\([^)]*(?:idToken|access|refresh)/s);
});

test("Apple configuration never accepts a manually rotated fixed client secret", async () => {
  const source = await readFile(new URL("../api/_lib/config.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /APPLE_WEB_CLIENT_SECRET/);
  assert.match(source, /APPLE_WEB_PRIVATE_KEY/);
  assert.match(source, /APPLE_WEB_KEY_ID/);
  assert.match(source, /APPLE_TEAM_ID/);
});

test("provider authorization state differs across parallel starts", () => {
  const config = { clientId: "google-client-id", clientSecret: "server-only" };
  const first = createAuthorization(
    "google",
    config,
    "https://links.playnavilab.com/api/auth/callback",
    "/surveys/launch-2026",
  );
  const second = createAuthorization(
    "google",
    config,
    "https://links.playnavilab.com/api/auth/callback",
    "/surveys/launch-2026",
  );
  assert.notEqual(first.state.state, second.state.state);
  assert.notEqual(first.state.nonce, second.state.nonce);
  assert.notEqual(first.state.codeVerifier, second.state.codeVerifier);
  // A second start replaces the one Host-only state cookie. The first callback
  // therefore fails state validation instead of borrowing another verifier.
  assert.notEqual(first.state.state, second.state.state);
});

test("handoff fragments are scrubbed before their same-origin POST", async () => {
  const source = await readFile(new URL("../assets/survey-app.mjs", import.meta.url), "utf8");
  const scrub = source.indexOf("window.history.replaceState");
  const exchange = source.indexOf("await exchangeHandoff");
  assert.ok(scrub >= 0 && exchange > scrub);
  assert.doesNotMatch(source, /localStorage|console\.|Sentry/);
  assert.doesNotMatch(source, /[?&]handoff=/);
});

test("survey uses a bounded mobile wizard and keeps handoff ahead of login", async () => {
  const source = await readFile(new URL("../assets/survey-app.mjs", import.meta.url), "utf8");
  assert.match(source, /const QUESTIONS_PER_STEP = 4/);
  assert.match(source, /createStepController/);
  assert.match(source, /sessionStorage/);
  assert.ok(source.indexOf("await exchangeHandoff") < source.indexOf("return loadSurvey"));
});

test("server code never logs sensitive request material or stores Supabase sessions", async () => {
  const files = [
    "../api/_lib/auth.mjs",
    "../api/_lib/upstream.mjs",
    "../api/auth/callback.mjs",
    "../api/survey/session/exchange.mjs",
    "../api/surveys/[surveySlug]/responses.mjs",
  ];
  const source = (await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), "utf8")))).join("\n");
  assert.doesNotMatch(source, /console\.|Sentry/);
  assert.doesNotMatch(source, /supabase-js|signInWithOAuth|exchangeCodeForSession|getUser/);
  assert.match(source, /X-PlayNavi-Web-Secret/);
  assert.match(source, /X-PlayNavi-Survey-Session/);
});
