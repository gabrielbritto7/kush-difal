import unittest
from backend.table_items import extract_table_items, number


class TablesTest(unittest.TestCase):
    def test_different_column_order_and_unknown_tax_columns(self):
        result = extract_table_items([{'rows': [
            ['CÓD.', 'PRODUTO', 'CFOP', 'UN.', 'QTDE.', 'VLR. UNITÁRIO', 'VLR. TOTAL', 'NCM/SH'],
            ['17', 'Mesa industrial', '6102', 'UN', '2', '1.234,50', '2.469,00', '9403.60.00'],
        ]}], 'Origem: SP\nDestino: RJ')
        self.assertEqual(len(result['items']), 1)
        self.assertEqual(result['items'][0]['description'], 'Mesa industrial')
        self.assertEqual(result['items'][0]['price'], 1234.5)
        self.assertEqual(result['items'][0]['ncm'], '94036000')
        self.assertEqual(result['destination'], 'RJ')

    def test_merged_two_line_headers_and_repeated_header(self):
        result = extract_table_items([{'rows': [
            ['Descrição', 'Quantidade', 'Valor', 'Valor'],
            ['', '', 'Unitário', 'Total'],
            ['Cadeira', '3', '100,00', '300,00'],
            ['Descrição', 'Quantidade', 'Valor unitário', 'Valor total'],
        ]}])
        self.assertEqual(len(result['items']), 1)
        self.assertEqual(result['items'][0]['quantity'], 3)

    def test_no_tax_rates_or_invented_ncm_and_unreadable_items_reported(self):
        result = extract_table_items([{'rows': [
            ['Discriminação', 'Qtd', 'Preço unitário', 'Total', 'NCM'],
            ['Prateleira', '1', '120,00', '120,00', '???'],
            ['Mesa', '', '100', '100', ''],
            ['Armário', '2', '100', '999', ''],
        ]}])
        self.assertEqual(len(result['items']), 1)
        self.assertEqual(result['items'][0]['ncm'], '')
        self.assertNotIn('internalRate', result)
        self.assertTrue(any('2 linha(s)' in warning for warning in result['warnings']))

    def test_total_can_derive_unit_price_with_explicit_warning(self):
        result = extract_table_items([{'rows': [['Produto', 'Quantidade', 'Total'], ['Cadeira', '4', '400,00']]}])
        self.assertEqual(result['items'][0]['price'], 100)
        self.assertTrue(any('total ÷ quantidade' in warning for warning in result['warnings']))

    def test_empty_tables_report_failure_instead_of_inventing_items(self):
        result = extract_table_items([{'rows': [['CNPJ', 'Valor'], ['1234', '100,00']]}])
        self.assertEqual(result['items'], [])
        self.assertEqual(result['mappedTableCount'], 0)

    def test_brazilian_values_invalid_and_decimal_quantities(self):
        self.assertEqual(float(number('R$ 1.234,56')), 1234.56)
        self.assertEqual(float(number('1,25')), 1.25)
        for value in ('-1', '', 'abc', 'NaN', 'inf', '1,2,3'):
            with self.assertRaises(ValueError):
                number(value)


if __name__ == '__main__':
    unittest.main()
