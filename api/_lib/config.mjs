const DEFAULT_FUNCTIONS = {
  handoffExchange: "survey-handoff-exchange",
  providerSessionCreate: "survey-provider-session-create",
  definition: "survey-read",
  submit: "survey-submit",
};

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
export function getConfig() {
  const supabaseUrl = required("SUPABASE_URL").replace(/\/$/, "");
  const webOrigin = required("PLAYNAVI_WEB_ORIGIN").replace(/\/$/, "");
  if (!/^https:\/\//.test(supabaseUrl) || !/^https:\/\//.test(webOrigin)) {
    throw new Error("SUPABASE_URL and PLAYNAVI_WEB_ORIGIN must use https");
  }
  return {
    supabaseUrl,
    publishableKey: required("SUPABASE_PUBLISHABLE_KEY"),
    webOrigin,
    functions: {
      handoffExchange:
        process.env.SURVEY_HANDOFF_EXCHANGE_FUNCTION || DEFAULT_FUNCTIONS.handoffExchange,
      providerSessionCreate:
        process.env.SURVEY_PROVIDER_SESSION_CREATE_FUNCTION || DEFAULT_FUNCTIONS.providerSessionCreate,
      definition: process.env.SURVEY_DEFINITION_FUNCTION || DEFAULT_FUNCTIONS.definition,
      submit: process.env.SURVEY_SUBMIT_FUNCTION || DEFAULT_FUNCTIONS.submit,
    },
  };
}

export function getProviderConfig(provider) {
  if (provider === "google") {
    return {
      clientId: required("GOOGLE_WEB_CLIENT_ID"),
      clientSecret: required("GOOGLE_WEB_CLIENT_SECRET"),
    };
  }
  if (provider === "apple") {
    return {
      clientId: required("APPLE_WEB_SERVICES_ID"),
      clientSecret: required("APPLE_WEB_CLIENT_SECRET"),
    };
  }
  throw new Error("Unsupported provider");
}

export function getSurveyBrokerSecret() {
  const value = required("SURVEY_WEB_BACKEND_SECRET");
  if (value.length < 43) throw new Error("SURVEY_WEB_BACKEND_SECRET must be at least 256 bits");
  return value;
}

export function functionUrl(config, name) {
  return `${config.supabaseUrl}/functions/v1/${encodeURIComponent(config.functions[name])}`;
}
