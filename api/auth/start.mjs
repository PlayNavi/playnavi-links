import { createAuthorization, setOAuthState } from "../_lib/auth.mjs";
import { getConfig, getProviderConfig } from "../_lib/config.mjs";
import {
  PRIVATE_HEADERS,
  firstQueryValue,
  safeReturnPath,
  sendJson,
} from "../_lib/http.mjs";

export default async function handler(request, response) {
  if (request.method !== "GET") return sendJson(response, 405, { status: "method_not_allowed" });
  const provider = firstQueryValue(request.query.provider);
  const returnPath = safeReturnPath(firstQueryValue(request.query.returnTo));
  if (!returnPath || !["google", "apple"].includes(provider)) {
    return sendJson(response, 400, { status: "invalid_request" });
  }

  try {
    const config = getConfig();
    const providerConfig = getProviderConfig(provider);
    const redirectUri = new URL("/api/auth/callback", config.webOrigin).toString();
    const authorization = createAuthorization(provider, providerConfig, redirectUri, returnPath);
    setOAuthState(response, authorization.state);
    for (const [name, value] of Object.entries(PRIVATE_HEADERS)) response.setHeader(name, value);
    return response.redirect(303, authorization.url);
  } catch {
    return sendJson(response, 503, { status: "unavailable" });
  }
}

