import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  classifySubmitConflict,
  parseSurveyRead,
  SurveyContractError,
  updateOrderedSelection,
  validateVoiceAnswers,
} from "../assets/survey-contract.mjs";
import { validAnswers } from "../api/surveys/[surveySlug]/responses.mjs";

const categories = [
  ["news_deals", "最新情報・イベント・お得情報", [
    ["game_news", "ゲームニュース"],
    ["events", "イベント情報"],
    ["subscriptions", "サブスクリプション情報"],
    ["sales", "セール情報"],
  ]],
  ["research", "ゲーム情報を調べる", [
    ["catalog_coverage", "ゲームカタログの収録数"],
    ["game_summary", "ゲーム説明・AI要約"],
    ["game_videos", "ゲーム動画"],
  ]],
  ["discovery", "遊びたいゲームを見つける", [
    ["for_you", "For You"],
    ["rankings", "ゲームランキング"],
    ["featured_games", "注目ゲーム一覧"],
    ["upcoming_games", "新作・発売予定ゲーム"],
  ]],
  ["library", "プレイ記録・Wishlistを管理する", [
    ["play_log", "プレイログ"],
    ["wishlist", "Wishlist"],
    ["bulk_edit", "一括編集"],
    ["external_import", "外部サービスからのインポート"],
  ]],
  ["social_creation", "ユーザーとつながる・まとめを作る", [
    ["social", "ソーシャル機能"],
    ["catalog_creation", "カタログ作成"],
    ["custom_rankings", "カスタムランキング"],
  ]],
  ["reflection_share", "自分の遊び方を振り返る・共有する", [
    ["my_best", "My Best"],
    ["game_poster", "ゲームポスター"],
    ["gamer_diagnosis", "ゲーマー診断"],
    ["profile_stats", "プロフィール統計"],
  ]],
  ["profile", "プロフィールを整える", [
    ["profile_games", "プロフィールのゲーム一覧"],
    ["profile_wishlist", "プロフィールのWishlist一覧"],
    ["honor_titles", "称号"],
    ["avatar_cover", "アバター・カバー画像のカスタマイズ"],
  ]],
].map(([id, label, features]) => ({
  id,
  label,
  features: features.map(([featureId, featureLabel]) => ({ id: featureId, label: featureLabel })),
}));

const futureOptions = [
  ["achievements", "トロフィー／実績の管理", "ゲーム内実績とPlayNavi独自実績を記録"],
  ["creator_posts", "クリエイター・ファン投稿", "キュレーション、カタログ、ファンアートの投稿・紹介"],
  ["collab_content", "PlayNavi独自コラボコンテンツ", "YouTubeクリエイター等との限定企画"],
  ["pc_web", "PC向けWeb版", "PCで使いやすい画面・操作"],
  ["game_communities", "ゲームごとのコミュニティ", "掲示板やレビューへのコメント"],
  ["guide_ai", "ゲーム攻略を相談できるAI", "ネタバレ度を調整可能"],
  ["library_ai", "ログ／Wishlistを操作するAI", "チャット・音声から記録や変更を実行"],
].map(([id, label, description]) => ({ id, label, description }));

const questions = {
  kind: "playnavi_voice_2026",
  usage_options: [
    ["daily", "ほぼ毎日"], ["several_weekly", "週に数回"], ["weekly", "週1程度"],
    ["several_monthly", "月に数回"], ["less_monthly", "月1未満"], ["inactive_recently", "最近使っていない"],
  ].map(([id, label]) => ({ id, label })),
  overall_satisfaction_options: [
    ["very_satisfied", "とても満足"], ["somewhat_satisfied", "やや満足"], ["neutral", "どちらともいえない"],
    ["somewhat_dissatisfied", "やや不満"], ["very_dissatisfied", "とても不満"], ["unknown", "判断できない"],
  ].map(([id, label]) => ({ id, label })),
  priority_options: [
    ["critical", "最優先で改善・強化してほしい"], ["high", "優先的に改善・強化してほしい"],
    ["medium", "改善してほしいが、急がなくてよい"], ["as_is", "現状のままでよい"],
    ["unknown", "よく知らない・判断できない"],
  ].map(([id, label]) => ({ id, label })),
  importance_options: [
    ["very_important", "とても重要"], ["somewhat_important", "やや重要"], ["neutral", "どちらともいえない"],
    ["not_very_important", "あまり重要でない"], ["not_important", "まったく重要でない"], ["unknown", "判断できない"],
  ].map(([id, label]) => ({ id, label })),
  detail_satisfaction_options: [
    ["very_satisfied", "とても満足"], ["somewhat_satisfied", "やや満足"], ["neutral", "どちらともいえない"],
    ["somewhat_dissatisfied", "やや不満"], ["very_dissatisfied", "とても不満"], ["never_used", "使ったことがない"],
    ["unknown", "判断できない"],
  ].map(([id, label]) => ({ id, label })),
  categories,
  future_options: futureOptions,
  comment_max_length: 200,
  second_category_optional: true,
  future_top_max: 3,
};

const payload = {
  status: "ok",
  survey: {
    slug: "playnavi-voice-2026",
    schema_version: 2,
    title: "PlayNavi Voice 2026",
    description: "今後の改善・開発優先度を決めるためのアンケートです。",
    questions,
    reward: { name_ja: "PlayNavi Voice 2026" },
  },
  response: null,
};

function completeAnswers(voice) {
  const selectedCategories = voice.categories.slice(0, 2);
  return {
    usage_frequency: voice.usageOptions[0].id,
    overall_satisfaction: voice.overallSatisfactionOptions[1].id,
    feature_priorities: Object.fromEntries(voice.features.map((feature) => [feature.id, voice.priorityOptions[2].id])),
    feature_comments: { game_news: "通知を細かく選びたい" },
    category_top: selectedCategories.map((category) => category.id),
    feature_details: Object.fromEntries(selectedCategories.flatMap((category) =>
      category.features.map((feature) => [feature.id, {
        importance: voice.importanceOptions[0].id,
        satisfaction: voice.detailSatisfactionOptions[1].id,
      }])
    )),
    future_interest: "yes",
    future_top: voice.futureOptions.slice(0, 3).map((option) => option.id),
  };
}

test("parses the exact PlayNavi Voice 2026 definition with all 7 categories and 26 features", () => {
  const survey = parseSurveyRead(payload, "playnavi-voice-2026");
  assert.equal(survey.schemaVersion, 2);
  assert.equal(survey.voice.kind, "playnavi_voice_2026");
  assert.equal(survey.voice.categories.length, 7);
  assert.equal(survey.voice.features.length, 26);
  assert.deepEqual(survey.voice.categories.map((category) => category.label), categories.map((category) => category.label));
  assert.deepEqual(survey.voice.categories.map((category) => category.id), [
    "news_deals", "research", "discovery", "library", "social_creation", "reflection_share", "profile",
  ]);
  assert.ok(survey.voice.features.some((feature) => feature.id === "game_summary"));
  assert.ok(survey.voice.features.some((feature) => feature.id === "play_log"));
  assert.ok(survey.voice.features.some((feature) => feature.id === "avatar_cover"));
  assert.deepEqual(survey.voice.futureOptions.map((option) => option.label), futureOptions.map((option) => option.label));
  assert.ok(survey.voice.futureOptions.some((option) => option.id === "collab_content"));
  assert.ok(survey.voice.futureOptions.some((option) => option.id === "guide_ai"));
});

test("v2 fails closed when counts or bounded campaign settings drift", () => {
  assert.throws(() => parseSurveyRead({
    ...payload,
    survey: { ...payload.survey, questions: { ...questions, categories: categories.slice(0, 6) } },
  }, "playnavi-voice-2026"), SurveyContractError);
  assert.throws(() => parseSurveyRead({
    ...payload,
    survey: { ...payload.survey, questions: { ...questions, unexpected: true } },
  }, "playnavi-voice-2026"), SurveyContractError);
  assert.throws(() => parseSurveyRead({
    ...payload,
    survey: {
      ...payload.survey,
      questions: {
        ...questions,
        categories: [{ ...categories[0], features: [{ ...categories[0].features[0], unexpected: true }, ...categories[0].features.slice(1)] }, ...categories.slice(1)],
      },
    },
  }, "playnavi-voice-2026"), SurveyContractError);
  assert.throws(() => parseSurveyRead({
    ...payload,
    survey: { ...payload.survey, questions: { ...questions, comment_max_length: 500 } },
  }, "playnavi-voice-2026"), SurveyContractError);
});

test("v2 rejects Backend boundary drift for IDs, text lengths, and basic option counts", () => {
  const invalidQuestions = [
    { ...questions, usage_options: questions.usage_options.slice(0, 5) },
    { ...questions, overall_satisfaction_options: questions.overall_satisfaction_options.slice(0, 5) },
    { ...questions, usage_options: [{ ...questions.usage_options[0], id: "Uppercase" }, ...questions.usage_options.slice(1)] },
    { ...questions, usage_options: [{ ...questions.usage_options[0], id: "has-hyphen" }, ...questions.usage_options.slice(1)] },
    { ...questions, usage_options: [{ ...questions.usage_options[0], id: `a${"x".repeat(40)}` }, ...questions.usage_options.slice(1)] },
    { ...questions, usage_options: [{ ...questions.usage_options[0], label: "x".repeat(121) }, ...questions.usage_options.slice(1)] },
    { ...questions, future_options: [{ ...questions.future_options[0], description: "x".repeat(241) }, ...questions.future_options.slice(1)] },
    { ...questions, categories: [{ ...questions.categories[0], label: "x".repeat(121) }, ...questions.categories.slice(1)] },
    {
      ...questions,
      categories: [{
        ...questions.categories[0],
        features: [{ ...questions.categories[0].features[0], id: "1invalid" }, ...questions.categories[0].features.slice(1)],
      }, ...questions.categories.slice(1)],
    },
  ];
  for (const invalid of invalidQuestions) {
    assert.throws(() => parseSurveyRead({
      ...payload,
      survey: { ...payload.survey, questions: invalid },
    }, "playnavi-voice-2026"), SurveyContractError);
  }
});

test("builds the exact v2 nested answer and reuses one feature_comments object", () => {
  const survey = parseSurveyRead(payload, "playnavi-voice-2026");
  const values = completeAnswers(survey.voice);
  const result = validateVoiceAnswers(survey.voice, values);
  assert.deepEqual(result.missing, []);
  assert.equal(result.structurallyInvalid, false);
  assert.equal(result.answers.feature_comments.game_news, "通知を細かく選びたい");
  assert.equal(Object.keys(result.answers.feature_priorities).length, 26);
  assert.equal(Object.keys(result.answers.feature_details).length, 7);
});

test("allows optional category second place and future Top1 completion", () => {
  const survey = parseSurveyRead(payload, "playnavi-voice-2026");
  const values = completeAnswers(survey.voice);
  values.category_top = values.category_top.slice(0, 1);
  values.feature_details = Object.fromEntries(Object.entries(values.feature_details).slice(0, 4));
  values.future_top = values.future_top.slice(0, 1);
  const result = validateVoiceAnswers(survey.voice, values);
  assert.deepEqual(result.missing, []);
  assert.equal(result.structurallyInvalid, false);
});

test("rejects duplicate ranks, missing feature ratings, and unknown nested keys", () => {
  const survey = parseSurveyRead(payload, "playnavi-voice-2026");
  const values = completeAnswers(survey.voice);
  delete values.feature_priorities.game_news;
  values.category_top = [values.category_top[0], values.category_top[0]];
  values.future_top = [values.future_top[0], values.future_top[0]];
  values.feature_comments.unknown_feature = "x";
  const result = validateVoiceAnswers(survey.voice, values);
  assert.ok(result.missing.includes("priority:game_news"));
  assert.equal(result.structurallyInvalid, true);
});

test("v2 UI preserves auth transport while providing dynamic low-burden pages", async () => {
  const source = await readFile(new URL("../assets/survey-app.mjs", import.meta.url), "utf8");
  assert.match(source, /buildVoicePages/);
  assert.match(source, /voiceComment\(feature, values, save, true\)/);
  assert.match(source, /category_top/);
  assert.match(source, /future_top/);
  assert.match(source, /prefers-reduced-motion/);
  assert.match(source, /!values\.category_top\[0\]/);
  assert.match(source, /!values\.future_top\[rank - 1\]/);
  assert.match(source, /このアンケートには別の回答がすでに保存されています/);
  assert.doesNotMatch(source, /category_top\s*=.*filter\(|future_top\s*=.*filter\(/);
  const voiceSubmit = source.slice(
    source.indexOf("async function submitVoiceSurvey"),
    source.indexOf("function showSurveyForm"),
  );
  const voiceConflictBranch = voiceSubmit.slice(
    voiceSubmit.indexOf("if (response.status === 409)"),
    voiceSubmit.indexOf("if ([404, 410].includes"),
  );
  assert.doesNotMatch(voiceConflictBranch, /clearDraft|showResult/);
  assert.match(voiceConflictBranch, /showSubmitConflict/);
  const v1Submit = source.slice(
    source.indexOf("async function submitSurvey"),
    source.indexOf("async function submitVoiceSurvey"),
  );
  const v1ConflictBranch = v1Submit.slice(
    v1Submit.indexOf("if (response.status === 409)"),
    v1Submit.indexOf("if ([404, 410].includes"),
  );
  assert.doesNotMatch(v1ConflictBranch, /clearDraft|showResult/);
  assert.match(v1ConflictBranch, /showSubmitConflict/);
  const start = source.slice(source.indexOf("export async function startSurvey"));
  assert.ok(start.indexOf("await exchangeHandoff") < start.indexOf("return loadSurvey"));
});

test("ordered ranks never promote a lower choice and clear dependent choices", () => {
  assert.deepEqual(updateOrderedSelection(["first", "second"], 0, "", 2), []);
  assert.deepEqual(updateOrderedSelection(["first", "second", "third"], 1, "", 3), ["first"]);
  assert.deepEqual(updateOrderedSelection(["first"], 2, "third", 3), ["first"]);
  assert.deepEqual(updateOrderedSelection(["first", "second"], 1, "first", 2), ["first"]);
  assert.deepEqual(updateOrderedSelection(["first", "second", "third"], 0, "second", 3), ["second"]);
});

test("409 answer conflict stays distinct from generic failure; neither is already answered", () => {
  assert.equal(classifySubmitConflict({
    status: "error",
    error: { code: "ALREADY_SUBMITTED_CONFLICT" },
  }), "answers_conflict");
  assert.equal(classifySubmitConflict({ status: "error", error: { code: "SESSION_INVALID" } }), "submit_failed");
  assert.equal(classifySubmitConflict(null), "submit_failed");
});

test("Web proxy accepts bounded v2 nested answers and keeps rejecting extra keys", () => {
  const survey = parseSurveyRead(payload, "playnavi-voice-2026");
  const answers = validateVoiceAnswers(survey.voice, completeAnswers(survey.voice)).answers;
  assert.equal(validAnswers(answers), true);
  assert.equal(validAnswers({ ...answers, unexpected: "x" }), false);
  const oversizedComments = Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [`comment_${index}`, "x".repeat(1_800)]),
  );
  assert.ok(Buffer.byteLength(JSON.stringify({ ...answers, feature_comments: oversizedComments })) > 64 * 1024);
  assert.equal(validAnswers({ ...answers, feature_comments: oversizedComments }), false);
  assert.equal(validAnswers({ usage_frequency: "weekly" }), true);
});
