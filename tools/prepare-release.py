#!/usr/bin/env python3
"""Regenerate standalone HTML and the portable sample from canonical source files."""
from pathlib import Path
import base64
import json
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
subprocess.run([sys.executable, str(ROOT / "tools/bundle.py")], check=True)
example = ROOT / "examples/FORM-Architecture.folio"
document = json.loads(example.read_text(encoding="utf-8"))
for key in ("architecture", "detail"):
    image = ROOT / "assets" / f"{key}.webp"
    document["assets"][key]["src"] = "data:image/webp;base64," + base64.b64encode(image.read_bytes()).decode("ascii")
example.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Portable sample: {example.stat().st_size:,} bytes")
