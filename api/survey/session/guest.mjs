import { getConfig, getSurveyBrokerSecret } from "../../_lib/config.mjs";
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
  const surveySlug = parseJsonBody(request)?.survey_slug;
  if (!isSurveyKey(surveySlug)) {
    return sendJson(response, 400, { status: "invalid_request" });
  }

  try {
    const payload = await callSurveyFunction(config, "guestSessionCreate", {
      body: { survey_slug: surveySlug },
      brokerSecret: getSurveyBrokerSecret(),
    });
    if (
      payload?.status !== "ok" || payload.survey_slug !== surveySlug ||
      typeof payload.session_token !== "string" ||
      !/^[A-Za-z0-9_-]{32,512}$/.test(payload.session_token) ||
      typeof payload.expires_at !== "string" ||
      !Number.isFinite(Date.parse(payload.expires_at)) ||
      Date.parse(payload.expires_at) <= Date.now()
    ) {
      return sendJson(response, 503, { status: "unavailable" });
    }
    setSurveySession(response, payload.session_token, payload.expires_at);
    return sendJson(response, 200, { status: "ok", survey_slug: surveySlug });
  } catch (error) {
    if (error instanceof UpstreamError && [400, 404, 409].includes(error.status)) {
      return sendJson(response, error.status, {
        status: "error",
        error: { code: error.code || "SURVEY_NOT_OPEN" },
      });
    }
    return sendJson(response, 503, { status: "unavailable" });
  }
}
