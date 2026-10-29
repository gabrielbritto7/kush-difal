# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --no-audit --no-fund
COPY index.html styles.css app.js browser-reader.js calculator.js icms-rates.js document-parser.js document-route.js table-model.js table-ai.worker.js browser-table-ai.js recognized-document.js invoice-layout.js ./
COPY scripts ./scripts
COPY assets ./assets
RUN npm run build

FROM python:3.12-slim-bookworm
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-por tesseract-ocr-eng libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY backend/requirements-cpu.txt backend/requirements.lock ./backend/
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export PIP_CERT=/run/secrets/proxy_ca; fi; \
    pip install --no-cache-dir -r backend/requirements-cpu.txt \
    && pip install --no-cache-dir -r backend/requirements.lock
COPY backend ./backend
COPY --from=frontend /app/public ./public
RUN useradd --create-home --uid 10001 kush \
    && chmod -R a+rX /app/backend /app/public \
    && mkdir -p /models && chown -R kush:kush /models /home/kush
ENV PORT=7860 HF_HOME=/models/huggingface DOCLING_CACHE_DIR=/models/docling \
    HF_HUB_ETAG_TIMEOUT=10 HF_HUB_DOWNLOAD_TIMEOUT=30 TOKENIZERS_PARALLELISM=false OMP_NUM_THREADS=4
USER kush
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:'+__import__('os').environ.get('PORT','7860')+'/health/live',timeout=4)"
CMD ["sh", "-c", "exec uvicorn backend.app:app --host 0.0.0.0 --port ${PORT:-7860} --workers 1 --no-access-log"]
