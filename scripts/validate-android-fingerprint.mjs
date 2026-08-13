import { readFile } from "node:fs/promises";

const assetLinks = JSON.parse(
  await readFile(new URL("../.well-known/assetlinks.json", import.meta.url), "utf8"),
);
const fingerprints = assetLinks.flatMap(
  (entry) => entry?.target?.sha256_cert_fingerprints || [],
);
const SHA256_FINGERPRINT = /^(?:[0-9a-f]{2}:){31}[0-9a-f]{2}$/i;
const invalid = fingerprints.filter((value) => !SHA256_FINGERPRINT.test(value));

if (fingerprints.length === 0 || invalid.length > 0) {
  console.error(
    "STOP: .well-known/assetlinks.json requires the exact Play App Signing SHA-256 fingerprint (32 bytes). Do not deploy or guess this value.",
  );
  process.exitCode = 1;
} else {
  console.log(`OK: validated ${fingerprints.length} Android SHA-256 fingerprint(s)`);
}
