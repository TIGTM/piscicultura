import fs from 'node:fs/promises';
import path from 'node:path';
import { asNumber, buildFechamento, parseDate } from './fechamento.js';

const ORIGINS_CACHE_TTL_MS = 60 * 60 * 1000;
const FECHAMENTO_CACHE_TTL_MS = 15 * 60 * 1000;
const OUTPUT_TYPES_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_VERSION = 2;
const CACHE_FILE = process.env.IEFISH_CACHE_FILE
    || path.resolve(process.cwd(), 'data', 'iefish-api-cache.json');
const cache = new Map();
const pendingFechamentos = new Map();
let originCache = null;
let persistentCache = { version: CACHE_VERSION, origins: null, outputTypes: null, fechamentos: {} };
let persistentCacheLoaded = false;
let cacheWrite = Promise.resolve();

function isCacheFresh(entry, ttl) {
    return entry && Date.now() - entry.createdAt < ttl;
}

function staleCacheValue(entry, reason) {
    return {
        ...entry.value,
        diagnostico: {
            ...entry.value.diagnostico,
            cache: {
                stale: true,
                savedAt: new Date(entry.createdAt).toISOString(),
                reason,
            },
        },
    };
}

async function loadPersistentCache() {
    if (persistentCacheLoaded) return;
    persistentCacheLoaded = true;

    try {
        const contents = await fs.readFile(CACHE_FILE, 'utf8');
        const parsed = JSON.parse(contents);
        if (parsed?.version === CACHE_VERSION) {
            persistentCache = {
                version: CACHE_VERSION,
                origins: parsed.origins || null,
                outputTypes: parsed.outputTypes || null,
                fechamentos: parsed.fechamentos || {},
            };
        }
    } catch (err) {
        if (err.code !== 'ENOENT') console.warn('Não foi possível ler o cache local do IEFish:', err.message);
    }
}

async function persistCache() {
    const now = Date.now();
    persistentCache.fechamentos = Object.fromEntries(Object.entries(persistentCache.fechamentos)
        .filter(([, entry]) => entry?.createdAt && now - entry.createdAt < CACHE_MAX_AGE_MS));
    const contents = JSON.stringify(persistentCache);

    cacheWrite = cacheWrite.catch(() => {}).then(async () => {
        await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
        const temporaryFile = `${CACHE_FILE}.tmp`;
        await fs.writeFile(temporaryFile, contents, 'utf8');
        await fs.rename(temporaryFile, CACHE_FILE);
    });

    try {
        await cacheWrite;
    } catch (err) {
        // O cache otimiza consultas; uma falha de disco não deve impedir o fechamento.
        console.warn('Não foi possível gravar o cache local do IEFish:', err.message);
    }
}

function toIsoDate(value) {
    const date = parseDate(value);
    return date ? date.toISOString().slice(0, 10) : null;
}

function minDate(values) {
    const dates = values.map(parseDate).filter(Boolean);
    if (!dates.length) return '2020-01-01';
    return new Date(Math.min(...dates.map(date => date.getTime()))).toISOString().slice(0, 10);
}

function groupBy(items, key) {
    const map = new Map();
    for (const item of items) {
        const itemKey = key(item);
        if (!map.has(itemKey)) map.set(itemKey, []);
        map.get(itemKey).push(item);
    }
    return map;
}

function phaseMetrics(card) {
    const values = Array.isArray(card.metrics) ? card.metrics : [];
    return {
        unit: values[0],
        specie: values[1],
        startDate: values[2],
        size: values[3],
        initialQty: asNumber(values[4]),
        initialWeightG: asNumber(values[5]),
        tca: asNumber(values[6]),
        survival: asNumber(values[7]),
    };
}

function statusFromCore(core) {
    return asNumber(core?.saldo_atual) <= 0 && core?.data_encerramento ? 'Encerrado' : 'Aberto';
}

function isLineageMove(type) {
    return ['Transferência', 'Classificação', 'Novo Lote'].includes(type);
}

function outputBiomass(output) {
    return asNumber(output.quantidade) * asNumber(output.peso) / 1000;
}

export async function listLotesFechamentoFromApi(api) {
    const origins = await getOrigins(api);
    const groups = groupBy(origins, item => item.nomeLote);
    return [...groups.entries()]
        .map(([lote, rows]) => ({
            lote,
            data_inicio: minDate(rows.map(row => row.data_entrada)),
            tanques_origem: rows.length,
            quantidade_inicial: rows.reduce((total, row) => total + asNumber(row.qty), 0),
        }))
        .filter(item => item.lote)
        .sort((left, right) => right.data_inicio.localeCompare(left.data_inicio));
}

async function getOrigins(api, { refresh = false } = {}) {
    await loadPersistentCache();
    if (!refresh && isCacheFresh(originCache, ORIGINS_CACHE_TTL_MS)) {
        return originCache.rows;
    }
    if (!refresh && isCacheFresh(persistentCache.origins, ORIGINS_CACHE_TTL_MS)) {
        originCache = persistentCache.origins;
        return originCache.rows;
    }

    try {
        const rows = await api.searchOrigins();
        originCache = { createdAt: Date.now(), rows };
        persistentCache.origins = originCache;
        await persistCache();
        return rows;
    } catch (err) {
        // A lista de origens muda pouco. Quando a API limita consultas, mantemos
        // a seleção disponível com a última lista salva em vez de quebrar a tela.
        if (persistentCache.origins?.rows?.length) {
            console.warn('API IEFish indisponível; usando lista de origens salva:', err.message);
            originCache = persistentCache.origins;
            return originCache.rows;
        }
        throw err;
    }
}

async function getOutputTypes(api) {
    await loadPersistentCache();
    if (isCacheFresh(persistentCache.outputTypes, OUTPUT_TYPES_CACHE_TTL_MS)) {
        return new Map(persistentCache.outputTypes.rows);
    }

    try {
        const outputTypes = await api.outputTypes();
        persistentCache.outputTypes = {
            createdAt: Date.now(),
            rows: [...outputTypes.entries()],
        };
        await persistCache();
        return outputTypes;
    } catch (err) {
        if (persistentCache.outputTypes?.rows?.length) {
            console.warn('API IEFish indisponível; usando tipos de saída salvos:', err.message);
            return new Map(persistentCache.outputTypes.rows);
        }
        throw err;
    }
}

export function buildApiFechamento({ lote, origins, cards, details, outputs, outputTypes }) {
    const roots = origins.map(origin => ({ id: Number(origin.idlote) }));
    const originById = new Map(origins.map(origin => [Number(origin.idlote), origin]));
    const phaseCards = cards.filter(card => card.card_type === 'fase' && card.allowed !== false);
    const phaseById = new Map(phaseCards.map(card => [Number(card.id), card]));
    const detailsByCycle = groupBy(details.feeding || [], item => Number(item.idlote));
    const outputsByCycle = groupBy(outputs, item => Number(item.idlote));

    const cycles = phaseCards.map(card => {
        const id = Number(card.id);
        const metric = phaseMetrics(card);
        const core = details.core?.[id] || {};
        const cycleOutputs = outputsByCycle.get(id) || [];
        const directSales = cycleOutputs.filter(item => ['Venda', 'Bonificação']
            .includes(outputTypes.get(Number(item.tipo))));
        const directDeaths = cycleOutputs.filter(item => outputTypes.get(Number(item.tipo)) === 'Morte');
        const directSaleQty = directSales.reduce((total, item) => total + asNumber(item.quantidade), 0);
        const directSaleBiomass = directSales.reduce((total, item) => total + outputBiomass(item), 0);
        const feeding = detailsByCycle.get(id) || [];
        const initialBiomass = metric.initialQty * metric.initialWeightG / 1000;
        const finalQty = metric.initialQty * metric.survival / 100;

        return {
            id,
            tank: card.tank || `Lote ${id}`,
            lot: originById.get(id)?.nomeLote || lote,
            groupOrigin: originById.get(id)?.idlote_estoque ? String(originById.get(id).idlote_estoque) : '',
            startDate: metric.startDate || core.data_entrada,
            populationDate: metric.startDate || core.data_entrada,
            endDate: core.data_encerramento || null,
            days: asNumber(core.dias),
            initialQty: metric.initialQty,
            finalQty,
            initialBiomass,
            finalBiomass: directSaleBiomass || finalQty * asNumber(core.despesca) / 1000,
            initialWeightG: metric.initialWeightG,
            exitWeightG: asNumber(core.despesca),
            feed: feeding.reduce((total, item) => total + asNumber(item.qtd), 0),
            feedCost: feeding.reduce((total, item) => total + asNumber(item.vle), 0),
            fishCost: 0,
            indirectCost: 0,
            collectedMortality: directDeaths.reduce((total, item) => total + asNumber(item.quantidade), 0),
            supplier: originById.get(id)?.fornecedor || 'Não informado',
            status: statusFromCore(core),
            apiTca: metric.tca,
            apiSurvival: metric.survival,
            directSaleQty,
        };
    });

    const edges = [];
    const events = [];
    for (const output of outputs) {
        const cycleId = Number(output.idlote);
        const type = outputTypes.get(Number(output.tipo)) || `Tipo ${output.tipo}`;
        const destinationId = Number(output.lotedestino);
        const quantity = asNumber(output.quantidade);
        if (isLineageMove(type) && destinationId && phaseById.has(destinationId)) {
            edges.push({ sourceId: cycleId, destId: destinationId, quantity, type });
        }
        events.push({
            cycleId,
            type,
            quantity,
            biomass: outputBiomass(output),
            lastDate: toIsoDate(output.datamovimentacao),
        });
    }

    const result = buildFechamento({ lote, roots, cycles, edges, events });
    result.diagnostico.fonte = 'API IEFish · Rastreabilidade 2.0';
    result.diagnostico.transferencias_api = edges.length;
    return result;
}

export async function getFechamentoFromApi(api, lote, { refresh = false } = {}) {
    await loadPersistentCache();
    const cached = cache.get(lote);
    if (!refresh && isCacheFresh(cached, FECHAMENTO_CACHE_TTL_MS)) return cached.value;

    const persisted = persistentCache.fechamentos[lote];
    if (!refresh && isCacheFresh(persisted, FECHAMENTO_CACHE_TTL_MS)) {
        cache.set(lote, persisted);
        return persisted.value;
    }

    // Mesmo um fechamento mais antigo ainda é melhor do que uma tela vazia
    // quando o IEFish responde com limite de consultas. O aviso vai até a UI.
    const staleCache = cached?.value ? cached : persisted?.value ? persisted : null;

    // Um clique repetido, a exportação ou outra aba não devem disparar a mesma
    // árvore de rastreabilidade enquanto o fechamento do lote já está sendo buscado.
    if (pendingFechamentos.has(lote)) return pendingFechamentos.get(lote);

    const pending = buildAndCacheFechamento(api, lote, { refresh }).catch(err => {
        if (staleCache) {
            console.warn(`API IEFish indisponível; usando fechamento salvo de ${lote}:`, err.message);
            return staleCacheValue(staleCache, err.message);
        }
        throw err;
    });
    pendingFechamentos.set(lote, pending);
    try {
        return await pending;
    } finally {
        pendingFechamentos.delete(lote);
    }
}

async function buildAndCacheFechamento(api, lote, { refresh }) {

    const allOrigins = await getOrigins(api, { refresh });
    const origins = allOrigins.filter(origin => origin.nomeLote === lote);
    if (!origins.length) throw new Error(`Nenhum tanque de origem encontrado para ${lote}.`);

    const rootIds = origins.map(origin => Number(origin.idlote));
    const cards = await api.cards(rootIds);
    const phaseIds = [...new Set(cards
        .filter(card => card.card_type === 'fase' && card.allowed !== false)
        .map(card => Number(card.id))
        .filter(Number.isFinite))];
    if (!phaseIds.length) throw new Error(`A Rastreabilidade 2.0 não retornou fases para ${lote}.`);

    const [details, outputTypes] = await Promise.all([
        api.cardDetails(phaseIds, rootIds),
        getOutputTypes(api),
    ]);
    const outputs = await api.lotOutputs(phaseIds, minDate(origins.map(origin => origin.data_entrada)));
    const value = buildApiFechamento({ lote, origins, cards, details, outputs, outputTypes });
    const cacheEntry = { createdAt: Date.now(), value };
    cache.set(lote, cacheEntry);
    persistentCache.fechamentos[lote] = cacheEntry;
    await persistCache();
    return value;
}
