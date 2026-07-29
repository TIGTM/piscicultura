const EPSILON = 1e-9;

export function asNumber(value, fallback = 0) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    if (value === null || value === undefined || value === '') return fallback;
    const normalized = typeof value === 'string'
        ? value.trim().replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.')
        : value;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

export function parseDate(value) {
    if (!value || value === '-') return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
    }

    const text = String(value).trim();
    const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
    if (br) return new Date(Date.UTC(Number(br[3]), Number(br[2]) - 1, Number(br[1])));

    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));

    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIsoDate(value) {
    const date = parseDate(value);
    return date ? date.toISOString().slice(0, 10) : null;
}

function daysBetween(start, end) {
    const startDate = parseDate(start);
    const endDate = parseDate(end);
    if (!startDate || !endDate) return null;
    return Math.max(0, Math.round((endDate - startDate) / 86400000));
}

function safeDivide(numerator, denominator) {
    return Math.abs(denominator) > EPSILON ? numerator / denominator : null;
}

function average(values) {
    const valid = values.filter(value => Number.isFinite(value));
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function weightedAverage(items) {
    const valid = items.filter(item => (
        Number.isFinite(item.value)
        && Number.isFinite(item.weight)
        && item.weight > EPSILON
    ));
    const totalWeight = valid.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight <= EPSILON) return null;
    return valid.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
}

function maxDate(values) {
    const valid = values.map(parseDate).filter(Boolean);
    if (!valid.length) return null;
    return new Date(Math.max(...valid.map(date => date.getTime()))).toISOString().slice(0, 10);
}

function isTransferType(type) {
    const normalized = normalizeText(type);
    return normalized.includes('transferencia') || normalized === 'novo lote';
}

function isSaleType(type) {
    const normalized = normalizeText(type);
    return normalized === 'venda' || normalized === 'bonificacao';
}

function isDeathType(type) {
    return normalizeText(type) === 'morte';
}

function isCorrectionType(type) {
    return normalizeText(type) === 'correcao de saldo';
}

function eventsFor(eventsByCycle, cycleId, predicate) {
    return (eventsByCycle.get(cycleId) || []).filter(event => predicate(event.type));
}

function sumEvents(events) {
    return events.reduce((total, event) => ({
        quantity: total.quantity + asNumber(event.quantity),
        biomass: total.biomass + asNumber(event.biomass),
        dates: event.lastDate ? [...total.dates, event.lastDate] : total.dates,
    }), { quantity: 0, biomass: 0, dates: [] });
}

function aggregatePlan(rows) {
    const totals = {
        tanques: rows.length,
        qtd_inicial_total: 0,
        saldo_final_total: 0,
        diferenca_total: 0,
        bio_inicial_total: 0,
        bio_final_total: 0,
        racao_total: 0,
        mortalidade_total: 0,
        mortalidade_pos_classificacao_total: 0,
        correcao_total: 0,
        custo_racao_total: 0,
        custo_peixe_total: 0,
        custo_indireto_total: 0,
    };

    for (const row of rows) {
        totals.qtd_inicial_total += row.qtd_inicial;
        totals.saldo_final_total += row.saldo_final;
        totals.diferenca_total += row.diferenca;
        totals.bio_inicial_total += row.bio_inicial;
        totals.bio_final_total += row.bio_final_planilha;
        totals.racao_total += row.racao_planilha;
        totals.mortalidade_total += row.mortalidade_total_planilha;
        totals.mortalidade_pos_classificacao_total += row.mortalidade_pos_classificacao;
        totals.correcao_total += row.correcao_total_planilha;
        totals.custo_racao_total += row.custo_racao_planilha;
        totals.custo_peixe_total += row.custo_peixe;
        totals.custo_indireto_total += row.custo_indireto_planilha;
    }

    // C.A. total igual a planilha: racao consumida / ganho de biomassa.
    // Ganho de biomassa = biomassa final - biomassa inicial.
    totals.ca_real = safeDivide(
        totals.racao_total,
        totals.bio_final_total - totals.bio_inicial_total,
    );
    // Os pesos medios consolidados tambem sao ponderados pela quantidade de peixes.
    // Assim, um tanque pequeno nao influencia o lote tanto quanto um tanque grande.
    totals.pm_entrada_medio_g = safeDivide(
        totals.bio_inicial_total * 1000,
        totals.qtd_inicial_total,
    );
    totals.pm_saida_medio_g = safeDivide(
        totals.bio_final_total * 1000,
        totals.saldo_final_total,
    );
    totals.dias_medio = average(rows.map(row => row.dias_planilha));
    totals.gpd_medio = average(rows.map(row => row.gpd_planilha));
    // Sobrevivencia consolidada: peixes iniciais menos todas as mortes e correcoes
    // atribuidas, inclusive depois das classificacoes.
    totals.sobrevivencia_media = safeDivide(
        (
            totals.qtd_inicial_total
            - totals.mortalidade_total
            - totals.correcao_total
        ) * 100,
        totals.qtd_inicial_total,
    );
    // Quebra = mortes + correcoes de saldo, comparadas com a quantidade inicial.
    totals.quebra_pct = safeDivide(
        totals.mortalidade_total + totals.correcao_total,
        totals.qtd_inicial_total,
    );
    if (totals.quebra_pct !== null) totals.quebra_pct *= 100;
    totals.custo_total = totals.custo_racao_total + totals.custo_peixe_total + totals.custo_indireto_total;
    totals.custo_por_kg = safeDivide(totals.custo_total, totals.bio_final_total);
    return totals;
}

function aggregateTrace(rows, cycleCount) {
    const totals = {
        tanques_origem: rows.length,
        ciclos_rastreados: cycleCount,
        qtd_inicial_total: 0,
        qtd_vendida_total: 0,
        bio_inicial_total: 0,
        bio_vendida_total: 0,
        racao_total: 0,
        mortalidade_total: 0,
        correcao_total: 0,
        saidas_terminais_total: 0,
        qtd_transferencia_sem_destino: 0,
        custo_racao_total: 0,
        custo_peixe_total: 0,
        custo_indireto_total: 0,
    };

    for (const row of rows) {
        totals.qtd_inicial_total += row.qtd_inicial;
        totals.qtd_vendida_total += row.qtd_vendida_rastreada;
        totals.bio_inicial_total += row.bio_inicial;
        totals.bio_vendida_total += row.bio_vendida_rastreada;
        totals.racao_total += row.racao_rastreada;
        totals.mortalidade_total += row.mortalidade_rastreada;
        totals.correcao_total += row.correcao_rastreada;
        totals.saidas_terminais_total += row.saidas_terminais_rastreadas;
        totals.qtd_transferencia_sem_destino += row.qtd_transferencia_sem_destino;
        totals.custo_racao_total += row.custo_racao_rastreado;
        totals.custo_peixe_total += row.custo_peixe;
        totals.custo_indireto_total += row.custo_indireto_rastreado;
    }

    // C.A. rastreada: usa toda a racao atribuida ao lote e toda a biomassa vendida
    // encontrada na linhagem do tanque.
    totals.ca_real = safeDivide(
        totals.racao_total,
        totals.bio_vendida_total - totals.bio_inicial_total,
    );
    // PM final rastreado = biomassa vendida / quantidade vendida.
    totals.pm_saida_medio_g = safeDivide(totals.bio_vendida_total * 1000, totals.qtd_vendida_total);
    totals.gpd_medio = average(rows.map(row => row.gpd_rastreado));
    totals.sobrevivencia_comercial = safeDivide(totals.qtd_vendida_total * 100, totals.qtd_inicial_total);
    totals.cobertura_rastreio = safeDivide(totals.saidas_terminais_total * 100, totals.qtd_inicial_total);
    totals.custo_total = totals.custo_racao_total + totals.custo_peixe_total + totals.custo_indireto_total;
    totals.custo_por_kg = safeDivide(totals.custo_total, totals.bio_vendida_total);
    totals.custo_por_peixe = safeDivide(totals.custo_total, totals.qtd_vendida_total);
    return totals;
}

export function buildFechamento({ lote, roots, cycles, edges, events }) {
    const cycleMap = new Map(cycles.map(cycle => [cycle.id, {
        ...cycle,
        id: Number(cycle.id),
        initialQty: asNumber(cycle.initialQty),
        finalQty: asNumber(cycle.finalQty),
        initialBiomass: asNumber(cycle.initialBiomass),
        finalBiomass: asNumber(cycle.finalBiomass),
        initialWeightG: asNumber(cycle.initialWeightG),
        exitWeightG: asNumber(cycle.exitWeightG),
        feed: asNumber(cycle.feed),
        feedCost: asNumber(cycle.feedCost),
        fishCost: asNumber(cycle.fishCost),
        indirectCost: asNumber(cycle.indirectCost),
        collectedMortality: asNumber(cycle.collectedMortality),
    }]));
    const rootIds = new Set(roots.map(root => Number(root.id)));

    const resolvedEdges = edges
        .filter(edge => edge.destId && cycleMap.has(Number(edge.destId)))
        .map(edge => ({ ...edge, sourceId: Number(edge.sourceId), destId: Number(edge.destId), quantity: asNumber(edge.quantity) }));
    const unresolvedEdges = edges
        .filter(edge => !edge.destId || !cycleMap.has(Number(edge.destId)))
        .map(edge => ({ ...edge, sourceId: Number(edge.sourceId), quantity: asNumber(edge.quantity) }));

    const incoming = new Map();
    const outgoing = new Map();
    for (const edge of resolvedEdges) {
        if (!incoming.has(edge.destId)) incoming.set(edge.destId, []);
        if (!outgoing.has(edge.sourceId)) outgoing.set(edge.sourceId, []);
        incoming.get(edge.destId).push(edge);
        outgoing.get(edge.sourceId).push(edge);
    }

    const compositionMemo = new Map();
    function compositionFor(cycleId, stack = new Set()) {
        if (compositionMemo.has(cycleId)) return compositionMemo.get(cycleId);
        if (rootIds.has(cycleId)) {
            const rootComposition = new Map([[cycleId, 1]]);
            compositionMemo.set(cycleId, rootComposition);
            return rootComposition;
        }
        if (stack.has(cycleId)) return new Map();

        const cycle = cycleMap.get(cycleId);
        const incomingEdges = incoming.get(cycleId) || [];
        // Quando um tanque destino recebe peixe de mais de uma origem, dividimos os
        // resultados pela participacao de cada origem na quantidade inicial do destino.
        // Exemplo: entrou 1.000 peixes de A em um tanque de 4.000, A leva 25% da racao,
        // mortes, correcoes e vendas desse tanque.
        const denominator = cycle?.initialQty || incomingEdges.reduce((sum, edge) => sum + edge.quantity, 0);
        const result = new Map();
        if (denominator <= 0) return result;

        const nextStack = new Set(stack).add(cycleId);
        for (const edge of incomingEdges) {
            const sourceComposition = compositionFor(edge.sourceId, nextStack);
            const edgeShare = edge.quantity / denominator;
            for (const [rootId, sourceShare] of sourceComposition) {
                result.set(rootId, (result.get(rootId) || 0) + sourceShare * edgeShare);
            }
        }
        compositionMemo.set(cycleId, result);
        return result;
    }

    for (const cycleId of cycleMap.keys()) compositionFor(cycleId);

    const sharesByRoot = new Map([...rootIds].map(rootId => [rootId, []]));
    for (const [cycleId, composition] of compositionMemo) {
        for (const [rootId, share] of composition) {
            if (share > EPSILON && sharesByRoot.has(rootId)) {
                sharesByRoot.get(rootId).push({ cycle: cycleMap.get(cycleId), share });
            }
        }
    }

    const eventsByCycle = new Map();
    for (const event of events) {
        const cycleId = Number(event.cycleId);
        if (!eventsByCycle.has(cycleId)) eventsByCycle.set(cycleId, []);
        eventsByCycle.get(cycleId).push({
            ...event,
            cycleId,
            quantity: asNumber(event.quantity),
            biomass: asNumber(event.biomass),
        });
    }

    function lineageDepth(rootId) {
        let maxDepth = 0;
        const queue = [{ id: rootId, depth: 0 }];
        const visited = new Set();
        while (queue.length) {
            const current = queue.shift();
            if (visited.has(current.id)) continue;
            visited.add(current.id);
            maxDepth = Math.max(maxDepth, current.depth);
            for (const edge of outgoing.get(current.id) || []) {
                queue.push({ id: edge.destId, depth: current.depth + 1 });
            }
        }
        return maxDepth;
    }

    const rows = roots
        .map(rootRef => cycleMap.get(Number(rootRef.id)))
        .filter(Boolean)
        .map(root => {
            const allocatedCycles = sharesByRoot.get(root.id) || [{ cycle: root, share: 1 }];
            const directSales = sumEvents(eventsFor(eventsByCycle, root.id, isSaleType));
            const rootCorrections = sumEvents(eventsFor(eventsByCycle, root.id, isCorrectionType));
            const hasDirectSale = directSales.quantity > 0;

            const saleCycles = allocatedCycles
                .map(({ cycle, share }) => {
                    const sales = sumEvents(eventsFor(eventsByCycle, cycle.id, isSaleType));
                    return { cycle, share, ...sales };
                })
                .filter(item => item.quantity > 0);

            const attributedSales = saleCycles.reduce((total, item) => ({
                quantity: total.quantity + item.quantity * item.share,
                biomass: total.biomass + item.biomass * item.share,
                dates: [...total.dates, ...item.dates],
            }), { quantity: 0, biomass: 0, dates: [] });
            const saleComponents = saleCycles.map(item => ({
                id_lote: item.cycle.id,
                tanque: item.cycle.tank,
                lote: item.cycle.lot,
                participacao_pct: item.share * 100,
                quantidade_vendida_ciclo: item.quantity,
                quantidade_atribuida: item.quantity * item.share,
                biomassa_vendida_ciclo: item.biomass,
                biomassa_atribuida: item.biomass * item.share,
                datas: item.dates,
            }));

            const manualCycles = hasDirectSale
                ? [{ cycle: root, share: 1 }]
                : allocatedCycles;
            // Modo "Modelo da planilha":
            // se o tanque inicial teve venda direta, usa so o proprio tanque;
            // se nao teve venda direta, soma/rateia os tanques descendentes
            // encontrados pelas classificacoes.
            const feedPlan = manualCycles.reduce((sum, item) => sum + item.cycle.feed * item.share, 0);
            const feedCostPlan = manualCycles.reduce((sum, item) => sum + item.cycle.feedCost * item.share, 0);
            const indirectCostPlan = manualCycles.reduce((sum, item) => sum + item.cycle.indirectCost * item.share, 0);
            const feedPlanComponents = manualCycles
                .map(item => ({
                    id_lote: item.cycle.id,
                    tanque: item.cycle.tank,
                    lote: item.cycle.lot,
                    participacao_pct: item.share * 100,
                    racao_ciclo: item.cycle.feed,
                    racao_atribuida: item.cycle.feed * item.share,
                }))
                .filter(item => Math.abs(item.racao_atribuida) > EPSILON);

            // PM final de cada destino vendido: biomassa vendida / quantidade vendida.
            // A quantidade usada como peso da media e a parcela de peixes da origem que
            // entrou naquele destino: quantidade inicial do destino x participacao da raiz.
            //
            // Exemplo do TR695-3:
            // (PM TR148 x 1.317 + PM TR903 x 3.267 + PM TR009 x 11) / 4.595.
            // Os 11 peixes entram na conta, mas influenciam muito menos que os 3.267.
            const descendantSaleWeightSamples = saleCycles
                .map(item => ({
                    cycleId: item.cycle.id,
                    tank: item.cycle.tank,
                    lot: item.cycle.lot,
                    value: safeDivide(item.biomass, item.quantity),
                    weight: item.cycle.initialQty * item.share,
                    saleQuantity: item.quantity,
                    saleBiomass: item.biomass,
                    dates: item.dates,
                }))
                .filter(item => (
                    Number.isFinite(item.value)
                    && Number.isFinite(item.weight)
                    && item.weight > EPSILON
                ));
            const descendantWeightingQty = descendantSaleWeightSamples
                .reduce((sum, item) => sum + item.weight, 0);
            const directWeightKg = safeDivide(directSales.biomass, directSales.quantity);
            // PM entrada = biomassa inicial / quantidade inicial.
            // Se a biomassa inicial vier vazia, usa o Peso Medio Entrada do IEFish.
            const initialWeightKg = safeDivide(root.initialBiomass, root.initialQty)
                ?? safeDivide(root.initialWeightG, 1000)
                ?? 0;
            const fallbackExitWeightKg = safeDivide(root.finalBiomass, root.finalQty)
                ?? safeDivide(root.exitWeightG, 1000);
            // PM saida do modelo planilha:
            // venda direta: peso da venda do tanque inicial;
            // com classificacao: media ponderada dos PMs finais pela quantidade da origem
            // atribuida a cada tanque descendente vendido.
            const planExitWeightKg = hasDirectSale
                ? directWeightKg
                : (weightedAverage(descendantSaleWeightSamples) ?? fallbackExitWeightKg);
            const planExitWeightComponents = hasDirectSale
                ? [{
                    id_lote: root.id,
                    tanque: root.tank,
                    lote: root.lot,
                    quantidade_ponderacao: directSales.quantity,
                    participacao_pct: 100,
                    pm_saida_g: directWeightKg === null ? null : directWeightKg * 1000,
                    quantidade_vendida: directSales.quantity,
                    biomassa_vendida: directSales.biomass,
                    datas: directSales.dates,
                }]
                : descendantSaleWeightSamples.map(item => ({
                    id_lote: item.cycleId,
                    tanque: item.tank,
                    lote: item.lot,
                    quantidade_ponderacao: item.weight,
                    participacao_pct: safeDivide(item.weight * 100, descendantWeightingQty),
                    pm_saida_g: item.value * 1000,
                    quantidade_vendida: item.saleQuantity,
                    biomassa_vendida: item.saleBiomass,
                    datas: item.dates,
                }));
            const planWeightCoverage = hasDirectSale
                ? 100
                : safeDivide(descendantWeightingQty * 100, root.finalQty);
            const planMethod = hasDirectSale
                ? 'Fechamento direto'
                : descendantSaleWeightSamples.length
                    ? 'Média ponderada por classificação'
                    : 'PM do IEFish sem venda rastreada';

            // Data de encerramento:
            // venda direta usa a data da venda do tanque inicial;
            // com classificacao usa a ultima data de venda encontrada na linhagem.
            const planEndDate = hasDirectSale
                ? (maxDate(directSales.dates) || toIsoDate(root.endDate))
                : (maxDate(attributedSales.dates) || toIsoDate(root.endDate));
            // Dias = data encerramento - data entrada, igual a subtracao de datas no Excel.
            const planDays = daysBetween(root.startDate, planEndDate) ?? asNumber(root.days, null);
            // Biomassa final do modelo planilha:
            // com classificacao, reconstruimos como saldo final do tanque inicial * PM final.
            // Isso replica a ideia da planilha: "quantos peixes ficaram" vezes "peso final".
            const planFinalBiomass = !hasDirectSale && planExitWeightKg !== null
                ? root.finalQty * planExitWeightKg
                : root.finalBiomass;
            // Ganho de biomassa = biomassa final - biomassa inicial.
            // Esta e a parte de baixo da formula da C.A. na aba "Modelo da planilha".
            const planBiomassGain = planFinalBiomass - root.initialBiomass;
            // C.A. = consumo de racao / ganho de biomassa.
            const planCa = safeDivide(feedPlan, planBiomassGain);
            // GPD tecnico = (PM final - PM entrada) / dias.
            // Multiplica por 1000 porque os pesos estao em kg e a tela mostra gramas/dia.
            const planGpd = planDays > 0 && planExitWeightKg !== null
                ? (planExitWeightKg - initialWeightKg) * 1000 / planDays
                : null;
            const tracedCycleComponents = allocatedCycles.map(item => {
                const cycleEvents = eventsByCycle.get(item.cycle.id) || [];
                const deaths = sumEvents(cycleEvents.filter(event => isDeathType(event.type)));
                const corrections = sumEvents(cycleEvents.filter(event => isCorrectionType(event.type)));
                const terminals = sumEvents(cycleEvents.filter(event => !isTransferType(event.type)));
                return {
                    cycle: item.cycle,
                    share: item.share,
                    deaths,
                    corrections,
                    terminals,
                };
            });
            const traced = tracedCycleComponents.reduce((total, item) => {
                return {
                    // Modo "Rastreio e custos": tudo que aconteceu em tanque descendente
                    // e multiplicado pela participacao da raiz naquele tanque.
                    feed: total.feed + item.cycle.feed * item.share,
                    feedCost: total.feedCost + item.cycle.feedCost * item.share,
                    indirectCost: total.indirectCost + item.cycle.indirectCost * item.share,
                    deaths: total.deaths + item.deaths.quantity * item.share,
                    corrections: total.corrections + item.corrections.quantity * item.share,
                    terminalQuantity: total.terminalQuantity + item.terminals.quantity * item.share,
                };
            }, { feed: 0, feedCost: 0, indirectCost: 0, deaths: 0, corrections: 0, terminalQuantity: 0 });
            const traceComponents = tracedCycleComponents.map(item => ({
                id_lote: item.cycle.id,
                tanque: item.cycle.tank,
                lote: item.cycle.lot,
                participacao_pct: item.share * 100,
                racao_ciclo: item.cycle.feed,
                racao_atribuida: item.cycle.feed * item.share,
                custo_racao_ciclo: item.cycle.feedCost,
                custo_racao_atribuido: item.cycle.feedCost * item.share,
                custo_indireto_ciclo: item.cycle.indirectCost,
                custo_indireto_atribuido: item.cycle.indirectCost * item.share,
                mortalidade_ciclo: item.deaths.quantity,
                mortalidade_atribuida: item.deaths.quantity * item.share,
                correcao_ciclo: item.corrections.quantity,
                correcao_atribuida: item.corrections.quantity * item.share,
                saidas_terminais_ciclo: item.terminals.quantity,
                saidas_terminais_atribuidas: item.terminals.quantity * item.share,
            }));

            // Sobrevivencia aprovada na reuniao:
            // considera mortes e correcoes do tanque inicial e das fases classificadas.
            // Esses eventos descendentes usam a mesma proporcao aplicada a racao.
            const planSurvivingQty = Math.max(
                0,
                root.initialQty - traced.deaths - traced.corrections,
            );
            const planSurvival = safeDivide(planSurvivingQty * 100, root.initialQty);

            const unresolvedQuantity = unresolvedEdges.reduce((sum, edge) => {
                const sourceShare = compositionMemo.get(edge.sourceId)?.get(root.id) || 0;
                return sum + edge.quantity * sourceShare;
            }, 0);
            // PM final rastreado usa a venda real atribuida ao lote: biomassa / quantidade.
            const tracedExitWeightKg = safeDivide(attributedSales.biomass, attributedSales.quantity);
            const tracedEndDate = maxDate(attributedSales.dates) || planEndDate;
            const tracedDays = daysBetween(root.startDate, tracedEndDate);
            // GPD rastreado usa o mesmo conceito tecnico, mas com PM e data das vendas
            // reais encontradas em toda a linhagem.
            const tracedGpd = tracedDays > 0 && tracedExitWeightKg !== null
                ? (tracedExitWeightKg - initialWeightKg) * 1000 / tracedDays
                : null;
            // C.A. rastreada = racao rateada / ganho de biomassa vendida.
            const tracedCa = safeDivide(traced.feed, attributedSales.biomass - root.initialBiomass);
            // Cobertura mostra quanto da quantidade inicial conseguimos explicar em saidas.
            const traceCoverage = safeDivide(traced.terminalQuantity * 100, root.initialQty);
            // Mortalidade pos-classificacao = mortes rastreadas nos destinos - mortes ja
            // coletadas no tanque inicial.
            const postClassificationMortality = Math.max(0, traced.deaths - root.collectedMortality);
            const postClassificationCorrection = Math.max(
                0,
                traced.corrections - rootCorrections.quantity,
            );
            const destinations = [...new Set(allocatedCycles
                .filter(item => item.cycle.id !== root.id)
                .map(item => item.cycle.tank))]
                .filter(Boolean);

            let traceStatus = 'Completo';
            let confidence = 'Alta';
            if (attributedSales.quantity <= 0) {
                traceStatus = 'Sem despesca rastreada';
                confidence = 'Baixa';
            } else if (unresolvedQuantity > EPSILON) {
                traceStatus = 'Transferência sem destino';
                confidence = 'Baixa';
            } else if (traceCoverage === null || traceCoverage < 85 || traceCoverage > 115) {
                traceStatus = 'Revisar conciliação';
                confidence = 'Média';
            }

            return {
                id_lote: root.id,
                tanque: root.tank,
                lote: root.lot,
                grupo_origem: root.groupOrigin || '',
                fornecedor: root.supplier || 'Não informado',
                status: root.status,
                data_entrada: toIsoDate(root.startDate),
                data_encerramento_planilha: planEndDate,
                dias_planilha: planDays,
                qtd_inicial: root.initialQty,
                saldo_final: root.finalQty,
                diferenca: root.initialQty - root.finalQty,
                mortalidade: root.collectedMortality,
                mortalidade_pos_classificacao: postClassificationMortality,
                mortalidade_total_planilha: traced.deaths,
                correcao_saldo: rootCorrections.quantity,
                correcao_pos_classificacao: postClassificationCorrection,
                correcao_total_planilha: traced.corrections,
                saldo_sobrevivente_estimado: planSurvivingQty,
                bio_inicial: root.initialBiomass,
                bio_final_planilha: planFinalBiomass,
                ganho_biomassa_planilha: planBiomassGain,
                pm_entrada_g: initialWeightKg * 1000,
                pm_saida_planilha_g: planExitWeightKg === null ? null : planExitWeightKg * 1000,
                qtd_ponderada_pm_final: hasDirectSale ? directSales.quantity : descendantWeightingQty,
                cobertura_pm_final_pct: planWeightCoverage,
                componentes_pm_final: planExitWeightComponents,
                componentes_racao_planilha: feedPlanComponents,
                componentes_venda: saleComponents,
                componentes_rastreio: traceComponents,
                racao_planilha: feedPlan,
                ca_planilha: planCa,
                gpd_planilha: planGpd,
                sobrevivencia_planilha: planSurvival,
                custo_racao_planilha: feedCostPlan,
                custo_peixe: root.fishCost,
                custo_indireto_planilha: indirectCostPlan,
                metodo_planilha: planMethod,
                ciclos_na_linhagem: allocatedCycles.length,
                profundidade_linhagem: lineageDepth(root.id),
                destinos: destinations,
                qtd_vendida_rastreada: attributedSales.quantity,
                bio_vendida_rastreada: attributedSales.biomass,
                pm_saida_rastreado_g: tracedExitWeightKg === null ? null : tracedExitWeightKg * 1000,
                data_encerramento_rastreado: tracedEndDate,
                dias_rastreado: tracedDays,
                gpd_rastreado: tracedGpd,
                racao_rastreada: traced.feed,
                ca_rastreada: tracedCa,
                sobrevivencia_comercial: safeDivide(attributedSales.quantity * 100, root.initialQty),
                mortalidade_rastreada: traced.deaths,
                correcao_rastreada: traced.corrections,
                saidas_terminais_rastreadas: traced.terminalQuantity,
                cobertura_rastreio: traceCoverage,
                qtd_transferencia_sem_destino: unresolvedQuantity,
                custo_racao_rastreado: traced.feedCost,
                custo_indireto_rastreado: traced.indirectCost,
                custo_total_rastreado: traced.feedCost + traced.indirectCost + root.fishCost,
                custo_por_kg_rastreado: safeDivide(
                    traced.feedCost + traced.indirectCost + root.fishCost,
                    attributedSales.biomass,
                ),
                status_rastreio: traceStatus,
                confianca: confidence,
            };
        });

    const fornecedores = [...new Set(rows.map(row => row.fornecedor))]
        .sort((a, b) => a.localeCompare(b, 'pt-BR'))
        .map(fornecedor => ({ fornecedor, ...aggregatePlan(rows.filter(row => row.fornecedor === fornecedor)) }));

    const invalidCompositions = [...compositionMemo.entries()]
        .map(([cycleId, composition]) => ({
            cycleId,
            total: [...composition.values()].reduce((sum, share) => sum + share, 0),
        }))
        .filter(item => item.total > 1.05);
    const lowPmCoverageRows = rows.filter(row => (
        row.metodo_planilha !== 'Fechamento direto'
        && (
            row.cobertura_pm_final_pct === null
            || row.cobertura_pm_final_pct < 85
            || row.cobertura_pm_final_pct > 115
        )
    ));

    return {
        lote,
        gerado_em: new Date().toISOString(),
        totais_planilha: aggregatePlan(rows),
        totais_rastreados: aggregateTrace(rows, cycleMap.size),
        fornecedores,
        porTanque: rows,
        diagnostico: {
            raizes: roots.length,
            ciclos: cycleMap.size,
            transferencias: edges.length,
            transferencias_resolvidas: resolvedEdges.length,
            transferencias_sem_destino: unresolvedEdges.length,
            composicoes_acima_de_105_pct: invalidCompositions.length,
            pm_ponderado_cobertura_baixa: lowPmCoverageRows.length,
        },
        metodologia: {
            planilha: 'Usa a fase inicial quando há venda direta. Quando existe classificação, calcula o peso final pela média ponderada dos destinos, usando a quantidade originária enviada a cada um.',
            sobrevivencia: 'Subtrai da quantidade inicial as mortalidades e correções atribuídas em toda a linhagem, inclusive após as classificações.',
            rastreada: 'Rateia cada ciclo descendente pela participação do lote na quantidade inicial do tanque de destino.',
            custo: 'Soma ração e custo indireto rateados em cada fase; o custo de aquisição do peixe é considerado apenas no tanque de origem para evitar duplicidade.',
        },
    };
}
