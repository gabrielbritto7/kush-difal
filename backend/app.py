"""Self-hosted Docling API. No external inference API or paid AI key."""
import asyncio
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import threading
import time
from collections import defaultdict, deque

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps
from pypdf import PdfReader

from backend import engine

LIMIT = 5 * 1024 * 1024
BUSY = threading.Lock()
REQUESTS = defaultdict(deque)
ORIGINS = [origin.strip().rstrip('/') for origin in os.getenv('ALLOWED_ORIGINS', 'https://difal.kush-archives.com.br,http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001,http://localhost:8000,http://127.0.0.1:8000').split(',') if origin.strip()]
app = FastAPI(title='Kush DIFAL — Docling', docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=['GET', 'POST'], allow_headers=['Content-Type'], expose_headers=['Retry-After'])


@app.exception_handler(HTTPException)
async def http_error(request, error):
    return JSONResponse(status_code=error.status_code, content={'error': error.detail}, headers=error.headers)


def check_origin(request):
    origin = request.headers.get('origin')
    if origin and origin.rstrip('/') not in ORIGINS and origin.rstrip('/') not in (f"http://{request.headers.get('host', '')}", f"https://{request.headers.get('host', '')}"):
        raise HTTPException(403, 'Origem não permitida. Configure ALLOWED_ORIGINS no serviço de IA.')


@app.get('/api/documents/status')
async def status():
    return dict(enabled=importlib.util.find_spec('docling') is not None, ready=engine._converter is not None, engine='Docling + TableFormer', protocol=1)


@app.get('/health/live')
async def live():
    return {'status': 'alive'}


@app.post('/api/documents/prepare')
async def prepare(request: Request):
    check_origin(request)
    if not BUSY.acquire(blocking=False):
        raise HTTPException(429, 'Uma leitura já está em andamento.', headers={'Retry-After': '30'})
    try:
        await asyncio.to_thread(engine.get_converter)
        return {'ready': True}
    except engine.ModelUnavailable as error:
        raise HTTPException(503, str(error)) from error
    finally:
        BUSY.release()


def document_pdf(data, mime, directory):
    path = Path(directory) / 'document.pdf'
    if mime == 'application/pdf':
        if not data.startswith(b'%PDF-'):
            raise ValueError('O conteúdo não é um PDF válido.')
        pdf = PdfReader(io.BytesIO(data), strict=False)
        if pdf.is_encrypted:
            raise ValueError('PDF protegido por senha não é suportado.')
        if not 1 <= len(pdf.pages) <= 10:
            raise ValueError('Envie um PDF com até 10 páginas.')
        path.write_bytes(data)
    else:
        expected = {'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WEBP'}[mime]
        with Image.open(io.BytesIO(data)) as image:
            if image.format != expected or image.width * image.height > 25000000 or getattr(image, 'n_frames', 1) != 1:
                raise ValueError('Imagem inválida, animada ou maior que 25 megapixels.')
            normalized = ImageOps.exif_transpose(image).convert('RGB')
            normalized.save(path, 'PDF', resolution=150)
    return path


def analyze(data, mime):
    # Only generated names in a private temporary directory; no document is retained.
    with tempfile.TemporaryDirectory(prefix='kush-docling-') as directory:
        path = document_pdf(data, mime, directory)
        return engine.convert_document(path)


@app.post('/api/documents/extract')
async def extract(request: Request):
    check_origin(request)
    mime = request.headers.get('content-type', '').split(';')[0]
    if mime not in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp'):
        raise HTTPException(415, 'Envie PDF, PNG, JPEG ou WebP.')
    key = request.client.host if request.client else 'unknown'
    now = time.monotonic()
    bucket = REQUESTS[key]
    while bucket and now - bucket[0] >= 60:
        bucket.popleft()
    if len(bucket) >= 6:
        raise HTTPException(429, 'Limite de seis leituras por minuto. Aguarde.', headers={'Retry-After': '60'})
    if len(REQUESTS) > 10000:
        for address in list(REQUESTS):
            if not REQUESTS[address] or now - REQUESTS[address][-1] > 60:
                del REQUESTS[address]
    if not BUSY.acquire(blocking=False):
        raise HTTPException(429, 'Uma leitura já está em andamento. Aguarde a conclusão.', headers={'Retry-After': '30'})
    bucket.append(now)
    try:
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > LIMIT:
                raise HTTPException(413, 'O arquivo excede 5 MB.')
        if not data:
            raise HTTPException(400, 'Arquivo vazio.')
        result = await asyncio.to_thread(analyze, bytes(data), mime)
        return result
    except engine.ModelUnavailable as error:
        raise HTTPException(503, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    except HTTPException:
        raise
    except Exception as error:
        # No document content or raw provider/library exceptions in responses or logs.
        raise HTTPException(422, 'Não foi possível analisar este documento. Confira se está íntegro e sem senha ou tente dividi-lo em páginas.') from None
    finally:
        BUSY.release()


public = Path(__file__).resolve().parent.parent / 'public'
if public.is_dir():
    app.mount('/', StaticFiles(directory=public, html=True), name='site')
