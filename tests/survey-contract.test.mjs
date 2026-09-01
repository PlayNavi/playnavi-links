import assert from "node:assert/strict";
import test from "node:test";

import {
  SurveyContractError,
  parseSubmitResult,
  parseSurveyRead,
  validateAnswers,
} from "../assets/survey-contract.mjs";

const surveyPayload = {
  status: "ok",
  survey: {
    slug: "launch-2026",
    title: "PlayNaviアンケート",
    description: "ご意見をお聞かせください。",
    opens_at: "2026-08-31T00:00:00Z",
    closes_at: "2026-09-07T00:00:00Z",
    reward: { title_id: "title-id", name_ja: "調査協力者", rarity: "common", icon_url: null },
    questions: [
      { id: "q1", type: "single_choice", label: "1つ選択", required: true, options: ["A", "B"] },
      { id: "q2", type: "multiple_choice", label: "複数選択", required: false, options: ["C", "D"] },
      { id: "q3", type: "short_text", label: "自由入力", required: true, max_length: 50 },
    ],
  },
  response: null,
};

test("parses the fixed survey-read contract", () => {
  const survey = parseSurveyRead(surveyPayload, "launch-2026");
  assert.equal(survey.status, "ok");
  assert.deepEqual(survey.questions[0].options, [
    { value: "A", label: "A" },
    { value: "B", label: "B" },
  ]);
  assert.equal(survey.questions[2].maxLength, 50);
});
test("marks a non-null response as already answered", () => {
  const parsed = parseSurveyRead({
    ...surveyPayload,
    response: { answers: { q1: "A", q3: "done" }, submitted_at: "2026-08-31T01:00:00Z" },
  }, "launch-2026");
  assert.equal(parsed.status, "already_answered");
  assert.equal(parsed.titleAwarded, false);
});

test("fails closed on slug, option, and question-type drift", () => {
  assert.throws(() => parseSurveyRead(surveyPayload, "another"), SurveyContractError);
  assert.throws(
    () => parseSurveyRead({
      ...surveyPayload,
      survey: { ...surveyPayload.survey, questions: [{ id: "q", type: "rating", label: "x" }] },
    }, "launch-2026"),
    SurveyContractError,
  );
  assert.throws(
    () => parseSurveyRead({
      ...surveyPayload,
      survey: {
        ...surveyPayload.survey,
        questions: [{ id: "q", type: "single_choice", label: "x", options: ["same", "same"] }],
      },
    }, "launch-2026"),
    SurveyContractError,
  );
});

test("builds the exact answer object and reports missing required questions", () => {
  const survey = parseSurveyRead(surveyPayload, "launch-2026");
  assert.deepEqual(validateAnswers(survey.questions, {
    q1: "A",
    q2: ["D", "bad", "D"],
    q3: "  feedback  ",
  }), {
    answers: { q1: "A", q2: ["D"], q3: "feedback" },
    missing: [],
  });
  assert.deepEqual(validateAnswers(survey.questions, {}), {
    answers: {},
    missing: ["q1", "q3"],
  });
});

test("parses submit status, idempotency, and reward", () => {
  assert.deepEqual(parseSubmitResult({
    status: "ok",
    submission: { submitted_at: "2026-08-31T01:00:00Z", already_submitted: false },
    reward: { title_id: "title-id", name_ja: "調査協力者", rarity: "common", icon_url: null, awarded: true },
  }), {
    status: "submitted",
    titleAwarded: true,
    titleName: "調査協力者",
  });
  assert.equal(parseSubmitResult({
    status: "ok",
    submission: { submitted_at: "2026-08-31T01:00:00Z", already_submitted: true },
    reward: null,
  }).status, "already_answered");
});
