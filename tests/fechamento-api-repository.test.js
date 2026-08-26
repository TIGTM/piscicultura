import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApiFechamento } from '../src/fechamento-api-repository.js';

test('usa a árvore da Rastreabilidade 2.0 para atribuir perdas após classificação', () => {
    const result = buildApiFechamento({
        lote: 'Lote API',
        origins: [{
            idlote: 1,
            nomeLote: 'Lote API',
            destan: 'TR001-3',
            fornecedor: 'Fornecedor API',
            qty: 1000,
            weight: 10,
            data_entrada: '2026-01-01',
        }],
        cards: [
            {
                id: 1,
                card_type: 'fase',
                allowed: true,
                tank: 'TR001-3',
                metrics: ['Unidade', 'Tilápia', '2026-01-01', 'A', 1000, 10, 1.5, 90],
            },
            {
                id: 2,
                card_type: 'fase',
                allowed: true,
                tank: 'TR002-3',
                metrics: ['Unidade', 'Tilápia', '2026-02-01', 'B', 900, 100, 1.6, 88.89],
            },
        ],
        details: {
            core: {
                1: { data_encerramento: '2026-02-01', dias: 31, saldo_atual: 0, despesca: 100 },
                2: { data_encerramento: '2026-03-01', dias: 59, saldo_atual: 0, despesca: 1000 },
            },
            feeding: [
                { idlote: 1, qtd: 100, vle: 200 },
                { idlote: 2, qtd: 400, vle: 800 },
            ],
        },
        outputs: [
            { idlote: 1, tipo: 0, quantidade: 50, peso: 10, datamovimentacao: '2026-01-20' },
            { idlote: 1, tipo: 2, quantidade: 50, peso: 10, datamovimentacao: '2026-01-21' },
            { idlote: 1, tipo: 3, quantidade: 900, peso: 100, lotedestino: 2, datamovimentacao: '2026-02-01' },
            { idlote: 2, tipo: 0, quantidade: 50, peso: 900, datamovimentacao: '2026-02-20' },
            { idlote: 2, tipo: 2, quantidade: 50, peso: 900, datamovimentacao: '2026-02-21' },
            { idlote: 2, tipo: 5, quantidade: 800, peso: 1000, datamovimentacao: '2026-03-01' },
        ],
        outputTypes: new Map([
            [0, 'Morte'],
            [2, 'Correção de Saldo'],
            [3, 'Classificação'],
            [5, 'Venda'],
        ]),
    });

    const row = result.porTanque[0];
    assert.equal(row.mortalidade_total_planilha, 100);
    assert.equal(row.correcao_total_planilha, 100);
    assert.equal(row.sobrevivencia_biologica_planilha, 90);
    assert.equal(row.sobrevivencia_fechamento_planilha, 80);
    assert.equal(row.sobrevivencia_planilha, 80);
    assert.equal(row.racao_planilha, 500);
    assert.equal(row.qtd_vendida_rastreada, 800);
    assert.equal(row.status_rastreio, 'Completo');
    assert.equal(result.diagnostico.transferencias_resolvidas, 1);
    assert.equal(result.diagnostico.fonte, 'API IEFish · Rastreabilidade 2.0');
});
