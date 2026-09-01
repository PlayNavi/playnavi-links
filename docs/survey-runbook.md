# Survey web runbook

## Delivery path and intentionally new server surface

This repository previously deployed only static files and two rewrites. That
path cannot issue an HttpOnly cookie. The survey keeps the existing static SPA
delivery, and adds the minimum server surface supported by Vercel: Node.js
Functions in `api/`. Vercel gives filesystem Functions precedence over the
final SPA catch-all rewrite.

| Concern | Reused evidence | Intentional difference | Verification |
| --- | --- | --- | --- |
| Production host | `links.playnavilab.com` association files and SPA catch-all | `/surveys/:slug` is added ahead of the catch-all | `tests/static-config.test.mjs` |
| API forwarding | Existing same-origin short-link proxy | Survey calls are server-side Functions so credentials never enter browser JS | `tests/server-security.test.mjs` |
| Sensitive entry URL | Existing short links use `no-store`, `no-referrer`, `noindex` | Handoff code uses a URL fragment and is removed before the first fetch | source invariant test |
| Login | App already uses Google/Apple provider identities | Web verifies provider tokens directly, then exact-matches the provider subject without invoking Supabase signup | source invariant test + pre-production login matrix |
| Survey UI | Existing static no-build UI | Declarative questions and draft persistence are added | `tests/survey-contract.test.mjs` |

History checks used for this design:

- `git log -S'api/share-links' -- .` identifies `d0c6d88`, the successful
  same-origin proxy/static fallback pattern.
- `git log -S'supabase' -- .` identifies `bb8d9c2`, the existing Supabase
  Function rewrite pattern.
- No earlier HttpOnly, SameSite, survey, SSR, or runbook implementation exists
  in this repository.

## Environment variables

Configure these in Vercel for Production and the intended Preview environment.
Never prefix them with `PUBLIC_` or expose them to browser assets.

| Variable | Required value |
| --- | --- |
| `SUPABASE_URL` | PlayNavi Supabase project HTTPS URL |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable/anon project key; never the service-role key |
| `PLAYNAVI_WEB_ORIGIN` | `https://links.playnavilab.com` in production |
| `GOOGLE_WEB_CLIENT_ID` | Dedicated Google Web OAuth client ID |
| `GOOGLE_WEB_CLIENT_SECRET` | Dedicated Google Web OAuth client secret |
| `APPLE_WEB_SERVICES_ID` | Apple Services ID associated with the existing primary App ID |
| `APPLE_WEB_CLIENT_SECRET` | Signed Apple client-secret JWT; rotate before its expiry and at least every six months |
| `SURVEY_WEB_BACKEND_SECRET` | Independent 256-bit+ broker secret, identical to Supabase `SURVEY_WEB_BACKEND_SECRET` |
| `SURVEY_HANDOFF_EXCHANGE_FUNCTION` | Optional; default `survey-handoff-exchange` |
| `SURVEY_PROVIDER_SESSION_CREATE_FUNCTION` | Optional; default `survey-provider-session-create` |
| `SURVEY_DEFINITION_FUNCTION` | Optional; default `survey-read` |
| `SURVEY_SUBMIT_FUNCTION` | Optional; default `survey-submit` |

Provider and broker secrets are server-only Vercel variables. Never put them
in `vercel.json`, browser assets, Preview comments, or source control.

## Server contract

The app creates a handoff with `survey-handoff-create` and puts only the opaque
code in `#handoff`. The Vercel server consumes it through:

```text
POST survey-handoff-exchange { code }
-> { status: "ok", survey_slug, session_token, expires_at }
```

Google uses state, nonce, and S256 PKCE. Apple uses state, nonce, a single-use
five-minute authorization code, and the signed Apple client secret. Apple's
published REST authorization/token parameter lists do not define
`code_challenge`/`code_verifier`, so this implementation does not send an
undocumented Apple PKCE parameter. Both returned ID tokens are verified against
the provider JWKS and exact issuer, audience, expiry, and nonce constraints.
The callback then calls:

```text
POST survey-provider-session-create
X-PlayNavi-Web-Secret: <independent 256-bit broker secret>
{ survey_slug, provider: "google" | "apple", provider_subject }
-> { status: "ok", survey_slug, session_token, expires_at }
```

The privileged Supabase function exact-matches
`auth.identities(provider, provider_id)` and an active PlayNavi profile. It
does not create a user and never merges on email. Only `session_token` is set
for at most 60 minutes as
`__Host-pn_survey_session; Secure; HttpOnly; SameSite=Lax; Path=/`. Read and
submit send it server-to-server as `X-PlayNavi-Survey-Session`; it is never
returned in browser JSON. The cookie is removed after a successful submit
response; the hashed DB session naturally expires so a lost response can be
retried idempotently.

```text
POST survey-read { survey_slug }
POST survey-submit { survey_slug, answers }
```

`answers` is an object keyed by question ID. Values are a string for single
choice/short text and a unique string array for multiple choice. The server
contract and client parser are covered by `tests/survey-contract.test.mjs`.

## External authentication setup

1. Register exact callback `https://links.playnavilab.com/api/auth/callback`
   on both the dedicated Google Web client and Apple Services ID. Do not allow
   arbitrary production paths or hosts.
2. Associate the Apple Services ID with the same primary App ID used by the
   native PlayNavi identity. Generate and securely set its client-secret JWT.
3. Provision a new 256-bit broker secret in both Vercel and Supabase. It must
   not be the Supabase service-role key. Rotate it independently.
4. Add a recurring Apple client-secret rotation reminder before its configured
   expiry (at least every six months).
5. Do not enable analytics, session replay, Sentry request-body capture, or
   Vercel request-body logging on survey routes.

Primary references reviewed on 2026-08-31:

- Google web-server OAuth and state: https://developers.google.com/identity/protocols/oauth2/web-server
- Google OpenID Connect verification: https://developers.google.com/identity/openid-connect/openid-connect
- Apple manual authorization: https://developer.apple.com/documentation/signinwithapple/incorporating-sign-in-with-apple-into-other-platforms
- Apple authorization-code validation: https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens
- Supabase SSR guidance reviewed but intentionally not used for this no-signup flow: https://supabase.com/docs/guides/auth/server-side/advanced-guide
- Vercel Node.js Functions: https://vercel.com/docs/functions/runtimes/node-js
- Vercel cache control: https://vercel.com/docs/caching/cache-control-headers

## Pre-production checks

Run locally:

```sh
npm test
npm run validate:android
```

Then deploy to an isolated Preview only after the Supabase Functions are
available. Do not use a production handoff code in Preview.

Test all of the following before production promotion:

1. OTA Google user and OTA Apple user: fragment disappears before any request;
   no login prompt; correct existing PlayNavi profile receives one response and
   at most one reward.
2. Older/non-OTA Google and Apple users: the direct provider callback returns
   to a clean survey URL and resolves the exact existing provider subject. Test
   with the same provider used in the app. A different provider, Apple relay
   identity, email-only match, or provider account without a PlayNavi profile
   is rejected rather than created or merged.
3. Expired, reused, malformed, and wrong-survey handoff codes fail closed.
4. Refresh during entry preserves the draft in `sessionStorage`; successful or
   already-submitted completion removes it.
5. Closed/not-yet-open surveys, invalid answers, retry, already answered, and
   newly awarded title displays match the API result.
6. Browser storage contains no provider/Supabase access, ID, or refresh token.
   The only durable auth cookie is opaque (not JWT-shaped, including no `eyJ`
   prefix), expires in at most 60 minutes, and cookies
   have `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`.
7. Vercel logs, Supabase Function logs, Sentry, Referer, browser history, and
   analytics contain no UID, answers, handoff/session token, or request body.
8. The provider callback's query authorization code is protocol-required,
   single-use, short-lived, and immediately receives a `303` with `no-store`
   and `no-referrer`. Confirm platform access logs do not retain query strings.
9. Responses carrying user state have `Cache-Control: private, no-store` and
   survey documents have strict CSP and `Referrer-Policy: no-referrer`.

Rollback is a normal Vercel deployment rollback plus disabling the survey
definition. Do not delete responses or revoke unrelated user sessions.

## Production stop conditions

Do not deploy or advertise the common URL until all of these are true:

- Google/Apple production callbacks, server secrets, and Apple secret-rotation
  ownership are configured and independently reviewed.
- The Supabase provider-session function enforces the broker secret with a
  constant-time comparison and exact `(provider, provider_id)` lookup only.
- Staging proves native existing UID equals the subject-matched Web UID for one
  real Google and one real Apple account, while auth identity/profile row counts
  do not increase. Different-provider and Apple relay/email-only cases fail.
- Staging proves malformed/reused handoffs and forged provider-session calls
  fail, broker/provider/session values never reach logs, and no Supabase signup
  endpoint is called by the Web implementation.
- The production logging configuration is known not to retain OAuth callback
  query strings. The standard provider authorization code is unavoidable in a
  redirect-mode callback, but is single-use, short-lived, state/nonce-bound
  (and Google PKCE-bound), immediately removed by `303`, and never app-logged.
