# Framegen — AI Frame Interpolation in your browser

Boost any video's frame rate with AI-generated in-between frames (RIFE via the
[`framegen`](https://www.npmjs.com/package/framegen) WebGPU runtime).

**100% client-side.** Your video never leaves your device. No servers, no
uploads, no accounts.

## How it works

1. You drop a video (MP4).
2. The browser demuxes it (`mp4box`), decodes it (`WebCodecs VideoDecoder`).
3. `framegen` runs RIFE on your GPU (`WebGPU`) and synthesizes in-between
   frames — 2×, 4× or 8× the frame rate.
4. The interpolated stream is re-encoded (`WebCodecs VideoEncoder`) and muxed
   to a valid MP4 (`mp4-muxer`), then offered back as a download.

## Requirements

- **Chrome or Edge** on desktop (WebGPU needed — Safari/Firefox not yet supported).
- A GPU with WebGPU + `shader-f16` support (any modern desktop GPU; Apple Silicon works).
- Recommended input: ≤ 1080p, ≤ ~60 seconds (browser memory is the limit).

Notes:
- Interpolation only — the audio track is currently **not** preserved (video-only MP4).
- Sample videos on scene cuts will briefly freeze instead of warping (scene-cut detection).

## Development

```bash
npm install
npm run dev       # local dev server
npm run build     # type-check + production build (dist/)
npm run preview   # preview the build
```

## Deployment

Static site — anything works (Vercel, Netlify, GitHub Pages). The frame
interpolation runs entirely in the browser, so no server runtime is required:

```bash
vercel --prod
```

## Tech stack

Vue 3 · Vite · TypeScript · [framegen](https://www.npmjs.com/package/framegen) ·
mp4box.js · WebCodecs · mp4-muxer

---

> ⚠️ The `framegen` model weights are **non-commercial**. The runtime code is
> MIT. See the [Framegen repository](https://github.com/MONZikWasTaken/Framegen)
> for details.