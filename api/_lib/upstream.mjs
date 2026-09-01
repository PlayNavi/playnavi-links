import { functionUrl } from "./config.mjs";

const SAFE_ERROR_CODES = new Set([
  "SURVEY_NOT_FOUND",
  "SURVEY_NOT_OPEN",
  "SURVEY_CLOSED",
  "INVALID_ANSWERS",
  "AUTHENTICATION_REQUIRED",
  "PLAYNAVI_USER_NOT_FOUND",
  "SESSION_INVALID",
  "SESSION_EXPIRED",
  "CODE_INVALID",
  "CODE_EXPIRED",
  "CODE_ALREADY_USED",
  "EXISTING_IDENTITY_NOT_FOUND",
  "ALREADY_SUBMITTED_CONFLICT",
]);

export class UpstreamError extends Error {
  constructor(status, code = null) {
    super("Survey service request failed");
    this.name = "UpstreamError";
    this.status = status;
    this.code = SAFE_ERROR_CODES.has(code) ? code : null;
  }
}
export async function callSurveyFunction(config, functionName, options = {}) {
  const headers = {
    Accept: "application/json",
    apikey: config.publishableKey,
  };
  if (options.surveySession) {
    headers["X-PlayNavi-Survey-Session"] = options.surveySession;
  }
  if (options.brokerSecret) headers["X-PlayNavi-Web-Secret"] = options.brokerSecret;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(functionUrl(config, functionName), {
      method: options.method || "POST",
      headers,
      cache: "no-store",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new UpstreamError(503);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Never include upstream bodies or credentials in thrown errors.
  }
  if (!response.ok || !payload || typeof payload !== "object") {
    throw new UpstreamError(
      response.status >= 400 && response.status < 500 ? response.status : 503,
      payload?.error?.code,
    );
  }
  return payload;
}
