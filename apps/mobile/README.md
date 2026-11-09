# Aistimator — business app (Expo)

On-site quoting for the business (T-137): sign in, create a quote with guided photos and the
service's own questions, watch it price, confirm open questions on site, share the customer link.

```bash
cp .env.example .env      # API URL (use your Mac's LAN IP on a phone), Supabase URL + anon key
npx expo start            # scan the QR code with Expo Go
pnpm --filter @estimator/mobile typecheck && pnpm --filter @estimator/mobile test
npx expo export --platform ios   # full JS bundle check, no device needed
```

Auth: the Supabase session lives in the keychain; API calls send the access token as a bearer
(`Docs/02-api-contracts.md`, "Business app APIs"). Pure logic lives in `src/lib` and is unit-tested.
