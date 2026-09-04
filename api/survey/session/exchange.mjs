import { getConfig } from "../../_lib/config.mjs";
import {
  hasExpectedOrigin,
  isSurveyKey,
  methodNotAllowed,
  parseJsonBody,
  sendJson,
} from "../../_lib/http.mjs";
import { setSurveySession } from "../../_lib/survey-session.mjs";
import { UpstreamError, callSurveyFunction } from "../../_lib/upstream.mjs";

export default async function handler(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);

  let config;
  try {
    config = getConfig();
  } catch {
    return sendJson(response, 503, { status: "unavailable" });
  }
  if (!hasExpectedOrigin(request, config.webOrigin)) {
    return sendJson(response, 403, { status: "forbidden" });
  }

  const code = parseJsonBody(request)?.code;
  if (typeof code !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(code)) {
    return sendJson(response, 400, { status: "invalid_or_expired" });
  }

  try {
    const payload = await callSurveyFunction(config, "handoffExchange", {
      body: { code },
    });
    if (
      payload.status !== "ok" ||
      !isSurveyKey(payload.survey_slug) ||
      typeof payload.session_token !== "string" ||
      !/^[A-Za-z0-9_-]{32,512}$/.test(payload.session_token) ||
      typeof payload.expires_at !== "string" ||
      !Number.isFinite(Date.parse(payload.expires_at)) ||
      Date.parse(payload.expires_at) <= Date.now()
    ) {
      return sendJson(response, 503, { status: "unavailable" });
    }

    setSurveySession(response, payload.session_token, payload.expires_at);

    return sendJson(response, 200, {
      status: "ok",
      survey_slug: payload.survey_slug,
    });
  } catch (error) {
    if (error instanceof UpstreamError && [400, 401, 404, 409, 410].includes(error.status)) {
      return sendJson(response, 401, { status: "invalid_or_expired" });
    }
    return sendJson(response, 503, { status: "unavailable" });
  }
}
