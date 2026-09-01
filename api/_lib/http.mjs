export const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

export function methodNotAllowed(response, allowed) {
  response.setHeader("Allow", allowed.join(", "));
  return sendJson(response, 405, { status: "method_not_allowed" });
}

export function sendJson(response, status, payload) {
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) {
    response.setHeader(name, value);
  }
  response.status(status).json(payload);
}

export function parseJsonBody(request) {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
    return null;
  }
  return request.body;
}

export function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

export function isSurveyKey(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,62}$/.test(value);
}

export function safeReturnPath(value) {
  if (typeof value !== "string") return null;
  const match = /^\/surveys\/([a-z0-9][a-z0-9-]{0,62})$/.exec(value);
  return match ? `/surveys/${match[1]}` : null;
}

export function hasExpectedOrigin(request, webOrigin) {
  const origin = request.headers.origin;
  return typeof origin === "string" && origin === webOrigin;
}

export function appendSetCookie(response, value) {
  const current = response.getHeader("Set-Cookie");
  if (!current) {
    response.setHeader("Set-Cookie", value);
    return;
  }
  response.setHeader("Set-Cookie", Array.isArray(current) ? [...current, value] : [current, value]);
}

export function parseCookies(header = "") {
  const result = {};
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    try {
      result[name] = decodeURIComponent(value);
    } catch {
      // Ignore malformed cookies rather than reflecting their value anywhere.
    }
  }
  return result;
}

export function serializeCookie(name, value, options = {}) {
  if (name.startsWith("__Host-") && (options.path !== "/" || options.secure === false)) {
    throw new Error("__Host- cookies require Secure and Path=/");
  }
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || "/"}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, options.maxAge)}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.secure !== false) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite || "Lax"}`);
  return parts.join("; ");
}

