import ExcelJS from 'exceljs';

const TABLE_COLUMNS = [
    { key: 'tanque', label: 'Tanque', width: 16 },
    { key: 'fornecedor', label: 'Fornecedor', width: 32 },
    { key: 'metodo_planilha', label: 'Método', width: 28 },
    { key: 'situacao_fechamento', label: 'Situação', width: 31 },
    { key: 'qtd_em_aberto_estimada', label: 'Peixes em aberto', width: 18, type: 'integer' },
    { key: 'data_entrada', label: 'Entrada', width: 14, type: 'date' },
    { key: 'data_encerramento_planilha', label: 'Encerramento', width: 16, type: 'date' },
    { key: 'dias_planilha', label: 'Dias', width: 10, type: 'integer' },
    { key: 'qtd_inicial', label: 'Qtd. inicial', width: 14, type: 'integer' },
    { key: 'saldo_final', label: 'Saldo final', width: 14, type: 'integer' },
    { key: 'diferenca', label: 'Diferença', width: 14, type: 'integer' },
    { key: 'bio_inicial', label: 'Bio. inicial (kg)', width: 17, type: 'decimal' },
    { key: 'bio_final_planilha', label: 'Bio. final (kg)', width: 17, type: 'decimal' },
    { key: 'ganho_biomassa_planilha', label: 'Ganho bio (kg)', width: 17, type: 'decimal' },
    { key: 'racao_planilha', label: 'Ração (kg)', width: 15, type: 'decimal' },
    { key: 'ca_planilha', label: 'C.A.', width: 10, type: 'decimal' },
    { key: 'pm_entrada_g', label: 'PM entrada (g)', width: 15, type: 'decimal' },
    { key: 'pm_saida_planilha_g', label: 'PM final pond. (g)', width: 19, type: 'decimal' },
    { key: 'gpd_planilha', label: 'GPD (g/dia)', width: 15, type: 'decimal' },
    { key: 'sobrevivencia_biologica_planilha', label: 'Sobrev. biológica (%)', width: 21, type: 'percent' },
    { key: 'sobrevivencia_fechamento_planilha', label: 'Sobrev. fechamento (%)', width: 22, type: 'percent' },
    { key: 'mortalidade_total_planilha', label: 'Mortalidade total', width: 18, type: 'integer' },
    { key: 'correcao_total_planilha', label: 'Correção total', width: 16, type: 'integer' },
];

const KPI_DEFINITIONS = [
    ['Quantidade inicial', totals => totals.qtd_inicial_total, 'integer'],
    ['Mortalidade total', totals => totals.mortalidade_total, 'integer'],
    ['Correção de saldo', totals => totals.correcao_total, 'integer'],
    ['Quebra', totals => totals.quebra_pct, 'percent'],
    ['Peixes em produção', totals => totals.qtd_em_aberto_estimada, 'integer'],
    ['Situação do lote', totals => totals.situacao_fechamento, 'text'],
    ['Tanques de origem', totals => totals.tanques, 'integer'],
    ['Dias médios', totals => totals.dias_medio, 'integer'],
    ['Biomassa final (kg)', totals => totals.bio_final_total, 'decimal'],
    ['Ração total (kg)', totals => totals.racao_total, 'decimal'],
    ['C.A. do lote', totals => totals.ca_real, 'decimal'],
    ['Peso médio final (g)', totals => totals.pm_saida_medio_g, 'decimal'],
    ['GPD médio (g/dia)', totals => totals.gpd_medio, 'decimal'],
    ['Sobrevivência biológica', totals => totals.sobrevivencia_biologica_media, 'percent'],
    ['Sobrevivência de fechamento', totals => totals.sobrevivencia_fechamento_media, 'percent'],
];

function numberFormat(type) {
    if (type === 'integer') return '#,##0';
    if (type === 'percent') return '0.00"%"';
    return '#,##0.00';
}

function formatCell(cell, type) {
    if (['integer', 'decimal', 'percent'].includes(type)) {
        cell.numFmt = numberFormat(type);
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
    }
    if (type === 'date') {
        cell.numFmt = 'dd/mm/yyyy';
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
}

function asDate(value) {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? value : date;
}

export async function createFechamentoWorkbook(fechamento) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'IEFISH VIEW';
    workbook.created = new Date();
    workbook.properties.title = `Fechamento ${fechamento.lote}`;

    const sheet = workbook.addWorksheet('Fechamento', {
        views: [{ state: 'frozen', ySplit: 14 }],
        pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    sheet.columns = TABLE_COLUMNS.map(column => ({ width: column.width }));

    const lastColumn = sheet.getColumn(TABLE_COLUMNS.length).letter;
    sheet.mergeCells(`A1:${lastColumn}1`);
    const title = sheet.getCell('A1');
    title.value = `Fechamento de Lotes - ${fechamento.lote}`;
    title.font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
    title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14212B' } };
    title.alignment = { horizontal: 'left', vertical: 'middle' };
    sheet.getRow(1).height = 28;

    sheet.mergeCells(`A2:${lastColumn}2`);
    const source = sheet.getCell('A2');
    source.value = `Fonte: ${fechamento.diagnostico?.fonte || 'API IEFish'} | Gerado em ${new Date(fechamento.gerado_em).toLocaleString('pt-BR')}`;
    source.font = { italic: true, color: { argb: 'FF52606D' } };

    sheet.getCell('A4').value = 'KPIs do fechamento';
    sheet.getCell('A4').font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    sheet.getCell('A4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F6F78' } };
    sheet.mergeCells('A4:D4');

    const totals = fechamento.totais_planilha;
    for (let index = 0; index < KPI_DEFINITIONS.length; index += 2) {
        const row = 5 + Math.floor(index / 2);
        for (const [offset, column] of [[0, 'A'], [1, 'C']]) {
            const definition = KPI_DEFINITIONS[index + offset];
            if (!definition) continue;
            const [label, getValue, type] = definition;
            const labelCell = sheet.getCell(`${column}${row}`);
            const valueCell = sheet.getCell(`${String.fromCharCode(column.charCodeAt(0) + 1)}${row}`);
            labelCell.value = label;
            labelCell.font = { bold: true, color: { argb: 'FF334E68' } };
            labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F1F3' } };
            valueCell.value = getValue(totals);
            valueCell.font = { bold: true, color: { argb: 'FF102A43' } };
            valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7FAFC' } };
            formatCell(valueCell, type);
            for (const cell of [labelCell, valueCell]) {
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FFCBD5E0' } },
                    bottom: { style: 'thin', color: { argb: 'FFCBD5E0' } },
                    left: { style: 'thin', color: { argb: 'FFCBD5E0' } },
                    right: { style: 'thin', color: { argb: 'FFCBD5E0' } },
                };
            }
        }
    }

    const tableHeaderRow = 14;
    const header = sheet.getRow(tableHeaderRow);
    TABLE_COLUMNS.forEach((column, index) => {
        const cell = header.getCell(index + 1);
        cell.value = column.label;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14212B' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    header.height = 32;

    for (const row of fechamento.porTanque || []) {
        const excelRow = sheet.addRow(TABLE_COLUMNS.map(column => (
            column.type === 'date' ? asDate(row[column.key]) : row[column.key] ?? null
        )));
        excelRow.height = 20;
        TABLE_COLUMNS.forEach((column, index) => {
            const cell = excelRow.getCell(index + 1);
            formatCell(cell, column.type);
            cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
        });
    }

    const firstDataRow = tableHeaderRow + 1;
    const lastDataRow = Math.max(firstDataRow, sheet.rowCount);
    sheet.autoFilter = `A${tableHeaderRow}:${lastColumn}${lastDataRow}`;
    sheet.getColumn(18).eachCell({ includeEmpty: false }, cell => {
        if (cell.row >= firstDataRow) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3FCEC' } };
    });
    sheet.getColumn(19).eachCell({ includeEmpty: false }, cell => {
        if (cell.row >= firstDataRow) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4E5' } };
    });

    return workbook.xlsx.writeBuffer();
}
