import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularKpisGerais } from '../public/kpis-gerais.js';
import { createFechamentoWorkbook } from '../src/fechamento-xlsx.js';
import ExcelJS from 'exceljs';

const totals = {
    qtd_inicial_total: 206742, mortalidade_total: 29943,
    bio_final_total: 148961.36, pm_saida_medio_g: 148961.36 * 1000 / 155501,
    correcao_total: 51069,
};

test('concilia quantidades com conversão de kg para gramas sem usar correções da API', () => {
    const result = calcularKpisGerais(totals);
    assert.equal(result.qtd_final_kpi, 155501);
    assert.equal(result.mortalidade_apurada_kpi, 29943);
    assert.equal(result.mortalidade_nao_apurada_kpi, 21298);
    assert.equal(result.mortalidade_total_kpi, 51241);
    assert.equal(result.sobrevivencia_fechamento_kpi, 155501 / 206742 * 100);
    assert.equal(result.quebra_kpi + result.sobrevivencia_fechamento_kpi, 100);
    assert.equal(totals.mortalidade_total, 29943);
});

test('não transforma dados ausentes em mortes e mantém divergências negativas para revisão', () => {
    for (const weight of [null, undefined, 0, '']) {
        const result = calcularKpisGerais({ ...totals, pm_saida_medio_g: weight });
        assert.equal(result.qtd_final_kpi, null);
        assert.equal(result.mortalidade_total_kpi, null);
        assert.equal(result.sobrevivencia_fechamento_kpi, null);
    }
    const inconsistent = calcularKpisGerais({ qtd_inicial_total: 100, mortalidade_total: 20, bio_final_total: 90, pm_saida_medio_g: 1000 });
    assert.equal(inconsistent.mortalidade_nao_apurada_kpi, -10);
});

test('exporta os mesmos KPIs sem sobrepor o cabeçalho dos tanques', async () => {
    const buffer = await createFechamentoWorkbook({
        lote: 'Lote teste', gerado_em: new Date().toISOString(),
        totais_planilha: totals, porTanque: [],
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer);
    const sheet = book.worksheets[0];
    const values = new Map();
    for (let row = 5; row < 14; row++) {
        values.set(sheet.getCell(`A${row}`).value, sheet.getCell(`B${row}`).value);
        values.set(sheet.getCell(`C${row}`).value, sheet.getCell(`D${row}`).value);
    }
    assert.equal(values.get('Mortalidade total'), 51241);
    assert.equal(values.get('Mortalidade não apurada'), 21298);
    assert.equal(values.get('Quantidade final (estimada)'), 155501);
    assert.equal(values.has('Correção de saldo'), false);
    assert.equal(sheet.getCell('A14').value, 'Tanque');
});
