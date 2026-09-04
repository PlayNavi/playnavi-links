import assert from "node:assert/strict";
import test from "node:test";

import { getConfig, getProviderConfig } from "../api/_lib/config.mjs";

function withConfigEnvironment(webOrigin, callback) {
  const names = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "PLAYNAVI_WEB_ORIGIN"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.SUPABASE_URL = "https://staging-project.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-test-key";
  process.env.PLAYNAVI_WEB_ORIGIN = webOrigin;
  try {
    return callback();
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

function withAppleEnvironment(values, callback) {
  const names = [
    "APPLE_WEB_SERVICES_ID",
    "APPLE_TEAM_ID",
    "APPLE_WEB_KEY_ID",
    "APPLE_WEB_PRIVATE_KEY",
    "APPLE_WEB_CLIENT_SECRET",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  Object.assign(process.env, values);
  try {
    return callback();
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

test("accepts only a PlayNavi-controlled Web origin", () => {
  withConfigEnvironment("https://survey-stg.playnavilab.com", () => {
    assert.equal(getConfig().webOrigin, "https://survey-stg.playnavilab.com");
    assert.equal(getConfig().functions.guestSessionCreate, "survey-guest-session-create");
  });

  for (const unmanagedOrigin of [
    "https://playnavi-links-git-survey.example.vercel.app",
    "https://survey-stg.playnavilab.com.example.com",
    "https://survey-stg.playnavilab.com:8443",
  ]) {
    withConfigEnvironment(unmanagedOrigin, () => {
      assert.throws(() => getConfig(), /PlayNavi-controlled https origin/);
    });
  }
});

test("accepts Apple signing material and normalizes Windows line endings", () => {
  withAppleEnvironment({
    APPLE_WEB_SERVICES_ID: "com.playnavilab.playnavi.survey.stg",
    APPLE_TEAM_ID: "9GSX6744M2",
    APPLE_WEB_KEY_ID: "A1B2C3D4E5",
    APPLE_WEB_PRIVATE_KEY:
      "-----BEGIN PRIVATE KEY-----\r\ntest-key-material\r\n-----END PRIVATE KEY-----\r\n",
  }, () => {
    assert.deepEqual(getProviderConfig("apple"), {
      clientId: "com.playnavilab.playnavi.survey.stg",
      teamId: "9GSX6744M2",
      keyId: "A1B2C3D4E5",
      privateKey: "-----BEGIN PRIVATE KEY-----\ntest-key-material\n-----END PRIVATE KEY-----",
    });
  });
});

test("rejects fixed Apple client secrets and malformed signing material", () => {
  withAppleEnvironment({
    APPLE_WEB_SERVICES_ID: "com.playnavilab.playnavi.survey.stg",
    APPLE_WEB_CLIENT_SECRET: "retired-fixed-jwt",
  }, () => {
    assert.throws(() => getProviderConfig("apple"), /APPLE_TEAM_ID/);
  });

  const valid = {
    APPLE_WEB_SERVICES_ID: "com.playnavilab.playnavi.survey.stg",
    APPLE_TEAM_ID: "9GSX6744M2",
    APPLE_WEB_KEY_ID: "A1B2C3D4E5",
    APPLE_WEB_PRIVATE_KEY:
      "-----BEGIN PRIVATE KEY-----\ntest-key-material\n-----END PRIVATE KEY-----",
  };
  for (const [name, value, expected] of [
    ["APPLE_TEAM_ID", "short", /APPLE_TEAM_ID/],
    ["APPLE_WEB_KEY_ID", "short", /APPLE_WEB_KEY_ID/],
    ["APPLE_WEB_PRIVATE_KEY", "not-a-private-key", /APPLE_WEB_PRIVATE_KEY/],
  ]) {
    withAppleEnvironment({ ...valid, [name]: value }, () => {
      assert.throws(() => getProviderConfig("apple"), expected);
    });
  }
});
