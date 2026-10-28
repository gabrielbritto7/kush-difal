"""Map structured Docling cells to fiscal input. Never infer NCM or tax rates."""
import re
import unicodedata
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

STATES = set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split())


def normalized(value):
    return ''.join(c for c in unicodedata.normalize('NFD', str(value)) if unicodedata.category(c) != 'Mn').lower()


def column_name(value):
    text = re.sub(r'[^a-z0-9]+', ' ', normalized(value)).strip()
    text = re.sub(r'\br\s*s\b', '', text).strip()
    if re.search(r'\b(descricao|discriminacao|produto|mercadoria|especificacao|description)\b', text) and not re.search(r'\b(codigo|cod|total|valor)\b', text):
        return 'description'
    if re.search(r'\bncm\b', text):
        return 'ncm'
    if re.fullmatch(r'(quantidade|qtde|qtd|quant|qt|quantity)( solicitada| comercial| com)?', text):
        return 'quantity'
    if re.search(r'\b(unitario|unitaria|unit|unitary)\b', text) and re.search(r'\b(valor|vlr|vl|v|vr|preco|price)\b', text):
        return 'price'
    if text in ('unitario', 'unit price', 'preco', 'price'):
        return 'price'
    if re.search(r'\btotal\b', text) and not re.search(r'\b(icms|ipi|tributos|impostos)\b', text):
        return 'total'
    if re.fullmatch(r'(valor |vlr |vl |v )?frete', text):
        return 'freight'
    if re.fullmatch(r'(valor |vlr |vl |v )?(desconto|desc)', text):
        return 'discount'
    if re.fullmatch(r'(outras despesas|despesas acessorias|valor ipi|v ipi|seguro)', text):
        return 'other'
    return None


def number(value):
    text = re.sub(r'\s|R\$', '', str(value)).strip()
    if not text:
        raise ValueError('Campo numérico vazio')
    if ',' in text:
        if not re.fullmatch(r'\d{1,3}(?:\.\d{3})*,\d+|\d+,\d+', text):
            raise ValueError('Número inválido')
        text = text.replace('.', '').replace(',', '.')
    elif not re.fullmatch(r'\d+(?:\.\d+)?', text):
        raise ValueError('Número inválido')
    try:
        result = Decimal(text)
    except InvalidOperation as error:
        raise ValueError('Número inválido') from error
    if not result.is_finite() or result < 0 or result > Decimal('1000000000000'):
        raise ValueError('Valor fora do limite')
    return result


def cents(value):
    return value.quantize(Decimal('.01'), rounding=ROUND_HALF_UP)


def extract_table_items(tables, text=''):
    items, warnings, skipped, recognized = [], [], 0, 0
    for table_index, table in enumerate(tables):
        rows = table.get('rows', [])
        if not rows:
            continue
        mapping, first_data = None, 0
        # Header rows can be merged or split across two lines; geometry is supplied by Docling.
        for start in range(min(8, len(rows))):
            for depth in (1, 2, 3):
                if start + depth > len(rows):
                    continue
                width = max(len(row) for row in rows[start:start+depth])
                headers = [' '.join(dict.fromkeys(str(row[col]).strip() for row in rows[start:start+depth] if col < len(row) and str(row[col]).strip())) for col in range(width)]
                fields = [column_name(header) for header in headers]
                if 'description' in fields and 'quantity' in fields and ('price' in fields or 'total' in fields):
                    mapping = {}
                    for index, field in enumerate(fields):
                        if field:
                            mapping.setdefault(field, []).append(index)
                    if any(len(mapping.get(key, [])) > 1 for key in ('description', 'quantity', 'price', 'total')):
                        mapping = None
                        continue
                    first_data = start + depth
                    break
            if mapping:
                break
        if not mapping:
            continue
        recognized += 1
        for row in rows[first_data:]:
            def get(key):
                indices = mapping.get(key, [])
                return str(row[indices[0]]).strip() if indices and indices[0] < len(row) else ''
            description = get('description').strip()
            if not description or re.match(r'^(total|subtotal|frete|desconto|observac)\b', normalized(description)):
                continue
            if column_name(description) == 'description' and column_name(get('quantity')) == 'quantity':
                continue
            try:
                quantity = number(get('quantity'))
                if quantity <= 0:
                    raise ValueError('Quantidade zerada')
                other = sum((number(row[index]) for index in mapping.get('other', []) if index < len(row) and str(row[index]).strip()), Decimal(0))
                freight = number(get('freight')) if get('freight') else Decimal(0)
                discount = number(get('discount')) if get('discount') else Decimal(0)
                total = number(get('total')) if get('total') else None
                if get('price'):
                    price = number(get('price'))
                elif total is not None and not (freight or discount or other):
                    price = total / quantity
                    warnings.append(f'Tabela {table_index+1}: preço unitário de “{description[:60]}” calculado por total ÷ quantidade; confira o arredondamento.')
                else:
                    raise ValueError('Preço ausente')
                expected = cents(quantity * price + freight + other - discount)
                if expected < 0 or total is not None and abs(expected - total) > Decimal('.02'):
                    raise ValueError('Total não confere')
                ncm = re.sub(r'[.\s]', '', get('ncm'))
                if ncm and not re.fullmatch(r'\d{8}', ncm):
                    warnings.append(f'NCM ilegível em “{description[:60]}”; deixado em branco.')
                    ncm = ''
                items.append(dict(description=description[:500], ncm=ncm, quantity=float(quantity), price=float(price), freight=float(freight), other=float(other), discount=float(discount)))
            except (ValueError, IndexError):
                skipped += 1
    if len(items) > 500:
        raise ValueError('Limite de 500 itens por documento. Divida o arquivo.')
    if skipped:
        warnings.append(f'{skipped} linha(s) não importadas por campos ausentes, ilegíveis ou total divergente. Confira as tabelas e inclua os itens faltantes.')
    if not items:
        warnings.append('A IA não encontrou itens com descrição, quantidade e preço confiáveis. Confira as tabelas reconhecidas; pode ser necessário ajustar os cabeçalhos ou preencher os itens manualmente.')
    warnings.append('A IA reconhece a estrutura do documento, mas não valida NCM, alíquotas nem enquadramento. Confira todos os valores. Frete, IPI e descontos globais não são distribuídos automaticamente.')
    def uf(label):
        match = re.search(r'(?:^|\n)\s*(?:estado de )?' + label + r'\s*[:=-]\s*([a-z]{2})\b', normalized(text))
        value = match.group(1).upper() if match else None
        return value if value in STATES else None
    return dict(items=items, warnings=list(dict.fromkeys(warnings)), origin=uf('origem'), destination=uf('destino'), tableCount=len(tables), mappedTableCount=recognized)
