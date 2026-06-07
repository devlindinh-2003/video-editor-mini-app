# Uplive Clipper

A fullstack video editor mini-app that allows users to download YouTube videos, define multiple clip segments, and export a single merged output file — all in one workflow.

---

## Project Overview

Uplive Clipper is a take-home assignment implementation of a video pipeline web application. Users paste a YouTube URL, the backend fetches and downloads the video via `yt-dlp`, and the frontend provides an editor where one or more timestamp ranges can be defined. On export, the backend extracts each segment with FFmpeg and merges them into a single file using the concat demuxer. The result is served as a file download.

The application runs as a single container in production: NestJS serves both the REST API and the pre-built React static assets.

---

## Features

- **YouTube download** — accepts `youtube.com` and `youtu.be` URLs; validates hostname before invoking `yt-dlp`
- **Clip editor** — add, remove, and configure multiple `HH:MM:SS` timestamp ranges; real-time client-side validation
- **Stream-copy export** — extracts clips and merges them without re-encoding using FFmpeg `-c copy`
- **File download** — exports are served from `data/exports/` with correct `Content-Type` and `Content-Disposition` headers
- **Backend health endpoint** — polled by the frontend every 5 seconds to display connection state
- **Fail-fast startup** — the NestJS bootstrap checks for `ffmpeg` and `yt-dlp` before accepting traffic; exits with code 1 if either is missing

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Docker Container                   │
│                                                     │
│  ┌─────────────┐        ┌──────────────────────┐   │
│  │ React SPA   │        │  NestJS API Server   │   │
│  │ (static,    │◄──────►│  :3000               │   │
│  │  served by  │        │                      │   │
│  │  NestJS)    │        │  VideoController     │   │
│  └─────────────┘        │  VideoService        │   │
│                         └──────┬───────────────┘   │
│                                │ child_process      │
│                         ┌──────▼───────────────┐   │
│                         │  yt-dlp / ffmpeg     │   │
│                         └──────────────────────┘   │
│                                                     │
│  Volume: ./data → /app/data                         │
│    data/downloads/   ← yt-dlp output                │
│    data/clips/       ← intermediate FFmpeg clips    │
│    data/temp/        ← FFmpeg concat list files     │
│    data/exports/     ← final merged output          │
└─────────────────────────────────────────────────────┘
```

**Request flow for export:**

1. `POST /api/video/download` → `yt-dlp` downloads video to `data/downloads/<id>.<ext>`
2. `POST /api/video/export` → for each clip: `extractClip()` runs `ffmpeg -ss -to -c copy` → intermediate file in `data/clips/`
3. If clips > 1: `mergeClips()` writes an FFmpeg concat list to `data/temp/` and runs `ffmpeg -f concat -safe 0 -c copy`
4. If clips == 1: the single extracted clip is `fs.copyFileSync`'d to `data/exports/`
5. Intermediate clip files are deleted in a `finally` block regardless of success or failure
6. `GET /api/video/files/:filename` streams the export back to the client

---

## Tech Stack

| Layer               | Technology                                          |
| ------------------- | --------------------------------------------------- |
| Backend framework   | NestJS 11 (Express adapter)                         |
| Frontend framework  | React 19 + Vite 8                                   |
| Language            | TypeScript 5 (backend), TypeScript 6 (frontend)     |
| Validation          | `class-validator` + `class-transformer` DTOs        |
| Video download      | `yt-dlp` (system binary)                            |
| Video processing    | `ffmpeg` (system binary, via `child_process.spawn`) |
| Static file serving | `@nestjs/serve-static`                              |
| Testing (backend)   | Jest + `@nestjs/testing` + Supertest                |
| Testing (frontend)  | Vitest + `@testing-library/react`                   |
| Containerisation    | Docker multi-stage build + Docker Compose           |

---

## Local Setup

### Prerequisites

- Node.js ≥ 20
- `ffmpeg` installed and on `PATH`
- `yt-dlp` installed and on `PATH`

```bash
# macOS
brew install ffmpeg yt-dlp

# Ubuntu/Debian
apt-get install ffmpeg
pip install yt-dlp
```

### Running without Docker

```bash
# 1. Backend
cd backend
npm install
npm run start:dev        # watch mode on :3000

# 2. Frontend (separate terminal)
cd frontend
npm install
npm run dev              # Vite dev server on :5173, proxies /api and /health to :3000
```

### Running with Docker

```bash
# Copy and review environment config
cp .env.example .env

# Build and start
docker compose up --build

# App is available at http://localhost:3000
```

The compose file mounts `./data` to `/app/data` so downloaded and exported files persist across container restarts. Resource limits are set to `0.5` CPU and `1 GB` RAM.

### Environment Variables

| Variable   | Default      | Description                       |
| ---------- | ------------ | --------------------------------- |
| `PORT`     | `3000`       | Port the NestJS server listens on |
| `NODE_ENV` | `production` | Node environment                  |

Frontend uses `VITE_API_BASE_URL` at build time (defaults to empty string, which uses the same origin).

---

## API Endpoints

### `GET /health`

Returns service status.

**Response 200:**

```json
{ "status": "ok", "service": "VideoService" }
```

---

### `POST /api/video/download`

Downloads a YouTube video to the server.

**Request body:**

```json
{ "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }
```

**Validation:**

- Must be a valid URL
- Hostname must be `youtube.com`, `www.youtube.com`, or `youtu.be`
- `yt-dlp` must be installed

**Download quality:** `best[height<=480]/worst` — capped at 480p to limit disk usage.

**Response 200:**

```json
{
  "filename": "dQw4w9WgXcQ.mp4",
  "title": "Rick Astley - Never Gonna Give You Up",
  "duration": 212
}
```

**Error responses:** `400 Bad Request`, `500 Internal Server Error`

---

### `POST /api/video/export`

Extracts clip segments from a downloaded video and merges them into a single file.

**Request body:**

```json
{
  "sourceFile": "dQw4w9WgXcQ.mp4",
  "clips": [
    { "start": "00:00:10", "end": "00:00:30" },
    { "start": "00:01:05", "end": "00:01:20" }
  ]
}
```

**Validation (DTO layer):**

- `sourceFile`: non-empty string
- `clips`: array with at least one element
- Each `start` / `end`: matches `^\d{2}:[0-5]\d:[0-5]\d$`

**Validation (service layer):**

- `start` must be strictly less than `end`
- `sourceFile` is sanitised with `path.basename()` and confined to `data/downloads/`; path traversal returns `400`

**Response 200:**

```json
{
  "filename": "merged-20260607-150000.mp4",
  "downloadUrl": "/api/video/files/merged-20260607-150000.mp4"
}
```

**Error responses:** `400 Bad Request`, `500 Internal Server Error`

---

### `GET /api/video/files/:filename`

Streams an exported file to the client.

**Filename validation:**

- Rejects `/`, `\`, `..`, null bytes, and URL-encoded equivalents (`%2f`, `%5c`, `%2e`)
- Enforces `^[a-zA-Z0-9._-]+$` safe-character allowlist
- Resolved path is confirmed to remain inside `data/exports/` (defense-in-depth)

**Response headers:**

```
Content-Type: video/mp4 | video/quicktime | video/x-matroska | video/webm
Content-Disposition: attachment; filename="<filename>"
Content-Length: <bytes>
```

**Error responses:** `400 Bad Request` (invalid filename), `404 Not Found` (file missing)

---

## Testing

### Backend unit tests

```bash
cd backend
npm test              # run once
npm run test:cov      # with coverage report
npm run test:watch    # watch mode
```

Test file: `src/video/video.service.spec.ts` (884 lines)

Coverage scope: `downloadVideo`, `extractClip`, `mergeClips`, `exportVideo`, `getExportFileStream`

All `child_process.spawn` calls and `fs` module calls are fully mocked. Tests cover:

- Happy path for each service method
- Input validation (missing fields, wrong types, invalid formats)
- Error propagation from `yt-dlp` and `ffmpeg` subprocesses
- Cleanup of intermediate files in both success and failure paths
- Path traversal rejection
- FFmpeg concat demuxer path-escaping (backslashes and single quotes)

### Backend E2E tests

```bash
cd backend
npm run test:e2e
```

File: `test/app.e2e-spec.ts` — boots the full NestJS application and runs HTTP assertions via Supertest:

- `GET /health` → 200 + correct body
- `GET /api/video/files/:filename` → 200 with correct headers and binary body
- 404 for a missing file
- 400 for path traversal (`..%2f`) and invalid filename characters

### Frontend tests

```bash
cd frontend
npm test
```

Uses Vitest + jsdom + `@testing-library/react`. Entry: `src/App.test.tsx`.

---

## Design Decisions

**`child_process.spawn` over `exec`**
`spawn` streams stdout/stderr incrementally and does not buffer the entire process output in memory. This matters for `yt-dlp --dump-json` which can produce large JSON blobs, and for `ffmpeg` which writes progress to stderr continuously.

**Stream copy (`-c copy`) for all FFmpeg operations**
Extraction and merging both use stream copy instead of re-encoding. This is significantly faster (CPU-bound re-encoding is avoided entirely) and produces no quality loss. The trade-off is keyframe-granularity cuts: the actual cut point is the nearest I-frame before or after the requested timestamp. This is acceptable for a clip-and-merge workflow but not suitable for frame-accurate editing.

**Single-clip short-circuit in `exportVideo`**
When only one clip is requested, `mergeClips` is skipped and the extracted clip is copied directly to `data/exports/`. This avoids the overhead of writing and reading a concat list file.

**File confined to `data/` subdirectories at multiple layers**
Both `sourceFile` (in `exportVideo`) and `filename` (in `getExportFileStream`) are validated at the string level (no `..`, no slashes) and then at the resolved path level using `path.relative()`. This defence-in-depth approach prevents path traversal attacks regardless of URL encoding.

**NestJS serves the React SPA**
In production, the frontend is built into `dist/` and copied into the container at `public/`. NestJS `ServeStaticModule` serves these assets, excluding `/api/(.*)` routes. This removes the need for a separate Nginx or CDN in simple deployments.

**Fail-fast binary checks at startup**
`main.ts` runs `checkFfmpegInstalled()` and `checkYtDlpInstalled()` in parallel before the server begins accepting requests. If either binary is unavailable the process exits with code 1 immediately, making misconfigured deployments immediately visible rather than failing silently at request time.

**Sequential clip extraction**
Clips are extracted one at a time in a `for` loop rather than with `Promise.all`. This keeps peak FFmpeg subprocess count at 1, avoids contention on disk I/O, and makes it easier to attribute a failure to a specific clip index in logs.

---

## Trade-offs

| Decision                                     | Benefit                                  | Cost                                                                                |
| -------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| Stream copy (`-c copy`)                      | No CPU overhead, instant for long videos | Keyframe-aligned cuts only                                                          |
| Synchronous download endpoint                | Simple implementation, sequential        | Blocks the request until `yt-dlp` finishes; long videos tie up an event-loop worker |
| Local disk for all intermediate files        | No external dependencies                 | Not horizontally scalable; disk fills if exports are not cleaned up                 |
| Single NestJS process serves everything      | Simple deployment, one port              | No separation of concerns; a crash takes down both API and static file serving      |
| Sequential clip extraction                   | Predictable resource usage               | Slower for many clips compared to parallel extraction                               |
| yt-dlp quality cap `best[height<=480]/worst` | Limits disk and bandwidth usage          | May not be acceptable for high-quality production use                               |

---

## Scaling Discussion

### What would break first if 1,000 users submitted videos simultaneously?

**The bottleneck is the download endpoint.** Each `POST /api/video/download` spawns a `yt-dlp` subprocess and holds the HTTP connection open until the download finishes. With 1,000 concurrent requests:

1. **OS process limit** — spawning 1,000 `yt-dlp` processes simultaneously will exceed the default per-process file descriptor and child process limits on most systems. The kernel will start returning `EAGAIN` / `ENOMEM` errors.

2. **Disk I/O saturation** — 1,000 concurrent writes to `data/downloads/` on a single disk will cause severe I/O contention. Even if the processes spawn, throughput will collapse.

3. **Network bandwidth** — even capped at 480p, 1,000 simultaneous YouTube downloads will saturate any realistic server uplink.

4. **NestJS event loop blocking** — `yt-dlp` is invoked via `spawn` (non-blocking), but the response is held until the subprocess exits. Under extreme concurrency, the resolved promises will queue heavily and response latency will climb.

**How to fix:**

- **Job queue** — move download and export operations off the request/response cycle into a queue (e.g. BullMQ backed by Redis). The API immediately returns a job ID; the client polls or receives a webhook when the job completes. This decouples HTTP concurrency from worker concurrency.

- **Worker pool** — run a fixed number of download workers (e.g. 4–8 per CPU core), bounded by the queue concurrency setting. This keeps process count predictable.

- **Horizontal scaling** — run multiple API instances behind a load balancer. Move `data/` off local disk to shared object storage (S3, GCS) so any instance can read/write downloads and exports.

- **Separate worker processes** — split the download/FFmpeg workers from the API process entirely. API containers can scale independently of heavy compute workers.

- **File lifecycle management** — add a background job to delete files from `data/downloads/` and `data/exports/` after a TTL (e.g. 1 hour). Without this, disk will fill and all operations will fail.

- **Rate limiting** — add a per-IP or per-user rate limit on `/api/video/download` to prevent a single client from exhausting the worker pool.

---

## Future Improvements

- **Async job system** — decouple download/export from the HTTP request lifecycle using BullMQ or similar
- **Progress streaming** — stream FFmpeg / yt-dlp progress events to the client via SSE or WebSocket
- **Frame-accurate cuts** — add an optional re-encode mode (`-c:v libx264`) for keyframe-independent trimming
- **Clip preview** — expose a lightweight thumbnail or metadata endpoint so the UI can show video duration and prevent out-of-bounds timestamps
- **File cleanup** — scheduled job to remove stale files from `data/downloads/` and `data/exports/`
- **Authentication** — add user sessions so jobs and exports are scoped to a user and not globally accessible
- **Input sanitisation for yt-dlp** — validate the URL against a more restrictive allow-list and consider `--no-download` metadata-only pre-validation before committing to a full download
- **Structured logging** — replace NestJS Logger with a JSON-structured logger (e.g. Pino) for easier log aggregation
