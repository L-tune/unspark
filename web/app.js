/* ============================================================
   Unspark — vanilla JS controller (production-wired)
   Hooks into pywebview bridge when available, falls back to
   simulation when running standalone (e.g. browser preview).
   ============================================================ */
(function () {
  "use strict";

  // ---------- Stub bridge (overwritten by Python's _on_loaded shim) ----------
  if (!window.unspark) {
    window.unspark = {
      processFile: function (path) {
        return new Promise(function (r) {
          setTimeout(function () {
            r({ outputPath: path, durationMs: 7200, score: 0.94 });
          }, 7200);
        });
      },
      processBatch: function (paths) {
        var et = new EventTarget();
        var i = 0;
        function tick() {
          if (i >= paths.length) {
            et.dispatchEvent(new CustomEvent("complete", { detail: { count: paths.length } }));
            return;
          }
          var p = paths[i];
          et.dispatchEvent(new CustomEvent("progress", { detail: { path: p, status: "processing", index: i } }));
          setTimeout(function () {
            et.dispatchEvent(new CustomEvent("progress", { detail: { path: p, status: "done", index: i } }));
            i++;
            tick();
          }, 600);
        }
        setTimeout(tick, 300);
        return et;
      },
      showOpenDialog: function () { return Promise.resolve([]); },
      showSaveDialog: function () { return Promise.resolve(""); },
      saveToPath: function () { return Promise.resolve(true); },
      openInFinder: function (path) { console.log("[stub] reveal", path); },
      openExternal: function (url) { window.open(url, "_blank", "noopener"); }
    };
  }

  function bridgeLive() {
    return document.body.getAttribute("data-bridge") === "live";
  }

  // ---------- DOM refs ----------
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var body = document.body;
  var dropzones = $$(".dropzone[data-droppable]");
  var procBar = $(".proc-spinner .fill");
  var procPct = $(".proc-spinner .pct");
  var procMsg = $(".proc-msg");
  var procThumb = $(".proc-thumb");
  var procFilename = $(".proc-meta .filename");
  var procSize = $(".proc-meta .size");

  // ---------- State machine ----------
  function setState(name) {
    body.setAttribute("data-state", name);
    $$(".state").forEach(function (s) {
      s.setAttribute("data-active", s.getAttribute("data-state") === name ? "true" : "false");
    });
    $$(".devpanel [data-state-btn]").forEach(function (b) {
      b.setAttribute("data-active", b.getAttribute("data-state-btn") === name ? "true" : "false");
    });
  }

  // ---------- Track current job ----------
  var currentBeforeUrl = null;
  var currentResult = null;

  // ---------- Drag & drop wiring ----------
  var dragCounter = 0;
  function bindDnD() {
    window.addEventListener("dragenter", function (e) {
      e.preventDefault();
      dragCounter++;
      if (body.getAttribute("data-state") === "idle") setState("drag-over");
    });
    window.addEventListener("dragover", function (e) { e.preventDefault(); });
    window.addEventListener("dragleave", function () {
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        if (body.getAttribute("data-state") === "drag-over") setState("idle");
      }
    });
    window.addEventListener("drop", function (e) {
      e.preventDefault();
      dragCounter = 0;
      var files = e.dataTransfer && e.dataTransfer.files
        ? Array.prototype.slice.call(e.dataTransfer.files)
        : [];
      if (!files.length) { setState("idle"); return; }

      // PyWebView's WKWebView host stashes the dropped file URLs in its dnd_state
      // before this JS event fires. Pull them now so we know real source folders.
      var pathsPromise = (bridgeLive() && window.unspark.popDroppedPaths)
        ? Promise.resolve(window.unspark.popDroppedPaths())
        : Promise.resolve([]);

      pathsPromise.then(function (nativePaths) {
        nativePaths = nativePaths || [];
        var enriched = files.map(function (f, i) {
          // Match by index (same drop order). Fall back to f.path if WebKit ever
          // exposes it, then null — last resort triggers bytes-only flow.
          f._unsparkPath = nativePaths[i] || f.path || null;
          return f;
        });
        if (enriched.length === 1) startProcessing(enriched[0]);
        else startBatch(enriched);
      });
    });

    // click to choose
    dropzones.forEach(function (dz) {
      dz.addEventListener("click", function () {
        if (bridgeLive()) {
          Promise.resolve(window.unspark.showOpenDialog()).then(function (paths) {
            if (!paths || !paths.length) return;
            var fakeFiles = paths.map(function (p) {
              return {
                name: String(p).split("/").pop() || "image",
                size: null,
                _unsparkPath: p
              };
            });
            if (fakeFiles.length === 1) startProcessing(fakeFiles[0]);
            else startBatch(fakeFiles);
          });
        } else {
          var input = document.createElement("input");
          input.type = "file";
          input.accept = "image/*";
          input.multiple = true;
          input.addEventListener("change", function () {
            var files = Array.prototype.slice.call(input.files);
            if (!files.length) return;
            files.forEach(function (f) { f._unsparkPath = f.path || null; });
            if (files.length === 1) startProcessing(files[0]);
            else startBatch(files);
          });
          input.click();
        }
      });
    });
  }

  // ---------- Single-file processing ----------
  var procTimer = null;
  function startProcessing(file) {
    setState("processing");
    var name = file.name || "image.png";
    var size = file.size != null ? humanSize(file.size) : "—";
    procFilename.textContent = name;
    procSize.textContent = size;

    // Thumbnail / before URL
    var beforeUrl;
    if (file instanceof File) {
      beforeUrl = URL.createObjectURL(file);
    } else if (file._unsparkPath) {
      beforeUrl = "file://" + file._unsparkPath;
    } else {
      beforeUrl = "samples/sample_before.png";
    }
    currentBeforeUrl = beforeUrl;
    procThumb.style.backgroundImage = "url('" + beforeUrl + "')";

    // Real backend (parallel to cosmetic animation)
    currentResult = null;
    var realPath = file._unsparkPath;
    var realPromise = null;
    if (bridgeLive()) {
      if (realPath) {
        realPromise = Promise.resolve(window.unspark.processFile(realPath))
          .then(function (res) { currentResult = res; return res; })
          .catch(function (err) { currentResult = { error: String(err) }; });
      } else if (file instanceof File && window.unspark.processBytes) {
        // WKWebView strips File.path for security; fall back to sending bytes.
        realPromise = new Promise(function (resolve) {
          var fr = new FileReader();
          fr.onload = function () {
            // Strip "data:image/png;base64," prefix
            var b64 = String(fr.result).split(",")[1] || "";
            Promise.resolve(window.unspark.processBytes(b64, file.name || "image.png"))
              .then(function (res) { currentResult = res; resolve(res); })
              .catch(function (err) { currentResult = { error: String(err) }; resolve(); });
          };
          fr.onerror = function () { currentResult = { error: "FileReader failed" }; resolve(); };
          fr.readAsDataURL(file);
        });
      }
    }

    var msgs = ["Reading the sparkle…", "Erasing…", "Almost there…"];
    var msgIdx = 0;
    procMsg.textContent = msgs[0];
    setRing(0);

    var t0 = performance.now();
    var minTotal = 2400;        // minimum perceived duration so animation feels deliberate
    var ringMaxBeforeBackend = 0.85;  // hold at 85% until real backend resolves

    if (procTimer) clearInterval(procTimer);
    procTimer = setInterval(function () {
      var elapsed = performance.now() - t0;
      var pct;
      if (realPromise && !currentResult) {
        // Backend not done yet — drift toward 85%
        pct = Math.min(ringMaxBeforeBackend, elapsed / Math.max(minTotal, 7200));
      } else {
        // Backend done (or stub mode) — easing to 100%
        pct = Math.min(1, elapsed / minTotal);
      }
      var eased = pct < 0.8 ? pct : (0.8 + 0.2 * (1 - Math.pow(1 - (pct - 0.8) / 0.2, 2)));
      setRing(eased);
      var nextIdx = pct < 0.34 ? 0 : pct < 0.7 ? 1 : 2;
      if (nextIdx !== msgIdx) { msgIdx = nextIdx; procMsg.textContent = msgs[msgIdx]; }
      if (pct >= 1) {
        clearInterval(procTimer);
        procTimer = null;
        finishProcessing(name, currentResult ? currentResult.durationMs : Math.max(elapsed, minTotal), beforeUrl);
      }
    }, 60);

    // If backend resolves AFTER min animation has passed, we want to advance to result
    if (realPromise) {
      realPromise.then(function () {
        // Trigger a one-shot check; the interval above will pick it up next tick.
      });
    }
  }

  function finishProcessing(filename, ms, beforeUrl) {
    var sec = (ms / 1000).toFixed(1);
    var stat = $(".result-meta .stat");
    var savedTo = (currentResult && currentResult.outputPath) ? currentResult.outputPath : "";
    var savedToShort = savedTo.replace(/^.*\/Pictures\//, "~/Pictures/");
    if (stat) {
      stat.innerHTML =
        '<span class="timing">Done in ' + sec + ' seconds</span>' +
        '<span class="dot"></span>' +
        '<span>Saved to <code style="font-family:var(--font-mono);font-size:11px;background:rgba(0,0,0,0.05);padding:1px 6px;border-radius:4px;">' + escapeHTML(savedToShort || "~/Pictures/Unspark") + '</code></span>';
    }

    var stage = $(".result-stage");
    var img = stage && stage.querySelector(".result-img");
    var particles = stage && stage.querySelector(".dissolve-particles");

    // Source: WKWebView blocks file:// from file://-loaded pages, so we display
    // via the data URL Python returns. outputPath stays for save/reveal actions.
    var srcUrl = "";
    if (currentResult && currentResult.outputDataUrl) {
      srcUrl = currentResult.outputDataUrl;
      stage.dataset.outputPath = currentResult.outputPath || "";
    } else if (currentResult && currentResult.outputPath) {
      srcUrl = "file://" + currentResult.outputPath;
      stage.dataset.outputPath = currentResult.outputPath;
    } else if (beforeUrl) {
      srcUrl = beforeUrl;
      stage.dataset.outputPath = "";
    }
    if (img) img.src = srcUrl;

    // Reset animation state then re-inject 8 particles for the dissolution burst.
    if (stage) {
      stage.removeAttribute("data-revealed");
      stage.removeAttribute("data-dissolving");
    }
    if (particles) {
      particles.innerHTML = "";
      for (var i = 0; i < 8; i++) particles.appendChild(document.createElement("span"));
    }

    setState("result");

    // Trigger reveal + burst on next paint so the transitions actually run.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (stage) {
          stage.setAttribute("data-revealed", "true");
          stage.setAttribute("data-dissolving", "true");
        }
      });
    });
  }

  function setRing(t) {
    var C = 226.19; // 2 * pi * 36
    procBar.setAttribute("stroke-dasharray", C);
    procBar.setAttribute("stroke-dashoffset", String(C * (1 - t)));
    procPct.textContent = Math.round(t * 100) + "%";
  }

  function humanSize(bytes) {
    if (bytes == null) return "—";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  // Cancel
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-action='cancel']");
    if (!t) return;
    if (procTimer) { clearInterval(procTimer); procTimer = null; }
    setState("idle");
  });

  // ---------- Batch processing ----------
  var batchData = [];
  function startBatch(files) {
    batchData = files.map(function (f, i) {
      return {
        name: f.name || ("image_" + (i + 1) + ".png"),
        size: f.size != null ? humanSize(f.size) : "—",
        path: f._unsparkPath || null,
        status: "queued"
      };
    });
    renderBatch();
    setState("batch");

    var paths = batchData.map(function (r) { return r.path; }).filter(Boolean);
    if (paths.length && bridgeLive()) {
      var et = window.unspark.processBatch(paths);
      et.addEventListener("progress", function (e) {
        var d = e.detail;
        var idx = batchData.findIndex(function (r) { return r.path === d.path; });
        if (idx < 0) idx = d.index || 0;
        batchData[idx].status = d.status;
        if (d.outputPath) batchData[idx].outputPath = d.outputPath;
        updateBatchRow(idx);
      });
      et.addEventListener("complete", function () { /* counter already updated by progress events */ });
    } else {
      runBatchSim();
    }
  }

  function renderBatch() {
    var list = $(".batch-list");
    list.innerHTML = "";
    batchData.forEach(function (row, idx) {
      var el = document.createElement("div");
      el.className = "batch-row";
      el.dataset.idx = String(idx);
      el.innerHTML =
        '<div class="thumb"></div>' +
        '<div class="name">' + escapeHTML(row.name) + '<span class="size">' + row.size + '</span></div>' +
        '<div class="status ' + row.status + '">' + statusContent(row.status) + '</div>';
      list.appendChild(el);
    });
    updateBatchFooter();
  }

  function statusContent(s) {
    if (s === "queued")     return '<span>Queued</span>';
    if (s === "processing") return '<span class="ico"><span class="mini-spin"></span></span><span>Processing</span>';
    if (s === "done")       return '<span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><span>Done</span>';
    if (s === "error")      return '<span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg></span><span>Failed</span>';
    return s;
  }

  function updateBatchRow(idx) {
    var row = batchData[idx];
    var el = $(".batch-row[data-idx='" + idx + "']");
    if (!el) return;
    var statusEl = el.querySelector(".status");
    statusEl.className = "status " + row.status;
    statusEl.innerHTML = statusContent(row.status);
    if (row.status === "done") {
      el.classList.add("flash-done");
      setTimeout(function () { el.classList.remove("flash-done"); }, 600);
    }
    updateBatchFooter();
  }

  function updateBatchFooter() {
    var done = batchData.filter(function (r) { return r.status === "done" || r.status === "error"; }).length;
    var total = batchData.length;
    $(".batch-foot .progress-summary").textContent = done + " of " + total + " done";
    $(".batch-header .counter").textContent = done + " / " + total;
    $(".batch-header h2").textContent = done === total
      ? total + " images, no sparkles."
      : "Processing " + total + " images…";
    var fill = $(".batch-foot .progress-track .fill");
    if (fill) fill.style.right = (100 - (done / total) * 100) + "%";
    var actions = $(".batch-foot .actions");
    if (actions) actions.style.opacity = done === total ? "1" : "0.4";
  }

  function runBatchSim() {
    var i = 0;
    function step() {
      if (i >= batchData.length) return;
      batchData[i].status = "processing";
      updateBatchRow(i);
      setTimeout(function () {
        batchData[i].status = (i === 4 && batchData.length >= 8) ? "error" : "done";
        updateBatchRow(i);
        i++;
        step();
      }, 480 + Math.random() * 240);
    }
    step();
  }

  // ---------- Compare slider ----------
  function bindCompare() {
    var compare = $(".compare");
    if (!compare) return;
    var dragging = false;
    function setPos(clientX) {
      var rect = compare.getBoundingClientRect();
      var x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      var pct = (x / rect.width) * 100;
      compare.style.setProperty("--pos", pct + "%");
    }
    compare.addEventListener("pointerdown", function (e) {
      dragging = true;
      compare.setPointerCapture(e.pointerId);
      setPos(e.clientX);
    });
    compare.addEventListener("pointermove", function (e) { if (dragging) setPos(e.clientX); });
    compare.addEventListener("pointerup", function () { dragging = false; });
    compare.addEventListener("pointercancel", function () { dragging = false; });
  }

  // ---------- About modal ----------
  function bindAbout() {
    var backdrop = $(".modal-backdrop");
    var openBtns = $$("[data-action='open-about']");
    var closeBtns = $$("[data-action='close-about']");
    openBtns.forEach(function (b) { b.addEventListener("click", function () { backdrop.setAttribute("data-open", "true"); }); });
    closeBtns.forEach(function (b) { b.addEventListener("click", function () { backdrop.setAttribute("data-open", "false"); }); });
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) backdrop.setAttribute("data-open", "false"); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") backdrop.setAttribute("data-open", "false"); });
    $$("a[data-external]").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        window.unspark.openExternal(a.getAttribute("href"));
      });
    });
  }

  // ---------- Action buttons ----------
  function bindActions() {
    document.addEventListener("click", function (e) {
      var t = e.target.closest("[data-action]");
      if (!t) return;
      var a = t.getAttribute("data-action");
      if (a === "save") {
        var stage = $(".result-stage");
        var src = stage && stage.dataset.outputPath;
        if (!src) {
          console.warn("[unspark] no outputPath, save aborted");
          return;
        }
        var suggested = src.split("/").pop() || "unsparked.png";
        Promise.resolve(window.unspark.showSaveDialog(suggested)).then(function (dest) {
          if (!dest) return;
          window.unspark.saveToPath(src, dest);
        });
      } else if (a === "process-more") {
        setState("idle");
      } else if (a === "reveal") {
        var c = $(".result-stage");
        var p = c && c.dataset.outputPath;
        if (p) window.unspark.openInFinder(p);
      } else if (a === "open-output") {
        window.unspark.openInFinder("~/Library/Application Support/Unspark/water_out");
      } else if (a === "retry") {
        setState("idle");
      }
    });
  }

  // ---------- Dev panel ----------
  function bindDevPanel() {
    $$(".devpanel [data-state-btn]").forEach(function (b) {
      b.addEventListener("click", function () {
        var st = b.getAttribute("data-state-btn");
        if (st === "processing") {
          startProcessing({ name: "europe_map.png", size: 2071845 });
        } else if (st === "batch") {
          var stub = [];
          var names = ["europe_map.png","logo_v3.png","poster_final.png","mountain.png","cafe_branding.png","banner_hero.png","cover_art.png","studio_pic.png","mockup_07.png","ui_concept.png","map_paris.png","banner_2.png"];
          for (var i = 0; i < names.length; i++) stub.push({ name: names[i], size: 800000 + Math.random() * 1500000 });
          startBatch(stub);
        } else {
          setState(st);
        }
      });
    });
    var themeBtns = $$(".devpanel [data-theme-btn]");
    themeBtns.forEach(function (b) {
      b.addEventListener("click", function () {
        var t = b.getAttribute("data-theme-btn");
        if (t === "auto") body.removeAttribute("data-theme");
        else body.setAttribute("data-theme", t);
        themeBtns.forEach(function (x) {
          x.setAttribute("data-active", x.getAttribute("data-theme-btn") === t ? "true" : "false");
        });
      });
    });
    var aboutBtn = $(".devpanel [data-action='open-about']");
    if (aboutBtn) aboutBtn.addEventListener("click", function () {
      $(".modal-backdrop").setAttribute("data-open", "true");
    });
    // Auto-hide dev panel when running inside PyWebView (data-bridge=live).
    var hideDev = function () {
      var dp = $(".devpanel");
      if (dp) dp.style.display = "none";
    };
    if (bridgeLive()) hideDev();
    else {
      // Re-check after page load — the bridge shim is injected after DOMContentLoaded.
      var attempts = 0;
      var iv = setInterval(function () {
        attempts++;
        if (bridgeLive()) { hideDev(); clearInterval(iv); }
        else if (attempts > 20) clearInterval(iv);
      }, 150);
    }
  }

  // ---------- helpers ----------
  function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
    });
  }

  // ---------- init ----------
  document.addEventListener("DOMContentLoaded", function () {
    setState("idle");
    bindDnD();
    bindAbout();
    bindActions();
    bindDevPanel();
    setRing(0);
  });
})();
