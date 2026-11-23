# Autonomous Warranty Intelligence System

A local-first, zero-cost warranty tracking platform. Every intelligence decision
(OCR parsing, classification, fraud detection, risk scoring, claim eligibility)
runs in the browser as deterministic JavaScript. A local Qwen model (llama.cpp)
acts as the conversational assistant — it reasons over your warranty records
but never invents data: deterministic engines and stored product fields remain
the source of truth.

## Structure

```
Autonomous-Warranty-Intelligence-System/
├── frontend/          Vite + React app (UI + local AI engine)
│   └── src/lib/engine/  Browser-side intelligence modules
└── backend/           Node bridge (port 3000) that talks to local Qwen
    ├── server.js        Express: /api/health + /api/ai/chat (SSE)
    ├── services/        qwen, context, system prompt, web search
    └── tests/           Server + engine test suites
```

## Architecture

```
Vite Frontend (localhost:5173)
    ↓  POST /api/ai/chat (SSE)   ── backend (localhost:3000) ── llama-server Qwen (127.0.0.1:8080)
    ↓
Browser-side Local AI Engine (Tesseract OCR + rule engines)
    ↓
Firebase Authentication  ->  Cloudflare Worker + per-account SQLite
```

- Qwen (llama.cpp, `http://127.0.0.1:8080/v1`, OpenAI-compatible) is the
  **language/reasoning interface only**. It must never invent values — missing
  data stays "unavailable". Bounded history: last 10 messages (backend caps 12).
- Optional free web search (DuckDuckGo, no API key) when a question needs
  current external info; results are passed to Qwen with source URLs.

## Invoice processing pipeline

```
Invoice image/PDF
 → OCR / PDF text extraction (browser Tesseract + pdf.js — unchanged)
 → raw invoice text
 → POST /api/ai/extract-invoice (local Qwen via the backend bridge)
 → strict structured JSON + schema validation + retry-once
 → UploadPage form state → user review → Save Product
```

- Qwen returns STRICT JSON only:
  `productName, brand, category, purchaseDate, warrantyMonths, invoiceNumber,
  serialNumber, seller, purchasePrice, currency` — `null` when a value cannot
  be determined. Qwen never invents missing data.
- Category is inferred from the product description/model when the invoice
  does not state one (e.g. "Lenovo ThinkPad E14 Gen 5" → `Laptop`).
- `purchasePrice` is the FINAL amount payable — the model distinguishes
  subtotal / tax / discount / grand total (e.g. the dummy invoice's
  ₹72,000 subtotal + ₹12,960 GST → ₹84,960 grand total).
- Malformed JSON or schema violations trigger ONE retry with a corrective
  instruction; both-fail → 422. Errors are reported honestly, never flattened
  into a generic "offline" message:
  - `AI_READY` — backend + Qwen reachable
  - `AI_OFFLINE` — backend up, Qwen unreachable (503 `QWEN_OFFLINE`)
  - `AI_REQUEST_FAILED` — Qwen answered but timed out / HTTP error (504/502)
  - `AI_INVALID_RESPONSE` — Qwen output failed schema validation (422)
  - `FORBIDDEN_ORIGIN` — browser origin rejected (403; non-local origins only)
- Env: `QWEN_EXTRACT_TIMEOUT_MS` (default 90000, per attempt).
- UI stages: "Reading invoice…" → "Understanding invoice…" →
  "Extracting warranty details…" → "Ready — review extracted details."
- Deterministic engines (fraud, risk, confidence) still run alongside and
  remain the source of truth for those signals.

## Risk score & extraction confidence model

The risk score is **deterministic and fully explainable** — the sum of
independent factors, each with its own evidence trail and warning list:

| Factor | What it measures |
| --- | --- |
| Warranty remaining | % of the warranty term left (expired → 45, ≤10% → 30, ≤25% → 20, ≤50% → 10, >50% → 0) |
| Product age | days in use vs warranty term (early life +5, late-warranty +15, post-expiry capped +15) |
| Category reference | historical failure rate vs the 10% baseline (±) from the repair-cost DB |
| Invoice integrity | fraud signals from the fraud engine (fraud runs **before** risk) |
| Data confidence | `(1 − extractionConfidence) × 60` |
| Recalls & advisories | internet research evidence (recall/advisory/defect/lawsuit), when provided |

- Levels: **LOW** <25 · **MEDIUM** 25–49 · **HIGH** 50–74 · **CRITICAL** ≥75.
  Classification, labels, actionable recommendations and colors come from
  ONE module — `engine/ai-engine/riskClassification.js` (twin copies in
  frontend/backend). No page, gauge, dashboard or monitor may derive a level
  itself, so score, level, label and color can never disagree.
- Fewer than **3 core evidence blocks** → `INSUFFICIENT_DATA` (`riskScore: null`)
  instead of a fabricated number, with the missing evidence listed.
- Risk confidence is derived from the evidence blocks actually present
  (including the extraction confidence) — never hardcoded.

**Warranty end date** is computed once (`utils/dateUtils.js`
`warrantyEndDate`/`warrantyEndIso`, month-end safe, LOCAL time) and used by
the risk engine evidence, eligibility engine, advisory timeline, knowledge
graph, agent and every UI page (`lib/warrantyStatus.js`). The displayed date
can never differ from the risk evidence.

**Invoice integrity ≠ authenticity.** The fraud engine runs before risk and
scans the RAW OCR text (and field values) for generic synthetic/test-document
markers ("SYNTHETIC TEST DOCUMENT", "dummy invoice", "generated for testing
purposes", placeholder invoice/serial numbers) producing a
`SYNTHETIC_DOCUMENT` signal (severity 0.85 → fraud verdict `SUSPICIOUS`, integrity
factor +53 in risk). A synthetic/test marker is STRONG SUSPICION — the
`FRAUDULENT` verdict is reserved for explicitly confirmed fraud. A clean
OCR/extraction only means "consistency check
passed" — the UI never claims an invoice is "verified" without real
verification, and risk reports "Invoice integrity: not assessed" when the
fraud analysis did not run (it is a separate dimension from product failure
risk, and a synthetic fresh product with a clean extraction is still HIGH).

**Risk explanation is evidence-driven.** The risk engine builds a dynamic
`riskReason` from the ACTUAL dominant factors (`engine/ai-engine/riskReason.js`,
twin copies): a synthetic/test marker produces an invoice-integrity
explanation, "warranty coverage has expired" is only mentioned when the
warranty really is expired (`warrantyRemaining <= 0`), and multiple factors
are combined into one sentence. There is no generic per-level description
text anymore — the UI renders exactly ONE primary explanation (`riskReason`)
and a separate per-level ACTION recommendation. The factor breakdown exposes
the live warranty metrics (`daysRemaining`, `totalWarrantyDays`,
`warrantyEndIso`) next to the contribution bars — the days remaining come from
`purchaseDate + warrantyMonths − currentDate` (one canonical date utility),
never a stale value.


Extraction confidence is computed **per field** at save time from real
provenance (`frontend/src/lib/extractionConfidence.js`):
AI+parser agree → 0.95 · AI only → 0.80 · parser only → its field confidence ·
deterministic supplement → 0.70 · manual edit → 1.00. Missing fields penalize
the overall confidence proportionally; `< 0.55` flags `needsManualReview`.

The saved product stores `riskFactors / riskEvidence / riskWarnings /
riskConfidence / riskLastCalculatedAt`, so the product page can show the full
breakdown. The product page also offers **↻ Recompute with current data**
(local, deterministic) and a lazy **Internet research** panel backed by
`POST /api/ai/product-research` (pure DuckDuckGo search + keyword
classification — no LLM, runs after the deterministic score renders).

## Running locally

### 1. Qwen (optional, needed for chat)

```
C:\AI\start-qwen.bat
```

Starts llama-server bound to `127.0.0.1:8080` only (never expose publicly).

### 2. Backend bridge

```bash
cd backend
npm install
cp .env.example .env    # optional; defaults are fine
npm start               # http://127.0.0.1:3000
```

Env vars (all optional):

| Var | Default |
| --- | --- |
| `PORT` | `3000` |
| `QWEN_BASE_URL` | `http://127.0.0.1:8080/v1` |
| `QWEN_MODEL` | `qwen` |
| `QWEN_EXTRACT_TIMEOUT_MS` | `90000` (invoice extraction, per attempt) |
| `ALLOWED_ORIGIN` | `http://localhost:5173` — any `localhost`/`127.0.0.1` origin is always accepted (Vite picks 5174/5175… when 5173 is busy); add explicit origins here (e.g. a deployed frontend) |

### 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # fill in Firebase config; VITE_API_BASE_URL defaults to http://localhost:3000
npm run dev                  # http://localhost:5173
```

### Tests

```bash
cd backend && npm test                  # 90 engine + 96 agent + 22 server + 23 extraction tests
cd backend && npm run test:e2e          # real end-to-end: dummy_warranty_invoice_test.pdf → Qwen → form values
cd frontend && npm run build            # production build check
```

## Chat behavior

- Qwen offline → the UI shows: "Local AI is currently offline. Start the Qwen
  server and try again." No silent fallback.
- Deterministic warranty math (expiry status, days remaining) is computed
  server-side from your saved products — Qwen never recalculates it.
- `GET /api/health` reports Qwen reachability (shown as a status pill in the
  Agent page).

## Deployment

- **Vercel** — static frontend (`frontend/vercel.json`)
- **Firebase Auth** — email/password + Google sign-in
- **Cloudflare Workers Free** stores each account's products, repairs, and invoice files in its own SQLite-backed Durable Object. The Worker verifies the Firebase ID token before accessing the account's records.

From the repository root in PowerShell:

```powershell
cd cloudflare-worker
npm run deploy -- --keep-vars
if ($LASTEXITCODE -eq 0) {
    cd ../frontend
    npx vercel --prod
}
```

## Security notes

- Purchase and repair invoices have a 500 KB limit. The browser checks file
  signatures. The Worker validates the file again and routes requests by the signed-in user ID.
- The selected AI backend receives extracted invoice text for field extraction and product context for chat.


**Weighting intent** (calibrated, deterministic — never tuned to look nicer):
each factor contributes documented risk points and the score is their simple
sum, capped at 100. For the synthetic test invoice this yields 91 = warranty
remaining 0 (728 days left) + product age 5 (bought 3 days ago) + category
reference 10 (laptop baseline) + invoice integrity 53 (synthetic marker) +
data confidence 23 (62% extraction). CRITICAL is valid here because the
integrity issue is severe; a normal invoice with active warranty scores ~21
(LOW) and can never become Critical from OCR noise alone — poor OCR only
lowers data confidence, missing fields are incomplete data, and only document
CONTENT markers raise invoice integrity.
