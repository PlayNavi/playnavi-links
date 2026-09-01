import { parseSubmitResult, parseSurveyRead, validateAnswers } from "./survey-contract.mjs";

const elements = {
  linkView: document.getElementById("link-view"),
  view: document.getElementById("survey-view"),
  loading: document.getElementById("survey-loading"),
  title: document.getElementById("survey-title"),
  description: document.getElementById("survey-description"),
  login: document.getElementById("survey-login"),
  google: document.getElementById("google-login"),
  apple: document.getElementById("apple-login"),
  form: document.getElementById("survey-form"),
  questions: document.getElementById("survey-questions"),
  step: document.getElementById("survey-step"),
  progressLabel: document.getElementById("survey-progress-label"),
  progressTrack: document.getElementById("survey-progress-track"),
  progressBar: document.getElementById("survey-progress-bar"),
  back: document.getElementById("survey-back"),
  next: document.getElementById("survey-next"),
  error: document.getElementById("survey-error"),
  submit: document.getElementById("survey-submit"),
  result: document.getElementById("survey-result"),
  resultIcon: document.getElementById("result-icon"),
  resultHeading: document.getElementById("result-heading"),
  resultDescription: document.getElementById("result-description"),
  reward: document.getElementById("title-reward"),
  titleName: document.getElementById("title-name"),
  retry: document.getElementById("survey-retry"),
};

const setVisible = (element, visible) => element?.classList.toggle("hidden", !visible);
const draftKey = (slug) => `pn_survey_draft:${slug}`;
const QUESTIONS_PER_STEP = 4;

function setPage({ title, description, loading = false }) {
  if (elements.title) elements.title.textContent = title;
  if (elements.description) elements.description.textContent = description;
  setVisible(elements.loading, loading);
}

function hideStates() {
  for (const element of [elements.login, elements.form, elements.result, elements.retry]) {
    setVisible(element, false);
  }
}

function showLogin(slug, failed = false) {
  hideStates();
  setPage({
    title: "PlayNaviアンケート",
    description: failed
      ? "ログインを完了できませんでした。PlayNaviで利用しているアカウントでもう一度お試しください。"
      : "PlayNaviで利用しているアカウントでログインしてください。",
  });
  const returnTo = `/surveys/${slug}`;
  if (elements.google) {
    elements.google.href = `/api/auth/start?provider=google&returnTo=${encodeURIComponent(returnTo)}`;
  }
  if (elements.apple) {
    elements.apple.href = `/api/auth/start?provider=apple&returnTo=${encodeURIComponent(returnTo)}`;
  }
  setVisible(elements.login, true);
}

function showUnavailable(retry, message = "一時的にアンケートを開けません。時間をおいてもう一度お試しください。") {
  hideStates();
  setPage({ title: "アンケートを開けません", description: message });
  if (elements.retry) elements.retry.onclick = retry;
  setVisible(elements.retry, true);
}

function showResult(result) {
  hideStates();
  const closed = result.status === "closed";
  const already = result.status === "already_answered";
  setPage({
    title: closed ? "アンケートは終了しました" : "回答ありがとうございました",
    description: closed ? "このアンケートの受付は終了しています。" : "回答を受け付けました。",
  });
  if (elements.resultIcon) elements.resultIcon.textContent = closed ? "–" : "✓";
  if (elements.resultHeading) {
    elements.resultHeading.textContent = closed
      ? "受付終了"
      : already
        ? "回答済みです"
        : "回答ありがとうございました";
  }
  if (elements.resultDescription) {
    elements.resultDescription.textContent = closed
      ? "ご協力ありがとうございました。"
      : already
        ? "このアンケートへの回答はすでに完了しています。"
        : "ご協力ありがとうございました。";
  }
  const hasReward = result.titleAwarded && result.titleName;
  if (hasReward && elements.titleName) elements.titleName.textContent = result.titleName;
  setVisible(elements.reward, Boolean(hasReward));
  setVisible(elements.result, true);
}

function readDraft(slug) {
  try {
    const value = JSON.parse(sessionStorage.getItem(draftKey(slug)) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function saveDraft(slug, values) {
  try {
    sessionStorage.setItem(draftKey(slug), JSON.stringify(values));
  } catch {
    // Draft persistence is a convenience; private browsing may disable it.
  }
}

function clearDraft(slug) {
  try {
    sessionStorage.removeItem(draftKey(slug));
  } catch {
    // No action needed.
  }
}

function choiceInput(question, option, value, onChange) {
  const label = document.createElement("label");
  label.className = "choice";
  const input = document.createElement("input");
  input.type = question.type === "single_choice" ? "radio" : "checkbox";
  input.name = `question-${question.id}`;
  input.value = option.value;
  input.checked = question.type === "single_choice"
    ? value === option.value
    : Array.isArray(value) && value.includes(option.value);
  input.addEventListener("change", onChange);
  const text = document.createElement("span");
  text.textContent = option.label;
  label.append(input, text);
  return label;
}

function renderQuestions(slug, survey) {
  const values = readDraft(slug);
  elements.questions.replaceChildren();

  const updateDraft = () => saveDraft(slug, values);
  const pages = [];
  for (let offset = 0; offset < survey.questions.length; offset += QUESTIONS_PER_STEP) {
    const pageQuestions = survey.questions.slice(offset, offset + QUESTIONS_PER_STEP);
    const page = document.createElement("section");
    page.className = "survey-step-page";
    page.dataset.step = String(pages.length);
    page.hidden = pages.length !== 0;
    pages.push({ element: page, questions: pageQuestions });

    for (const question of pageQuestions) {
      const fieldset = document.createElement("fieldset");
      fieldset.className = "question question-card";
      fieldset.dataset.questionId = question.id;
      const legend = document.createElement("legend");
      legend.textContent = question.prompt;
      if (question.required) {
        const required = document.createElement("span");
        required.className = "required";
        required.textContent = "必須";
        legend.append(required);
      }
      fieldset.append(legend);

      if (question.type === "short_text") {
        const input = document.createElement("textarea");
        input.maxLength = question.maxLength;
        input.value = typeof values[question.id] === "string" ? values[question.id] : "";
        input.addEventListener("input", () => {
          values[question.id] = input.value;
          updateDraft();
        });
        const hint = document.createElement("p");
        hint.className = "hint";
        const updateCount = () => {
          hint.textContent = `${input.value.length} / ${question.maxLength}文字`;
        };
        updateCount();
        input.addEventListener("input", updateCount);
        fieldset.append(input, hint);
      } else {
        for (const option of question.options) {
          const input = choiceInput(question, option, values[question.id], (event) => {
            if (question.type === "single_choice") {
              values[question.id] = event.currentTarget.value;
            } else {
              const selected = new Set(Array.isArray(values[question.id]) ? values[question.id] : []);
              event.currentTarget.checked
                ? selected.add(event.currentTarget.value)
                : selected.delete(event.currentTarget.value);
              values[question.id] = [...selected];
            }
            updateDraft();
          });
          fieldset.append(input);
        }
      }
      page.append(fieldset);
    }
    elements.questions.append(page);
  }
  return { values, pages };
}

function missingOnPage(page, values) {
  return validateAnswers(page.questions, values).missing;
}

function markMissing(missing) {
  for (const fieldset of elements.questions.querySelectorAll(".question")) {
    fieldset.removeAttribute("aria-invalid");
  }
  for (const id of missing) {
    elements.questions
      .querySelector(`[data-question-id="${CSS.escape(id)}"]`)
      ?.setAttribute("aria-invalid", "true");
  }
}

function focusQuestion(id) {
  const fieldset = elements.questions.querySelector(
    `[data-question-id="${CSS.escape(id)}"]`,
  );
  fieldset?.scrollIntoView({ behavior: "smooth", block: "center" });
  fieldset?.querySelector("input, textarea")?.focus({ preventScroll: true });
}

function createStepController(pages, values) {
  let current = 0;
  const show = (index) => {
    current = Math.max(0, Math.min(index, pages.length - 1));
    pages.forEach((page, pageIndex) => {
      page.element.hidden = pageIndex !== current;
    });
    const stepNumber = current + 1;
    if (elements.step) elements.step.textContent = `${stepNumber} / ${pages.length}`;
    if (elements.progressLabel) {
      elements.progressLabel.textContent = current === pages.length - 1
        ? "最後のステップ"
        : "回答の進捗";
    }
    if (elements.progressBar) {
      elements.progressBar.style.width = `${Math.round((stepNumber / pages.length) * 100)}%`;
    }
    elements.progressTrack?.setAttribute("aria-valuemax", String(pages.length));
    elements.progressTrack?.setAttribute("aria-valuenow", String(stepNumber));
    setVisible(elements.back, current > 0);
    setVisible(elements.next, current < pages.length - 1);
    setVisible(elements.submit, current === pages.length - 1);
    elements.error.textContent = "";
    setVisible(elements.error, false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  elements.back.onclick = () => show(current - 1);
  elements.next.onclick = () => {
    const missing = missingOnPage(pages[current], values);
    markMissing(missing);
    if (missing.length > 0) {
      elements.error.textContent = "この画面の必須項目に回答してください。";
      setVisible(elements.error, true);
      focusQuestion(missing[0]);
      return;
    }
    show(current + 1);
  };
  show(0);
  return { show };
}

async function submitSurvey(slug, survey, values, stepController) {
  const result = validateAnswers(survey.questions, values);
  elements.error.textContent = "";
  setVisible(elements.error, false);
  markMissing(result.missing);
  if (result.missing.length > 0) {
    const pageIndex = survey.questions.findIndex((question) => question.id === result.missing[0]);
    stepController.show(Math.floor(pageIndex / QUESTIONS_PER_STEP));
    elements.error.textContent = "必須の質問に回答してください。";
    setVisible(elements.error, true);
    focusQuestion(result.missing[0]);
    return;
  }

  elements.submit.disabled = true;
  elements.submit.textContent = "送信しています…";
  try {
    const response = await fetch(`/api/surveys/${encodeURIComponent(slug)}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      body: JSON.stringify({ answers: result.answers }),
    });
    if (response.status === 401) return showLogin(slug);
    const payload = await response.json();
    if (response.status === 409) {
      clearDraft(slug);
      return showResult({ status: "already_answered" });
    }
    if ([404, 410].includes(response.status)) return showResult({ status: "closed" });
    if (!response.ok) throw new Error("submit failed");
    const parsed = parseSubmitResult(payload);
    if (["submitted", "already_answered"].includes(parsed.status)) clearDraft(slug);
    showResult(parsed);
  } catch {
    elements.error.textContent = "回答を送信できませんでした。入力内容はこの画面に保持されています。";
    setVisible(elements.error, true);
  } finally {
    elements.submit.disabled = false;
    elements.submit.textContent = "回答を送信";
  }
}

function showSurveyForm(slug, survey) {
  hideStates();
  setPage({ title: survey.title, description: survey.description });
  const { values, pages } = renderQuestions(slug, survey);
  const stepController = createStepController(pages, values);
  elements.form.onsubmit = (event) => {
    event.preventDefault();
    submitSurvey(slug, survey, values, stepController);
  };
  setVisible(elements.form, true);
}

async function loadSurvey(slug, authFailed = false) {
  hideStates();
  setPage({ title: "PlayNaviアンケート", description: "アンケートを準備しています。", loading: true });
  try {
    const response = await fetch(`/api/surveys/${encodeURIComponent(slug)}`, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    if (response.status === 401) return showLogin(slug, authFailed);
    if (response.status === 403) {
      return showLogin(slug, true);
    }
    if (response.status === 404 || response.status === 410) {
      return showResult({ status: "closed" });
    }
    if (!response.ok) throw new Error("read failed");
    const survey = parseSurveyRead(await response.json(), slug);
    return survey.status === "ok" ? showSurveyForm(slug, survey) : showResult(survey);
  } catch {
    return showUnavailable(() => loadSurvey(slug));
  }
}

async function exchangeHandoff(code, currentSlug) {
  try {
    const response = await fetch("/api/survey/session/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      body: JSON.stringify({ code }),
    });
    if (!response.ok) return false;
    const payload = await response.json();
    if (payload?.status !== "ok" || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(payload.survey_slug)) {
      return false;
    }
    if (payload.survey_slug !== currentSlug) {
      window.location.replace(`/surveys/${encodeURIComponent(payload.survey_slug)}`);
      return null;
    }
    return true;
  } catch {
    return false;
  }
}

export async function startSurvey(slug) {
  setVisible(elements.linkView, false);
  setVisible(elements.view, true);

  const params = new URLSearchParams(window.location.search);
  const authFailed = params.get("auth") === "failed";
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const handoff = fragment.get("handoff");

  // Remove every fragment value before any network call. The handoff code is
  // retained only in this local variable and is never written to storage/DOM.
  if (window.location.hash || authFailed) {
    window.history.replaceState(null, "", window.location.pathname);
  }

  if (handoff) {
    setPage({ title: "PlayNaviアンケート", description: "ログイン情報を確認しています。", loading: true });
    const exchanged = await exchangeHandoff(handoff, slug);
    if (exchanged === null) return;
    if (!exchanged) return showLogin(slug, true);
  }
  return loadSurvey(slug, authFailed);
}
