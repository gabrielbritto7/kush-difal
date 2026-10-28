"""Docling layout and TableFormer inference, loaded once per service process."""
import os
import subprocess
import threading

_converter = None
_lock = threading.Lock()


class ModelUnavailable(Exception):
    pass


def get_converter():
    global _converter
    with _lock:
        if _converter is not None:
            return _converter
        try:
            from docling.datamodel.base_models import InputFormat
            from docling.datamodel.pipeline_options import PdfPipelineOptions, TesseractCliOcrOptions, TableFormerMode
            from docling.datamodel.accelerator_options import AcceleratorOptions, AcceleratorDevice
            from docling.document_converter import DocumentConverter, PdfFormatOption
            languages = subprocess.run(['tesseract', '--list-langs'], capture_output=True, text=True, check=True, timeout=10).stdout.split()
            selected = [language for language in ('por', 'eng') if language in languages]
            if not selected:
                raise RuntimeError('Tesseract precisa de por ou eng')
            options = PdfPipelineOptions()
            options.do_ocr = True
            options.do_table_structure = True
            options.table_structure_options.mode = TableFormerMode.ACCURATE
            options.ocr_options = TesseractCliOcrOptions(lang=selected)
            options.accelerator_options = AcceleratorOptions(num_threads=min(4, os.cpu_count() or 1), device=AcceleratorDevice.CPU)
            options.document_timeout = 240
            options.enable_remote_services = False
            _converter = DocumentConverter(allowed_formats=[InputFormat.PDF], format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})
            # Build now, so /ready validates cached weights and model initialization, not only Python imports.
            _converter.initialize_pipeline(InputFormat.PDF)
            return _converter
        except Exception as error:
            raise ModelUnavailable('Os modelos do Docling ainda não estão disponíveis. Execute o download de modelos no servidor e confira a rede/cache. Nenhuma leitura por IA foi concluída.') from error


def convert_document(path):
    from backend.table_items import extract_table_items
    converter = get_converter()
    result = converter.convert(path, max_num_pages=10, max_file_size=5*1024*1024)
    if str(result.status.value) != 'success':
        raise ValueError('A IA não concluiu todas as páginas. Divida o documento ou confira o arquivo; nenhum resultado parcial foi importado.')
    doc = result.document
    tables = [dict(rows=[[cell.text for cell in row] for row in table.data.grid]) for table in doc.tables]
    text = doc.export_to_markdown()[:500000]
    parsed = extract_table_items(tables, text)
    parsed.update(text=text, method='docling', engine='Docling + TableFormer', pages=len(doc.pages), tables=tables, language='por')
    return parsed
