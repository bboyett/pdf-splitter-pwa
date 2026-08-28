# PDF Splitter — Setup & Run

A local Flask app for visually splitting a tall PDF (e.g. a OneNote export) into normal pages by clicking cut points.

Want to run this from your iPad instead, with no laptop needed? See
[DEPLOY.md](DEPLOY.md) for hosting it free on Render + GitHub Pages as an
installable home-screen app.

## Prerequisites (already done on this machine)

- Python 3.12 — already installed.
- Python packages — already installed via `pip install -r requirements.txt` (flask, pypdf, pdf2image, pillow).
- **Poppler** (required by `pdf2image` for rendering PDF pages to images) — already installed via `winget install oschwartz10612.Poppler` and added to your user PATH.

If you're setting this up on a **different machine**, run:

```bash
pip install -r requirements.txt
```

and install Poppler:
- **Windows:** `winget install oschwartz10612.Poppler` (or download binaries and add `bin/` to PATH)
- **Mac:** `brew install poppler`
- **Linux:** `sudo apt install poppler-utils`

## Running the app

1. Open a terminal in the project folder (`c:\Users\benbo\pdf-Splitter`).
   - **Important:** if you just installed Poppler for the first time, open a *fresh* terminal window so it picks up the updated PATH.
2. Start the server:
   ```bash
   python app.py
   ```
3. You should see Flask start up and print something like `Running on http://127.0.0.1:5000`.
4. Open **http://localhost:5000** in your browser.

## Using it

1. Click **Choose File**, pick your PDF, click **Upload**.
2. The rendered page appears. Click anywhere on the image to drop a horizontal cut line.
   - Click an existing line to **delete** it.
   - Drag a line up/down to **adjust** it.
   - Each line shows the height (in inches) of the slice above it.
3. If the source PDF has multiple pages, use **Prev / Next** to switch which page you're annotating — your cuts on each page are kept.
4. Choose **Single multi-page PDF** or **ZIP of separate PDFs** from the dropdown.
5. Click **Split & Download** — the file downloads automatically.

## Stopping the server

Go back to the terminal and press `Ctrl+C`.

## Notes

- Uploaded files and rendered images are stored in `uploads/<file_id>/` and auto-deleted after 1 hour (checked on each new upload).
- Nothing leaves your machine — this is a fully local Flask app.
- If `/upload` fails with a Poppler-related error, it means the terminal running `python app.py` doesn't have Poppler on its PATH yet — close and reopen the terminal, then restart the server.
