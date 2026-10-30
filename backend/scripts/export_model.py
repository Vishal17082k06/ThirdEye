"""Obtain backend/models/yolov8n.onnx (YOLOv8n, COCO-80, 640x640, opset 12).

Why a script: there is no official pre-exported YOLOv8n ONNX download, only the
PyTorch weights (yolov8n.pt). Converting needs `ultralytics`, which pulls in
torch (~1 GB). To keep the backend's runtime dependencies light, this script
installs ultralytics into a throw-away virtualenv, exports, copies the .onnx
file into backend/models/ and deletes the temp venv.

Usage (from anywhere):  python backend/scripts/export_model.py [--force]

Idempotent: if the model already exists it only prints its location.
The model file is git-ignored; ultralytics is AGPL-3.0, which is another reason
it is kept out of the backend's own requirements.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "yolov8n.onnx"

_EXPORT_CODE = (
    "import sys; from ultralytics import YOLO; "
    "p = YOLO('yolov8n.pt').export(format='onnx', opset=12, imgsz=640, simplify=False); "
    "print('EXPORTED:' + str(p))"
)


def _venv_python(venv: Path) -> Path:
    return venv / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


def _run(cmd: list[str], cwd: Path | None = None) -> str:
    # ultralytics prints non-ASCII symbols; force UTF-8 so Windows' cp1252 can't choke.
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    result = subprocess.run(
        cmd, cwd=cwd, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    if result.returncode != 0:
        sys.exit(f"Command failed: {' '.join(cmd)}\n{result.stdout}\n{result.stderr}")
    return result.stdout


def export(target: Path = MODEL_PATH) -> Path:
    with tempfile.TemporaryDirectory(prefix="thirdeye-export-") as tmp:
        tmp_dir = Path(tmp)
        venv = tmp_dir / "venv"
        work = tmp_dir / "work"
        work.mkdir()
        print("Creating temporary virtualenv and installing ultralytics (this is slow)...")
        _run([sys.executable, "-m", "venv", str(venv)])
        py = str(_venv_python(venv))
        _run([py, "-m", "pip", "install", "--quiet", "ultralytics", "onnx"])
        print("Exporting yolov8n.pt -> ONNX (opset 12, imgsz 640)...")
        out = _run([py, "-c", _EXPORT_CODE], cwd=work)
        line = next(x for x in out.splitlines() if x.startswith("EXPORTED:"))
        exported = Path(line.removeprefix("EXPORTED:").strip())
        if not exported.is_absolute():
            exported = work / exported
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(exported, target)
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--force", action="store_true", help="re-export even if present")
    args = parser.parse_args()
    if MODEL_PATH.exists() and not args.force:
        print(f"Model already present: {MODEL_PATH}")
        return
    path = export()
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    print(f"Model written to {path} ({path.stat().st_size} bytes, sha256 {digest})")


if __name__ == "__main__":
    main()
