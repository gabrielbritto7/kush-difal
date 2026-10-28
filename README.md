# Kush DIFAL

Site de cálculo de DIFAL interestadual em português. Agora com modo **IA Docling** para reconhecer a estrutura de tabelas em PDFs e fotos, sem chave de API de IA paga. Esse modo precisa de um backend separado; XML/CSV e o modo local simples continuam no navegador.

## Desenvolvimento

Node.js 24.5+ e npm. Dependências fixadas no `package-lock.json`.

```sh
npm ci
npm run build
npm start
npm test
npm run check
```

Para testar **site + IA juntos**, consulte [backend/README.md](backend/README.md), começando por `docker compose up --build`. Somente publicar na Vercel não instala a IA.

O servidor estático local usa a porta 3000 ou `PORT`. `npm run build` gera `public/`, contendo somente os arquivos públicos, PDF.js, Tesseract.js, WebAssembly, fontes e modelo OCR em português. O modo local não utiliza CDNs externas durante a leitura. A primeira utilização de OCR baixa aproximadamente alguns megabytes de ferramentas e modelo do próprio site. O desempenho depende do dispositivo.

## Publicação na Vercel

A configuração `vercel.json` define o comando `npm run build` e o diretório `public`. Importe este repositório na Vercel usando o preset **Other**, sem servidor ou funções. Para o modo IA, publique também o backend e defina `DOCUMENT_AI_URL` com sua URL HTTPS (não é uma chave). Sem backend, a página mostra que a IA está desconectada; não simula uma análise. O token da Vercel, quando usado para automatizar o deploy, pertence apenas ao ambiente de administração e nunca ao site ou ao repositório.

Após um deployment passar para Ready, associe `difal.kush-archives.com.br` ao projeto. Use exatamente o registro DNS indicado pela Vercel para esse domínio. Se o DNS estiver no Registro.br, crie o registro do subdomínio `difal` na zona existente; não troque os nameservers nem altere o domínio raiz ou registros de email. Se a zona já estiver na Vercel, configure pelo próprio provedor. Confirme a propagação, emissão do certificado e acesso HTTPS antes de considerar a publicação concluída. Não há URL de produção validada apenas por estes arquivos existirem.

## Importação e conferência

- XML original de NF-e: produtos, UFs e componentes da base.
- CSV de orçamento: use o modelo da interface.
- IA Docling: serviço com modelos de layout e TableFormer, usando células estruturadas para mapear itens.
- PDF com texto no modo local: PDF.js extrai texto e posições.
- PDF digitalizado e fotos no modo local: Tesseract.js executa OCR em português no navegador.
- Entrada manual: disponível para qualquer documento.

Até 5 MB por arquivo, PDFs de até 10 páginas, imagens de até 25 megapixels e 500 itens por leitura PDF/OCR. Documentos protegidos por senha não são suportados. A análise ocorre página por página; páginas com menos de 30 caracteres passam por OCR.

O parser do modo local reconhece tabelas simples com descrição, quantidade e valor unitário, e opcionalmente NCM e total. Totais de linha, quando identificados, precisam conferir com quantidade × preço para aceitar a sugestão. O texto original e um CSV editável aparecem antes da importação, que exige confirmação. Tabelas complexas, DANFEs, texto quebrado e fotos ruins podem precisar de ajustes ou do XML original. OCR pode trocar dígitos; não determina NCM, alíquotas ou enquadramento. Frete, IPI, despesas e descontos globais não são distribuídos automaticamente. Inclua-os após a conferência.

Após importar PDF/foto, UFs não identificadas ficam em branco, alíquotas internas são limpas e o enquadramento deve ser confirmado. O OCR não inicia um cálculo sem revisão.

## Privacidade

XML, CSV e o modo local ficam no navegador. **No modo IA**, o documento é enviado somente após consentimento ao serviço Docling informado na tela, para inferência no próprio servidor. O código do backend deste projeto usa arquivos temporários e os exclui ao terminar; confirme que o host é confiável e mantenha logs/gateway sem captura de documentos. Não há chamadas de inferência para OpenAI ou outro provedor pago. O primeiro carregamento do servidor baixa os pesos públicos dos modelos, sem enviar o documento a esses repositórios.

Somente resumos de cálculos e a URL do serviço são salvos no navegador. O histórico permite apagar os resumos. Não coloque segredos na URL do backend. Não é necessária `DIFAL_AI_KEY`; remova a exigência antiga nas configurações se ainda estiver presente.

## Escopo tributário

Simulação por **base única** para consumidor final não contribuinte. Base = produtos + frete + seguro + outras despesas + IPI − descontos. DIFAL = base × (interna − interestadual), com FCP separado e arredondamento por item. A alíquota interestadual é sugerida por UF ou marcada para importados sujeitos a 4%. Confirme ICMS interno, FCP, data, produto e legislação. XML com taxas diferentes deve ser separado por enquadramento.

Não cobre ICMS-ST, benefícios fiscais, reduções, base dupla, regimes especiais ou operações para contribuintes. Não emite GNRE, valida assinatura digital nem consulta autorização da SEFAZ. Não substitui validação fiscal.

## Código aberto

- [Docling](https://github.com/docling-project/docling), MIT (consulte as licenças dos modelos separadamente).
- [PDF.js](https://github.com/mozilla/pdf.js), Apache 2.0.
- [Tesseract.js](https://github.com/naptha/tesseract.js), Apache 2.0, e Tesseract WebAssembly.
- [Modelo de português](https://www.npmjs.com/package/@tesseract.js-data/por).

As dependências são obtidas pelo npm com integridade registrada no lockfile. O build inclui os avisos de licença disponíveis em `public/vendor/licenses`.

A implementação anterior com Poppler/Tesseract nativos foi preservada em `document-reader.mjs` apenas como alternativa local, sem endpoint público e sem uso pelo site publicado. Seus testes opcionais (`npm run test:native`) precisam de Poppler, Tesseract, Python/Pillow e fontes DejaVu. A página estática e os testes padrão não dependem dessas ferramentas.

## Identidade visual

O site segue a identidade dos projetos PDF (`ilovekush`) e Bitmap do Kush Archives: títulos Fredoka, texto Quicksand, fundo branco, contornos pretos e botões arredondados. Fontes são servidas localmente e suas licenças acompanham o build em `assets/licenses`. O favicon é o mesmo do projeto PDF do usuário. Os links do cabeçalho levam às ferramentas PDF, Bitmap e remoção de fundo.

## Situação da integração Docling

O frontend permite selecionar IA Docling, informar a URL, autorizar o envio, revisar texto/tabelas e importar itens conferidos. O backend possui API, teste do adaptador com classes reais do SDK, validações e arquivos de publicação Docker. Os testes da API simulam a inferência; a tentativa de inicializar modelos reais foi bloqueada por `403` no proxy ao acessar Hugging Face. Não há extração real com pesos validada nesta sessão. As instruções completas e os limites estão em [backend/README.md](backend/README.md).

## Quando os produtos não forem identificados

A leitura local é a opção padrão e não exige backend. Depois da extração, a revisão mostra campos de descrição, NCM opcional, quantidade, valor unitário, frete, despesas e desconto. Se nenhum item for reconhecido, um produto vazio aparece para preenchimento a partir do documento, sem precisar editar CSV. Após conferir e importar, a página leva aos estados e alíquotas necessários ao cálculo. O CSV permanece como opção avançada. Isso permite continuar manualmente; não transforma o OCR em uma IA nem garante reconhecimento automático de layouts desconhecidos.
