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

The Android association uses the exact 32-byte SHA-256 fingerprint copied from
Play App Signing. Rerun both validation commands after any association-file
change. Do not derive or guess the fingerprint.
