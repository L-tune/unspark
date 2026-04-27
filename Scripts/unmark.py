"""Batch-remove Gemini/Nano Banana sparkle watermarks using LaMa inpainting.

Usage:
    python unmark.py                      # process water_in/ -> water_out/
    python unmark.py img1.png img2.jpg    # explicit files (output to water_out/)
    python unmark.py --corner             # skip detection, mask fixed corner
    python unmark.py --debug              # also write masks to water_out/_masks/
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from detect import detect_sparkle_mask

# Data dir can be overridden by env var (used by .app bundle). Default: project root.
ROOT = Path(os.environ.get("NB_UNMARK_DATA") or Path(__file__).resolve().parent.parent)
IN_DIR = ROOT / "water_in"
OUT_DIR = ROOT / "water_out"
EXTS = {".png", ".jpg", ".jpeg", ".webp"}


def load_lama():
    # Imported lazily — heavy (torch); we want fast --help.
    from simple_lama_inpainting import SimpleLama
    return SimpleLama()


def process(path: Path, lama, force_corner: bool, debug: bool) -> str:
    img_bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img_bgr is None:
        return f"  skipped (unreadable): {path.name}"

    if force_corner:
        h, w = img_bgr.shape[:2]
        mask = np.zeros((h, w), dtype=np.uint8)
        cw, ch = max(48, int(w * 0.10)), max(48, int(h * 0.10))
        mx, my = int(w * 0.02), int(h * 0.02)
        cv2.rectangle(mask, (w - cw - mx, h - ch - my), (w - mx, h - my), 255, -1)
        method = "corner"
    else:
        mask, method = detect_sparkle_mask(img_bgr)

    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(img_rgb)
    pil_mask = Image.fromarray(mask).convert("L")

    out = lama(pil_img, pil_mask)

    OUT_DIR.mkdir(exist_ok=True)
    out_path = OUT_DIR / path.name
    out.save(out_path)

    if debug:
        dbg = OUT_DIR / "_masks"
        dbg.mkdir(exist_ok=True)
        cv2.imwrite(str(dbg / f"{path.stem}_mask.png"), mask)

    return f"  ✓ {path.name}  [{method}]  -> {out_path.relative_to(ROOT)}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*", help="image files (default: scan water_in/)")
    ap.add_argument("--corner", action="store_true", help="skip detection, mask bottom-right corner")
    ap.add_argument("--debug", action="store_true", help="also dump masks to water_out/_masks/")
    args = ap.parse_args()

    if args.files:
        targets = [Path(f) for f in args.files]
    else:
        IN_DIR.mkdir(exist_ok=True)
        targets = sorted(p for p in IN_DIR.iterdir() if p.suffix.lower() in EXTS)

    if not targets:
        print(f"No images. Drop PNG/JPG/WEBP into {IN_DIR}/")
        return 0

    print(f"Loading LaMa model... (first run downloads ~200MB)")
    t0 = time.time()
    lama = load_lama()
    print(f"  ready in {time.time() - t0:.1f}s")

    print(f"\nProcessing {len(targets)} image(s):")
    for p in targets:
        t0 = time.time()
        msg = process(p, lama, args.corner, args.debug)
        print(f"{msg}  ({time.time() - t0:.1f}s)")

    print(f"\nDone. Output: {OUT_DIR}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
