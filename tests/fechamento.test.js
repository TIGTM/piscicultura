import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFechamento } from '../src/fechamento.js';

function cycle(overrides) {
    return {
        id: 1,
        tank: 'TR001-3',
        lot: 'Lote 01-24',
        groupOrigin: '',
        startDate: '01/01/2024',
        populationDate: '01/01/2024',
        endDate: '01/06/2024',
        days: 152,
        initialQty: 1000,
        finalQty: 900,
        collectedMortality: 100,
        initialBiomass: 10,
        finalBiomass: 90,
        initialWeightG: 10,
        exitWeightG: 100,
        feed: 100,
        feedCost: 10,
        fishCost: 50,
        indirectCost: 5,
        status: 'Encerrado',
        supplier: 'Fornecedor A',
        ...overrides,
    };
}

function event(cycleId, type, quantity, biomass, lastDate = '2024-06-01') {
    return { cycleId, type, quantity, biomass, lastDate };
}

test('interpola a fase classificada pela participação no tanque de destino', () => {
    const result = buildFechamento({
        lote: 'Lote 01-24',
        roots: [{ id: 1 }],
        cycles: [
            cycle({ id: 1 }),
            cycle({
                id: 2,
                tank: 'TR002-3',
                initialQty: 1800,
                finalQty: 1600,
                initialBiomass: 180,
                finalBiomass: 1600,
                feed: 1000,
                feedCost: 100,
                fishCost: 0,
                indirectCost: 10,
            }),
        ],
        edges: [{ sourceId: 1, destId: 2, quantity: 900 }],
        events: [
            event(1, 'Transferência', 900, 90, '2024-02-01'),
            event(1, 'Morte', 100, 1, '2024-02-01'),
            event(2, 'Venda', 1600, 1600),
            event(2, 'Morte', 100, 100),
            event(2, 'Correção de Saldo', 100, 0),
        ],
    });

    const row = result.porTanque[0];
    assert.equal(row.metodo_planilha, 'Média ponderada por classificação');
    assert.equal(row.racao_planilha, 600);
    assert.equal(row.bio_final_planilha, 900);
    assert.equal(row.ganho_biomassa_planilha, 890);
    assert.equal(row.pm_saida_planilha_g, 1000);
    assert.equal(row.qtd_vendida_rastreada, 800);
    assert.equal(row.bio_vendida_rastreada, 800);
    assert.equal(row.cobertura_rastreio, 100);
    assert.equal(row.mortalidade_pos_classificacao, 50);
    assert.equal(row.mortalidade_total_planilha, 150);
    assert.equal(row.correcao_total_planilha, 50);
    assert.equal(row.sobrevivencia_planilha, 80);
    assert.equal(result.totais_planilha.sobrevivencia_media, 80);
    assert.equal(row.componentes_racao_planilha.length, 2);
    assert.equal(row.componentes_rastreio.length, 2);
    assert.equal(row.componentes_venda.length, 1);
    assert.ok(Math.abs(row.ca_planilha - (600 / 890)) < 1e-9);
});

test('pondera o peso final pela quantidade da origem enviada a cada destino', () => {
    const result = buildFechamento({
        lote: 'Lote 03-25',
        roots: [{ id: 1 }],
        cycles: [
            cycle({
                id: 1,
                tank: 'TR695-3',
                initialQty: 5509,
                finalQty: 4595,
                initialBiomass: 122.2998,
                feed: 163.69,
                collectedMortality: 0,
            }),
            cycle({
                id: 2,
                tank: 'TR148-6',
                initialQty: 5109,
                feed: 9008.35,
                feedCost: 0,
                fishCost: 0,
                indirectCost: 0,
            }),
            cycle({
                id: 3,
                tank: 'TR903-6',
                initialQty: 4987,
                feed: 8167.43,
                feedCost: 0,
                fishCost: 0,
                indirectCost: 0,
            }),
            cycle({
                id: 4,
                tank: 'TR009-3',
                initialQty: 396,
                feed: 2008.67,
                feedCost: 0,
                fishCost: 0,
                indirectCost: 0,
            }),
        ],
        edges: [
            { sourceId: 1, destId: 2, quantity: 1317 },
            { sourceId: 1, destId: 3, quantity: 3267 },
            { sourceId: 1, destId: 4, quantity: 11 },
        ],
        events: [
            event(1, 'Transferência', 4595, 0),
            event(1, 'Correção de Saldo', 914, 0),
            event(2, 'Venda', 4568, 4568 * 1.0110114),
            event(3, 'Venda', 3770, 3770 * 1.0322015913262599),
            event(4, 'Venda', 269, 269 * 1.1003717),
        ],
    });

    const row = result.porTanque[0];
    const expectedPmKg = (
        1.0110114 * 1317
        + 1.0322015913262599 * 3267
        + 1.1003717 * 11
    ) / 4595;
    const expectedFinalBiomass = 4595 * expectedPmKg;
    const expectedFeed = 163.69
        + 9008.35 * (1317 / 5109)
        + 8167.43 * (3267 / 4987)
        + 2008.67 * (11 / 396);

    assert.ok(Math.abs(row.pm_saida_planilha_g - expectedPmKg * 1000) < 1e-9);
    assert.ok(Math.abs(row.bio_final_planilha - expectedFinalBiomass) < 1e-9);
    assert.ok(Math.abs(row.racao_planilha - expectedFeed) < 1e-9);
    assert.ok(Math.abs(row.ca_planilha - (
        expectedFeed / (expectedFinalBiomass - 122.2998)
    )) < 1e-9);
    assert.equal(row.qtd_ponderada_pm_final, 4595);
    assert.deepEqual(
        row.componentes_pm_final.map(item => item.tanque),
        ['TR148-6', 'TR903-6', 'TR009-3'],
    );
    assert.equal(row.componentes_racao_planilha.length, 4);
    assert.equal(row.componentes_venda.length, 3);
    assert.ok(Math.abs(row.sobrevivencia_planilha - (4595 / 5509 * 100)) < 1e-9);
    row.componentes_pm_final
        .map(item => item.quantidade_ponderacao)
        .forEach((quantity, index) => {
            assert.ok(Math.abs(quantity - [1317, 3267, 11][index]) < 1e-9);
        });
});

test('mantém o modelo da planilha na fase inicial quando existe venda direta', () => {
    const result = buildFechamento({
        lote: 'Lote 01-24',
        roots: [{ id: 1 }],
        cycles: [
            cycle({ id: 1, finalBiomass: 800, feed: 500 }),
            cycle({
                id: 2,
                tank: 'TR002-3',
                initialQty: 100,
                finalQty: 90,
                initialBiomass: 100,
                finalBiomass: 90,
                feed: 200,
                feedCost: 20,
                fishCost: 0,
                indirectCost: 0,
            }),
        ],
        edges: [{ sourceId: 1, destId: 2, quantity: 100 }],
        events: [
            event(1, 'Venda', 800, 800),
            event(1, 'Transferência', 100, 100),
            event(1, 'Morte', 100, 1),
            event(2, 'Venda', 90, 90),
            event(2, 'Correção de Saldo', 10, 0),
        ],
    });

    const row = result.porTanque[0];
    assert.equal(row.metodo_planilha, 'Fechamento direto');
    assert.equal(row.racao_planilha, 500);
    assert.equal(row.bio_final_planilha, 800);
    assert.equal(row.racao_rastreada, 700);
    assert.equal(row.qtd_vendida_rastreada, 890);
    assert.equal(row.cobertura_rastreio, 100);
    assert.equal(row.sobrevivencia_planilha, 89);
});

test('divide um tanque misto entre as duas origens sem duplicar ração', () => {
    const result = buildFechamento({
        lote: 'Lote 01-24',
        roots: [{ id: 1 }, { id: 2 }],
        cycles: [
            cycle({ id: 1, tank: 'TR001-3', feed: 100 }),
            cycle({ id: 2, tank: 'TR002-3', feed: 200, supplier: 'Fornecedor B' }),
            cycle({
                id: 3,
                tank: 'TR003-3',
                initialQty: 1000,
                finalQty: 900,
                initialBiomass: 100,
                finalBiomass: 900,
                feed: 1000,
                feedCost: 100,
                fishCost: 0,
                indirectCost: 0,
            }),
        ],
        edges: [
            { sourceId: 1, destId: 3, quantity: 500 },
            { sourceId: 2, destId: 3, quantity: 500 },
        ],
        events: [
            event(1, 'Transferência', 500, 50),
            event(2, 'Transferência', 500, 50),
            event(3, 'Venda', 900, 900),
            event(3, 'Correção de Saldo', 100, 0),
        ],
    });

    const first = result.porTanque.find(row => row.id_lote === 1);
    const second = result.porTanque.find(row => row.id_lote === 2);
    assert.equal(first.racao_rastreada, 600);
    assert.equal(second.racao_rastreada, 700);
    assert.equal(first.qtd_vendida_rastreada, 450);
    assert.equal(second.qtd_vendida_rastreada, 450);
    assert.equal(result.totais_rastreados.racao_total, 1300);
});
