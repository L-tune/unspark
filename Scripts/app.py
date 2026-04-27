"""Unspark — PyWebView entry point.

Wraps the Claude-Design HTML/CSS/JS interface around the LaMa pipeline.
No Terminal, no AppleScript flow. Drag-drop is handled inside the WebKit window.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import threading
import time
import traceback
import webbrowser
from pathlib import Path

# Resources/Scripts/ -> Resources/
RSRC = Path(__file__).resolve().parent.parent
SCRIPTS = RSRC / "Scripts"
WEB = RSRC / "web"

# Bundle-internal torch cache so weights are read from inside the .app
os.environ["TORCH_HOME"] = str(RSRC / "torch_cache")

# Make our local detect.py importable
sys.path.insert(0, str(SCRIPTS))

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import webview  # noqa: E402
from PIL import Image  # noqa: E402

from detect import detect_sparkle_mask  # noqa: E402
from webview.dom import _dnd_state  # noqa: E402

# PyWebView's macOS WKWebView extracts dropped-file URLs into _dnd_state['paths']
# only when at least one drop listener is registered. We don't use the DOM API,
# so bump the counter manually to keep extraction enabled.
_dnd_state["num_listeners"] = max(_dnd_state.get("num_listeners", 0), 1)

OUTPUT_ROOT_FALLBACK = Path.home() / "Pictures" / "Unspark"
OUTPUT_ROOT_FALLBACK.mkdir(parents=True, exist_ok=True)

_lama = None


def get_lama():
    global _lama
    if _lama is None:
        from simple_lama_inpainting import SimpleLama
        _lama = SimpleLama()
    return _lama


class Bridge:
    """Methods on this class are exposed to JS as `pywebview.api.<name>`."""

    def __init__(self):
        self._window = None

    def attach_window(self, window):
        self._window = window

    # ---------- File processing ----------

    def pop_dropped_paths(self) -> list[str]:
        """Return file paths captured by the last Cocoa drag-drop and clear the buffer.

        PyWebView's WKWebView host accumulates URLs in webview.dom._dnd_state['paths']
        as a list of (display_name, absolute_path) tuples whenever something is dropped
        on the window. Calling this drains the buffer.
        """
        items = list(_dnd_state.get("paths", []))
        _dnd_state["paths"] = []
        return [p for (_name, p) in items]

    def process_file(self, path: str, target_dir: str | None = None) -> dict:
        """Sync. Returns {outputPath, outputDataUrl, durationMs, score, method}.

        target_dir overrides where the cleaned file is written. When None we save
        next to the source file (so user gets a sibling like Foo.png → Foo_1.png).
        """
        t0 = time.time()
        path = os.path.expanduser(path)
        img_bgr = cv2.imread(path, cv2.IMREAD_COLOR)
        if img_bgr is None:
            raise ValueError(f"Cannot read image: {path}")

        mask, method = detect_sparkle_mask(img_bgr)

        score = 0.0
        if "score=" in method:
            try:
                score = float(method.split("score=")[1].rstrip(")"))
            except (ValueError, IndexError):
                pass

        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        result = get_lama()(Image.fromarray(img_rgb), Image.fromarray(mask).convert("L"))

        # Pick destination directory: explicit target_dir → sibling of source → fallback.
        src_dir = Path(target_dir).expanduser() if target_dir else Path(path).parent
        try:
            src_dir.mkdir(parents=True, exist_ok=True)
            test = src_dir / ".unspark_write_test"
            test.touch(); test.unlink()
        except Exception:
            src_dir = OUTPUT_ROOT_FALLBACK

        stem = Path(path).stem
        ext = Path(path).suffix or ".png"
        # Suffix the cleaned file so it doesn't clobber the original.
        out_path = src_dir / f"{stem}_unsparked{ext}"
        n = 1
        while out_path.exists():
            out_path = src_dir / f"{stem}_unsparked_{n}{ext}"
            n += 1
        result.save(out_path)

        # Also encode as data URL — WKWebView blocks cross-origin file:// loads
        # from file://-loaded pages, so the UI uses this for display.
        import base64
        import io
        buf = io.BytesIO()
        result.save(buf, format="PNG")
        data_url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")

        return {
            "outputPath": str(out_path),
            "outputDataUrl": data_url,
            "durationMs": int((time.time() - t0) * 1000),
            "score": score,
            "method": method,
        }

    def process_bytes(self, b64_data: str, filename: str, target_dir: str | None = None) -> dict:
        """Used when JS only has bytes. Optional target_dir saves next to the
        original location when JS knows it (e.g. via Cocoa drop URL extraction).
        """
        import base64
        import tempfile
        import re

        safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", filename or "image.png")
        if "." not in safe_name:
            safe_name += ".png"
        tmp = Path(tempfile.gettempdir()) / f"unspark_in_{int(time.time()*1000)}_{safe_name}"
        try:
            tmp.write_bytes(base64.b64decode(b64_data))
            res = self.process_file(str(tmp), target_dir=target_dir)
            # Rewrite output filename to use the original (without temp prefix).
            from pathlib import Path as _P
            orig_stem = _P(safe_name).stem
            out_path = _P(res["outputPath"])
            new_name = out_path.name.replace(_P(safe_name).stem.replace(".", "_"), orig_stem)
            # Actually just use the original stem cleanly:
            ext = out_path.suffix or ".png"
            new_path = out_path.parent / f"{orig_stem}_unsparked{ext}"
            i = 1
            while new_path.exists():
                new_path = out_path.parent / f"{orig_stem}_unsparked_{i}{ext}"
                i += 1
            try:
                out_path.rename(new_path)
                res["outputPath"] = str(new_path)
            except OSError:
                pass
            return res
        finally:
            try:
                tmp.unlink()
            except OSError:
                pass

    def process_batch(self, paths: list[str]) -> str:
        """Async. Spawns worker thread that pushes progress events into JS."""
        batch_id = f"batch_{int(time.time() * 1000)}"
        thread = threading.Thread(target=self._batch_worker, args=(batch_id, paths), daemon=True)
        thread.start()
        return batch_id

    def _batch_worker(self, batch_id: str, paths: list[str]):
        for i, p in enumerate(paths):
            self._emit("progress", {"batchId": batch_id, "path": p, "status": "processing", "index": i})
            try:
                res = self.process_file(p)
                self._emit("progress", {
                    "batchId": batch_id, "path": p, "status": "done", "index": i, **res,
                })
            except Exception as e:
                traceback.print_exc()
                self._emit("progress", {
                    "batchId": batch_id, "path": p, "status": "error", "index": i, "error": str(e),
                })
        self._emit("complete", {"batchId": batch_id, "count": len(paths)})

    def _emit(self, event: str, detail: dict):
        if not self._window:
            return
        payload = json.dumps(detail)
        # Wrapped in try/except inside JS via __unsparkEmit shim
        self._window.evaluate_js(
            f"window.__unsparkEmit && window.__unsparkEmit({json.dumps(event)}, {payload});"
        )

    # ---------- File pickers / system actions ----------

    def show_open_dialog(self) -> list[str]:
        """Returns list of file paths chosen by user."""
        result = self._window.create_file_dialog(
            webview.OPEN_DIALOG,
            allow_multiple=True,
            file_types=("Images (*.png;*.jpg;*.jpeg;*.webp)",),
        )
        return list(result) if result else []

    def show_save_dialog(self, suggested_name: str = "unsparked.png") -> str:
        result = self._window.create_file_dialog(
            webview.SAVE_DIALOG,
            save_filename=suggested_name,
        )
        return result if result else ""

    def save_to_path(self, src: str, dest: str) -> bool:
        try:
            shutil.copy(os.path.expanduser(src), os.path.expanduser(dest))
            return True
        except Exception:
            traceback.print_exc()
            return False

    def open_in_finder(self, path: str):
        path = os.path.expanduser(path)
        if Path(path).exists():
            os.system(f"open -R {json.dumps(path)}")
        else:
            os.system(f"open {json.dumps(path)}")

    def open_external(self, url: str):
        try:
            webbrowser.open(url)
        except Exception:
            traceback.print_exc()


def _on_loaded(bridge: Bridge):
    """Inject the production bridge shim into the window after page load."""
    if not bridge._window:
        return
    js_shim = """
        (function () {
            // Replace the standalone stub bridge with one that calls pywebview.api.
            var api = window.pywebview && window.pywebview.api;
            if (!api) return;

            var batchListeners = {};
            var activeBatchId = null;
            var activeET = null;

            window.__unsparkEmit = function (event, detail) {
                if (activeET) {
                    activeET.dispatchEvent(new CustomEvent(event, { detail: detail }));
                }
            };

            window.unspark = {
                processFile: function (path, targetDir) { return api.process_file(path, targetDir || null); },
                processBytes: function (b64, filename, targetDir) { return api.process_bytes(b64, filename, targetDir || null); },
                popDroppedPaths: function () { return api.pop_dropped_paths(); },
                processBatch: function (paths) {
                    var et = new EventTarget();
                    activeET = et;
                    api.process_batch(paths).then(function (id) { activeBatchId = id; });
                    return et;
                },
                showOpenDialog: function () { return api.show_open_dialog(); },
                showSaveDialog: function (name) { return api.show_save_dialog(name || 'unsparked.png'); },
                saveToPath: function (src, dest) { return api.save_to_path(src, dest); },
                openInFinder: function (path) { return api.open_in_finder(path); },
                openExternal: function (url) { return api.open_external(url); },
            };

            // Signal to UI that real bridge is live (in case UI wants to hide dev panel etc).
            document.body.setAttribute('data-bridge', 'live');
        })();
    """
    bridge._window.evaluate_js(js_shim)


def main():
    bridge = Bridge()
    window = webview.create_window(
        title="Unspark",
        url=str(WEB / "index.html"),
        js_api=bridge,
        width=840,
        height=600,
        resizable=False,
        min_size=(840, 600),
        background_color="#0A0A0B",
    )
    bridge.attach_window(window)

    def loaded_handler():
        _on_loaded(bridge)

    window.events.loaded += loaded_handler

    webview.start(debug=False)


if __name__ == "__main__":
    main()
