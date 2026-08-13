import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_ORIGIN,
  ResolveError,
  canonicalTargetFromPath,
  isValidShortCode,
  resolveShortLink,
  shortCodeFromPath,
} from "../assets/link-routing.mjs";

const UUID_A = "12345678-1234-4234-8234-123456789012";
const UUID_B = "abcdefab-cdef-4def-8def-abcdefabcdef";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const NON_VERSIONED_UUID = "abcdefab-cdef-0def-fdef-abcdefabcdef";
const CODE = "AbCdEf012345_-xy";

test("accepts only an exact 16-character short code", () => {
  assert.equal(CODE.length, 16);
  assert.equal(isValidShortCode(CODE), true);
  assert.equal(shortCodeFromPath(`/s/${CODE}`), CODE);
  assert.equal(shortCodeFromPath(`/s/${CODE}/extra`), null);
  assert.equal(isValidShortCode("too-short"), false);
  assert.equal(isValidShortCode("123456789012345!"), false);
});

test("allowlists the five canonical target shapes", () => {
  const cases = [
    ["/game/42", "game"],
    [`/game/42?logId=${UUID_A}`, "log"],
    [`/users/${UUID_A}`, "user"],
    [`/users/${UUID_A}/custom-rankings/${UUID_B}`, "ranking"],
    [`/catalogs/${UUID_B}`, "catalog"],
  ];

  for (const [path, type] of cases) {
    assert.deepEqual(canonicalTargetFromPath(path), {
      type,
      canonicalPath: path,
      canonicalUrl: `${CANONICAL_ORIGIN}${path}`,
      schemeUrl: `playnavi:/${path}`,
    });
  }
});

test("accepts every PostgreSQL UUID shape without version or variant restrictions", () => {
  assert.equal(canonicalTargetFromPath(`/users/${NIL_UUID}`)?.type, "user");
  assert.equal(
    canonicalTargetFromPath(`/catalogs/${NON_VERSIONED_UUID}`)?.type,
    "catalog",
  );
});

test("rejects arbitrary URLs, schemes, queries, fragments, and short paths", () => {
  for (const value of [
    "https://evil.example/game/42",
    "//evil.example/game/42",
    "javascript:alert(1)",
    `/game/42?logId=${UUID_A}&next=https://evil.example`,
    "/game/42#fragment",
    "/game/9223372036854775808",
    "/game/12345678901234567890",
    `/users/${UUID_A}?x=1`,
    `/s/${CODE}`,
  ]) {
    assert.equal(canonicalTargetFromPath(value), null, value);
  }
});

test("resolver consumes canonical_path and never trusts an absolute URL", async () => {
  const target = await resolveShortLink(CODE, {
    fetchImpl: async (url, options) => {
      assert.equal(url, `/api/share-links/${CODE}`);
      assert.equal(options.method, "GET");
      assert.equal(options.cache, "no-store");
      assert.equal(options.credentials, "omit");
      return new Response(JSON.stringify({
        status: "ok",
        code: CODE,
        target_type: "game",
        canonical_path: "/game/42",
        canonical_url: "https://evil.example/game/42",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(target.canonicalUrl, `${CANONICAL_ORIGIN}/game/42`);

  await assert.rejects(
    resolveShortLink(CODE, {
      fetchImpl: async () =>
        new Response(JSON.stringify({
          status: "ok",
          code: CODE,
          target_type: "game",
          canonical_path: "https://evil.example/game/42",
        }), {
          status: 200,
        }),
    }),
    (error) => error instanceof ResolveError && error.kind === "temporary",
  );
});

test("resolver fails closed on status, code, or target_type mismatches", async () => {
  for (const body of [
    { status: "not_found", code: CODE, target_type: "game", canonical_path: "/game/42" },
    { status: "ok", code: "OtherCode1234_-x", target_type: "game", canonical_path: "/game/42" },
    { status: "ok", code: CODE, target_type: "user", canonical_path: "/game/42" },
  ]) {
    await assert.rejects(
      resolveShortLink(CODE, {
        fetchImpl: async () => new Response(JSON.stringify(body), { status: 200 }),
      }),
      (error) => error.kind === "temporary",
    );
  }
});

test("maps unavailable and retryable resolver failures separately", async () => {
  await assert.rejects(
    resolveShortLink(CODE, { fetchImpl: async () => new Response(null, { status: 404 }) }),
    (error) => error.kind === "unavailable" && error.status === 404,
  );
  for (const status of [400, 401, 403, 429, 500, 503]) {
    await assert.rejects(
      resolveShortLink(CODE, { fetchImpl: async () => new Response(null, { status }) }),
      (error) => error.kind === "temporary" && error.status === status,
    );
  }
  await assert.rejects(
    resolveShortLink(CODE, {
      fetchImpl: async () => {
        throw new Error("offline");
      },
    }),
    (error) => error.kind === "temporary",
  );
});
