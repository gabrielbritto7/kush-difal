# Testar a leitura com IA Docling

O frontend e este backend já estão integrados, mas **publicar o frontend sozinho na Vercel não instala nem executa o Docling**. A IA precisa de um servidor Python/CPU ou de um host que aceite o Dockerfile. Não há chave de API paga. O modelo/código são abertos; custos de hospedagem dependem da sua infraestrutura. Consulte também as licenças individuais dos modelos.

## Opção 1 — site e IA juntos em Docker

Na raiz do projeto:

```sh
docker compose up --build
```

Abra a porta 7860 do servidor. Para testar no próprio computador, o site estará em `http://localhost:7860`. O container inclui a página e a API no mesmo endereço: selecione **IA Docling**, envie um orçamento e confira os itens antes de importar.

A primeira inicialização precisa baixar os modelos públicos do Docling. É possível preparar o cache antes de enviar o documento:

```sh
docker compose exec difal python -m backend.prepare
```

Os pesos ficam no volume `docling-models`. O download não exige token de IA. O host precisa alcançar Hugging Face e seus servidores de arquivos, além dos repositórios de pacotes durante o build. Não desative verificação TLS. Em redes com CA própria, o Dockerfile aceita o segredo BuildKit `proxy_ca` para npm/pip; em execução forneça a CA ao processo pelas variáveis de confiança correspondentes.

O compose reserva limites de 8 GB de memória e quatro CPUs. São valores de configuração para o teste, não uma medição de capacidade ou garantia de desempenho. A primeira leitura pode levar minutos; o timeout de documento é 240 segundos. Ajuste os limites após medir documentos reais.

## Opção 2 — manter o site na Vercel

1. Publique este Dockerfile em um host de containers com HTTPS e memória suficiente. Um Space Docker no Hugging Face é uma possibilidade; disponibilidade e limites gratuitos dependem da conta e do provedor. O serviço usa a variável `PORT` (padrão 7860).
2. Configure `ALLOWED_ORIGINS` no backend com a origem exata do frontend, por exemplo `https://difal.kush-archives.com.br`. Para previews, acrescente a origem exata de cada preview que será usado.
3. Na Vercel, defina a variável **não secreta** `DOCUMENT_AI_URL=https://seu-backend.exemplo.com` e faça novo deploy. O build grava esse endereço em `app-config.json`.
4. Alternativamente, na página abra **Ler PDF / foto → Conectar serviço de IA**, informe a URL e clique em conectar. Esse endereço fica salvo somente no navegador.
5. Verifique se o serviço está conectado e se a primeira leitura efetivamente retorna `method: "docling"`. Se os modelos não carregarem, a página mostra o erro e não substitui o resultado por OCR local silenciosamente.

Sem uma URL configurada, a página tenta `/api/documents` na própria origem. Isso funciona no container integrado; na Vercel estática retornará indisponível até um backend ser conectado.

## Opção 3 — Python local, sem Docker

Requer Python 3.12 e Tesseract com os modelos `por` e/ou `eng`. Em Debian/Ubuntu: `apt-get install tesseract-ocr tesseract-ocr-por tesseract-ocr-eng libgomp1`.

```sh
python3 -m venv .venv-docling
. .venv-docling/bin/activate
pip install -r backend/requirements-cpu.txt
pip install -r backend/requirements.lock
npm ci
npm run build
python -m backend.prepare
uvicorn backend.app:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log
```

Abra `http://localhost:8000`. O cache segue `DOCLING_CACHE_DIR` e `HF_HOME`, se definidos. Não copie chaves ou arquivos de credenciais para o projeto.

## O que a IA faz

Docling usa modelos de layout e TableFormer para reconhecer células e estrutura de tabelas. Tesseract é usado como OCR auxiliar. O adaptador lê as células estruturadas e reconhece cabeçalhos, inclusive com colunas desconhecidas, ordens diferentes e títulos divididos em linhas. Não é um LLM que conhece regras tributárias e não determina NCM ou alíquotas.

Uma linha precisa de descrição, quantidade e preço unitário ou total. Se apenas o total estiver disponível, o preço é calculado por total ÷ quantidade com aviso. NCM só é aceito quando explícito; números ilegíveis, quantidades zeradas e totais divergentes são rejeitados com aviso. Frete/seguro/IPI/descontos globais não são distribuídos automaticamente. Tabelas reconhecidas e texto ficam disponíveis para conferir o que foi omitido. Nenhuma extração deve ser usada sem revisão.

## Contrato e privacidade

- `GET /api/documents/status`: instalação disponível (`enabled`) e modelos inicializados (`ready`), estados distintos.
- `POST /api/documents/prepare`: carrega os modelos; retorna falha se não puder inicializá-los.
- `POST /api/documents/extract`: corpo binário do arquivo e `Content-Type` PDF/PNG/JPEG/WebP. Limites de 5 MB, 10 páginas, 25 megapixels e 500 itens. Retorna itens, tabelas, texto, avisos e `method: "docling"`.
- `GET /health/live`: somente vida do processo, não prova que os modelos estão disponíveis nem que uma leitura funciona.

O documento é enviado apenas após autorização do usuário. A inferência acontece no servidor escolhido, sem chamada a APIs de IA externas. Arquivos temporários são excluídos ao finalizar ou falhar; interrupção abrupta pode deixar arquivos no diretório temporário do sistema. O serviço não registra o conteúdo dos documentos e não oferece busca de URLs remotas. Use HTTPS e um host confiável.

Há uma leitura por vez, limite de seis pedidos por minuto por endereço de conexão e CORS explícito. CORS não é autenticação. Para uso público, acrescente autenticação/quota no gateway do host, limite de corpo e tempo do proxy, e restrição de recursos. O serviço é preparado para um teste privado; não é uma infraestrutura de produção multiusuário validada.

## Testes e limites da validação

```sh
pip install -r backend/requirements-test.txt
python -m unittest discover -s backend/tests -v
```

Os testes cobrem mapeamento, classes reais de documento do SDK Docling, API, validação e limpeza de arquivos. **A inferência nesses testes de integração é simulada**; eles não medem precisão de IA. A inicialização real tentou baixar pesos e foi bloqueada com `403` pelo proxy deste ambiente. Portanto não há extração real com pesos validada nesta sessão, nem evidência de que o orçamento específico do usuário será reconhecido. Valide com os modelos baixados e o documento real antes de concluir que o problema de reconhecimento foi resolvido.
