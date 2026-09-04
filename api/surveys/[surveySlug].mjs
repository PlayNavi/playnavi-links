import { getConfig, getSurveyBrokerSecret } from "../_lib/config.mjs";
import { firstQueryValue, isSurveyKey, methodNotAllowed, sendJson } from "../_lib/http.mjs";
import { clearSurveySession, getSurveySession } from "../_lib/survey-session.mjs";
import { UpstreamError, callSurveyFunction } from "../_lib/upstream.mjs";

export default async function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
  const surveySlug = firstQueryValue(request.query.surveySlug);
  if (!isSurveyKey(surveySlug)) return sendJson(response, 404, { status: "not_found" });

  let config;
  try {
    config = getConfig();
    const surveySession = getSurveySession(request);
    const payload = await callSurveyFunction(config, "definition", {
      body: { survey_slug: surveySlug },
      surveySession,
      brokerSecret: surveySession ? undefined : getSurveyBrokerSecret(),
    });
    return sendJson(response, surveySession ? 200 : 401, payload);
  } catch (error) {
    if (error instanceof UpstreamError && error.status === 401) {
      try {
        clearSurveySession(response);
        const preview = await callSurveyFunction(config, "definition", {
          body: { survey_slug: surveySlug },
          brokerSecret: getSurveyBrokerSecret(),
        });
        return sendJson(response, 401, preview);
      } catch {
        return sendJson(response, 401, { status: "authentication_required" });
      }
    }
    if (error instanceof UpstreamError && [403, 404, 409, 410].includes(error.status)) {
      return sendJson(response, error.status, { status: error.status === 404 ? "not_found" : "unavailable" });
    }
    return sendJson(response, 503, { status: "unavailable" });
  }
}
