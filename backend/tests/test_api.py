import io
from pathlib import Path
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image
from pypdf import PdfWriter

from backend.app import app, REQUESTS
from backend.engine import ModelUnavailable


def pdf_bytes(pages=1, encrypted=False):
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(595, 842)
    if encrypted:
        writer.encrypt('test-password')
    data = io.BytesIO()
    writer.write(data)
    return data.getvalue()


class APITest(unittest.TestCase):
    def setUp(self):
        REQUESTS.clear()
        self.client = TestClient(app)

    def test_status_does_not_claim_models_ready_from_imports(self):
        with patch('backend.engine._converter', None):
            result = self.client.get('/api/documents/status').json()
        self.assertEqual(result['protocol'], 1)
        self.assertFalse(result['ready'])

    def test_upload_contract_and_temporary_file_cleanup_with_simulated_inference(self):
        paths = []
        def convert(path):
            paths.append(path)
            self.assertTrue(Path(path).is_file())
            return dict(items=[], text='Tabela extraída', method='docling', warnings=[], tableCount=0, tables=[])
        with patch('backend.engine.convert_document', side_effect=convert):
            result = self.client.post('/api/documents/extract', content=pdf_bytes(), headers={'Content-Type': 'application/pdf', 'Origin': 'http://localhost:3001'})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['method'], 'docling')
        self.assertFalse(paths[0].exists())

    def test_model_failure_is_explicit_not_fake_success(self):
        with patch('backend.engine.convert_document', side_effect=ModelUnavailable('Modelos indisponíveis')):
            response = self.client.post('/api/documents/extract', content=pdf_bytes(), headers={'Content-Type': 'application/pdf'})
        self.assertEqual(response.status_code, 503)
        self.assertIn('Modelos', response.json()['error'])

    def test_reject_invalid_origin_type_empty_and_large_files(self):
        for headers, content, status in [
            ({'Content-Type': 'application/pdf', 'Origin': 'https://untrusted.example'}, b'%PDF-', 403),
            ({'Content-Type': 'text/plain'}, b'hello', 415),
            ({'Content-Type': 'application/pdf'}, b'', 400),
            ({'Content-Type': 'application/pdf'}, b'bad', 422),
            ({'Content-Type': 'application/pdf'}, b'x'*(5*1024*1024+1), 413),
        ]:
            response = self.client.post('/api/documents/extract', content=content, headers=headers)
            self.assertEqual(response.status_code, status)

    def test_reject_page_limit_and_encrypted_pdfs_before_inference(self):
        with patch('backend.engine.convert_document') as inference:
            for content in (pdf_bytes(11), pdf_bytes(encrypted=True)):
                response = self.client.post('/api/documents/extract', content=content, headers={'Content-Type': 'application/pdf'})
                self.assertEqual(response.status_code, 422)
            inference.assert_not_called()

    def test_image_is_normalized_to_pdf_before_inference(self):
        data = io.BytesIO()
        Image.new('RGB', (200, 200), 'white').save(data, 'PNG')
        with patch('backend.engine.convert_document', return_value=dict(items=[], text='Imagem', method='docling', warnings=[], tableCount=0, tables=[])) as inference:
            response = self.client.post('/api/documents/extract', content=data.getvalue(), headers={'Content-Type': 'image/png'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(inference.call_args.args[0].suffix, '.pdf')


if __name__ == '__main__':
    unittest.main()
