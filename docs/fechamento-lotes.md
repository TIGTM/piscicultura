# Fechamento de lotes da piscicultura

## Objetivo

Automatizar o fechamento que era montado manualmente nas 12 planilhas de 2024. O sistema parte dos tanques originais de um lote, segue classificacoes, transferencias, misturas e despescas e entrega indicadores produtivos, custos e diagnosticos de conciliacao.

## Fontes analisadas

| Fonte | Uso |
| --- | --- |
| `lote 01-24.xlsx` a `Lote 12-24.xlsx` | Estrutura do fechamento, formulas e resultados historicos |
| `transcriçãomatheus.txt` | Regras operacionais explicadas pelo Matheus |
| `ies_TempDash_vwvisaogeral_CACHE` | Saldos, biomassa, racao, custos e dados consolidados dos ciclos |
| `ies_TempDash_vwentradaslote_CACHE` | Identificacao das origens e dos destinos das transferencias |
| `ies_TempDash_vwrelatsaidaslote_CACHE` | Vendas, mortes, correcoes e transferencias de cada ciclo |

O identificador principal e o nome do lote, por exemplo `Lote 06-24`. O campo `Grupo Origem` nao pode ser usado como chave porque esta vazio nos lotes 01-24 a 10-24.

## Formulas reproduzidas

| Indicador | Regra |
| --- | --- |
| Diferenca | quantidade inicial - saldo final |
| PM de entrada | biomassa inicial / quantidade inicial |
| PM de saida direto | biomassa vendida / quantidade vendida no tanque de origem |
| PM de saida classificado | media ponderada dos pesos finais dos destinos pela quantidade da origem enviada a cada destino |
| Biomassa final classificada | saldo final da origem x PM de saida ponderado |
| Dias | ultima data considerada de venda/encerramento - data de entrada |
| GPD | (PM de saida - PM de entrada) x 1.000 / dias |
| Sobrevivencia | (quantidade inicial - mortalidade total atribuida - correcao total atribuida) / quantidade inicial x 100 |
| Conversao alimentar | racao / (biomassa final - biomassa inicial) |

Os totais somam quantidade, biomassa, racao, mortalidade e correcao. O PM de entrada e o PM final consolidados sao ponderados pelas respectivas quantidades de peixes. A sobrevivencia consolidada usa todas as perdas atribuidas e, por isso, tambem e ponderada pela quantidade inicial. Dias e GPD continuam seguindo a media entre os tanques de origem.

## Media ponderada do peso final

Na reuniao de validacao, foi decidido que os destinos classificados nao podem ter
o mesmo peso na media. Cada PM final influencia o resultado conforme a quantidade
de peixes da origem enviada para aquele destino:

`PM final ponderado = soma(PM do destino x quantidade da origem no destino) / soma das quantidades`

No exemplo do `TR695-3`, as bases sao 1.317 peixes no `TR148-6`, 3.267 no
`TR903-6` e 11 no `TR009-3`. Os 11 peixes continuam na conta, mas sua influencia
e proporcionalmente pequena. O C.A. permanece:

`C.A. = racao consumida / (biomassa final ponderada - biomassa inicial)`

Mortalidade e correcao de saldo posteriores a classificacao usam a mesma proporcao
aplicada a racao. Elas entram na sobrevivencia, mas nao alteram a formula aprovada
do C.A.

Tanques com ataque de piranha, escape ou outra perda excepcional nao sao excluidos
automaticamente. A reuniao reconheceu que eles devem permanecer no custo financeiro,
mas nao definiu um campo nem um limite objetivo para remove-los das medias produtivas.

## Regra de classificacao

Cada entrada do tipo `Estoque` ou `Avulsa` e uma raiz do fechamento. Uma transferencia liga o ciclo de origem ao ciclo de destino pela combinacao de tanque, lote, data e quantidade. A composicao do destino e calculada recursivamente:

- uma origem dividida entre varios tanques distribui seus valores na proporcao transferida;
- um tanque que recebe varias origens preserva a participacao de cada raiz;
- racao, mortalidade, correcoes e custos das fases descendentes sao rateados pela participacao da raiz na quantidade inicial do destino;
- o custo de aquisicao do peixe entra somente na raiz, evitando duplicidade.

O rastreamento aceita ate 12 niveis e 3.000 ciclos por fechamento. Transferencias sem destino e composicoes inconsistentes aparecem no diagnostico.

## Dois modos de resultado

**Modelo da planilha:** replica o criterio historico. Se o tanque original teve venda direta, usa apenas essa fase; caso contrario, interpola as fases classificadas.

**Rastreio e custos:** acompanha toda a linhagem ate as saidas terminais e calcula vendas atribuidas, racao, mortalidade, custos, custo por quilo e cobertura do rastreio.

## Conciliacao do Lote 06-24

| Indicador | Planilha historica | Banco atual |
| --- | ---: | ---: |
| Tanques de origem | 61 | 61 |
| Quantidade inicial | 211.990 | 211.990 |
| Saldo final | 178.414 | 178.414 |
| Correcao de saldo | 33.182 | 33.182 |
| Biomassa final | 180.763,93 kg | 182.476,20 kg |
| Racao | 253.844,40 kg | 232.405,80 kg |
| Conversao alimentar | 1,48 | 1,34 |

As chaves estruturais conciliam exatamente. Biomassa e racao diferem porque a planilha e uma fotografia historica e alguns valores da base atual foram atualizados depois do fechamento manual. No banco atual, as 219 transferencias do Lote 06-24 foram ligadas aos respectivos destinos.

## Qualidade do rastreio

- `Completo`: venda rastreada, sem transferencia pendente e cobertura entre 85% e 115%.
- `Revisar conciliacao`: existe venda, mas a cobertura esta fora da faixa esperada.
- `Transferencia sem destino`: uma classificacao nao encontrou a entrada correspondente.
- `Sem despesca rastreada`: a linhagem ainda nao chegou a uma venda identificavel.

## Pendencias de negocio

1. Confirmar o cadastro que converte a razao social do fornecedor para o nome comercial usado nas planilhas, como `AQUAGENETICS`.
2. Validar com o financeiro quais componentes devem formar o custo indireto oficial.
3. Definir se cada fechamento aprovado deve ser congelado em uma fotografia mensal para manter a reproducibilidade historica.
4. Homologar pelo menos um lote com muitas classificacoes junto ao Matheus.

## Implementacao

- Motor de calculo: `src/fechamento.js`
- Leitura e rastreamento: `src/fechamento-repository.js`
- Interface: `public/index.html`, `public/app.js` e `public/style.css`
- Testes: `tests/fechamento.test.js`
- Endpoints: `GET /api/lotes-fechamento` e `GET /api/fechamento?lote=Lote%2006-24`
