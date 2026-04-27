# Current state (what we're replacing)

The app today is **NB Unmark.app**, a 985 MB self-contained macOS bundle.

## Current user flow

1. User downloads `NB Unmark.dmg`, drags app to Applications.
2. Right-click → Open (Gatekeeper bypass for ad-hoc signed app).
3. App icon = Apple's ✨ emoji rendered as bitmap. No identity, no original artwork.
4. User drops images on the app icon in Finder, OR double-clicks app.
5. **Terminal.app opens.** Black window with progress text:
   ```
   ============================================
     NB Unmark — processing
   ============================================
   Loading LaMa model... (first run downloads ~200MB)
     ready in 0.9s

   Processing 1 image(s):
     ✓ Gemini_Generated_Image_-3.png  [detected(score=0.80)]
     -> water_out/Gemini_Generated_Image_-3.png  (6.9s)

   Done. Output: ~/Library/Application Support/NB Unmark/water_out/

   Press Cmd-W to close this window.
   ```
6. Finder opens output folder.
7. User compares before/after by switching between two folders manually.

## Why this is bad UX

- Terminal feels like a developer tool, not a finished product.
- ~7 seconds of silence during processing — only static "Processing..." text in Terminal.
- No visual progress indicator.
- No before/after view inside the app.
- "Press Cmd-W to close" is a power-user instruction, not a polished close button.
- File path in output (`~/Library/Application Support/...`) leaks implementation detail.
- No drag-and-drop hitbox — drops only work on the Dock icon or Finder icon.
- No batch progress — multi-file drops show only counter text in log.

## What we keep under the hood

The new UI wraps the same pipeline. **Nothing in the backend changes:**

- Standalone Python 3.11.15 (777 MB) — bundled inside `.app/Contents/Resources/python/`
- LaMa weights `big-lama.pt` (196 MB) — bundled inside `.app/Contents/Resources/torch_cache/`
- Detection logic in `detect.py` — multi-scale template matching of synthesized 4-pointed star against top-hat transform
- Inpainting in `unmark.py` — calls `simple_lama_inpainting.SimpleLama()` under the hood
- File I/O paths in `~/Library/Application Support/Unspark/` (renamed from "NB Unmark")

What we're replacing is **only the user-facing layer**: AppleScript droplet → PyWebView window with HTML/CSS/JS UI.
