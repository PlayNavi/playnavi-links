const QUESTION_TYPES = new Set(["single_choice", "multiple_choice", "short_text"]);

export class SurveyContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "SurveyContractError";
  }
}
function text(value, maxLength) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength
    ? value
    : null;
}

function normalizeOptions(options) {
  if (!Array.isArray(options) || options.length < 1 || options.length > 100) return null;
  const normalized = options.map((option) => ({ value: text(option, 500), label: text(option, 500) }));
  if (normalized.some((option) => !option.value || !option.label)) return null;
  if (new Set(normalized.map((option) => option.value)).size !== normalized.length) return null;
  return normalized;
}

function normalizeQuestion(question) {
  const id = text(question?.id, 100);
  const type = question?.type;
  const prompt = text(question?.label, 1_000);
  if (!id || !QUESTION_TYPES.has(type) || !prompt) return null;

  const options = type === "short_text" ? [] : normalizeOptions(question.options);
  if (options === null) return null;
  const configuredMax = Number.isInteger(question.max_length) ? question.max_length : 500;
  const maxLength = Math.max(1, Math.min(2_000, configuredMax));
  return {
    id,
    type,
    prompt,
    required: question.required === true,
    options,
    maxLength,
  };
}

export function parseSurveyRead(payload, expectedSlug) {
  if (!payload || typeof payload !== "object") throw new SurveyContractError("invalid payload");
  if (payload.status !== "ok" || !payload.survey || payload.survey.slug !== expectedSlug) {
    throw new SurveyContractError("invalid survey status");
  }
  const questions = Array.isArray(payload.survey.questions)
    ? payload.survey.questions.map(normalizeQuestion)
    : null;
  if (
    !questions ||
    questions.length < 1 ||
    questions.length > 100 ||
    questions.some((question) => !question) ||
    new Set(questions.map((question) => question.id)).size !== questions.length
  ) {
    throw new SurveyContractError("invalid questions");
  }
  return {
    status: payload.response ? "already_answered" : "ok",
    title: text(payload.survey.title, 500),
    description: typeof payload.survey.description === "string"
      ? payload.survey.description.slice(0, 2_000)
      : "",
    questions,
    titleName: payload.response ? text(payload.survey.reward?.name_ja, 200) : null,
    titleAwarded: false,
  };
}

export function parseSubmitResult(payload) {
  if (!payload || typeof payload !== "object") throw new SurveyContractError("invalid payload");
  if (
    payload.status !== "ok" ||
    !payload.submission ||
    typeof payload.submission.already_submitted !== "boolean"
  ) {
    throw new SurveyContractError("invalid submit status");
  }
  return {
    status: payload.submission.already_submitted ? "already_answered" : "submitted",
    titleAwarded: payload.reward?.awarded === true,
    titleName: text(payload.reward?.name_ja, 200),
  };
}

export function validateAnswers(questions, values) {
  const answers = {};
  const missing = [];
  for (const question of questions) {
    const value = values[question.id];
    if (question.type === "multiple_choice") {
      const selected = Array.isArray(value)
        ? value.filter((item) => question.options.some((option) => option.value === item))
        : [];
      if (question.required && selected.length === 0) missing.push(question.id);
      if (selected.length > 0) answers[question.id] = [...new Set(selected)];
      continue;
    }
    if (question.type === "single_choice") {
      const selected = question.options.some((option) => option.value === value) ? value : "";
      if (question.required && !selected) missing.push(question.id);
      if (selected) answers[question.id] = selected;
      continue;
    }
    const entered = typeof value === "string" ? value.trim().slice(0, question.maxLength) : "";
    if (question.required && !entered) missing.push(question.id);
    if (entered) answers[question.id] = entered;
  }
  return { answers, missing };
}
