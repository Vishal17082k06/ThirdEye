from fastapi import FastAPI

app = FastAPI(title="Third Eye")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
