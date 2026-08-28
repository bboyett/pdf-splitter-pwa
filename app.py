import io
import time
import uuid
import zipfile
from pathlib import Path

from flask import Flask, jsonify, request, send_file, send_from_directory, render_template
from pdf2image import convert_from_path
from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject

APP_ROOT = Path(__file__).resolve().parent
UPLOAD_DIR = APP_ROOT / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

RENDER_DPI = 110
TTL_SECONDS = 60 * 60  # 1 hour

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024  # 100MB


def cleanup_old_uploads():
    now = time.time()
    for child in UPLOAD_DIR.iterdir():
        if not child.is_dir():
            continue
        try:
            age = now - child.stat().st_mtime
        except OSError:
            continue
        if age > TTL_SECONDS:
            for f in child.glob("*"):
                f.unlink(missing_ok=True)
            child.rmdir()


def file_dir(file_id):
    d = UPLOAD_DIR / file_id
    if not d.is_dir():
        raise FileNotFoundError(file_id)
    return d


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/health")
def health():
    # Cheap, fast endpoint used by the PWA launcher page to detect when a
    # sleeping Render free-tier instance has finished spinning up.
    resp = jsonify({"status": "ok"})
    resp.headers["Access-Control-Allow-Origin"] = "*"
    return resp


@app.route("/upload", methods=["POST"])
def upload():
    cleanup_old_uploads()

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "No file selected"}), 400

    file_id = uuid.uuid4().hex
    work_dir = UPLOAD_DIR / file_id
    work_dir.mkdir()

    source_path = work_dir / "source.pdf"
    f.save(source_path)

    reader = PdfReader(source_path)
    images = convert_from_path(str(source_path), dpi=RENDER_DPI)

    pages = []
    for i, (src_page, image) in enumerate(zip(reader.pages, images)):
        mb = src_page.mediabox
        width_pt = float(mb.width)
        height_pt = float(mb.height)

        png_path = work_dir / f"page_{i}.png"
        image.save(png_path, "PNG")

        pages.append({
            "page_num": i,
            "width_px": image.width,
            "height_px": image.height,
            "width_pt": width_pt,
            "height_pt": height_pt,
        })

    return jsonify({
        "file_id": file_id,
        "dpi": RENDER_DPI,
        "pages": pages,
    })


@app.route("/render/<file_id>/<int:page_num>")
def render_page(file_id, page_num):
    try:
        work_dir = file_dir(file_id)
    except FileNotFoundError:
        return jsonify({"error": "Unknown file_id"}), 404
    filename = f"page_{page_num}.png"
    if not (work_dir / filename).exists():
        return jsonify({"error": "Unknown page"}), 404
    return send_from_directory(work_dir, filename)


def build_boundaries(cuts_px, height_px):
    boundaries = sorted(set([0] + [c for c in cuts_px if 0 < c < height_px] + [height_px]))
    return boundaries


def build_split_writer(reader, cuts_by_page, pages_meta):
    writer = PdfWriter()

    meta_by_page = {p["page_num"]: p for p in pages_meta}

    for page_idx in range(len(reader.pages)):
        meta = meta_by_page.get(page_idx)
        if meta is None:
            continue
        src_page = reader.pages[page_idx]
        mb = src_page.mediabox
        width_pt = float(mb.width)
        height_pt = float(mb.height)
        height_px = meta["height_px"]
        scale = height_pt / height_px

        cuts_px = cuts_by_page.get(str(page_idx), cuts_by_page.get(page_idx, []))
        boundaries = build_boundaries(cuts_px, height_px)

        for i in range(len(boundaries) - 1):
            row_top = boundaries[i]
            row_bottom = boundaries[i + 1]
            pdf_top = height_pt - row_top * scale
            pdf_bottom = height_pt - row_bottom * scale
            new_page = writer.add_page(src_page)
            box = RectangleObject((0, pdf_bottom, width_pt, pdf_top))
            new_page.mediabox = box
            new_page.cropbox = box

    return writer


@app.route("/split", methods=["POST"])
def split():
    data = request.get_json(force=True)
    file_id = data.get("file_id")
    cuts_by_page = data.get("cuts", {})
    pages_meta = data.get("pages", [])
    mode = data.get("mode", "single")

    if not file_id:
        return jsonify({"error": "file_id is required"}), 400

    try:
        work_dir = file_dir(file_id)
    except FileNotFoundError:
        return jsonify({"error": "Unknown file_id"}), 404

    source_path = work_dir / "source.pdf"
    if not source_path.exists():
        return jsonify({"error": "Source PDF missing"}), 404

    reader = PdfReader(source_path)

    if mode == "zip":
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            meta_by_page = {p["page_num"]: p for p in pages_meta}
            for page_idx in range(len(reader.pages)):
                meta = meta_by_page.get(page_idx)
                if meta is None:
                    continue
                single_writer = build_split_writer(reader, {str(page_idx): cuts_by_page.get(str(page_idx), [])}, [meta])
                for slice_idx in range(len(single_writer.pages)):
                    out = io.BytesIO()
                    slice_writer = PdfWriter()
                    slice_writer.add_page(single_writer.pages[slice_idx])
                    slice_writer.write(out)
                    zf.writestr(f"page_{page_idx + 1}_slice_{slice_idx + 1}.pdf", out.getvalue())
        buf.seek(0)
        return send_file(buf, mimetype="application/zip", as_attachment=True, download_name="split_pages.zip")

    writer = build_split_writer(reader, cuts_by_page, pages_meta)
    out = io.BytesIO()
    writer.write(out)
    out.seek(0)
    return send_file(out, mimetype="application/pdf", as_attachment=True, download_name="split.pdf")


if __name__ == "__main__":
    app.run(debug=True, port=5000)
