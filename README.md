# KEYXERXES // OMNI-CRYPT ULTRA

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Web Crypto API](https://img.shields.io/badge/Web%20Crypto%20API-Native%20CSPRNG-10B981?style=flat-square)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
[![Zero-Knowledge](https://img.shields.io/badge/Architecture-Zero--Knowledge-090A0D?style=flat-square)](#security--zero-knowledge-threat-model)
[![Client-Side](https://img.shields.io/badge/Execution-100%25%20Client--Side-10B981?style=flat-square)](#)
[![MIT License](https://img.shields.io/badge/License-MIT-F59E0B?style=flat-square)](./LICENSE)

A zero-knowledge, 100% client-side **Cryptography & Omni-Media Steganography Workstation** engineered by `keyxerxes`. Built for deterministic binary integrity across Persian/Multilingual text, lossless & JPEG-resistant images, 16-bit PCM audio, and ISO-BMFF/EBML video containers—without a single byte ever leaving the local browser process.

---

## Architectural Pipeline

Every payload (UTF-8 text or arbitrary binary file) flows through a deterministic, authenticated binary pipeline before carrier injection:

```text
+-------------------+      +------------------------+      +-----------------------------------+
|  Secret Payload   | ---> | Unified Envelope (KX)  | ---> | Native DEFLATE-RAW Compression    |
| (Text or File)    |      | Magic + Kind + Meta    |      | CompressionStream('deflate-raw')  |
+-------------------+      +------------------------+      +-----------------------------------+
                                                                             |
                                                                             v
+-------------------+      +------------------------+      +-----------------------------------+
|  Stego Carrier    | <--- | Carrier Engine & ECC   | <--- | Multi-Cipher AEAD Core (KXU1)     |
| Text/PNG/WAV/MP4  |      | ZW / Homoglyph / LSB / |      | AES-256-GCM | ChaCha20-Poly1305 | |
|                   |      | 2D-DCT+Hamming(7,4) /  |      | Cascade Dual | RSA-2048 Hybrid    |
|                   |      | PCM-2bit / ISO uuid    |      | PBKDF2-SHA256 (150,000 rounds)    |
+-------------------+      +------------------------+      +-----------------------------------+
```

---

## Cryptographic Core (`src/core/cryptoSuite.ts`)

All ciphertexts are wrapped in a self-describing, authenticated **`KXU1`** binary header bound as Additional Authenticated Data (AAD) so algorithm downgrade attacks or header tampering trigger immediate authentication tag rejection:

| Mode | Specification | Key Derivation / Wrapping | Integrity |
| :--- | :--- | :--- | :--- |
| **AES-256-GCM** | Native Web Crypto 256-bit GCM | `PBKDF2-HMAC-SHA256` (150,000 rounds, 128-bit salt, 96-bit IV) | 128-bit GHASH Tag |
| **ChaCha20-Poly1305** | Audited RFC 8439 (`@noble/ciphers`) | `PBKDF2-HMAC-SHA256` (150,000 rounds, 128-bit salt, 96-bit nonce) | 128-bit Poly1305 MAC |
| **Cascading Dual-Cipher** | Inner `AES-256-GCM` -> Outer `ChaCha20-Poly1305` | 512-bit master key split into independent 256-bit subkeys | Dual Nested AEAD Tags |
| **RSA-OAEP-2048 Hybrid** | Ephemeral `AES-256-GCM` + `RSA-OAEP` (SHA-256) | 2048-bit SPKI Public Key / PKCS#8 Private Key PEM | OAEP + 128-bit GHASH |

Additional Standalone Workbench utilities (`src/components/CryptoToolsModule.tsx`):
- **Direct Text & Binary File Encryptor/Decryptor** (Base64URL & `.kxc` binary export + live Hex Dump).
- **In-Browser RSA-2048 Keypair Generator** with SHA-256 fingerprint and `.pem` export.
- **SHA-256 / SHA-384 / SHA-512 Digest Generator & Verifier** for text and local files.
- **Encrypted QR Code Generator** (ISO/IEC 18004 with selectable L/M/Q/H error correction).
- **Unbiased CSPRNG Password Generator** with Shannon entropy estimator.

---

## Omni-Media Steganography Engines (`src/engines/`)

### 1. Persian & Multilingual Cover-Text Engine (`src/engines/textStego.ts`)
- **Zero-Width Unicode Injection:** Encodes encrypted bytes across 4 zero-width symbols (`U+200B`, `U+200C`, `U+200D`, `U+FEFF` — 2 bits/char) distributed exclusively at word boundaries. Explicitly preserves natural mid-word Persian ZWNJs (`نیم‌فاصله`) without corrupting extraction.
- **Persian/Arabic Homoglyph Substitution:** Encodes bits by alternating visually identical Unicode code points:
  - Persian Kaf `ک` (`U+06A9`) vs Arabic Kaf `ك` (`U+0643`)
  - Persian Yeh `ی` (`U+06CC`) vs Arabic Yeh `ي` (`U+064A`)
  - Optional Latin/Cyrillic fallback pairs for English cover paragraphs.
  - Survives messaging apps and forums that sanitize or strip zero-width characters.

### 2. High-Capacity & Robust Image Engine (`src/engines/imageStego.ts`)
Supports embedding both confidential text and arbitrary binary files (`.txt`, `.pdf`, `.zip`, small images):
- **Ultra-Capacity Lossless (2-bit RGBA LSB):** Embeds 8 bits/pixel across R, G, B, and A channels. Uses a custom pure-TypeScript bit-exact PNG encoder/decoder (`src/core/pngCodec.ts`) to bypass HTML5 Canvas2D premultiplied-alpha corruption completely.
- **Stealth 1-bit RGB LSB:** Classic low-noise PNG embedding (3 bits/pixel, opaque alpha, PSNR typically > 55–65 dB).
- **Telegram / Social-Shield Mode (2D-DCT + Hamming(7,4) + 3x Spatial Redundancy):** Auto-aligns cover image to `<= 1280px` (8x8 block grid), transforms BT.601 Luminance (`Y`) blocks via 2D Type-II DCT, and injects Hamming(7,4)-protected bits with 3x spatial majority voting into mid-frequency differential coefficients `(3,2)` vs `(2,3)` so payloads survive lossy JPEG re-encoding.
- **Forensic Diff Inspector:** Original vs Stego vs **255x Amplified Bit-Diff Map**, real PSNR/MSE metrics, and a live **Simulated JPEG Compression Stress Tester**.

### 3. High-Capacity PCM Audio Engine (`src/engines/audioStego.ts`)
- Decodes any browser-supported audio track (`MP3`, `WAV`, `OGG`, `FLAC`) via Web Audio API into 16-bit signed PCM.
- Injects encrypted text or files into the 2 least-significant bits of every 16-bit PCM sample (~22 KB/s at 44.1 kHz stereo) with perceptual transparency (`SNR > 75 dB`).
- Exports a lossless RIFF `.wav` container with an interactive Canvas PCM Waveform Monitor. Extraction reads raw RIFF `data` chunk Int16 samples directly without float resampling loss.

### 4. ISO-BMFF Video & Universal Container Engine (`src/engines/videoStego.ts`)
- Embeds arbitrarily large encrypted payloads (text or full files) with **zero re-encoding lag** and **100% original video quality preservation**.
- **ISO-BMFF (`.mp4`, `.mov`, `.m4v`):** Appends a spec-compliant `uuid` atom carrying a custom 16-byte KEYXERXES identifier, payload length, CRC-32 checksum, and ciphertext.
- **EBML (`.webm`, `.mkv`) & Universal Binary:** Appends a valid EBML `Void` element (`0xEC`) ignored by compliant demuxers.
- Includes a live **Container Atom Structure Inspector** displaying top-level boxes (`ftyp`, `moov`, `mdat`, `uuid`) with exact hexadecimal offsets and sizes.

---

## Security & Zero-Knowledge Threat Model

1. **Zero Network Egress:** All key derivation, compression, encryption, steganographic injection, and media decoding execute strictly inside browser memory. No keys, plaintexts, or carrier media are transmitted to any remote server.
2. **Pre-Encryption Compression Trade-Off:** Native `DEFLATE-RAW` runs before encryption to maximize capacity in constrained carriers (such as Homoglyph text and 2D-DCT images). Because there is no attacker-controlled oracle in offline file sharing, compression maximizes stealth without exposing interactive CRIME/BREACH side channels.
3. **Authenticated Encryption (AEAD):** Every cipher mode binds the `KXU1` header and salt/wrapped-key as AAD. Any single-bit corruption or wrong passphrase fails MAC verification cleanly before decompression.
4. **Memory Hygiene:** Object URLs created for image, audio, and video previews are deterministically released via `URL.revokeObjectURL` on state transitions and component unmount.

---

## Quick Start & Deployment

### Local Development
```bash
npm install
npm run dev
```

### Production Build & Type Check
```bash
npm run lint
npm run build
```

### Direct GitHub Pages Deployment
This repository is pre-configured with `base: './'` in `vite.config.ts` and an automated GitHub Actions pipeline at `.github/workflows/deploy.yml`:
1. Push the repository to GitHub under `keyxerxes`.
2. Navigate to **Settings -> Pages -> Source** and select **GitHub Actions**.
3. Every push to `main` automatically type-checks, builds `dist/`, and publishes to `https://keyxerxes.github.io/<repo-name>/`.

### Netlify Deployment
Connect the repository on Netlify with:
- **Build command:** `npm run build`
- **Publish directory:** `dist`

---

## License

Released under the [MIT License](./LICENSE) — Copyright (c) 2026 `keyxerxes`.
