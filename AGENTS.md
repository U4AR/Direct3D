# Draw3d

Hosted build: Vercel (`vercel.json`) builds U4AR/Direct3D on every push to `main`
(served at the domain root; set `BASE_PATH` only for sub-path hosting). Local development: `npm install && npm run dev`.
The Gemini bridge (`npm run bridge`, `/api/*`) runs locally only; the hosted static
site has no `/api` server, so Gemini depth generation and cloud transcription are
unavailable there (drawing, VR, capture, reconstruction and browser speech still work).
