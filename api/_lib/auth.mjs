import { createHash, randomBytes } from "node:crypto";

import { createRemoteJWKSet, jwtVerify } from "jose";

import { appendSetCookie, parseCookies, serializeCookie } from "./http.mjs";

export const OAUTH_STATE_COOKIE = "__Host-pn_oauth_state";
const STATE_MAX_AGE_SECONDS = 600;
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const APPLE_JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

const opaque = () => randomBytes(32).toString("base64url");
const challenge = (verifier) => createHash("sha256").update(verifier).digest("base64url");

export function setOAuthState(response, value) {
  appendSetCookie(
    response,
    serializeCookie(OAUTH_STATE_COOKIE, JSON.stringify(value), {
      path: "/",
      maxAge: STATE_MAX_AGE_SECONDS,
    }),
  );
}
export function clearOAuthState(response) {
  appendSetCookie(
    response,
    serializeCookie(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 }),
  );
}

export function readOAuthState(request) {
  try {
    const value = JSON.parse(parseCookies(request.headers.cookie || "")[OAUTH_STATE_COOKIE]);
    if (
      !value ||
      !["google", "apple"].includes(value.provider) ||
      typeof value.state !== "string" ||
      typeof value.nonce !== "string" ||
      typeof value.returnPath !== "string" ||
      typeof value.createdAt !== "number" ||
      value.createdAt > Date.now() ||
      Date.now() - value.createdAt > STATE_MAX_AGE_SECONDS * 1_000 ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.state) ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.nonce)
    ) return null;
    if (value.provider === "google" && !/^[A-Za-z0-9_-]{43}$/.test(value.codeVerifier)) return null;
    return value;
  } catch {
    return null;
  }
}

export function createAuthorization(provider, providerConfig, redirectUri, returnPath) {
  if (!["google", "apple"].includes(provider)) throw new Error("Unsupported provider");
  const state = opaque();
  const nonce = opaque();
  const value = { provider, state, nonce, returnPath, createdAt: Date.now() };
  let url;

  if (provider === "google") {
    value.codeVerifier = opaque();
    url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: providerConfig.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid",
      state,
      nonce,
      code_challenge: challenge(value.codeVerifier),
      code_challenge_method: "S256",
      prompt: "select_account",
    });
  } else {
    url = new URL("https://appleid.apple.com/auth/authorize");
    url.search = new URLSearchParams({
      client_id: providerConfig.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      response_mode: "query",
      state,
      nonce,
    });
  }
  return { url: url.toString(), state: value };
}

async function tokenRequest(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("provider token exchange failed");
  const payload = await response.json();
  if (typeof payload?.id_token !== "string") throw new Error("provider identity token missing");
  return payload.id_token;
}

export async function exchangeProviderCode(provider, providerConfig, redirectUri, code, state) {
  if (provider === "google") {
    return tokenRequest("https://oauth2.googleapis.com/token", {
      client_id: providerConfig.clientId,
      client_secret: providerConfig.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code,
      code_verifier: state.codeVerifier,
    });
  }
  return tokenRequest("https://appleid.apple.com/auth/token", {
    client_id: providerConfig.clientId,
    client_secret: providerConfig.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code,
  });
}

export async function verifyProviderIdentity(provider, providerConfig, idToken, nonce) {
  const options = provider === "google"
    ? {
        audience: providerConfig.clientId,
        issuer: ["https://accounts.google.com", "accounts.google.com"],
      }
    : { audience: providerConfig.clientId, issuer: "https://appleid.apple.com" };
  const { payload } = await jwtVerify(idToken, provider === "google" ? GOOGLE_JWKS : APPLE_JWKS, {
    ...options,
    algorithms: ["RS256"],
  });
  if (payload.nonce !== nonce || typeof payload.sub !== "string" || payload.sub.length > 255) {
    throw new Error("provider identity verification failed");
  }
  return payload.sub;
}
