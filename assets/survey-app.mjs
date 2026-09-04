import {
  classifySubmitConflict,
  parseSubmitResult,
  parseSurveyRead,
  parseSurveyPreview,
  updateOrderedSelection,
  validateAnswers,
  validateVoiceAnswers,
} from "./survey-contract.mjs";

const elements = {
  linkView: document.getElementById("link-view"),
  view: document.getElementById("survey-view"),
  loading: document.getElementById("survey-loading"),
  title: document.getElementById("survey-title"),
  description: document.getElementById("survey-description"),
  login: document.getElementById("survey-login"),
  google: document.getElementById("google-login"),
  apple: document.getElementById("apple-login"),
  guest: document.getElementById("guest-login"),
  guide: document.getElementById("survey-guide"),
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
const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

function setPage({ title, description, loading = false, descriptionTone = "default" }) {
  if (elements.title) elements.title.textContent = title;
  if (elements.description) {
    elements.description.textContent = description;
    elements.description.classList.toggle("auth-warning", descriptionTone === "warning");
    if (descriptionTone === "warning") elements.description.setAttribute("role", "alert");
    else elements.description.removeAttribute("role");
  }
  setVisible(elements.loading, loading);
}

function hideStates() {
  for (const element of [elements.login, elements.form, elements.result, elements.retry]) {
    setVisible(element, false);
  }
}

function showLogin(slug, preview, failed = false) {
  hideStates();
  setPage({
    title: preview?.title || "アンケート",
    description: failed
      ? "ログインを完了できませんでした。PlayNaviで利用しているアカウントでもう一度お試しください。"
      : "",
    descriptionTone: failed ? "warning" : "default",
  });
  if (elements.guide) {
    elements.guide.textContent = preview?.description || "";
    setVisible(elements.guide, Boolean(preview?.description));
  }
  const returnTo = `/surveys/${slug}`;
  if (elements.google) {
    elements.google.href = `/api/auth/start?provider=google&returnTo=${encodeURIComponent(returnTo)}`;
  }
  if (elements.apple) {
    elements.apple.href = `/api/auth/start?provider=apple&returnTo=${encodeURIComponent(returnTo)}`;
  }
  if (elements.guest) {
    elements.guest.onclick = () => createGuestSession(slug, elements.guest);
  }
  setVisible(elements.login, true);
}

async function createGuestSession(slug, button) {
  button.disabled = true;
  try {
    const response = await fetch("/api/survey/session/guest", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      body: JSON.stringify({ survey_slug: slug }),
    });
    if (!response.ok) throw new Error("guest session failed");
    return loadSurvey(slug);
  } catch {
    return showUnavailable(() => loadSurvey(slug));
  } finally {
    button.disabled = false;
  }
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
  fieldset?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
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
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
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

function voiceValues(slug, voice) {
  const draft = readDraft(slug);
  const featureIds = new Set(voice.features.map((feature) => feature.id));
  const categoryIds = new Set(voice.categories.map((category) => category.id));
  const priorities = draft.feature_priorities && typeof draft.feature_priorities === "object"
    ? Object.fromEntries(Object.entries(draft.feature_priorities).filter(([id]) => featureIds.has(id)))
    : {};
  const comments = draft.feature_comments && typeof draft.feature_comments === "object"
    ? Object.fromEntries(Object.entries(draft.feature_comments).filter(([id]) => featureIds.has(id)))
    : {};
  const categoryTop = [];
  if (Array.isArray(draft.category_top)) {
    for (const id of draft.category_top.slice(0, 2)) {
      if (!categoryIds.has(id) || categoryTop.includes(id)) break;
      categoryTop.push(id);
    }
  }
  const detailIds = new Set(voice.categories
    .filter((category) => categoryTop.includes(category.id))
    .flatMap((category) => category.features.map((feature) => feature.id)));
  const details = draft.feature_details && typeof draft.feature_details === "object"
    ? Object.fromEntries(Object.entries(draft.feature_details).filter(([id]) => detailIds.has(id)))
    : {};
  const futureIds = new Set(voice.futureOptions.map((option) => option.id));
  return {
    usage_frequency: typeof draft.usage_frequency === "string" ? draft.usage_frequency : "",
    overall_satisfaction: typeof draft.overall_satisfaction === "string" ? draft.overall_satisfaction : "",
    feature_priorities: priorities,
    feature_comments: comments,
    category_top: categoryTop,
    feature_details: details,
    future_interest: typeof draft.future_interest === "string" ? draft.future_interest : "",
    future_top: (() => {
      const ordered = [];
      if (!Array.isArray(draft.future_top)) return ordered;
      for (const id of draft.future_top.slice(0, 3)) {
        if (!futureIds.has(id) || ordered.includes(id)) break;
        ordered.push(id);
      }
      return ordered;
    })(),
  };
}

function appendRequired(legend) {
  const required = document.createElement("span");
  required.className = "required";
  required.textContent = "必須";
  legend.append(required);
}

function voiceFieldset(errorId, label, { required = true, className = "" } = {}) {
  const fieldset = document.createElement("fieldset");
  fieldset.className = `question question-card ${className}`.trim();
  fieldset.dataset.errorId = errorId;
  const legend = document.createElement("legend");
  legend.textContent = label;
  if (required) appendRequired(legend);
  fieldset.append(legend);
  return fieldset;
}

function voiceChoiceGroup(fieldset, name, options, value, onChange, compact = false) {
  const choices = document.createElement("div");
  choices.className = compact ? "choice-grid compact-options" : "choice-grid";
  options.forEach((option, index) => {
    const label = document.createElement("label");
    label.className = "choice";
    if (compact) label.title = option.label;
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = option.id;
    input.checked = value === option.id;
    if (compact) input.setAttribute("aria-label", option.label);
    input.addEventListener("change", () => onChange(option.id));
    const copy = document.createElement("span");
    if (compact) {
      copy.className = "rating-number";
      copy.textContent = String(index + 1);
    } else {
      copy.textContent = option.label;
    }
    label.append(input, copy);
    choices.append(label);
  });
  fieldset.append(choices);
}

function voiceScaleKey(options) {
  const key = document.createElement("ol");
  key.className = "scale-key";
  options.forEach((option, index) => {
    const item = document.createElement("li");
    item.textContent = `${index + 1}: ${option.label}`;
    key.append(item);
  });
  return key;
}

function voiceDropdown(fieldset, options, selected, onChange) {
  const select = document.createElement("select");
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "選んでください";
  select.append(placeholder);
  for (const option of options) {
    const item = document.createElement("option");
    item.value = option.id;
    item.textContent = option.label;
    item.selected = selected === option.id;
    select.append(item);
  }
  select.addEventListener("change", () => onChange(select.value));
  fieldset.append(select);
}

function voiceComment(feature, values, save, reused = false) {
  const details = document.createElement("details");
  details.className = "comment-details";
  const summary = document.createElement("summary");
  summary.textContent = reused
    ? "ひとこと要望を確認・編集（任意）"
    : "ひとこと要望を書く（任意）";
  const textarea = document.createElement("textarea");
  textarea.maxLength = 200;
  textarea.rows = 3;
  textarea.value = typeof values.feature_comments[feature.id] === "string"
    ? values.feature_comments[feature.id]
    : "";
  const count = document.createElement("span");
  count.className = "hint comment-count";
  const updateCount = () => { count.textContent = `${textarea.value.length} / 200文字`; };
  textarea.addEventListener("input", () => {
    values.feature_comments[feature.id] = textarea.value;
    updateCount();
    save();
  });
  updateCount();
  if (textarea.value) details.open = true;
  details.append(summary, textarea, count);
  return details;
}

function pageIntro(title, description) {
  const section = document.createElement("section");
  section.className = "voice-intro question-card";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const copy = document.createElement("p");
  copy.textContent = description;
  const list = document.createElement("ul");
  for (const message of [
    "今後の改善・開発優先度を決めるためのアンケートです",
    "任意コメントを書かなくても、回答完了と称号の受取に影響しません",
    "入力内容はこの端末のタブ内に一時保存されます",
  ]) {
    const item = document.createElement("li");
    item.textContent = message;
    list.append(item);
  }
  section.append(heading, copy, list);
  return section;
}

function voiceSelect(errorId, labelText, options, selected, optional, onChange, disabled = false) {
  const fieldset = voiceFieldset(errorId, labelText, { required: !optional, className: "ranking-card" });
  const select = document.createElement("select");
  select.setAttribute("aria-label", labelText);
  select.disabled = disabled;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = optional ? "選択しない" : "選んでください";
  select.append(placeholder);
  for (const option of options) {
    const item = document.createElement("option");
    item.value = option.id;
    item.textContent = option.label;
    item.selected = selected === option.id;
    select.append(item);
  }
  select.addEventListener("change", () => onChange(select.value));
  fieldset.append(select);
  return fieldset;
}

function voicePageTitle(title, description = "") {
  const fragment = document.createDocumentFragment();
  const heading = document.createElement("h2");
  heading.className = "voice-page-title";
  heading.textContent = title;
  fragment.append(heading);
  if (description) {
    const copy = document.createElement("p");
    copy.className = "voice-page-description";
    copy.textContent = description;
    fragment.append(copy);
  }
  return fragment;
}

function pruneVoiceDetails(voice, values) {
  const allowed = new Set(voice.categories
    .filter((category) => values.category_top.includes(category.id))
    .flatMap((category) => category.features.map((feature) => feature.id)));
  for (const featureId of Object.keys(values.feature_details)) {
    if (!allowed.has(featureId)) delete values.feature_details[featureId];
  }
}

function buildVoicePages(slug, survey, values) {
  const { voice } = survey;
  const save = () => saveDraft(slug, values);
  const pages = [
    {
      key: "intro",
      render: (page) => page.append(pageIntro(survey.title, survey.description)),
      validate: () => [],
    },
    {
      key: "basic",
      render: (page) => {
        page.append(voicePageTitle("まず、普段の利用について", "近いものを1つずつ選んでください。"));
        const usage = voiceFieldset("usage_frequency", "PlayNaviの利用頻度");
        voiceChoiceGroup(usage, "usage-frequency", voice.usageOptions, values.usage_frequency, (id) => {
          values.usage_frequency = id;
          save();
        });
        const satisfaction = voiceFieldset("overall_satisfaction", "PlayNavi全体への満足度");
        voiceChoiceGroup(satisfaction, "overall-satisfaction", voice.overallSatisfactionOptions, values.overall_satisfaction, (id) => {
          values.overall_satisfaction = id;
          save();
        });
        page.append(usage, satisfaction);
      },
      validate: () => validateVoiceAnswers(voice, values).missing
        .filter((id) => ["usage_frequency", "overall_satisfaction"].includes(id)),
    },
  ];

  voice.categories.forEach((category, categoryIndex) => {
    pages.push({
      key: `category:${category.id}`,
      render: (page) => {
        page.append(voicePageTitle(
          `${categoryIndex + 1}. ${category.label}`,
          "今後の改善・強化の優先度を、各機能1タップで選んでください。",
        ));
        page.append(voiceScaleKey(voice.priorityOptions));
        for (const feature of category.features) {
          const fieldset = voiceFieldset(`priority:${feature.id}`, feature.label, { className: "feature-card" });
          voiceChoiceGroup(
            fieldset,
            `priority-${feature.id}`,
            voice.priorityOptions,
            values.feature_priorities[feature.id],
            (id) => {
              values.feature_priorities[feature.id] = id;
              save();
            },
            true,
          );
          fieldset.append(voiceComment(feature, values, save));
          page.append(fieldset);
        }
      },
      validate: () => validateVoiceAnswers(voice, values).missing
        .filter((id) => category.features.some((feature) => id === `priority:${feature.id}`)),
    });
  });

  pages.push({
    key: "category_top",
    render: (page) => {
      page.append(voicePageTitle("力を入れてほしいカテゴリ", "1位は必須、2位は任意です。すべてを順位付けする必要はありません。"));
      const options = voice.categories.map(({ id, label }) => ({ id, label }));
      const rankings = document.createElement("div");
      rankings.className = "category-rankings";
      const renderRankings = () => {
        rankings.replaceChildren(
          voiceSelect("category_top:0", "1位", options, values.category_top[0] || "", false, (id) => {
            values.category_top = updateOrderedSelection(values.category_top, 0, id, 2);
            pruneVoiceDetails(voice, values);
            save();
            renderRankings();
          }),
          voiceSelect("category_top:1", "2位（任意）", options, values.category_top[1] || "", true, (id) => {
            values.category_top = updateOrderedSelection(values.category_top, 1, id, 2);
            pruneVoiceDetails(voice, values);
            save();
            renderRankings();
          }, !values.category_top[0]),
        );
      };
      page.append(rankings);
      renderRankings();
    },
    validate: () => {
      const missing = [];
      if (!values.category_top[0]) missing.push("category_top:0");
      if (values.category_top[0] && values.category_top[0] === values.category_top[1]) {
        missing.push("category_top:1");
      }
      return missing;
    },
  });

  for (const categoryId of values.category_top) {
    const category = voice.categories.find((item) => item.id === categoryId);
    if (!category) continue;
    pages.push({
      key: `detail:${category.id}`,
      render: (page) => {
        page.append(voicePageTitle(`${category.label}を詳しく`, "選んだカテゴリだけ、重要度と現在の満足度を教えてください。"));
        for (const feature of category.features) {
          const detail = values.feature_details[feature.id] || {};
          values.feature_details[feature.id] = detail;
          const card = document.createElement("section");
          card.className = "detail-feature question-card";
          const heading = document.createElement("h3");
          heading.textContent = feature.label;
          const importance = voiceFieldset(`importance:${feature.id}`, "あなたにとっての重要度", { className: "nested-question" });
          voiceDropdown(importance, voice.importanceOptions, detail.importance, (id) => {
            detail.importance = id;
            save();
          });
          const satisfaction = voiceFieldset(`satisfaction:${feature.id}`, "現在の満足度", { className: "nested-question" });
          voiceDropdown(satisfaction, voice.detailSatisfactionOptions, detail.satisfaction, (id) => {
            detail.satisfaction = id;
            save();
          });
          card.append(heading, importance, satisfaction, voiceComment(feature, values, save, true));
          page.append(card);
        }
      },
      validate: () => validateVoiceAnswers(voice, values).missing.filter((id) =>
        category.features.some((feature) => id === `importance:${feature.id}` || id === `satisfaction:${feature.id}`)
      ),
    });
  }

  pages.push({
    key: "future",
    render: (page) => {
      page.append(voicePageTitle("これから期待する機能", "期待する候補がある場合だけ、最大3つまで順位を選べます。"));
      const interest = voiceFieldset("future_interest", "期待する機能はありますか？");
      voiceChoiceGroup(interest, "future-interest", [
        { id: "yes", label: "ある" },
        { id: "none", label: "今はない" },
        { id: "unsure", label: "判断できない" },
      ], values.future_interest, (id) => {
        values.future_interest = id;
        if (id !== "yes") values.future_top = [];
        save();
        renderRankings();
      });
      const rankings = document.createElement("div");
      rankings.className = "future-rankings";
      const renderRankings = () => {
        rankings.replaceChildren();
        setVisible(rankings, values.future_interest === "yes");
        if (values.future_interest !== "yes") return;
        [0, 1, 2].forEach((rank) => {
          rankings.append(voiceSelect(
            `future_top:${rank}`,
            `${rank + 1}位${rank === 0 ? "" : "（任意）"}`,
            voice.futureOptions,
            values.future_top[rank] || "",
            rank > 0,
            (id) => {
              values.future_top = updateOrderedSelection(values.future_top, rank, id, 3);
              save();
              renderRankings();
            },
            rank > 0 && !values.future_top[rank - 1],
          ));
        });
        const candidates = document.createElement("div");
        candidates.className = "future-candidates";
        for (const option of voice.futureOptions) {
          const item = document.createElement("article");
          const heading = document.createElement("strong");
          heading.textContent = option.label;
          const description = document.createElement("p");
          description.textContent = option.description;
          item.append(heading, description);
          candidates.append(item);
        }
        rankings.append(candidates);
      };
      page.append(interest, rankings);
      renderRankings();
    },
    validate: () => {
      const missing = [];
      if (!["yes", "none", "unsure"].includes(values.future_interest)) missing.push("future_interest");
      if (values.future_interest === "yes") {
        if (!values.future_top[0]) missing.push("future_top:0");
        if (new Set(values.future_top).size !== values.future_top.length) {
          const duplicateIndex = values.future_top.findIndex((id, index) => id && values.future_top.indexOf(id) !== index);
          missing.push(`future_top:${Math.max(1, duplicateIndex)}`);
        }
      }
      return missing;
    },
  });

  pages.push({
    key: "review",
    render: (page) => {
      page.append(voicePageTitle("回答内容の確認", "入力は完了です。送信前に、回答漏れがないことを確認しました。"));
      const review = document.createElement("section");
      review.className = "review-card question-card";
      const answered = document.createElement("strong");
      answered.textContent = "26機能の優先度をすべて回答済み";
      const categories = document.createElement("p");
      categories.textContent = `重点カテゴリ: ${values.category_top.map((id) => voice.categories.find((item) => item.id === id)?.label).join("、")}`;
      const future = document.createElement("p");
      future.textContent = values.future_interest === "yes"
        ? `将来機能Top${values.future_top.length}: ${values.future_top.map((id) => voice.futureOptions.find((item) => item.id === id)?.label).join("、")}`
        : "将来機能: 順位選択なし";
      const note = document.createElement("p");
      note.textContent = "「回答を送信」を押すまで、回答はサーバーへ送られません。";
      review.append(answered, categories, future, note);
      page.append(review);
    },
    validate: () => [],
  });
  return pages;
}

function markVoiceMissing(missing) {
  for (const fieldset of elements.questions.querySelectorAll("[data-error-id]")) {
    fieldset.removeAttribute("aria-invalid");
  }
  for (const id of missing) {
    elements.questions.querySelector(`[data-error-id="${CSS.escape(id)}"]`)?.setAttribute("aria-invalid", "true");
  }
}

function focusVoiceError(id) {
  const fieldset = elements.questions.querySelector(`[data-error-id="${CSS.escape(id)}"]`);
  fieldset?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
  fieldset?.querySelector("input, select, textarea")?.focus({ preventScroll: true });
}

function pageKeyForVoiceError(voice, values, id) {
  if (["usage_frequency", "overall_satisfaction"].includes(id)) return "basic";
  const [, featureId] = id.split(":");
  if (id.startsWith("priority:")) {
    return `category:${voice.categories.find((category) => category.features.some((feature) => feature.id === featureId))?.id}`;
  }
  if (id.startsWith("category_top:")) return "category_top";
  if (id.startsWith("importance:") || id.startsWith("satisfaction:")) {
    return `detail:${voice.categories.find((category) => category.features.some((feature) => feature.id === featureId))?.id}`;
  }
  if (id.startsWith("future_")) return "future";
  return "basic";
}

function createVoiceController(slug, survey, values) {
  let currentKey = "intro";
  const render = (requestedKey = currentKey) => {
    const pages = buildVoicePages(slug, survey, values);
    let current = pages.findIndex((page) => page.key === requestedKey);
    if (current < 0) current = Math.max(0, pages.findIndex((page) => page.key === currentKey));
    if (current < 0) current = 0;
    currentKey = pages[current].key;
    const container = document.createElement("section");
    container.className = "survey-step-page voice-step-page";
    container.dataset.step = currentKey;
    pages[current].render(container);
    elements.questions.replaceChildren(container);
    const stepNumber = current + 1;
    elements.step.textContent = `${stepNumber} / ${pages.length}`;
    elements.progressLabel.textContent = currentKey === "review" ? "入力完了" : "回答の進捗";
    elements.progressBar.style.width = `${Math.round((stepNumber / pages.length) * 100)}%`;
    elements.progressTrack.setAttribute("aria-valuemax", String(pages.length));
    elements.progressTrack.setAttribute("aria-valuenow", String(stepNumber));
    setVisible(elements.back, current > 0);
    setVisible(elements.next, current < pages.length - 1);
    setVisible(elements.submit, currentKey === "review");
    elements.next.textContent = currentKey === "intro" ? "回答を始める" : "次へ";
    elements.error.textContent = "";
    setVisible(elements.error, false);

    elements.back.onclick = () => render(pages[Math.max(0, current - 1)].key);
    elements.next.onclick = () => {
      const missing = pages[current].validate();
      markVoiceMissing(missing);
      if (missing.length > 0) {
        elements.error.textContent = missing.some((id) => id.includes("top:1") || id.includes("top:2"))
          ? "同じ項目を複数の順位には選べません。"
          : "この画面の必須項目に回答してください。";
        setVisible(elements.error, true);
        focusVoiceError(missing[0]);
        return;
      }
      const freshPages = buildVoicePages(slug, survey, values);
      const freshIndex = freshPages.findIndex((page) => page.key === currentKey);
      render(freshPages[Math.min(freshIndex + 1, freshPages.length - 1)].key);
      window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
    };
  };
  render();
  return {
    showError(id, message) {
      currentKey = pageKeyForVoiceError(survey.voice, values, id);
      render(currentKey);
      elements.error.textContent = message;
      setVisible(elements.error, true);
      markVoiceMissing([id]);
      focusVoiceError(id);
    },
  };
}

function showSubmitConflict(payload) {
  elements.error.textContent = classifySubmitConflict(payload) === "answers_conflict"
    ? "このアンケートには別の回答がすでに保存されています。入力内容は保持しています。再送せず、サポートへお問い合わせください。"
    : "回答を送信できませんでした。入力内容は保持しています。時間をおいてもう一度お試しください。";
  setVisible(elements.error, true);
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
    if (response.status === 401) return loadSurvey(slug);
    const payload = await response.json();
    if (response.status === 409) {
      return showSubmitConflict(payload);
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

async function submitVoiceSurvey(slug, survey, values, controller) {
  const result = validateVoiceAnswers(survey.voice, values);
  if (result.missing.length > 0 || result.structurallyInvalid) {
    const first = result.missing[0] || "usage_frequency";
    controller.showError(first, result.structurallyInvalid
      ? "入力内容を確認してください。古い一時保存データがある場合は、該当項目を選び直してください。"
      : "必須の質問に回答してください。");
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
    if (response.status === 401) return loadSurvey(slug);
    const payload = await response.json();
    if (response.status === 409) {
      return showSubmitConflict(payload);
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
  if (survey.schemaVersion === 2) {
    const values = voiceValues(slug, survey.voice);
    const controller = createVoiceController(slug, survey, values);
    elements.form.onsubmit = (event) => {
      event.preventDefault();
      submitVoiceSurvey(slug, survey, values, controller);
    };
    setVisible(elements.form, true);
    return;
  }
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
    if (response.status === 401) {
      const preview = parseSurveyPreview(await response.json(), slug);
      return showLogin(slug, preview, authFailed);
    }
    if (response.status === 403) {
      return showLogin(slug, null, true);
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
    if (!exchanged) return loadSurvey(slug, true);
  }
  return loadSurvey(slug, authFailed);
}
