const DEFAULT_FUNCTIONS = {
  handoffExchange: "survey-handoff-exchange",
  providerSessionCreate: "survey-provider-session-create",
  guestSessionCreate: "survey-guest-session-create",
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
  if (!/^https:\/\//.test(supabaseUrl)) {
    throw new Error("SUPABASE_URL must use https");
  }
  let parsedWebOrigin;
  try {
    parsedWebOrigin = new URL(webOrigin);
  } catch {
    throw new Error("PLAYNAVI_WEB_ORIGIN must be a PlayNavi-controlled https origin");
  }
  if (
    parsedWebOrigin.protocol !== "https:" ||
    parsedWebOrigin.origin !== webOrigin ||
    parsedWebOrigin.username ||
    parsedWebOrigin.password ||
    parsedWebOrigin.port ||
    !parsedWebOrigin.hostname.endsWith(".playnavilab.com")
  ) {
    throw new Error("PLAYNAVI_WEB_ORIGIN must be a PlayNavi-controlled https origin");
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
      guestSessionCreate:
        process.env.SURVEY_GUEST_SESSION_CREATE_FUNCTION || DEFAULT_FUNCTIONS.guestSessionCreate,
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
    const teamId = required("APPLE_TEAM_ID");
    const keyId = required("APPLE_WEB_KEY_ID");
    const privateKey = required("APPLE_WEB_PRIVATE_KEY").replace(/\r\n/g, "\n");
    if (!/^[A-Z0-9]{10}$/.test(teamId)) {
      throw new Error("APPLE_TEAM_ID must be a 10-character Apple Team ID");
    }
    if (!/^[A-Z0-9]{10}$/.test(keyId)) {
      throw new Error("APPLE_WEB_KEY_ID must be a 10-character Apple Key ID");
    }
    if (!/^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----$/.test(privateKey)) {
      throw new Error("APPLE_WEB_PRIVATE_KEY must be an Apple PKCS#8 .p8 private key");
    }
    return {
      clientId: required("APPLE_WEB_SERVICES_ID"),
      teamId,
      keyId,
      privateKey,
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
