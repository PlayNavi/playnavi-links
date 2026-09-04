import { appendSetCookie, parseCookies, serializeCookie } from "./http.mjs";

export const SURVEY_SESSION_COOKIE = "__Host-pn_survey_session";
const MAX_SESSION_SECONDS = 60 * 60;

export function getSurveySession(request) {
  const value = parseCookies(request.headers.cookie || "")[SURVEY_SESSION_COOKIE];
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,512}$/.test(value) ? value : null;
}
export function setSurveySession(response, token, expiresAt) {
  const expiresMs = Date.parse(expiresAt);
  const remainingSeconds = Number.isFinite(expiresMs)
    ? Math.floor((expiresMs - Date.now()) / 1000)
    : 0;
  const maxAge = Math.max(1, Math.min(MAX_SESSION_SECONDS, remainingSeconds));
  appendSetCookie(
    response,
    serializeCookie(SURVEY_SESSION_COOKIE, token, {
      path: "/",
      maxAge,
    }),
  );
}

export function clearSurveySession(response) {
  appendSetCookie(
    response,
    serializeCookie(SURVEY_SESSION_COOKIE, "", { path: "/", maxAge: 0 }),
  );
}
