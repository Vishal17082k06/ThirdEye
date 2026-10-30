# Third Eye Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build "Third Eye – Smart Assistance System for Visually Impaired People": a responsive, accessible web platform with auth, Simulation and Live Camera modes, YOLOv8 obstacle detection, Coimbatore-restricted navigation, demo ride requests, global voice assistant, emergency SOS by email, device management, history, notifications, profile and settings.

**Architecture:** A FastAPI backend (SQLite via SQLAlchemy, JWT auth, onnxruntime for YOLOv8, smtplib for Gmail) serves a JSON REST API under `/api`. A React + TypeScript + Vite single-page app consumes it, with a feature-folder layout and a shared design system. Browser APIs (getUserMedia, Geolocation, SpeechRecognition, speechSynthesis) are wrapped in small hooks so they can be tested and swapped.

**Tech Stack:** Python 3.12/3.13 venv, FastAPI, SQLAlchemy 2, Alembic-free `create_all` (simple), pytest, onnxruntime, Pillow, numpy; React 18, TypeScript, Vite, React Router, TanStack Query, Tailwind CSS, Leaflet + OpenStreetMap tiles, Vitest + Testing Library.

**Spec:** The pasted "THIRD EYE – COMPLETE WEBSITE FEATURES AND FUNCTIONALITY PROMPT" (sections 1–17). Saved verbatim at `docs/superpowers/specs/third-eye-spec.md` in Task 0.

## Global Constraints

- Honesty rules (spec §16): no fake data in Live Mode; never mark hardware connected from simulated data; never claim SOS email sent unless SMTP accepted it; never claim a real ride/driver; never claim a path is "completely safe".
- Simulation Mode shows a permanent **SIMULATION MODE** indicator; simulated events are stored with `source="simulation"`.
- Navigation and rides restricted to Coimbatore bounding box: south 10.85, west 76.85, north 11.15, east 77.15 (lat/lon). Single constant on backend and frontend.
- Initial device status: VL53L0X `disconnected`; ESP32-CAM, Vibration Motor, Battery Monitoring `not_integrated`.
- Sidebar order: Dashboard, AI Assistance, Navigation, Book a Ride, Device Management, Activity History, Emergency SOS, Profile, Settings.
- Colours: primary blue `#1D4ED8`, secondary cyan `#0891B2`, accent teal `#0D9488`, background `#F8FAFC`, text `#0F172A`. WCAG AA contrast; light theme default plus high-contrast mode.
- Secrets (JWT secret, Gmail app password) only in `backend/.env`, never committed.
- No separate Currency Recognition page.

## Decisions you should know about (simple vs. proper)

| Topic | Simple option | Proper option | Plan chooses | Why |
|---|---|---|---|---|
| Database | SQLite file | PostgreSQL | SQLite | Zero setup; SQLAlchemy lets you switch later by changing one URL |
| Auth tokens | JWT in localStorage | httpOnly cookie | JWT in `Authorization` header (+ "remember me" picks localStorage vs sessionStorage) | Simpler to learn; cookie variant noted as hardening step |
| Inference location | Browser (onnxruntime-web) | Backend (onnxruntime) | Backend | Spec says "send frames for analysis"; keeps model off the client |
| Routing | Self-hosted OSRM | Public OSM routing service (routing.openstreetmap.de: foot/bike/car) | Public service, proxied via backend | No infra; fair-use limits noted |
| Geocoding | Google | Nominatim with `viewbox` + `bounded=1` | Nominatim | Free, OSM, boundable to Coimbatore |
| Fare | Invented rates | Only show when configured | Configurable per-km rates in settings; shown labelled "estimate (demo rates)" | Spec: show only when reliable; we label it |

## File Structure

```
backend/
  app/main.py              FastAPI app, CORS, router mounting, startup create_all
  app/config.py            Settings from .env (pydantic-settings)
  app/db.py                engine, SessionLocal, Base, get_db
  app/models.py            User, Guardian, Settings, Device, Event, Notification, Ride, Sos
  app/schemas.py           Pydantic request/response models
  app/security.py          bcrypt hashing, JWT create/decode, current_user dependency
  app/geo.py               COIMBATORE_BOUNDS, in_service_area()
  app/routers/auth.py      register, login, forgot-password, me
  app/routers/profile.py   profile, guardian, change password
  app/routers/settings.py  per-user settings JSON
  app/routers/devices.py   device list/config/heartbeat
  app/routers/events.py    activity history query + create
  app/routers/notifications.py
  app/routers/detect.py    POST /detect (image -> detections)
  app/routers/nav.py       geocode + route proxy with boundary check
  app/routers/rides.py     create/list/cancel demo rides
  app/routers/sos.py       trigger, history, retry
  app/services/detector.py YOLOv8 ONNX preprocessing/NMS/risk classification
  app/services/mailer.py   Gmail SMTP sender
  models/yolov8n.onnx      exported model (git-ignored, script provided)
  scripts/export_model.py  one-time export
  tests/                   pytest per router/service
frontend/
  src/app/                 router, providers, layout (Sidebar, Topbar, Shell)
  src/design/              tokens, Button, Card, Input, Badge, Modal, Toast, Spinner, EmptyState
  src/lib/                 api client, auth store, geo constants
  src/hooks/               useCamera, useGeolocation, useSpeech, useVoiceCommands
  src/features/auth|portal|dashboard|ai|navigation|rides|devices|history|sos|profile|settings|notifications|voice/
```

---

## Phase A — Foundation (working app shell, login to dashboard)

### Task 0: Repo scaffolding, spec, tooling
**Files:** Create `docs/superpowers/specs/third-eye-spec.md`, `.gitignore`, `backend/requirements.txt`, `backend/.env.example`, `frontend/` (Vite react-ts), `README.md` update.
**Produces:** runnable `uvicorn app.main:app` and `npm run dev`.
- [ ] Step 1: Save the spec verbatim; create `.gitignore` (venv, node_modules, `.env`, `*.db`, `models/*.onnx`).
- [ ] Step 2: `python -m venv backend/.venv` with Python 3.12/3.13 (onnxruntime wheel availability on 3.14 must be verified: `pip install onnxruntime`; if it fails, use 3.12 via `py -3.12`).
- [ ] Step 3: `npm create vite@latest frontend -- --template react-ts`; add tailwind, react-router-dom, @tanstack/react-query, leaflet, react-leaflet, vitest, @testing-library/react.
- [ ] Step 4: Verify both dev servers start. Commit `chore: scaffold backend and frontend`.

### Task 1: Backend core — config, DB, models, security (TDD)
**Files:** `app/config.py, db.py, models.py, security.py`, `tests/test_security.py`.
**Produces:** `hash_password(str)->str`, `verify_password(str,str)->bool`, `create_token(user_id:int, remember:bool)->str`, `decode_token(str)->int`, `get_current_user` dependency.
- [ ] Step 1: Write failing tests: hash≠plain, verify true/false, token round-trip, expired token rejected.
- [ ] Step 2: Run `pytest tests/test_security.py -v` → FAIL.
- [ ] Step 3: Implement (bcrypt via `passlib` or `bcrypt`, JWT via `pyjwt`).
- [ ] Step 4: Run → PASS. Commit.

### Task 2: Auth API (TDD)
**Files:** `routers/auth.py`, `schemas.py`, `tests/test_auth.py`.
**Produces:** `POST /api/auth/register` (name,email,phone,password) → 201 + token; `POST /api/auth/login` (email,password,remember) → token; `POST /api/auth/forgot-password` (always 202, no account enumeration; sends reset email only if SMTP configured); `GET /api/auth/me`.
- [ ] Tests first: duplicate email 409, weak password 422, bad login 401 generic message, `/me` requires token. Then implement; commit.

### Task 3: Design system + app shell
**Files:** `src/design/*`, `src/app/Shell.tsx, Sidebar.tsx, Topbar.tsx, router.tsx`, `src/index.css` tokens.
- [ ] Define CSS variables from Global Constraints; build Button, Card, Input (label+error wired with `aria-describedby`), Badge, Modal (focus trap, Esc), Toast (aria-live), Spinner, EmptyState.
- [ ] Sidebar: 9 items in spec order, collapsible, mobile drawer, `aria-current`. Topbar: mode indicator, notification bell, voice button, SOS shortcut, user menu, logout. Skip-to-content link.
- [ ] Vitest: sidebar renders 9 links in order; collapse toggles `aria-expanded`. Commit.

### Task 4: Auth pages + portal selection + dashboard skeleton
**Files:** `features/auth/Login.tsx, Register.tsx, ForgotPassword.tsx`, `lib/api.ts`, `lib/auth.tsx`, `features/portal/PortalSelect.tsx`, `features/dashboard/Dashboard.tsx`, `ProtectedRoute`.
- [ ] Login: show/hide password, remember me (localStorage vs sessionStorage), field validation, server error banner. Register: confirm password, redirect to `/portal`.
- [ ] Portal selection stores mode (`simulation|live`) in app state; Topbar shows persistent **SIMULATION MODE** badge when simulation.
- [ ] Dashboard: welcome, mode, status cards for all 11 items wired to real device/state data (see Task 6), empty states for recent lists. Commit.

## Phase B — Data features

### Task 5: Profile, guardian, settings API + pages (TDD backend)
Endpoints: `GET/PUT /api/profile`, `PUT /api/guardian`, `POST /api/profile/change-password`, `GET/PUT /api/settings` (JSON document with sections camera, hardware, ai, voice, accessibility, emergency). Frontend Profile and Settings pages (7 sections); accessibility settings (text size, high contrast, large buttons) applied via `data-` attributes on `<html>` and persisted server-side + cached locally.

### Task 6: Devices API + Device Management page
Seed per user: laptop camera (status from browser, reported via heartbeat), VL53L0X `disconnected`, ESP32-CAM / Vibration / Battery `not_integrated`. `PUT /api/devices/{key}` saves IP/config. A status can only become `connected` via `POST /api/devices/{key}/heartbeat` with `source="hardware"`; simulation never calls it. Tests assert simulation events cannot flip status. Laptop camera and ESP32-CAM are independent rows.

### Task 7: Events (activity history) + notifications
`events` table: `type, source (live|simulation|hardware), title, details JSON, status, created_at`. `GET /api/events?type&source&q&from&to`. Notifications table with `read` flag; endpoints list, mark read, clear. Frontend History page (filters, search, detail drawer, source badges) and bell with unread count. Helper `record_event()` creates event (+ notification where spec §13 lists it).

## Phase C — AI

### Task 8: YOLOv8 ONNX detector service (TDD)
**Files:** `scripts/export_model.py` (`pip install ultralytics`; `YOLO("yolov8n.pt").export(format="onnx")`), `services/detector.py`, `routers/detect.py`, `tests/test_detector.py`.
**Produces:** `detect(image_bytes, conf) -> list[Detection(label, confidence, box{x,y,w,h normalised}, position("left"|"ahead"|"right"), risk("low"|"medium"|"high"|"critical"))]`.
- [ ] Unit-test pure functions first with synthetic arrays: letterbox, NMS, position from box centre, risk from class + box area (e.g. vehicle/person large box = high/critical), announcement text builder ("Person detected ahead.", "Path appears clear in the current camera view." – never "safe").
- [ ] Integration test with a real sample image once the model exists; `/api/detect` returns 503 with clear message if model file is missing (no fake results).
- [ ] Optional OpenAI Vision: off by default, only used when setting enabled AND key configured; otherwise endpoint ignores it.

### Task 9: Camera hook + AI Assistance page
`useCamera` (permission, enumerate devices, select, start/stop, capture frame, error states). AI page: live preview with canvas overlay boxes, interval frame upload (throttled, one in flight), confidence %, risk badges, spoken announcements via `useSpeech` (deduplicated), image upload analysis, detection history list. Records events/notifications. In Simulation mode: uploaded image uses the same backend but events are tagged simulation; simulated distance readings come from a clearly labelled generator.

### Task 10: Simulation portal tools
Scenario picker (e.g. crowded street, vehicle approaching), simulated distance slider/stream, test voice, test SOS (dry-run, sends nothing), simulated device panel. Everything labelled and tagged `source="simulation"`.

## Phase D — Maps

### Task 11: Nav backend (TDD)
`geo.in_service_area(lat,lon)`; `GET /api/nav/geocode?q=` (Nominatim, `viewbox`+`bounded=1`, results re-filtered); `GET /api/nav/route?from&to&mode=foot|car|bike` → distance, duration, geometry, steps; 422 with restriction message outside the area; 502 on provider failure. Tests mock the HTTP client.

### Task 12: Navigation page
Leaflet map centred on Coimbatore with bounds, geolocation marker, manual location pick fallback, destination search + map click, mode toggle, route polyline, ETA/distance, step list, voice guidance, off-route detection → reroute, start/stop. Records navigation events.

### Task 13: Book a Ride (TDD backend)
`rides` table; `POST /api/rides` validates both points in area, generates `TE-YYYYMMDD-XXXX` ID, status `requested`; `GET /api/rides`; `POST /api/rides/{id}/cancel` only when `requested`. UI labelled "Third Eye ride request (demo) – no driver is assigned". Fare shown as "estimate (demo rates)".

## Phase E — Emergency, voice, polish

### Task 14: SOS (TDD backend)
`services/mailer.send(to, subject, body)` using `smtplib.SMTP_SSL("smtp.gmail.com",465)`; raises on failure. `POST /api/sos` stores row `pending`, sends mail with timestamp, coordinates only if provided, `https://www.google.com/maps?q=lat,lon`; status `sent` only if SMTP returned without exception, else `failed` with error; `POST /api/sos/{id}/retry`. Tests inject a fake mailer for success and failure paths, and assert no guardian → clear 400. Frontend: large SOS button, confirm modal, history with delivery status, retry; global topbar SOS shortcut.

### Task 15: Voice assistant
`useSpeech` (speechSynthesis; voice, rate from settings) and `useVoiceCommands` (SpeechRecognition, Chrome/Edge; fallback text input and keyboard shortcut `Alt+V`). Pure `parseCommand(text) -> Command` unit-tested for all 17 spec commands; executor wired to router, camera, detection, nav mode, device status, screen reader, SOS. Sensitive commands (SOS, call guardian) require spoken/clicked confirmation.

### Task 16: Final integration, accessibility audit, verification
- [ ] Run `web-design-guidelines` review on the UI; fix findings.
- [ ] Keyboard-only walkthrough of every page; check focus visible, labels, contrast.
- [ ] Run full `pytest` and `vitest`, `npm run build`, `tsc --noEmit`.
- [ ] Manually run the app and exercise: register → portal → each page (use the `verification-before-completion` skill; report evidence, and list anything that could not be verified, e.g. real SMTP delivery needs your Gmail app password; speech recognition needs Chrome/Edge).
- [ ] README: setup, env vars, model export, limitations.

---

## Spec coverage self-review
§1 T2,T4 · §2 T4,T9,T10 · §3 T4,T6,T7 · §4 T8,T9 · §5 T11,T12 · §6 T13 · §7 T15 · §8 T14 · §9,§12 T5 · §10 T6 · §11 T7 · §13 T7 · §14 T3 · §15 T3,T16 · §16–17 Global Constraints + T16. No gaps found.

## Known risks (told up front)
1. onnxruntime on Python 3.14 may lack wheels → use 3.12/3.13 venv.
2. Public Nominatim/OSM routing have fair-use limits; fine for development, not production.
3. Web Speech recognition works in Chrome/Edge only.
4. Real SOS email requires a Gmail **app password** (2-step verification on) in `backend/.env`; until then SOS shows "failed – email not configured", never "sent".
5. "Make no mistakes" is achieved by tests and running the app, not by promise; the final report will state exactly what was and wasn't verified.
