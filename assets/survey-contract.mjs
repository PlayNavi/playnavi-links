const QUESTION_TYPES = new Set(["single_choice", "multiple_choice", "short_text"]);
const VOICE_KIND = "playnavi_voice_2026";
const VOICE_ANSWER_KEYS = [
  "usage_frequency",
  "overall_satisfaction",
  "feature_priorities",
  "feature_comments",
  "category_top",
  "feature_details",
  "future_interest",
  "future_top",
];
const ID_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

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
const hasOnlyKeys = (value, allowed) =>
  value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).every((key) => allowed.includes(key));

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

function normalizeNamedOptions(options, expectedLength = null, description = false) {
  if (
    !Array.isArray(options) ||
    options.length < 1 ||
    options.length > 12 ||
    (expectedLength !== null && options.length !== expectedLength)
  ) return null;
  const optionKeys = description ? ["id", "label", "description"] : ["id", "label"];
  if (options.some((option) => !hasOnlyKeys(option, optionKeys))) return null;
  const normalized = options.map((option) => ({
    id: text(option?.id, 40),
    label: text(option?.label, 120),
    ...(description ? { description: text(option?.description, 240) } : {}),
  }));
  if (
    normalized.some((option) => !option.id || !ID_PATTERN.test(option.id) || !option.label || (description && !option.description)) ||
    new Set(normalized.map((option) => option.id)).size !== normalized.length
  ) return null;
  return normalized;
}

function normalizeVoiceDefinition(questions) {
  if (!questions || typeof questions !== "object" || Array.isArray(questions)) return null;
  if (!hasOnlyKeys(questions, [
    "kind",
    "usage_options",
    "overall_satisfaction_options",
    "priority_options",
    "importance_options",
    "detail_satisfaction_options",
    "categories",
    "future_options",
    "comment_max_length",
    "second_category_optional",
    "future_top_max",
  ])) return null;
  const usageOptions = normalizeNamedOptions(questions.usage_options, 6);
  const overallSatisfactionOptions = normalizeNamedOptions(questions.overall_satisfaction_options, 6);
  const priorityOptions = normalizeNamedOptions(questions.priority_options, 5);
  const importanceOptions = normalizeNamedOptions(questions.importance_options, 6);
  const detailSatisfactionOptions = normalizeNamedOptions(questions.detail_satisfaction_options, 7);
  const futureOptions = normalizeNamedOptions(questions.future_options, 7, true);
  if (
    !usageOptions || !overallSatisfactionOptions ||
    !priorityOptions || !importanceOptions || !detailSatisfactionOptions || !futureOptions ||
    questions.kind !== VOICE_KIND ||
    questions.comment_max_length !== 200 ||
    questions.second_category_optional !== true ||
    questions.future_top_max !== 3 ||
    !Array.isArray(questions.categories) || questions.categories.length !== 7
  ) return null;

  if (questions.categories.some((category) =>
    !hasOnlyKeys(category, ["id", "label", "features"]) ||
    !Array.isArray(category.features) ||
    category.features.some((feature) => !hasOnlyKeys(feature, ["id", "label"]))
  )) return null;
  const categories = questions.categories.map((category) => ({
    id: text(category?.id, 40),
    label: text(category?.label, 120),
    features: Array.isArray(category?.features)
      ? category.features.map((feature) => ({
        id: text(feature?.id, 40),
        label: text(feature?.label, 120),
      }))
      : null,
  }));
  const features = categories.flatMap((category) => category.features || []);
  if (
    categories.some((category) =>
      !category.id || !ID_PATTERN.test(category.id) || !category.label ||
      !category.features || category.features.length < 3 || category.features.length > 4 ||
      category.features.some((feature) => !feature.id || !ID_PATTERN.test(feature.id) || !feature.label)
    ) ||
    new Set(categories.map((category) => category.id)).size !== 7 ||
    features.length !== 26 ||
    new Set(features.map((feature) => feature.id)).size !== 26
  ) return null;

  return {
    kind: VOICE_KIND,
    usageOptions,
    overallSatisfactionOptions,
    priorityOptions,
    importanceOptions,
    detailSatisfactionOptions,
    categories,
    features,
    futureOptions,
    commentMaxLength: 200,
    secondCategoryOptional: true,
    futureTopMax: 3,
  };
}

export function parseSurveyRead(payload, expectedSlug) {
  if (!payload || typeof payload !== "object") throw new SurveyContractError("invalid payload");
  if (payload.status !== "ok" || !payload.survey || payload.survey.slug !== expectedSlug) {
    throw new SurveyContractError("invalid survey status");
  }
  if (![undefined, 1, 2].includes(payload.survey.schema_version)) {
    throw new SurveyContractError("unsupported schema version");
  }
  if (payload.survey.schema_version === 2) {
    const voice = normalizeVoiceDefinition(payload.survey.questions);
    if (!voice) throw new SurveyContractError("invalid voice questions");
    return {
      status: payload.response ? "already_answered" : "ok",
      schemaVersion: 2,
      title: text(payload.survey.title, 500),
      description: typeof payload.survey.description === "string"
        ? payload.survey.description.slice(0, 2_000)
        : "",
      voice,
      titleName: payload.response ? text(payload.survey.reward?.name_ja, 200) : null,
      titleAwarded: false,
    };
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
    schemaVersion: 1,
    title: text(payload.survey.title, 500),
    description: typeof payload.survey.description === "string"
      ? payload.survey.description.slice(0, 2_000)
      : "",
    questions,
    titleName: payload.response ? text(payload.survey.reward?.name_ja, 200) : null,
    titleAwarded: false,
  };
}

export function parseSurveyPreview(payload, expectedSlug) {
  if (!payload || typeof payload !== "object" || payload.status !== "ok") {
    throw new SurveyContractError("invalid preview status");
  }
  const survey = payload.survey;
  const title = survey?.slug === expectedSlug ? text(survey.title, 120) : null;
  if (!title || !hasOnlyKeys(survey, ["slug", "title", "description"])) {
    throw new SurveyContractError("invalid survey preview");
  }
  return {
    title,
    description: typeof survey.description === "string"
      ? survey.description.slice(0, 2_000)
      : "",
  };
}

const optionHas = (options, value) => options.some((option) => option.id === value);
const objectValue = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const exactKeys = (value, allowed) => Object.keys(value).every((key) => allowed.includes(key));

export function validateVoiceAnswers(voice, rawValues) {
  const values = objectValue(rawValues);
  const missing = [];
  const answers = {
    usage_frequency: "",
    overall_satisfaction: "",
    feature_priorities: {},
    feature_comments: {},
    category_top: [],
    feature_details: {},
    future_interest: "",
    future_top: [],
  };
  const featureIds = voice.features.map((feature) => feature.id);
  const categoryIds = voice.categories.map((category) => category.id);
  const futureIds = voice.futureOptions.map((option) => option.id);
  let structurallyInvalid = !exactKeys(values, VOICE_ANSWER_KEYS);

  if (optionHas(voice.usageOptions, values.usage_frequency)) {
    answers.usage_frequency = values.usage_frequency;
  } else missing.push("usage_frequency");
  if (optionHas(voice.overallSatisfactionOptions, values.overall_satisfaction)) {
    answers.overall_satisfaction = values.overall_satisfaction;
  } else missing.push("overall_satisfaction");

  const priorities = objectValue(values.feature_priorities);
  structurallyInvalid ||= !exactKeys(priorities, featureIds);
  for (const featureId of featureIds) {
    if (optionHas(voice.priorityOptions, priorities[featureId])) {
      answers.feature_priorities[featureId] = priorities[featureId];
    } else missing.push(`priority:${featureId}`);
  }

  const comments = objectValue(values.feature_comments);
  structurallyInvalid ||= !exactKeys(comments, featureIds);
  for (const [featureId, value] of Object.entries(comments)) {
    if (typeof value !== "string" || value.length > voice.commentMaxLength) {
      structurallyInvalid = true;
      continue;
    }
    const comment = value.trim();
    if (comment) answers.feature_comments[featureId] = comment;
  }

  const categoryTop = Array.isArray(values.category_top)
    ? values.category_top.filter((id) => categoryIds.includes(id))
    : [];
  if (categoryTop.length < 1) missing.push("category_top:0");
  if (
    categoryTop.length > 2 ||
    new Set(categoryTop).size !== categoryTop.length ||
    categoryTop.length !== (Array.isArray(values.category_top) ? values.category_top.length : 0)
  ) structurallyInvalid = true;
  answers.category_top = [...new Set(categoryTop)].slice(0, 2);

  const expectedDetailIds = voice.categories
    .filter((category) => answers.category_top.includes(category.id))
    .flatMap((category) => category.features.map((feature) => feature.id));
  const details = objectValue(values.feature_details);
  structurallyInvalid ||= !exactKeys(details, expectedDetailIds);
  for (const featureId of expectedDetailIds) {
    const detail = objectValue(details[featureId]);
    if (!exactKeys(detail, ["importance", "satisfaction"])) structurallyInvalid = true;
    const importance = optionHas(voice.importanceOptions, detail.importance) ? detail.importance : "";
    const satisfaction = optionHas(voice.detailSatisfactionOptions, detail.satisfaction)
      ? detail.satisfaction
      : "";
    if (!importance) missing.push(`importance:${featureId}`);
    if (!satisfaction) missing.push(`satisfaction:${featureId}`);
    if (importance && satisfaction) answers.feature_details[featureId] = { importance, satisfaction };
  }
  if (Object.keys(details).length !== expectedDetailIds.length) structurallyInvalid = true;

  if (["yes", "none", "unsure"].includes(values.future_interest)) {
    answers.future_interest = values.future_interest;
  } else missing.push("future_interest");
  const futureTop = Array.isArray(values.future_top)
    ? values.future_top.filter((id) => futureIds.includes(id))
    : [];
  if (answers.future_interest === "yes" && futureTop.length < 1) missing.push("future_top:0");
  if (answers.future_interest !== "yes" && futureTop.length > 0) structurallyInvalid = true;
  if (
    futureTop.length > voice.futureTopMax ||
    new Set(futureTop).size !== futureTop.length ||
    futureTop.length !== (Array.isArray(values.future_top) ? values.future_top.length : 0)
  ) structurallyInvalid = true;
  answers.future_top = answers.future_interest === "yes" ? [...new Set(futureTop)].slice(0, 3) : [];

  return { answers, missing, structurallyInvalid };
}

export function updateOrderedSelection(current, index, value, maxLength) {
  const previous = Array.isArray(current) ? current.slice(0, maxLength) : [];
  if (!Number.isInteger(index) || index < 0 || index >= maxLength) return previous;
  if (index > 0 && !previous[index - 1]) return previous.slice(0, index);
  if (!value) return previous.slice(0, index);
  const next = previous.slice();
  next[index] = value;
  const duplicateAbove = next.slice(0, index).includes(value);
  if (duplicateAbove) return next.slice(0, index);
  const duplicateBelow = next.findIndex((item, itemIndex) => itemIndex > index && item === value);
  return (duplicateBelow >= 0 ? next.slice(0, duplicateBelow) : next).slice(0, maxLength);
}

export function classifySubmitConflict(payload) {
  return payload?.error?.code === "ALREADY_SUBMITTED_CONFLICT"
    ? "answers_conflict"
    : "submit_failed";
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
