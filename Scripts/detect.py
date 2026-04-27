"""Detect Gemini/Nano Banana ✦ sparkle watermark and produce a binary mask.

The sparkle is a translucent white 4-pointed concave star, placed in the
bottom-right ~30% of the image at ~5-6% of min(h,w) in size. Color-based
detection fails (it's white, blends with bright backgrounds), so we match
on SHAPE: synthesize a binary ✦ template, run multi-scale matchTemplate
against the top-hat transform of the search region.

Top-hat (image − morphological_opening) cancels the global brightness of
the background and highlights bright structures smaller than the kernel —
exactly the sparkle's profile.
"""

from __future__ import annotations

import cv2
import numpy as np


# Empirically tuned on 7 Gemini samples (score range 0.55-0.80).
# Below this, detector is likely matching noise → fall back to corner mask.
DETECTION_SCORE_THRESHOLD = 0.40


def _make_sparkle_template(size: int) -> np.ndarray:
    """Render a 4-pointed concave star (✦) as binary mask of given size."""
    img = np.zeros((size, size), dtype=np.uint8)
    cx = cy = size / 2
    R = size * 0.48      # tip radius (cardinal directions)
    r = size * 0.10      # waist radius (deep concave between tips)
    pts = []
    for i in range(8):
        theta = -np.pi / 2 + i * (np.pi / 4)
        rad = R if i % 2 == 0 else r
        pts.append([cx + rad * np.cos(theta), cy + rad * np.sin(theta)])
    pts = np.array(pts, dtype=np.int32)
    cv2.fillPoly(img, [pts], 255)
    return cv2.GaussianBlur(img, (3, 3), 0)


def detect_sparkle_mask(
    image_bgr: np.ndarray,
    pad: int = 8,
) -> tuple[np.ndarray, str]:
    """Return (mask_uint8, method) where method ∈ {'detected', 'fallback'}."""
    h, w = image_bgr.shape[:2]
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)

    # Search bottom-right 30% × 30% (sparkle is always inside this region).
    y0 = int(h * 0.70)
    x0 = int(w * 0.70)
    region = gray[y0:, x0:]

    # Top-hat suppresses global background brightness, leaving small bright blobs.
    sparkle_est = max(20, int(min(h, w) * 0.06))
    k = sparkle_est | 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    tophat = cv2.morphologyEx(region, cv2.MORPH_TOPHAT, kernel)

    best = None  # (score, x, y, size)
    for size in range(int(sparkle_est * 0.7), int(sparkle_est * 1.4) + 1, 4):
        if size < 12 or size >= region.shape[0] or size >= region.shape[1]:
            continue
        tmpl = _make_sparkle_template(size)
        res = cv2.matchTemplate(tophat, tmpl, cv2.TM_CCOEFF_NORMED)
        _, max_val, _, max_loc = cv2.minMaxLoc(res)
        if best is None or max_val > best[0]:
            best = (max_val, max_loc[0], max_loc[1], size)

    mask = np.zeros((h, w), dtype=np.uint8)

    if best is not None and best[0] >= DETECTION_SCORE_THRESHOLD:
        score, lx, ly, ssize = best
        ax, ay = x0 + lx, y0 + ly
        cv2.rectangle(
            mask,
            (max(0, ax - pad), max(0, ay - pad)),
            (min(w, ax + ssize + pad), min(h, ay + ssize + pad)),
            255, -1,
        )
        return mask, f"detected(score={score:.2f})"

    # Fallback: cover the typical Gemini sparkle position (~7% from BR corner,
    # ~6% of min(h,w) in size).
    ssize = max(40, int(min(h, w) * 0.06))
    margin_x = int(w * 0.05)
    margin_y = int(h * 0.05)
    cv2.rectangle(
        mask,
        (w - margin_x - ssize - pad, h - margin_y - ssize - pad),
        (w - margin_x + pad, h - margin_y + pad),
        255, -1,
    )
    return mask, "fallback"
