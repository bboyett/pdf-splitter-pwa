(() => {
  const fileInput = document.getElementById("file-input");
  const uploadBtn = document.getElementById("upload-btn");
  const uploadStatus = document.getElementById("upload-status");
  const workspace = document.getElementById("workspace");

  const prevBtn = document.getElementById("prev-page");
  const nextBtn = document.getElementById("next-page");
  const pageIndicator = document.getElementById("page-indicator");
  const clearCutsBtn = document.getElementById("clear-cuts");
  const resetTrimBtn = document.getElementById("reset-trim");
  const trimReadout = document.getElementById("trim-readout");
  const modeSelect = document.getElementById("mode-select");
  const splitBtn = document.getElementById("split-btn");
  const filenameInput = document.getElementById("filename-input");

  const connectionBanner = document.getElementById("connection-banner");
  const connectionBannerMsg = document.getElementById("connection-banner-msg");
  const connectionRetry = document.getElementById("connection-retry");

  const pageImage = document.getElementById("page-image");
  const overlay = document.getElementById("overlay");

  const DRAG_THRESHOLD_PX = 4;

  let filenameEdited = false;
  filenameInput.addEventListener("input", () => {
    filenameEdited = true;
  });
  modeSelect.addEventListener("change", () => {
    if (!filenameEdited) {
      filenameInput.value = modeSelect.value === "zip" ? "split_pages.zip" : "split.pdf";
    }
  });

  function isNetworkError(e) {
    // fetch() rejects with a TypeError specifically when the request never
    // reached the server (DNS/connection failure) — as opposed to an
    // Error we threw ourselves for a real HTTP error response.
    return e instanceof TypeError;
  }

  function showOffline(message) {
    connectionBannerMsg.textContent = message;
    connectionBanner.classList.remove("hidden");
    document.body.classList.add("offline");
  }

  function hideOffline() {
    connectionBanner.classList.add("hidden");
    document.body.classList.remove("offline");
  }

  async function checkServer() {
    connectionRetry.disabled = true;
    connectionRetry.textContent = "Checking...";
    try {
      const res = await fetch("/health", { cache: "no-store" });
      if (res.ok) {
        hideOffline();
      } else {
        showOffline("Can't reach the server — actions won't work right now.");
      }
    } catch (e) {
      showOffline("Can't reach the server — actions won't work right now.");
    } finally {
      connectionRetry.disabled = false;
      connectionRetry.textContent = "Retry";
    }
  }

  connectionRetry.addEventListener("click", checkServer);

  function sanitizeFilename(name) {
    return name.replace(/[\\/:*?"<>|]/g, "").trim();
  }

  function resolveDownloadFilename() {
    const defaultExt = modeSelect.value === "zip" ? ".zip" : ".pdf";
    let name = sanitizeFilename(filenameInput.value) || `split${defaultExt}`;
    if (!/\.[a-z0-9]+$/i.test(name)) {
      name += defaultExt;
    }
    return name;
  }

  const state = {
    fileId: null,
    pages: [],
    currentPage: 0,
    cutsByPage: {}, // pageNum -> [naturalPixelY, ...]
    trim: { left: 0, right: 0 }, // fractions of page width discarded per side, all pages
  };

  const MIN_KEEP_FRAC = 0.05; // never let the two guides collapse past this

  // Timestamp of the last cut/trim handle drag or tap. The overlay's
  // "tap empty space to add a cut" handler ignores taps right after one, so
  // finishing a drag near the image edge can't drop a stray cut line.
  let lastHandleInteraction = 0;
  // Live references to the trim shade/guide DOM nodes so a drag can reposition
  // them in place instead of rebuilding the overlay every pointermove (a
  // rebuild would destroy the node the touch pointer is captured to).
  let trimEls = null;

  function currentPageMeta() {
    return state.pages[state.currentPage];
  }

  function currentCuts() {
    const key = state.currentPage;
    if (!state.cutsByPage[key]) state.cutsByPage[key] = [];
    return state.cutsByPage[key];
  }

  async function uploadFile() {
    const file = fileInput.files[0];
    if (!file) {
      uploadStatus.textContent = "Choose a PDF first.";
      return;
    }
    uploadStatus.textContent = "Uploading & rendering...";
    uploadBtn.disabled = true;

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/upload", { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Upload failed (${res.status})`);
      }
      const data = await res.json();
      state.fileId = data.file_id;
      state.pages = data.pages;
      state.currentPage = 0;
      state.cutsByPage = {};
      state.trim = { left: 0, right: 0 };

      uploadStatus.textContent = `Loaded ${data.pages.length} page(s).`;
      workspace.classList.remove("hidden");
      hideOffline();
      loadPage(0);
    } catch (e) {
      if (isNetworkError(e)) {
        showOffline("Can't reach the server — upload didn't go through.");
        uploadStatus.textContent = "";
      } else {
        uploadStatus.textContent = e.message;
      }
    } finally {
      uploadBtn.disabled = false;
    }
  }

  function loadPage(pageNum) {
    state.currentPage = pageNum;
    const meta = currentPageMeta();
    pageIndicator.textContent = `Page ${pageNum + 1} of ${state.pages.length}`;
    prevBtn.disabled = pageNum === 0;
    nextBtn.disabled = pageNum === state.pages.length - 1;

    pageImage.onload = () => renderOverlay();
    pageImage.src = `/render/${state.fileId}/${meta.page_num}`;
  }

  function naturalHeight() {
    return pageImage.naturalHeight;
  }

  function naturalWidth() {
    return pageImage.naturalWidth;
  }

  function displayScale() {
    const rect = pageImage.getBoundingClientRect();
    return rect.height / naturalHeight();
  }

  function pxToPt(pxDelta) {
    const meta = currentPageMeta();
    return pxDelta * (meta.height_pt / meta.height_px);
  }

  function formatInches(pt) {
    return (pt / 72).toFixed(2);
  }

  function clientYToNatural(clientY) {
    const rect = pageImage.getBoundingClientRect();
    const relY = clientY - rect.top;
    const scale = displayScale();
    let y = relY / scale;
    y = Math.max(0, Math.min(naturalHeight(), y));
    return y;
  }

  function syncOverlaySize() {
    const rect = pageImage.getBoundingClientRect();
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
  }

  function renderOverlay() {
    syncOverlaySize();
    overlay.innerHTML = "";
    trimEls = null;
    const scale = displayScale();
    // Keep the model sorted so a line's array index always matches its
    // visual order — the drag handlers rely on that.
    currentCuts().sort((a, b) => a - b);
    const cuts = currentCuts();
    const boundaries = [0, ...cuts, naturalHeight()];

    cuts.forEach((cutY, idx) => {
      const line = document.createElement("div");
      line.className = "cut-line";
      line.style.top = `${cutY * scale}px`;
      line.dataset.index = String(idx);

      const gapPx = boundaries[idx + 1] - boundaries[idx];
      const gapPt = pxToPt(gapPx);
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = `${formatInches(gapPt)} in above`;
      line.appendChild(badge);

      attachLineHandlers(line, idx);
      overlay.appendChild(line);
    });

    const lastGapPx = boundaries[boundaries.length - 1] - boundaries[boundaries.length - 2];
    if (lastGapPx > 0) {
      const finalBadge = document.createElement("div");
      finalBadge.className = "slice-final-badge";
      finalBadge.textContent = `${formatInches(pxToPt(lastGapPx))} in`;
      overlay.appendChild(finalBadge);
    }

    renderTrim();
    updateTrimReadout();
  }

  function renderTrim() {
    // Both shades always exist (width 0 when that side isn't trimmed) so a
    // drag starting from the edge has a node to resize. They sit behind the
    // cut lines; the draggable guides sit on top.
    const leftShade = document.createElement("div");
    leftShade.className = "trim-shade";
    const rightShade = document.createElement("div");
    rightShade.className = "trim-shade";
    overlay.insertBefore(rightShade, overlay.firstChild);
    overlay.insertBefore(leftShade, overlay.firstChild);

    const leftLine = document.createElement("div");
    leftLine.className = "trim-line";
    const leftBadge = document.createElement("span");
    leftBadge.className = "badge";
    leftLine.appendChild(leftBadge);
    attachTrimHandlers(leftLine, "left");

    const rightLine = document.createElement("div");
    rightLine.className = "trim-line";
    const rightBadge = document.createElement("span");
    rightBadge.className = "badge";
    rightLine.appendChild(rightBadge);
    attachTrimHandlers(rightLine, "right");

    overlay.appendChild(leftLine);
    overlay.appendChild(rightLine);

    trimEls = { leftShade, rightShade, leftLine, rightLine, leftBadge, rightBadge };
    positionTrim();
  }

  function positionTrim() {
    if (!trimEls) return;
    const wDisp = naturalWidth() * displayScale();
    const meta = currentPageMeta();
    const leftX = state.trim.left * wDisp;
    const rightX = (1 - state.trim.right) * wDisp;

    trimEls.leftShade.style.left = "0px";
    trimEls.leftShade.style.width = `${Math.max(0, leftX)}px`;
    trimEls.leftShade.style.display = state.trim.left > 0 ? "block" : "none";

    trimEls.rightShade.style.left = `${rightX}px`;
    trimEls.rightShade.style.width = `${Math.max(0, wDisp - rightX)}px`;
    trimEls.rightShade.style.display = state.trim.right > 0 ? "block" : "none";

    trimEls.leftLine.style.left = `${leftX}px`;
    trimEls.rightLine.style.left = `${rightX}px`;

    if (meta) {
      trimEls.leftBadge.textContent = `${formatInches(state.trim.left * meta.width_pt)} in`;
      trimEls.rightBadge.textContent = `${formatInches(state.trim.right * meta.width_pt)} in`;
    }
    trimEls.leftBadge.style.display = state.trim.left > 0 ? "block" : "none";
    trimEls.rightBadge.style.display = state.trim.right > 0 ? "block" : "none";
  }

  function attachTrimHandlers(lineEl, side) {
    // Swallow the click so it doesn't bubble to the overlay's add-a-cut handler.
    lineEl.addEventListener("click", (e) => e.stopPropagation());
    lineEl.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      lineEl.classList.add("dragging");

      function onMove(ev) {
        const rect = pageImage.getBoundingClientRect();
        let frac = (ev.clientX - rect.left) / rect.width;
        frac = Math.max(0, Math.min(1, frac));
        if (side === "left") {
          state.trim.left = Math.max(0, Math.min(frac, 1 - state.trim.right - MIN_KEEP_FRAC));
        } else {
          state.trim.right = Math.max(0, Math.min(1 - frac, 1 - state.trim.left - MIN_KEEP_FRAC));
        }
        positionTrim();
        updateTrimReadout();
      }

      function endDrag() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", endDrag);
        window.removeEventListener("pointercancel", endDrag);
        lineEl.classList.remove("dragging");
        lastHandleInteraction = Date.now();
        renderOverlay();
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", endDrag);
      window.addEventListener("pointercancel", endDrag);
    });
  }

  function updateTrimReadout() {
    const meta = currentPageMeta();
    if (!meta) return;
    if (state.trim.left === 0 && state.trim.right === 0) {
      trimReadout.textContent = "none";
      return;
    }
    const l = formatInches(state.trim.left * meta.width_pt);
    const r = formatInches(state.trim.right * meta.width_pt);
    trimReadout.textContent = `${l} in left, ${r} in right (all pages)`;
  }

  function attachLineHandlers(lineEl, index) {
    lineEl.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const startClientY = e.clientY;
      let dragging = false;
      lineEl.classList.add("dragging");

      function onMove(ev) {
        if (!dragging && Math.abs(ev.clientY - startClientY) <= DRAG_THRESHOLD_PX) return;
        dragging = true;
        const naturalY = clientYToNatural(ev.clientY);
        currentCuts()[index] = naturalY;
        // Move just this node while dragging. A full renderOverlay() here would
        // delete it mid-gesture and cut off the touch pointer event stream.
        lineEl.style.top = `${naturalY * displayScale()}px`;
      }

      function endDrag() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", endDrag);
        window.removeEventListener("pointercancel", endDrag);
        lineEl.classList.remove("dragging");
        lastHandleInteraction = Date.now();
        if (!dragging) {
          currentCuts().splice(index, 1);
        }
        renderOverlay();
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", endDrag);
      window.addEventListener("pointercancel", endDrag);
    });
  }

  overlay.addEventListener("click", (e) => {
    // Only a tap on empty overlay adds a cut — not one bubbling up from a
    // guide, nor the click synthesized right after a drag ends near an edge.
    if (e.target !== overlay) return;
    if (Date.now() - lastHandleInteraction < 400) return;
    const naturalY = clientYToNatural(e.clientY);
    currentCuts().push(naturalY);
    renderOverlay();
  });

  window.addEventListener("resize", () => {
    if (state.fileId) renderOverlay();
  });

  prevBtn.addEventListener("click", () => {
    if (state.currentPage > 0) loadPage(state.currentPage - 1);
  });
  nextBtn.addEventListener("click", () => {
    if (state.currentPage < state.pages.length - 1) loadPage(state.currentPage + 1);
  });
  clearCutsBtn.addEventListener("click", () => {
    state.cutsByPage[state.currentPage] = [];
    renderOverlay();
  });
  resetTrimBtn.addEventListener("click", () => {
    state.trim = { left: 0, right: 0 };
    renderOverlay();
  });

  uploadBtn.addEventListener("click", uploadFile);

  async function tryShareFile(blob, filename) {
    // iOS / iPadOS Safari has no showSaveFilePicker and ignores <a download>.
    // The Web Share API (level 2) hands the file to the OS share sheet, where
    // "Save to Files" is one tap away.
    if (!navigator.canShare || !navigator.share) return false;
    const type =
      blob.type || (filename.toLowerCase().endsWith(".zip") ? "application/zip" : "application/pdf");
    const file = new File([blob], filename, { type });
    if (!navigator.canShare({ files: [file] })) return false;
    try {
      await navigator.share({ files: [file], title: filename });
      return true;
    } catch (e) {
      if (e.name === "AbortError") return true; // dismissed — don't also download
      console.warn("Share failed, falling back to download:", e);
      return false;
    }
  }

  async function pickSaveTarget(suggestedName) {
    if (!window.showSaveFilePicker) return null;
    const isZip = suggestedName.toLowerCase().endsWith(".zip");
    const accept = isZip
      ? { "application/zip": [".zip"] }
      : { "application/pdf": [".pdf"] };
    try {
      return await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: isZip ? "ZIP Archive" : "PDF Document", accept }],
      });
    } catch (e) {
      if (e.name === "AbortError") return "cancelled"; // user hit Cancel — respect it
      // Anything else (e.g. Chromium's hard "cross-origin sub frames aren't
      // allowed to show a file picker" restriction when this page is
      // embedded in an iframe) — treat the picker as unavailable and fall
      // back to a normal download instead of blocking the whole action.
      console.warn("Save dialog unavailable, falling back to normal download:", e);
      return null;
    }
  }

  splitBtn.addEventListener("click", async () => {
    if (!state.fileId) return;

    const filename = resolveDownloadFilename();

    // Ask where to save *before* hitting the server, so a cancel costs nothing
    // and the picker still runs inside the click's user-activation window.
    let saveHandle;
    try {
      saveHandle = await pickSaveTarget(filename);
    } catch (e) {
      alert(e.message);
      return;
    }
    if (saveHandle === "cancelled") return;

    splitBtn.disabled = true;
    splitBtn.textContent = "Splitting...";

    const cuts = {};
    state.pages.forEach((p) => {
      cuts[p.page_num] = state.cutsByPage[p.page_num] || [];
    });

    try {
      const res = await fetch("/split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_id: state.fileId,
          cuts,
          pages: state.pages,
          mode: modeSelect.value,
          trim: state.trim,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Split failed (${res.status})`);
      }
      const blob = await res.blob();

      if (saveHandle) {
        const writable = await saveHandle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else if (await tryShareFile(blob, filename)) {
        // Handed off to the OS share sheet (iOS/iPadOS "Save to Files", etc.).
      } else {
        // Fallback for browsers without the File System Access API
        // (Firefox, Safari): normal browser download to the Downloads folder.
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
      hideOffline();
    } catch (e) {
      if (isNetworkError(e)) {
        showOffline("Can't reach the server — split didn't go through.");
      } else {
        alert(e.message);
      }
    } finally {
      splitBtn.disabled = false;
      splitBtn.textContent = "Split & Download";
    }
  });
})();
