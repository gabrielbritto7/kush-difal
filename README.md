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

1. PDF.js extrai o texto e as posições de PDFs selecionáveis; PDFs digitalizados e fotos passam por OCR em português com caixas de palavras. O OCR corrige pequenas inclinações e a IA recebe a mesma imagem alinhada, preservando as posições das palavras. PNGs transparentes ganham fundo branco antes da leitura. Quando a leitura por OCR é incompleta ou não recupera totais declarados, uma segunda segmentação tenta recuperar colunas numéricas ignoradas na primeira leitura. Se um PDF tiver uma camada de texto que não produz itens, o leitor tenta OCR automaticamente. Marcas d'água diagonais não entram nas linhas de texto dos produtos.
2. O site localiza regiões candidatas da tabela, sem depender de espaçamento fixo no texto. Cabeçalhos de DANFE em mais de uma linha e descrições quebradas não encerram a tabela; todas as páginas são processadas.
3. **SLANet-plus**, uma rede neural de estrutura de tabelas, prevê células, linhas e colunas com ONNX Runtime Web. O modelo é executado de verdade no dispositivo, não substituído por resposta simulada.
4. O texto é associado às células. Em notas com grade, as posições do texto e as linhas da própria página oferecem uma segunda leitura estruturada. Em orçamentos sem grade, os cabeçalhos explícitos e a posição das palavras permitem recuperar colunas que a rede tenha fundido, inclusive tabelas curtas com marca, quantidade, preço, ST e total. As duas leituras são conferidas com quantidade, preço e totais; uma interpretação incompleta não substitui outra que já confere. A recuperação não depende de nome de fornecedor, número do orçamento ou valores específicos. O adaptador reconhece títulos com erros comuns de OCR, quantidade com unidade, NCM explícito na descrição, descrições deslocadas e texto sobreposto à quantidade. Não gera preços nem produtos novos. Artefatos de borda de OCR são removidos dos números sem trocar letras por dígitos.
5. Quantidade × preço é conferido com o total da linha. Pequenas diferenças de arredondamento preservam o total impresso, com aviso. Entrega/frete e desconto globais explicitamente identificados são rateados em centavos; não são adicionados novamente quando já aparecem nas linhas. Encargos não modelados causam divergência de total e exigem conferência.
6. Quando um total de produtos ou de orçamento está explícito, ele precisa conferir com a soma reconhecida. Linhas rejeitadas ou divergências bloqueiam a importação automática. Os campos aparecem preenchidos; o usuário revisa e confirma, sem ter de redigitar os produtos.

Em DANFE, valores globais são lidos abaixo de seus rótulos, dentro das respectivas colunas, inclusive abreviações como “V. TOTAL PRODUTOS” e “V. TOTAL DA NOTA”. Frete, seguro, outras despesas, IPI e descontos são conciliados sem duplicar valores já presentes nos itens. O total bruto do produto continua separado desses componentes. Totais conflitantes entre páginas bloqueiam a importação.

Uma NF pode ter itens com alíquotas interestaduais diferentes. Quando a rota é interestadual e a tabela informa explicitamente ICMS de 4%, 7% ou 12%, esses valores são preservados por item, inclusive em XML e CSV avançado. O uso das alíquotas da nota começa ativado para a rota original; a prévia mostra os valores por produto, o resumo indica “por item” e a exportação registra a taxa aplicada em cada linha. Mudar a rota, desativar a opção ou marcar a regra geral de importados passa a usar a taxa geral correspondente. Alíquotas internas por NCM e regras fiscais especiais continuam fora do escopo automático.

O reconhecimento não é universal. O modelo pode falhar em tabelas diferentes, múltiplas colunas de cabeçalho, texto ilegível, fotografias inclinadas ou valores ambíguos. Uma soma que confere não certifica todos os caracteres da descrição ou dados fiscais. Não inventamos NCM, UF de origem ou enquadramento quando ausentes. O ICMS interno padrão vem da tabela de referência descrita abaixo; não é um número gerado pela IA.

As UFs são procuradas nas indicações de origem/destino e nos endereços dos blocos de emitente/fornecedor e destinatário/cliente. Siglas, nomes completos dos estados e colunas de UF são aceitos. O resumo mostra os estados reconhecidos e os seletores continuam editáveis; mudar a rota atualiza a sugestão interestadual. UFs ausentes ou conflitantes ficam sem seleção, sem herdar a rota de outro arquivo. Não se deduz UF por telefone, CNPJ, código de produto, nome do arquivo ou município sem estado.

O ICMS interno é preenchido automaticamente pela UF de destino, usando as 27 alíquotas da diagonal da [tabela indicada pelo usuário](https://www.calculadoraicms.com.br/). A fonte informa atualização em **19/08/2026**; os valores foram consultados em **29/10/2026** e estão versionados em `icms-rates.js`, junto da origem e das datas. Por exemplo, PR recebe 19,5%. Alterar o destino atualiza a alíquota; o campo continua editável. Uma alíquota uniforme explícita no XML da NF-e tem prioridade até o destino ser alterado. Mudar somente origem ou regra de importados preserva o ICMS interno já ajustado.

A tabela usa valores gerais da referência, não regras por NCM, data histórica ou enquadramento especial. Não substitui consulta à legislação. O FCP segue separado e ajustável; confira sua incidência e eventuais adicionais já incluídos na alíquota da fonte para evitar contagem duplicada. Nenhum site externo é consultado ao importar um documento: a tabela é um arquivo estático do próprio deploy.

Para revisar as alíquotas futuramente, execute `npm run update:rates` com acesso à fonte, confira o diff e publique o commit. O script exige todas as 27 UFs, lê somente a diagonal correspondente e rejeita tabela incompleta, inválida ou sem data. A atualização não acontece silenciosamente durante um cálculo ou build.

A opção de consumidor final não contribuinte começa marcada e permanece marcada após leitura de PDF/foto e CSV. XML com indicação explícita contrária mantém o enquadramento do documento e o aviso correspondente. O resumo distingue o total a recolher (DIFAL + FCP) do valor total da operação (base + DIFAL + FCP); o CSV também contém os dois totais. Qualquer alteração invalida os valores calculados até uma nova simulação.

**NFS-e de serviços é identificada separadamente.** O site mostra a descrição/valor quando legíveis e não importa a nota como mercadoria para este cálculo de DIFAL/ICMS. Isso não é uma consulta à SEFAZ, verificação de autenticidade ou parecer tributário.

XML original de NF-e e CSV continuam com importação direta. O modelo neural é usado na leitura de PDF/foto. Limites: 5 MB, PDF até 10 páginas, imagens até 25 megapixels, até 500 produtos. O reconhecimento expira em cinco minutos e libera os workers.

## Privacidade

Documentos, páginas renderizadas e resultados permanecem no navegador. Não há endpoint de upload nem chamadas a serviços de IA externos no fluxo atual. O site somente baixa arquivos estáticos do seu próprio domínio. São persistidos apenas resumos de cálculos no localStorage; o histórico permite apagá-los. Os documentos usados nos testes enviados pelo usuário não fazem parte do repositório nem do deploy.

## Verificações

```sh
npm test
npm run check
npm run test:browser
npm run test:invoices
npm run test:photos
```

`npm test` verifica os cálculos, mapeamento das células, detecção de NFS-e, rateio, rejeição de divergências e hash do modelo. `test:browser` executa **inferência real** no Chromium com um PDF sintético e passa da seleção do arquivo ao cálculo, sem preencher os produtos manualmente. Requer Chromium instalado (`BROWSER_PATH` pode selecionar o executável). O script inicia um servidor de teste ou usa `TEST_BASE_URL`.

`test:invoices` gera DANFEs fictícios de duas páginas, com cabeçalho dividido, descrições em várias linhas e taxas mistas de 4% e 12%. Confere leitura, NCMs, seleção automática de UFs e ICMS, cálculo por item, alteração de rota, exportação e bloqueio de uma nota inconsistente. Executa o modelo real; não usa respostas simuladas nem documentos de clientes no repositório.

`test:photos` gera orçamentos fictícios de duas linhas em PNG, JPEG e WebP, em resoluções diferentes, com leve inclinação e transparência. Executa OCR e inferência reais, confere descrição, quantidade, preço/total, UFs e cálculo, e mantém bloqueada uma foto com total divergente. A ausência da origem no documento não é preenchida por suposição. Os arquivos de teste são criados em memória; documentos enviados pelo usuário continuam fora do repositório.

Para testar documentos privados sem copiá-los para o projeto:

```sh
npm run test:browser -- --budget /caminho/orcamento.pdf --expected-count 2 --expected-base 370 --photo /caminho/foto.jpg --scan /caminho/digitalizado.pdf --service /caminho/nfse.pdf
```

Substitua os valores de exemplo pelos totais e quantidade de linhas do documento testado. Os valores esperados são parâmetros do teste e não regras do reconhecimento. Não comite documentos de clientes. Os testes executados nesta alteração incluíram o orçamento e a NFS-e fornecidos pelo usuário, mais cópias em JPEG e PDF digitalizado. No orçamento, as linhas e os totais foram reconhecidos sem edição de produtos; a NFS-e foi identificada como serviço. Esse resultado vale para esses casos e não é uma taxa de acerto geral.

Para uma NF privada, `npm run test:invoices -- --pdf /caminho/nota.pdf --expected-count 2 --expected-base 220 --expected-origin SP --expected-destination PR --expected-rates 4,12 --expected-difal 25.3` testa também as alíquotas por item. Os parâmetros acima são fictícios. A correção foi verificada com uma DANFE multipágina enviada pelo usuário, outros layouts públicos do [BrazilFiscalReport](https://github.com/Engenere/BrazilFiscalReport), documentos fictícios e uma versão digitalizada com OCR. Os exemplos públicos com totais inconsistentes foram corretamente bloqueados. Isso amplia a cobertura de layouts, sem garantir leitura de todo arquivo, foto ilegível ou documento fiscal de outro tipo.

## Integridade e código aberto

- [SLANet-plus / RapidTable](https://github.com/RapidAI/RapidTable), Apache 2.0. Modelo obtido do pacote oficial `rapid-table==0.3.0`, conferido com o checksum upstream, convertido para compatibilidade com o runtime Web e incluído no GitHub.
- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime), MIT.
- [PDF.js](https://github.com/mozilla/pdf.js), Apache 2.0.
- [Tesseract.js](https://github.com/naptha/tesseract.js) e modelo português, Apache 2.0.

A origem, hashes e licença do modelo estão em `assets/models`. `scripts/prepare-table-model.py` reproduz a conversão e compara as saídas numéricas com o modelo original. Os pesos aprendidos não são retreinados. O build e o worker verificam o hash do artefato convertido. Não há download de pesos externos durante o deploy; Python não é necessário na Vercel. Avisos de licença acompanham os assets.

A identidade visual usa Fredoka/Quicksand locais, fundo branco, contornos pretos e botões arredondados dos projetos PDF/Bitmap do Kush Archives. O bloco de apresentação com título e calculadora foi removido. O cabeçalho contém um link para este repositório com a marca do GitHub ([Octicons](https://github.com/primer/octicons), MIT; licença em `assets/octicons-LICENSE.txt`). Os ícones usam somente preto, branco e cinza.

## Escopo fiscal

Simulação por **base única**, para consumidor final não contribuinte. Base = produtos + frete + seguro + despesas/IPI aplicáveis − descontos. DIFAL = base × (interna − interestadual); FCP separado, com arredondamento por item. Confira tributação vigente, data, NCM, UF, benefícios e incidência de despesas. Não cobre ICMS-ST, redução de base, base dupla ou regimes especiais; não emite GNRE nem valida autorização/assinatura da NF-e. A IA lê documentos e não decide a legislação aplicável.

## Implementação antiga

O backend experimental Docling, Docker e leitor nativo foram preservados apenas como referência histórica. **Não são usados pelo site nem necessários para publicar ou testar a IA atual.** O campo de conexão de serviço foi removido. Os testes `test:backend` e `test:native` são opcionais e exigem dependências Python/sistema; não fazem parte do fluxo da Vercel.
