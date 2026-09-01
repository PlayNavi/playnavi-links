import { getConfig } from "../../_lib/config.mjs";
import {
  firstQueryValue,
  hasExpectedOrigin,
  isSurveyKey,
  methodNotAllowed,
  parseJsonBody,
  sendJson,
} from "../../_lib/http.mjs";
import { clearSurveySession, getSurveySession } from "../../_lib/survey-session.mjs";
import { UpstreamError, callSurveyFunction } from "../../_lib/upstream.mjs";

const MAX_ANSWERS = 100;
const MAX_ANSWER_BYTES = 64 * 1024;
const VOICE_KEYS = [
  "usage_frequency",
  "overall_satisfaction",
  "feature_priorities",
  "feature_comments",
  "category_top",
  "feature_details",
  "future_interest",
  "future_top",
];

function boundedJson(value, depth = 0, budget = { entries: 0 }) {
  if (typeof value === "string") return value.length <= 2_000;
  if (depth >= 4 || !value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    if (value.length > 100 || new Set(value).size !== value.length) return false;
    return value.every((item) => typeof item === "string" && item.length <= 500);
  }
  const entries = Object.entries(value);
  budget.entries += entries.length;
  if (entries.length > MAX_ANSWERS || budget.entries > 300) return false;
  return entries.every(([key, item]) =>
    /^[A-Za-z0-9_-]{1,100}$/.test(key) && boundedJson(item, depth + 1, budget)
  );
}

export function validAnswers(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > MAX_ANSWERS) return false;
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return false;
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_ANSWER_BYTES) return false;
  const isVoice = VOICE_KEYS.every((key) => Object.hasOwn(value, key));
  if (isVoice) {
    if (entries.length !== VOICE_KEYS.length || entries.some(([key]) => !VOICE_KEYS.includes(key))) return false;
    return boundedJson(value);
  }
  return entries.every(([questionId, answer]) => {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(questionId)) return false;
    if (typeof answer === "string") return answer.length <= 2_000;
    return (
      Array.isArray(answer) &&
      answer.length <= 100 &&
      new Set(answer).size === answer.length &&
      answer.every((item) => typeof item === "string" && item.length <= 500)
    );
  });
}
export default async function handler(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  const surveySlug = firstQueryValue(request.query.surveySlug);
  if (!isSurveyKey(surveySlug)) return sendJson(response, 404, { status: "not_found" });

  let config;
  try {
    config = getConfig();
  } catch {
    return sendJson(response, 503, { status: "unavailable" });
  }
  if (!hasExpectedOrigin(request, config.webOrigin)) {
    return sendJson(response, 403, { status: "forbidden" });
  }

  const answers = parseJsonBody(request)?.answers;
  if (!validAnswers(answers)) return sendJson(response, 400, { status: "invalid_answers" });

  try {
    const surveySession = getSurveySession(request);
    if (!surveySession) return sendJson(response, 401, { status: "authentication_required" });

    const payload = await callSurveyFunction(config, "submit", {
      body: { survey_slug: surveySlug, answers },
      surveySession,
    });
    if (
      payload?.status !== "ok" ||
      !payload.submission ||
      typeof payload.submission.submitted_at !== "string" ||
      typeof payload.submission.already_submitted !== "boolean"
    ) {
      return sendJson(response, 503, { status: "unavailable" });
    }
    clearSurveySession(response);
    return sendJson(response, 200, payload);
  } catch (error) {
    if (error instanceof UpstreamError && error.status === 400) {
      return sendJson(response, 400, { status: "invalid_answers" });
    }
    if (error instanceof UpstreamError && error.status === 401) {
      return sendJson(response, 401, { status: "authentication_required" });
    }
    if (error instanceof UpstreamError && [403, 404, 409, 410].includes(error.status)) {
      return sendJson(response, error.status, {
        status: "error",
        error: { code: error.code || "SURVEY_NOT_OPEN" },
      });
    }
    return sendJson(response, 503, { status: "unavailable" });
  }
}
