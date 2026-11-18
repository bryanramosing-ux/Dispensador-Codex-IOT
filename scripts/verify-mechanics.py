"""Run the unchanged CAD generator in a temporary source-layout directory."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix="dispensador-mecanica-") as temporary:
    workspace = Path(temporary)
    shutil.copytree(root / "assets/3d", workspace / "Mechanical")
    shutil.copytree(root / "firmware/ESP32/Dispensador_ESP32", workspace / "ESP32/Dispensador_ESP32")
    mechanical = workspace / "Mechanical"
    subprocess.run([sys.executable, "generar_stl.py"], cwd=mechanical, check=True)
    subprocess.run([sys.executable, "plan_impresion.py", "--sin-laminar"], cwd=mechanical, check=True)
