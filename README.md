# Kush DIFAL

Calculadora de DIFAL com **reconhecimento automático por IA no navegador**. Basta selecionar o PDF ou a imagem: o site identifica as células da tabela, lê produtos/quantidades/preços e confere os totais. Hospedagem estática na **Vercel**, código e modelo no **GitHub**. Não precisa de servidor de IA, endereço de serviço, chave paga, Hugging Face ou API de inferência.

## Executar e publicar

Node.js 24.5+ e npm:

```sh
npm ci
npm run build
npm start
```

O servidor estático usa a porta 3000 ou `PORT`. Na Vercel, importe o repositório com preset **Other**, build `npm run build` e saída `public`. Nenhuma variável de IA é necessária. `DOCUMENT_AI_URL` e `DIFAL_AI_KEY` não são usadas pelo site atual e podem ser removidas das configurações antigas.

O build inclui o modelo SLANet-plus, ONNX Runtime Web, PDF.js, Tesseract.js, modelo de português e fontes locais. O modelo de tabelas ocupa aproximadamente 8 MB; o runtime WebAssembly e o OCR também são baixados do próprio site. A primeira leitura usa mais rede que as seguintes; o cache é do navegador. O processamento usa CPU/WebAssembly e Web Workers, sem exigir WebGPU. Navegadores antigos, dispositivos com pouca memória, fotos ruins e documentos extensos podem falhar.

Para publicar `difal.kush-archives.com.br`, associe o domínio ao projeto e aplique o registro DNS exato fornecido pela Vercel. Preserve domínio raiz, email e nameservers. Um push no GitHub não prova que o deploy ou o domínio já estejam atualizados; confira o deployment e o HTTPS.

## Como funciona

1. PDF.js extrai o texto e as posições de PDFs selecionáveis; PDFs digitalizados e fotos passam por OCR em português com caixas de palavras.
2. O site localiza regiões candidatas da tabela, sem depender de espaçamento fixo no texto.
3. **SLANet-plus**, uma rede neural de estrutura de tabelas, prevê células, linhas e colunas com ONNX Runtime Web. O modelo é executado de verdade no dispositivo, não substituído por resposta simulada.
4. O texto é associado às células. O adaptador reconhece campos, títulos com erros comuns de OCR, descrições deslocadas e texto sobreposto à quantidade. Não gera preços nem produtos novos.
5. Quantidade × preço é conferido com o total da linha. Pequenas diferenças de arredondamento preservam o total impresso, com aviso. Entrega/frete e desconto globais explicitamente identificados são rateados em centavos; não são adicionados novamente quando já aparecem nas linhas. Encargos não modelados causam divergência de total e exigem conferência.
6. Quando um total de produtos ou de orçamento está explícito, ele precisa conferir com a soma reconhecida. Linhas rejeitadas ou divergências bloqueiam a importação automática. Os campos aparecem preenchidos; o usuário revisa e confirma, sem ter de redigitar os produtos.

O reconhecimento não é universal. O modelo pode falhar em tabelas diferentes, múltiplas colunas de cabeçalho, texto ilegível, fotografias inclinadas ou valores ambíguos. Uma soma que confere não certifica todos os caracteres da descrição ou dados fiscais. Não inventamos NCM, UF de origem, alíquotas ou enquadramento quando ausentes. O resultado fiscal depende desses dados e da confirmação do usuário.

As UFs são procuradas nas indicações de origem/destino e nos endereços dos blocos de emitente/fornecedor e destinatário/cliente. Siglas, nomes completos dos estados e colunas de UF são aceitos. O resumo mostra os estados reconhecidos e os seletores continuam editáveis; mudar a rota atualiza a sugestão interestadual. UFs ausentes ou conflitantes ficam sem seleção, sem herdar a rota de outro arquivo. Não se deduz UF por telefone, CNPJ, código de produto, nome do arquivo ou município sem estado.

Uma tabela pode automatizar também ICMS interno e FCP, mas deve ter vigência, fonte e enquadramento do produto. O projeto ainda não inclui uma tabela estadual validada para essa finalidade: o XML pode fornecer alíquotas uniformes já informadas na NF-e; fora disso, o ICMS interno e FCP continuam sujeitos à conferência.

**NFS-e de serviços é identificada separadamente.** O site mostra a descrição/valor quando legíveis e não importa a nota como mercadoria para este cálculo de DIFAL/ICMS. Isso não é uma consulta à SEFAZ, verificação de autenticidade ou parecer tributário.

XML original de NF-e e CSV continuam com importação direta. O modelo neural é usado na leitura de PDF/foto. Limites: 5 MB, PDF até 10 páginas, imagens até 25 megapixels, até 500 produtos. O reconhecimento expira em cinco minutos e libera os workers.

## Privacidade

Documentos, páginas renderizadas e resultados permanecem no navegador. Não há endpoint de upload nem chamadas a serviços de IA externos no fluxo atual. O site somente baixa arquivos estáticos do seu próprio domínio. São persistidos apenas resumos de cálculos no localStorage; o histórico permite apagá-los. Os documentos usados nos testes enviados pelo usuário não fazem parte do repositório nem do deploy.

## Verificações

```sh
npm test
npm run check
npm run test:browser
```

`npm test` verifica os cálculos, mapeamento das células, detecção de NFS-e, rateio, rejeição de divergências e hash do modelo. `test:browser` executa **inferência real** no Chromium com um PDF sintético e passa da seleção do arquivo ao cálculo, sem preencher os produtos manualmente. Requer Chromium instalado (`BROWSER_PATH` pode selecionar o executável). O script inicia um servidor de teste ou usa `TEST_BASE_URL`.

Para testar documentos privados sem copiá-los para o projeto:

```sh
npm run test:browser -- --budget /caminho/orcamento.pdf --expected-count 2 --expected-base 370 --photo /caminho/foto.jpg --scan /caminho/digitalizado.pdf --service /caminho/nfse.pdf
```

Substitua os valores de exemplo pelos totais e quantidade de linhas do documento testado. Os valores esperados são parâmetros do teste e não regras do reconhecimento. Não comite documentos de clientes. Os testes executados nesta alteração incluíram o orçamento e a NFS-e fornecidos pelo usuário, mais cópias em JPEG e PDF digitalizado. No orçamento, as linhas e os totais foram reconhecidos sem edição de produtos; a NFS-e foi identificada como serviço. Esse resultado vale para esses casos e não é uma taxa de acerto geral.

## Integridade e código aberto

- [SLANet-plus / RapidTable](https://github.com/RapidAI/RapidTable), Apache 2.0. Modelo obtido do pacote oficial `rapid-table==0.3.0`, conferido com o checksum upstream, convertido para compatibilidade com o runtime Web e incluído no GitHub.
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime), MIT.
- [PDF.js](https://github.com/mozilla/pdf.js), Apache 2.0.
- [Tesseract.js](https://github.com/naptha/tesseract.js) e modelo português, Apache 2.0.

A origem, hashes e licença do modelo estão em `assets/models`. `scripts/prepare-table-model.py` reproduz a conversão e compara as saídas numéricas com o modelo original. Os pesos aprendidos não são retreinados. O build e o worker verificam o hash do artefato convertido. Não há download de pesos externos durante o deploy; Python não é necessário na Vercel. Avisos de licença acompanham os assets.

A identidade visual usa Fredoka/Quicksand locais, fundo branco, contornos pretos e botões arredondados dos projetos PDF/Bitmap do Kush Archives. A ilustração da calculadora e os ícones do leitor e do resumo usam somente preto, branco e cinza.

## Escopo fiscal

Simulação por **base única**, para consumidor final não contribuinte. Base = produtos + frete + seguro + despesas/IPI aplicáveis − descontos. DIFAL = base × (interna − interestadual); FCP separado, com arredondamento por item. Confira tributação vigente, data, NCM, UF, benefícios e incidência de despesas. Não cobre ICMS-ST, redução de base, base dupla ou regimes especiais; não emite GNRE nem valida autorização/assinatura da NF-e. A IA lê documentos e não decide a legislação aplicável.

## Implementação antiga

O backend experimental Docling, Docker e leitor nativo foram preservados apenas como referência histórica. **Não são usados pelo site nem necessários para publicar ou testar a IA atual.** O campo de conexão de serviço foi removido. Os testes `test:backend` e `test:native` são opcionais e exigem dependências Python/sistema; não fazem parte do fluxo da Vercel.
