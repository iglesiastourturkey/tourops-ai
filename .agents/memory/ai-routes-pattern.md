---
name: AI routes pattern
description: How OpenAI is called in api-server; no npm package, raw fetch, model selection
---

## Pattern
- All AI calls use `fetch()` directly to `https://api.openai.com/v1/chat/completions`.
- No `openai` npm package in api-server — intentional, keeps the bundle lean.
- API key: `process.env.OPENAI_API_KEY` — if missing, routes return safe mock responses (never hard-fail).

## Models
- **Vision / OCR**: `gpt-4o` — only model that reliably handles image inputs.
- **Text generation** (itinerary, email, analyze-request, assist): `gpt-4o-mini`.

## Rate limiting
- In-memory `Map<userId, { count, resetAt }>` — resets per OCR_WINDOW_MS.
- Not persisted across restarts — fine for MVP.

**Why:** No npm package avoids version-lock friction and keeps startup fast.

**How to apply:** Any new AI endpoint in ai.ts should follow the same fetch + mock pattern and add its own rate limiter entry if the operation is expensive.
