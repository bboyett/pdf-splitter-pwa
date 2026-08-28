# PDF Custom Splitter — Local Flask App Spec

## Goal
A small local web app (Flask) that lets you upload a PDF (typically a tall, single "infinite page" OneNote export), visually click where you want to cut it, and download a normal multi-page PDF split at those exact points.

Runs entirely on your laptop — no file uploads to a third-party site.

---

## Core workflow

1. User opens `http://localhost:5000` in a browser.
2. User uploads a PDF.
3. Server renders the PDF page(s) to an image and sends it to the browser.
4. Browser shows the full page image, scrollable, at a reasonable zoom.
5. User clicks anywhere on the image to drop a horizontal cut line. Can add as many as needed, drag to adjust, click a line to delete it.
6. User clicks "Split," server crops the PDF at those exact Y-coordinates and returns a downloadable multi-page PDF (or a .zip if they'd rather have separate files per page).

---

## Tech stack

- **Backend:** Flask (Python)
- **PDF → image render:** `pdf2image` (wraps `poppler`'s `pdftoppm`) — needs `poppler` installed (`brew install poppler` on Mac, or on Windows via a poppler binary in PATH)
- **PDF cropping:** `pypdf` — crop via `MediaBox`/`CropBox` manipulation (same technique used earlier: duplicate the source page N times, give each copy a different mediabox/cropbox slice, so no content is rewritten — it's just visually clipped per page). This means no need for `PyMuPDF`, keeps dependencies light.
- **Frontend:** plain HTML/CSS/JS, no framework needed — an `<img>` displaying the rendered page, an absolutely-positioned overlay `<div>` for the draggable cut lines, one `<input type="range">` or click-to-add-line interaction.

---

## Backend endpoints

### `POST /upload`
- Accepts a PDF file (multipart form).
- Saves it to a temp folder (session- or UUID-keyed, so multiple tabs/users don't collide).
- Renders each page to a PNG at a fixed DPI (start with 100–120 DPI — high enough to read handwriting, low enough to keep the image a reasonable size in the browser).
- Returns: image URL(s) or base64-encoded image(s), plus the PDF's actual point-dimensions (`mediabox.width`, `mediabox.height`) and the render DPI used — the frontend needs both to convert click-pixel-Y back to PDF-point-Y later.

### `GET /render/<file_id>/<page_num>`
- Serves the rendered PNG for a given page (if you don't inline it as base64 in the upload response).

### `POST /split`
- Accepts: `file_id`, and a list of cut points per source page, e.g.:
  ```json
  {
    "file_id": "abc123",
    "cuts": {
      "0": [812, 1900, 3300]   // pixel-Y values (at the render DPI), source page 0
    }
  }
  ```
- For each source page, converts pixel-Y cut points to PDF-point Y using:
  ```
  scale = page_height_pts / (page_height_pts / 72 * render_dpi)
  pdf_y_from_top = pixel_y * scale
  pdf_y_from_bottom = page_height_pts - pdf_y_from_top
  ```
- Builds boundary list `[0, cut1, cut2, ..., page_height_px]`, sorted, deduped.
- For each consecutive pair of boundaries, adds a new page to a `PdfWriter`, duplicating the source page and setting `mediabox`/`cropbox` to that vertical slice (same approach as the `homework-pdf-splitter` skill already built — see reference code below).
- Writes the output PDF to the temp folder, returns it as a file download (`send_file`).
- Optionally: also support returning a `.zip` of individually-named single-page PDFs, if the user wants that instead of one multi-page file.

### Cleanup
- Delete temp files for a `file_id` after some TTL (e.g. on next upload, or a simple cron-less "delete anything older than 1 hour" check on each request) — this is a local personal tool so it doesn't need to be bulletproof, just not accumulate garbage forever.

---

## Frontend behavior

- On upload: show the rendered page image at a width that fits the browser window (scale down visually, but always send click coordinates back in *original render-pixel* space, not the CSS-scaled display space — this is the most common bug source, be careful to convert `clientY` through the image's actual displayed height vs. its natural height).
- Click on image → adds a horizontal line + a small draggable handle at that Y position.
- Each line should show its computed height gap from the line above it, so the user can sanity check ("this slice is going to be 3.2 inches tall").
- A "Split & Download" button sends the current cut list to `/split` and triggers the file download.
- Nice-to-have (skip for v1 if it's slowing you down): auto-suggest cut points using the same content-aware detection from the `homework-pdf-splitter` skill (colored marker detection + last-non-white-row logic) as a starting point the user can then adjust by hand, rather than starting from zero every time.

---

## Reference: page-cropping logic (already proven to work)

This is the exact approach used earlier this week for a real homework PDF — reuse it directly:

```python
from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject

def build_split_pdf(input_pdf_path, output_pdf_path, boundaries_by_page, render_dpi):
    """
    boundaries_by_page: {page_index: [row0_px, row1_px, ..., rowN_px]}
    Cuts each source page into len(rows)-1 slices.
    """
    reader = PdfReader(input_pdf_path)
    writer = PdfWriter()

    for page_idx, boundaries in boundaries_by_page.items():
        src_page = reader.pages[page_idx]
        mb = src_page.mediabox
        width = float(mb.width)
        height = float(mb.height)
        img_h_px = height / 72.0 * render_dpi
        scale = height / img_h_px

        for i in range(len(boundaries) - 1):
            row_top = boundaries[i]
            row_bottom = boundaries[i + 1]
            pdf_top = height - row_top * scale
            pdf_bottom = height - row_bottom * scale
            new_page = writer.add_page(src_page)
            box = RectangleObject((0, pdf_bottom, width, pdf_top))
            new_page.mediabox = box
            new_page.cropbox = box

    with open(output_pdf_path, "wb") as f:
        writer.write(f)
```

Key point: this never rewrites the actual content stream — it just gives each output "page" a different visible window into the same tall source page. Cheap, reliable, and preserves vector text/annotations exactly as-is (no rasterizing the actual output, only the preview image shown in-browser).

---

## Suggested build order (good milestones for Claude Code to check in at)

1. Flask skeleton: single route, upload a PDF, render page 1 to PNG, display it in browser (no cutting yet) — confirms the render pipeline works end to end.
2. Add click-to-place-line interaction in JS, log the pixel-Y values to the console — confirms coordinate capture is correct before wiring up the backend.
3. Add `/split` endpoint using the reference cropping code above, wire the button to POST the cut list and trigger a download.
4. Handle multi-page source PDFs (loop the above per page, let the user pick which source page they're currently annotating).
5. Polish: delete/drag existing cut lines, show slice height labels, cleanup of temp files.
6. (Optional) port over the auto-detect-marker suggestion logic from the `homework-pdf-splitter` skill as a "suggest cuts" button.

---

## Dependencies to install

```bash
pip install flask pypdf pdf2image pillow
```

Plus **poppler** on the system (required by `pdf2image`):
- Windows: download poppler binaries, add the `bin/` folder to PATH
- Mac: `brew install poppler`
- Linux: `apt install poppler-utils`