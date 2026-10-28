"""Download/load exactly the models selected by the service, preserving TLS."""
from backend.engine import get_converter, ModelUnavailable

if __name__ == '__main__':
    try:
        get_converter()
        print('Modelos do Docling carregados. Serviço pronto para um teste de leitura real.')
    except ModelUnavailable as error:
        print(str(error))
        raise SystemExit(1)
