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

## Tests

```powershell
cd backend;  .venv\Scripts\python -m pytest
cd frontend; npm test
```

Spec: `docs/superpowers/specs/third-eye-spec.md`
