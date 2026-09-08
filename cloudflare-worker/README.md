# Warranty Vault Cloudflare AI Worker

This worker is the hosted AI option for the Warranty Vault frontend. It keeps
the existing local Node/Qwen bridge unchanged. Select the hosted worker by
setting `VITE_API_BASE_URL` in Vercel to this worker's URL.

## What it provides

- `GET /api/health`
- `POST /api/ai/chat`
- `POST /api/ai/extract-invoice`

The worker uses the Cloudflare Workers AI binding; it does not put any AI key
in the browser bundle. OCR, warranty rules, fraud checks, risk scoring, and
Firestore remain in the existing frontend.

## Deploy

1. Create/login to a Cloudflare account, then run `npx wrangler login` here.
2. Run `npm install` and `npm run deploy`.
3. Copy the deployed `workers.dev` URL.
4. In Vercel, set `VITE_API_BASE_URL` to that URL and redeploy the frontend.
5. Add the final Vercel domain to `ALLOWED_ORIGINS` in `wrangler.toml`, then
   deploy the worker again.

The hosted service receives OCR text and chat product context. Do not use it
when all invoice/chat data must remain local; retain `VITE_API_BASE_URL` as
`http://localhost:3000` to use the existing Qwen bridge instead.
