import assert from "node:assert/strict";
import test from "node:test";

import { getConfig } from "../api/_lib/config.mjs";

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

test("accepts only a PlayNavi-controlled Web origin", () => {
  withConfigEnvironment("https://survey-stg.playnavilab.com", () => {
    assert.equal(getConfig().webOrigin, "https://survey-stg.playnavilab.com");
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
