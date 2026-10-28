# Kush DIFAL

Site de cálculo de DIFAL interestadual em português. XML, CSV, PDFs e fotos são processados no navegador, sem chave de IA e sem envio de documentos a um servidor.

## Desenvolvimento

Node.js 24.5+ e npm. Dependências fixadas no `package-lock.json`.

```sh
npm ci
npm run build
npm start
npm test
npm run check
```

O servidor local usa a porta 3000 ou `PORT`. `npm run build` gera `public/`, contendo somente os arquivos públicos, PDF.js, Tesseract.js, WebAssembly, fontes e modelo OCR em português. Não utiliza CDNs externas durante a leitura. A primeira utilização de OCR baixa aproximadamente alguns megabytes de ferramentas e modelo do próprio site. O desempenho depende do dispositivo.

## Publicação na Vercel

A configuração `vercel.json` define o comando `npm run build` e o diretório `public`. Importe este repositório na Vercel usando o preset **Other**, sem servidor ou funções. Nenhuma variável de IA é necessária. O token da Vercel, quando usado para automatizar o deploy, pertence apenas ao ambiente de administração e nunca ao site ou ao repositório.

Após um deployment passar para Ready, associe `difal.kush-archives.com.br` ao projeto. Use exatamente o registro DNS indicado pela Vercel para esse domínio. Se o DNS estiver no Registro.br, crie o registro do subdomínio `difal` na zona existente; não troque os nameservers nem altere o domínio raiz ou registros de email. Se a zona já estiver na Vercel, configure pelo próprio provedor. Confirme a propagação, emissão do certificado e acesso HTTPS antes de considerar a publicação concluída. Não há URL de produção validada apenas por estes arquivos existirem.

## Importação e conferência

- XML original de NF-e: produtos, UFs e componentes da base.
- CSV de orçamento: use o modelo da interface.
- PDF com texto: PDF.js extrai texto e posições.
- PDF digitalizado e fotos: Tesseract.js executa OCR em português no navegador.
- Entrada manual: disponível para qualquer documento.

Até 5 MB por arquivo, PDFs de até 10 páginas, imagens de até 25 megapixels e 500 itens por leitura PDF/OCR. Documentos protegidos por senha não são suportados. A análise ocorre página por página; páginas com menos de 30 caracteres passam por OCR.

O parser reconhece tabelas simples com descrição, quantidade e valor unitário, e opcionalmente NCM e total. Totais de linha, quando identificados, precisam conferir com quantidade × preço para aceitar a sugestão. O texto original e um CSV editável aparecem antes da importação, que exige confirmação. Tabelas complexas, DANFEs, texto quebrado e fotos ruins podem precisar de ajustes ou do XML original. OCR pode trocar dígitos; não determina NCM, alíquotas ou enquadramento. Frete, IPI, despesas e descontos globais não são distribuídos automaticamente. Inclua-os após a conferência.

Após importar PDF/foto, UFs não identificadas ficam em branco, alíquotas internas são limpas e o enquadramento deve ser confirmado. O OCR não inicia um cálculo sem revisão.

## Privacidade

Os documentos permanecem no navegador. Não são enviados à OpenAI nem ao servidor da hospedagem. Ferramentas e modelo são baixados do próprio site, e o navegador pode armazená-los em cache. Somente resumos dos cálculos são persistidos no localStorage. O botão de histórico permite excluí-los. Nenhuma chave de API de IA é necessária; a exigência antiga `DIFAL_AI_KEY` deve ser removida das configurações de ambiente se ainda estiver presente.

## Escopo tributário

Simulação por **base única** para consumidor final não contribuinte. Base = produtos + frete + seguro + outras despesas + IPI − descontos. DIFAL = base × (interna − interestadual), com FCP separado e arredondamento por item. A alíquota interestadual é sugerida por UF ou marcada para importados sujeitos a 4%. Confirme ICMS interno, FCP, data, produto e legislação. XML com taxas diferentes deve ser separado por enquadramento.

Não cobre ICMS-ST, benefícios fiscais, reduções, base dupla, regimes especiais ou operações para contribuintes. Não emite GNRE, valida assinatura digital nem consulta autorização da SEFAZ. Não substitui validação fiscal.

## Código aberto

- [PDF.js](https://github.com/mozilla/pdf.js), Apache 2.0.
- [Tesseract.js](https://github.com/naptha/tesseract.js), Apache 2.0, e Tesseract WebAssembly.
- [Modelo de português](https://www.npmjs.com/package/@tesseract.js-data/por).

As dependências são obtidas pelo npm com integridade registrada no lockfile. O build inclui os avisos de licença disponíveis em `public/vendor/licenses`.

A implementação anterior com Poppler/Tesseract nativos foi preservada em `document-reader.mjs` apenas como alternativa local, sem endpoint público e sem uso pelo site publicado. Seus testes opcionais (`npm run test:native`) precisam de Poppler, Tesseract, Python/Pillow e fontes DejaVu. A página estática e os testes padrão não dependem dessas ferramentas.
