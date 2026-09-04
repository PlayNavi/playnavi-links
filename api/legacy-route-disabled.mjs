import { sendJson } from "./_lib/http.mjs";

export default function handler(_request, response) {
  return sendJson(response, 404, { status: "not_found" });
}
