# ThirdEye

Third Eye: smart assistance system for visually impaired people (FastAPI backend + React/TypeScript/Vite/Tailwind frontend).

## Setup

### Backend (Python 3.11+; developed on 3.11)

```powershell
cd backend
py -3.11 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env      # then fill in secrets
uvicorn app.main:app --reload --port 8000
```

Health check: http://localhost:8000/api/health

### Obstacle detection model (YOLOv8n ONNX)

The detector (`POST /api/detect`) needs `backend/models/yolov8n.onnx` (git-ignored). Create it once:

```powershell
backend\.venv\Scripts\python backend\scripts\export_model.py
```

It installs `ultralytics` (which pulls in torch, ~1 GB) into a throw-away virtualenv, exports the
official YOLOv8n weights to ONNX (opset 12, 640x640) and copies the file in, so the backend itself
stays light. Until the file exists, `/api/detect` answers 503 with an explanatory message (it never
returns fake detections). Optional OpenAI Vision is not implemented: the `ai.openaiVisionEnabled`
setting is a no-op and YOLO is always the primary engine.

### Frontend (Node 20+)

```powershell
cd frontend
npm install
npm run dev                 # http://localhost:5173, /api is proxied to :8000
```

## Enabling SOS emails

The Emergency SOS feature emails the guardian through Gmail SMTP (`smtp.gmail.com:465`, SSL).

1. Turn on 2-Step Verification for the sending Google account.
2. Create an App Password at https://myaccount.google.com/apppasswords (a 16-character code; your normal password will not work).
3. In `backend/.env` set `GMAIL_USER=you@gmail.com` and `GMAIL_APP_PASSWORD=<the 16 characters>`, then restart the backend.
4. Add a guardian with a valid email in the Profile page.

Without these, SOS attempts are stored as `failed` ("Email service is not configured on the server.") and can be retried once configured. A SOS is marked `sent` only when Gmail's server accepts the message; that confirms hand-off, not that the guardian read it. Dev databases created before SOS gained its extra columns are upgraded automatically at startup.

## Maps and OpenStreetMap usage

Navigation and Book a Ride show OpenStreetMap tiles (`https://tile.openstreetmap.org`), with the required "OpenStreetMap contributors" attribution link kept visible on every map. The public OSM tile servers, Nominatim (search) and the public OSRM demo server are for **demo / low-volume use only** (see the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/)): no bulk downloading, no heavy traffic, and a real User-Agent with a contact address (`NOMINATIM_USER_AGENT` in `backend/.env`). For anything beyond a demo, use a commercial tile provider or self-host tiles, geocoding and routing.

## Voice commands

Press the microphone in the top bar, or **Alt+Shift+V**, then speak (Chrome, Edge or Safari). Firefox has no speech recognition; type the same commands in the panel's "Type a command" box. It only listens after you press and takes one command at a time. This app never stores audio, but your browser's speech service does the recognition: in Chrome and Edge your audio is sent to Google or Microsoft to be turned into text. Typed commands stay on this device. Alt+Shift+V is best effort (some systems use it to switch keyboard layout); typed commands always work.

| Say | What happens |
| --- | --- |
| Open dashboard / Open AI assistance / Open navigation / Open book a ride | Opens that page |
| Start camera / Stop camera | Starts or stops the AI page camera |
| Start obstacle detection / Stop obstacle detection | Starts or stops detection (needs the camera) |
| Where am I? | Says the address near you |
| Take me to Gandhipuram | Searches Coimbatore, asks "Start navigation to ...? Say yes or no" |
| Walking mode / Car mode | Changes the travel mode |
| Check device status | Reads the real device statuses |
| Read screen | Reads the page heading and key content |
| Call guardian | Asks first, then opens your phone dialer |
| Emergency SOS | Opens the SOS confirmation; nothing is sent until you confirm |
| Go back / Stop listening / Yes / No / Cancel | Controls |

## Tests

```powershell
cd backend;  .venv\Scripts\python -m pytest
cd frontend; npm test
```

Spec: `docs/superpowers/specs/third-eye-spec.md`
