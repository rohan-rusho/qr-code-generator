# QR Code Generator

A free QR code generator that works fully offline. Type any text or URL, watch the code appear live, and download it as a PNG.

## Features

- **Text / URL input** — live QR rendering as you type
- **Size picker** — 256, 512 or 1024 px PNG downloads
- **Download PNG button** — clean image with a proper quiet zone, ready to print
- **Self-contained encoder** — `js/qrcode.js` is a byte-mode QR encoder written from scratch (error correction level M, versions 1–10, Reed–Solomon ECC, mask selection). No external API, no CDN, no requests at runtime — it works fully offline.
- **Extras** — one-tap example presets (website, location, Wi-Fi, message), live byte counter, version / module-size readout, copy-text button

## Run locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Or just open `index.html` in a browser — there is no build step and no dependency beyond Google Fonts.

## Deploy

Static site — drop the folder on any static host (GitHub Pages, Netlify, Vercel) and it works.

## Tech

Plain HTML, CSS and JavaScript. Zero dependencies except Google Fonts. The QR encoder (`js/qrcode.js`) is original code implementing ISO/IEC 18004 byte mode.
