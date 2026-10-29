# Draw3d

Hosted build: GitHub Pages (`.github/workflows/pages.yml`) builds on every push to `main`
with `BASE_PATH=/<repo>/`. Local development: `npm install && npm run dev`.
The Gemini bridge (`npm run bridge`, `/api/*`) runs locally only; the hosted static
site has no `/api` server, so Gemini depth generation and cloud transcription are
unavailable there (drawing, VR, capture, reconstruction and browser speech still work).
