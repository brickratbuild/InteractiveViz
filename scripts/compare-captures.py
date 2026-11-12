"""Requires Pillow and NumPy. Reads reference captures; writes only validation/."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

root = Path(__file__).resolve().parent.parent
references = root.parent / "shareefa_walkthrough_2026-11-11/v13/reference/views"
for variant, reference in [("desktop", "desktop_v22"), ("mobile", "mobile_m3")]:
    captures = root / f"validation/{variant}-desktop-auto"
    rows = []
    for image in sorted((references / reference).glob("*.png")):
        a = np.asarray(Image.open(image).convert("RGB"), dtype=float) / 255
        b = np.asarray(Image.open(captures / image.name).convert("RGB"), dtype=float) / 255
        if a.shape != b.shape:
            raise ValueError(f"Resolution mismatch: {image.name}")
        delta = np.abs(a - b)
        rows.append(dict(view=image.stem, mae=float(delta.mean()),
                         brightness=float(b.mean() / a.mean()), p99=float(np.quantile(delta, .99))))
    (captures / "comparison.json").write_text(json.dumps(rows, indent=2))
    print(variant, "median MAE", np.median([r["mae"] for r in rows]),
          "median brightness", np.median([r["brightness"] for r in rows]))
