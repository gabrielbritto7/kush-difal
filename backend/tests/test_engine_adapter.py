"""Exercise real Docling document classes; inference itself is simulated."""
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from docling_core.types.doc import DoclingDocument, TableData, TableCell
from backend.engine import convert_document


class AdapterTest(unittest.TestCase):
    def test_docling_grid_to_items_uses_cell_boundaries(self):
        rows = [['Código', 'Produto', 'Qtde', 'Vlr. unitário', 'Total'], ['001', 'Mesa com descrição longa', '2', '150,00', '300,00']]
        cells = [TableCell(text=text, start_row_offset_idx=r, end_row_offset_idx=r+1, start_col_offset_idx=c, end_col_offset_idx=c+1, column_header=r==0) for r, row in enumerate(rows) for c, text in enumerate(row)]
        doc = DoclingDocument(name='test-budget')
        doc.add_table(data=TableData(num_rows=2, num_cols=5, table_cells=cells))
        result = SimpleNamespace(status=SimpleNamespace(value='success'), document=doc)
        converter = SimpleNamespace(convert=lambda *args, **kwargs: result)
        with patch('backend.engine.get_converter', return_value=converter):
            parsed = convert_document('unused-test-path.pdf')
        self.assertEqual(len(parsed['items']), 1)
        self.assertEqual(parsed['items'][0]['description'], 'Mesa com descrição longa')
        self.assertEqual(parsed['tableCount'], 1)
        self.assertEqual(parsed['method'], 'docling')


if __name__ == '__main__':
    unittest.main()
