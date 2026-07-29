import { buildFechamento } from './fechamento.js';

const VIEW_GERAL = 'ies_TempDash_vwvisaogeral_CACHE';
const VIEW_ENTRADAS = 'ies_TempDash_vwentradaslote_CACHE';
const VIEW_SAIDAS = 'ies_TempDash_vwrelatsaidaslote_CACHE';
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_DEPTH = 12;
const MAX_CYCLES = 3000;
const cache = new Map();

function placeholders(values) {
    return values.map(() => '?').join(',');
}

function chunks(values, size = 350) {
    const result = [];
    for (let index = 0; index < values.length; index += size) {
        result.push(values.slice(index, index + size));
    }
    return result;
}

function normalizeKey(value) {
    return String(value || '').trim().toUpperCase();
}

function sameQuantity(left, right) {
    return Math.abs(Number(left || 0) - Number(right || 0)) < 0.01;
}

export async function listLotesFechamento(pool) {
    const [rows] = await pool.query(`
        SELECT
            roots.lote,
            DATE_FORMAT(MIN(roots.data_inicio), '%Y-%m-%d') AS data_inicio,
            COUNT(*) AS tanques_origem,
            SUM(COALESCE(cycles.quantidade_inicial, roots.quantidade_entrada)) AS quantidade_inicial
        FROM (
            SELECT
                e.numLote AS id,
                MAX(e.nomelote) AS lote,
                MIN(e.datamovimentacao) AS data_inicio,
                SUM(e.quantidade) AS quantidade_entrada
            FROM ${VIEW_ENTRADAS} e
            WHERE e.tipo IN ('Estoque', 'Avulsa')
              AND e.nomelote IS NOT NULL
              AND e.nomelote != ''
            GROUP BY e.numLote
        ) roots
        LEFT JOIN (
            SELECT
                v.\`ID Lote\` AS id,
                MAX(v.\`Quantidade Inicial\`) AS quantidade_inicial
            FROM ${VIEW_GERAL} v
            GROUP BY v.\`ID Lote\`
        ) cycles ON cycles.id = roots.id
        GROUP BY roots.lote
        ORDER BY MIN(roots.data_inicio) DESC
    `);
    return rows;
}

async function fetchRootIds(pool, lote) {
    // Tanque de origem do fechamento: na planilha do Matheus e o primeiro tanque
    // povoado no lote. No IEFish ele aparece como entrada do tipo Estoque/Avulsa.
    const [rows] = await pool.query(`
        SELECT DISTINCT e.numLote AS id
        FROM ${VIEW_ENTRADAS} e
        WHERE e.nomelote = ?
          AND e.tipo IN ('Estoque', 'Avulsa')
        ORDER BY e.numLote
    `, [lote]);
    return rows.map(row => Number(row.id)).filter(Number.isFinite);
}

async function fetchCycles(pool, ids) {
    if (!ids.length) return [];
    const rows = [];
    for (const batch of chunks([...new Set(ids)])) {
        // Dados principais do tanque/ciclo: saldo, biomassa, racao, custos, PM,
        // dias e fornecedor. Sao os mesmos blocos que viram as colunas do fechamento.
        const [batchRows] = await pool.query(`
            SELECT
                v.\`ID Lote\` AS id,
                v.Tanque AS tank,
                v.Lote AS lot,
                v.\`Grupo Origem\` AS groupOrigin,
                v.\`Data Entrada\` AS startDate,
                v.\`Data Povoamento\` AS populationDate,
                v.\`Data Encerramento\` AS endDate,
                v.\`n Dias\` AS days,
                v.\`Quantidade Inicial\` AS initialQty,
                v.\`Saldo Final\` AS finalQty,
                v.\`Mortalidade\` AS systemMortality,
                v.\`Mortalidade Coletada\` AS collectedMortality,
                v.\`Biomassa Inicial\` AS initialBiomass,
                v.\`Biomassa Final\` AS finalBiomass,
                v.\`Peso Medio Entrada\` AS initialWeightG,
                v.\`Peso Medio Saida\` AS exitWeightG,
                v.\`Racao Real\` AS feed,
                v.\`Custo Racao\` AS feedCost,
                v.\`Custo Peixe para Cultivo\` AS fishCost,
                v.\`Custo Indireto\` AS indirectCost,
                v.Sobrevivencia AS survival,
                v.\`GPD Real\` AS gpd,
                v.Status AS status,
                v.\`Fornecedor Origem\` AS supplier
            FROM ${VIEW_GERAL} v
            WHERE v.\`ID Lote\` IN (${placeholders(batch)})
        `, batch);
        rows.push(...batchRows);
    }
    return rows;
}

async function fetchTransfers(pool, sourceIds) {
    if (!sourceIds.length) return [];
    const rows = [];
    for (const batch of chunks(sourceIds)) {
        // Saidas com tanque/lote de destino sao classificacoes/transferencias.
        // Elas dizem para onde os peixes foram depois do tanque inicial.
        const [batchRows] = await pool.query(`
            SELECT
                s.\`ID LOTE\` AS sourceId,
                DATE_FORMAT(s.\`DATA MOVIMENTACAO\`, '%Y-%m-%d') AS movedAt,
                s.\`TANQUE ORIGEM\` AS sourceTank,
                s.TIPO AS type,
                s.QUANTIDADE AS quantity,
                s.BIOMASSA AS biomass,
                s.\`LOTE DESTINO\` AS destLot,
                s.\`TANQUE DESTINO\` AS destTank
            FROM ${VIEW_SAIDAS} s
            WHERE s.\`ID LOTE\` IN (${placeholders(batch)})
              AND s.\`TANQUE DESTINO\` IS NOT NULL
              AND s.\`TANQUE DESTINO\` != '-'
              AND s.\`LOTE DESTINO\` IS NOT NULL
              AND s.\`LOTE DESTINO\` != '-'
            ORDER BY s.\`DATA MOVIMENTACAO\`, s.\`ID LOTE\`
        `, batch);
        rows.push(...batchRows);
    }
    return rows;
}

async function resolveDestinations(pool, transfers) {
    if (!transfers.length) return [];
    const tanks = [...new Set(transfers.map(row => row.destTank).filter(Boolean))];
    const lots = [...new Set(transfers.map(row => row.destLot).filter(Boolean))];
    const dates = transfers.map(row => row.movedAt).filter(Boolean).sort();
    if (!tanks.length || !lots.length || !dates.length) {
        return transfers.map(row => ({ ...row, destId: null }));
    }

    const candidates = [];
    for (const tankBatch of chunks(tanks, 120)) {
        const [rows] = await pool.query(`
            SELECT
                e.numLote AS id,
                e.destan AS tank,
                e.nomelote AS lot,
                DATE_FORMAT(e.datamovimentacao, '%Y-%m-%d') AS movedAt,
                e.quantidade AS quantity,
                e.tipo AS type,
                e.origem AS origin
            FROM ${VIEW_ENTRADAS} e
            WHERE e.destan IN (${placeholders(tankBatch)})
              AND e.nomelote IN (${placeholders(lots)})
              AND e.datamovimentacao BETWEEN ? AND ?
        `, [...tankBatch, ...lots, `${dates[0]} 00:00:00`, `${dates.at(-1)} 23:59:59`]);
        candidates.push(...rows);
    }

    const byKey = new Map();
    for (const candidate of candidates) {
        const key = `${normalizeKey(candidate.tank)}|${normalizeKey(candidate.lot)}|${candidate.movedAt}`;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(candidate);
    }

    return transfers.map(transfer => {
        // Ligacao origem -> destino:
        // 1. mesmo tanque destino;
        // 2. mesmo lote destino;
        // 3. mesma data;
        // 4. mesma quantidade;
        // 5. quando possivel, origem escrita no IEFish bate com o tanque origem.
        const key = `${normalizeKey(transfer.destTank)}|${normalizeKey(transfer.destLot)}|${transfer.movedAt}`;
        const matches = byKey.get(key) || [];
        const quantityMatches = matches.filter(candidate => sameQuantity(candidate.quantity, transfer.quantity));
        const sourceTank = normalizeKey(transfer.sourceTank);
        const originMatch = quantityMatches.find(candidate => normalizeKey(candidate.origin).includes(sourceTank));
        const candidate = originMatch || quantityMatches[0] || (matches.length === 1 ? matches[0] : null);
        return { ...transfer, destId: candidate ? Number(candidate.id) : null };
    });
}

async function traceEdges(pool, rootIds) {
    const seen = new Set(rootIds);
    let frontier = [...rootIds];
    const edges = [];

    for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth += 1) {
        // Caminha pela arvore do lote: tanque inicial -> tanques classificados ->
        // proximas classificacoes, ate encontrar vendas/mortes/correcoes finais.
        const transfers = await fetchTransfers(pool, frontier);
        const resolved = await resolveDestinations(pool, transfers);
        edges.push(...resolved);

        const next = [];
        for (const edge of resolved) {
            if (edge.destId && !seen.has(edge.destId)) {
                seen.add(edge.destId);
                next.push(edge.destId);
            }
        }
        if (seen.size > MAX_CYCLES) {
            throw new Error(`A linhagem ultrapassou o limite de ${MAX_CYCLES} ciclos.`);
        }
        frontier = next;
    }

    return { cycleIds: [...seen], edges };
}

async function fetchEvents(pool, cycleIds) {
    const rows = [];
    for (const batch of chunks(cycleIds)) {
        // Eventos finais por ciclo: venda, bonificacao, morte, correcao e transferencia.
        // Quantidade/biomassa alimentam GPD, PM final, sobrevivencia e mortalidade.
        const [batchRows] = await pool.query(`
            SELECT
                s.\`ID LOTE\` AS cycleId,
                s.TIPO AS type,
                SUM(s.QUANTIDADE) AS quantity,
                SUM(s.BIOMASSA) AS biomass,
                DATE_FORMAT(MAX(s.\`DATA MOVIMENTACAO\`), '%Y-%m-%d') AS lastDate
            FROM ${VIEW_SAIDAS} s
            WHERE s.\`ID LOTE\` IN (${placeholders(batch)})
            GROUP BY s.\`ID LOTE\`, s.TIPO
        `, batch);
        rows.push(...batchRows);
    }
    return rows;
}

export async function getFechamento(pool, lote, { refresh = false } = {}) {
    const cached = cache.get(lote);
    if (!refresh && cached && Date.now() - cached.createdAt < CACHE_TTL_MS) return cached.value;

    const rootIds = await fetchRootIds(pool, lote);
    if (!rootIds.length) throw new Error(`Nenhum tanque de origem encontrado para ${lote}.`);

    const { cycleIds, edges } = await traceEdges(pool, rootIds);
    const [cycles, events] = await Promise.all([
        fetchCycles(pool, cycleIds),
        fetchEvents(pool, cycleIds),
    ]);
    const availableIds = new Set(cycles.map(cycle => Number(cycle.id)));
    const roots = rootIds.filter(id => availableIds.has(id)).map(id => ({ id }));
    const value = buildFechamento({ lote, roots, cycles, edges, events });
    cache.set(lote, { createdAt: Date.now(), value });
    return value;
}
