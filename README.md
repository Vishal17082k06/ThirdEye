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
