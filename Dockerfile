FROM python:3.12-slim

# poppler-utils provides pdftoppm/pdftocairo, required by pdf2image
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render injects $PORT at runtime; 10000 is just a sane local default.
ENV PORT=10000
EXPOSE 10000

# One worker with a few threads keeps memory low (important on the free
# 512MB instance) while still handling a couple of concurrent users.
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 4 --worker-class gthread --timeout 120 app:app"]
