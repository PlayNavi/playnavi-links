# PlayNavi links

Static fallback pages and domain-association files for PlayNavi links.

## Short-link web contract

`/s/{16-character code}` resolves through the same-origin route
`/api/share-links/{code}`. `vercel.json` proxies that request to the public
Supabase Edge Function `short-links-resolve`.

The browser accepts only a successful payload whose `status`, `code`,
`target_type`, and `canonical_path` agree. `canonical_path` must be one of the
five allowlisted `game`, `log`, `user`, `ranking`, or `catalog` route shapes.
An absolute URL from the API is never used for navigation.

## Validation

```sh
npm test
npm run validate:android
```

The Android validation intentionally fails on the repository's current
20-byte certificate fingerprint. Before associating or deploying a new host,
replace it with the exact 32-byte SHA-256 fingerprint copied from Play App
Signing, then rerun the validation. Do not derive or guess the fingerprint.
