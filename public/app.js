const state = {
    viewId: null,
    viewLabel: null,
    columns: [],
    filters: [],
    orderBy: '',
    orderDir: 'ASC',
    limit: 500
};

const viewList = document.getElementById('view-list');
const tableWrapper = document.getElementById('table-wrapper');
const currentViewTitle = document.getElementById('current-view-title');
const refreshBtn = document.getElementById('refresh-btn');
const connectionStatus = document.getElementById('connection-status');
const statusDot = document.querySelector('.dot');
const queryBar = document.getElementById('query-bar');
const limitInput = document.getElementById('limit-input');
const orderBySelect = document.getElementById('orderby-select');
const orderDirSelect = document.getElementById('orderdir-select');
const filtersContainer = document.getElementById('filters-container');
const rowCount = document.getElementById('row-count');
const sessionUsername = document.getElementById('session-username');
const logoutBtn = document.getElementById('logout-btn');

async function apiFetch(input, options) {
    const response = await fetch(input, options);
    if (response.status === 401) {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.replace(`/login?next=${encodeURIComponent(next)}`);
        throw new Error('Sessão expirada. Entre novamente.');
    }
    return response;
}

async function init() {
    try {
        const sessionResponse = await apiFetch('/api/auth/session');
        const session = await sessionResponse.json();
        sessionUsername.textContent = session.username;

        const res = await apiFetch('/api/views');
        if (!res.ok) throw new Error('Falha ao carregar visualizações');
        const views = await res.json();
        renderNav(views);
        populateSqlHint(views);
        await loadLotesFechamento();
        showToast('Sistema carregado com sucesso');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function renderNav(views) {
    viewList.innerHTML = '';
    views.forEach(view => {
        const div = document.createElement('div');
        div.className = 'nav-item';
        div.textContent = view.label;
        div.onclick = () => selectView(view.id, view.label);
        viewList.appendChild(div);
    });
}

function selectView(id, label) {
    state.viewId = id;
    state.viewLabel = label;
    state.filters = [];
    state.orderBy = '';
    state.orderDir = 'ASC';
    state.limit = parseInt(limitInput.value) || 500;

    currentViewTitle.textContent = label;
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.textContent === label);
    });

    queryBar.style.display = 'block';
    executeQuery(true);
}

async function executeQuery(resetColumns = false) {
    if (!state.viewId) return;

    if (!resetColumns) {
        state.limit = Math.min(Math.max(parseInt(limitInput.value) || 500, 1), 5000);
        state.orderBy = orderBySelect.value;
        state.orderDir = orderDirSelect.value;
        state.filters = collectFilters();
    }

    tableWrapper.innerHTML = '<div class="loader"></div>';
    tableWrapper.style.display = 'flex';
    rowCount.textContent = '';

    const params = new URLSearchParams({ limit: state.limit });
    if (state.orderBy) {
        params.set('orderBy', state.orderBy);
        params.set('orderDir', state.orderDir);
    }
    if (state.filters.length) params.set('filters', JSON.stringify(state.filters));

    try {
        const res = await apiFetch(`/api/view/${state.viewId}?${params}`);
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Erro ao carregar dados');
        }
        const { data, total } = await res.json();
        updateStatus(true);

        if (resetColumns && data.length > 0) {
            state.columns = Object.keys(data[0]);
            populateOrderBySelect();
            filtersContainer.innerHTML = '';
        }

        rowCount.textContent = `${total} linha${total !== 1 ? 's' : ''}`;
        renderTable(data);
    } catch (err) {
        updateStatus(false);
        tableWrapper.style.display = 'flex';
        tableWrapper.innerHTML = `
            <div class="welcome-message">
                <h3 style="color: var(--error)">Erro</h3>
                <p>${err.message}</p>
            </div>
        `;
        showToast(err.message, 'error');
    }
}

function populateOrderBySelect() {
    orderBySelect.innerHTML = '<option value="">-- Nenhum --</option>';
    state.columns.forEach(col => {
        const opt = document.createElement('option');
        opt.value = col;
        opt.textContent = col;
        if (col === state.orderBy) opt.selected = true;
        orderBySelect.appendChild(opt);
    });
    orderDirSelect.value = state.orderDir;
    limitInput.value = state.limit;
}

function addFilterRow(col = '', op = '=', val = '') {
    const row = document.createElement('div');
    row.className = 'filter-row';

    const colSel = document.createElement('select');
    colSel.className = 'filter-col-select';
    state.columns.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        if (c === col) opt.selected = true;
        colSel.appendChild(opt);
    });

    const opSel = document.createElement('select');
    opSel.className = 'filter-op-select';
    ['=', '!=', '<', '>', '<=', '>=', 'LIKE', 'NOT LIKE'].forEach(o => {
        const opt = document.createElement('option');
        opt.value = o;
        opt.textContent = o;
        if (o === op) opt.selected = true;
        opSel.appendChild(opt);
    });

    const valInput = document.createElement('input');
    valInput.type = 'text';
    valInput.className = 'filter-val-input';
    valInput.placeholder = 'valor...';
    valInput.value = val;
    valInput.onkeydown = e => { if (e.key === 'Enter') executeQuery(); };

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = '×';
    removeBtn.onclick = () => row.remove();

    row.append(colSel, opSel, valInput, removeBtn);
    filtersContainer.appendChild(row);
}

function collectFilters() {
    return Array.from(document.querySelectorAll('.filter-row')).map(row => ({
        col: row.querySelector('.filter-col-select').value,
        op: row.querySelector('.filter-op-select').value,
        val: row.querySelector('.filter-val-input').value
    })).filter(f => f.col && f.val !== '');
}

function renderTable(data) {
    if (!data || data.length === 0) {
        tableWrapper.style.display = 'flex';
        tableWrapper.innerHTML = '<div class="welcome-message"><p>Nenhum dado encontrado.</p></div>';
        return;
    }

    const columns = Object.keys(data[0]);
    let html = '<table><thead><tr>';
    columns.forEach(col => {
        const isSorted = col === state.orderBy;
        const arrow = isSorted ? (state.orderDir === 'ASC' ? ' ▲' : ' ▼') : '';
        html += `<th class="th-sortable" data-col="${col}">${col}${arrow}</th>`;
    });
    html += '</tr></thead><tbody>';

    data.forEach(row => {
        html += '<tr>';
        columns.forEach(col => {
            let val = row[col];
            if (val instanceof Date) val = val.toLocaleDateString('pt-BR');
            if (val === null || val === undefined) val = '-';
            html += `<td>${String(val).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    tableWrapper.style.display = 'block';
    tableWrapper.innerHTML = html;

    tableWrapper.querySelectorAll('.th-sortable').forEach(th => {
        th.onclick = () => {
            const col = th.dataset.col;
            if (state.orderBy === col) {
                state.orderDir = state.orderDir === 'ASC' ? 'DESC' : 'ASC';
            } else {
                state.orderBy = col;
                state.orderDir = 'ASC';
            }
            orderBySelect.value = state.orderBy;
            orderDirSelect.value = state.orderDir;
            executeQuery();
        };
    });
}

function updateStatus(isOnline) {
    connectionStatus.textContent = isOnline ? 'Conectado ao RDS' : 'Erro de Conexão';
    statusDot.className = `dot ${isOnline ? 'online' : 'offline'}`;
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.style.borderLeftColor = type === 'success' ? 'var(--success)' : 'var(--error)';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

document.getElementById('add-filter-btn').onclick = () => {
    if (!state.columns.length) { showToast('Selecione uma view primeiro', 'error'); return; }
    addFilterRow();
};

document.getElementById('run-query-btn').onclick = () => executeQuery();

refreshBtn.onclick = () => {
    if (state.viewId) executeQuery();
    else showToast('Selecione uma visualização primeiro', 'error');
};

// ── Sidebar tab switching ──────────────────────────────────────────────────
function switchSidebarTab(tab) {
    const mainContent = document.querySelector('main.content');
    document.getElementById('tab-views').classList.toggle('active', tab === 'views');
    document.getElementById('tab-sql').classList.toggle('active', tab === 'sql');
    document.getElementById('tab-fechamento').classList.toggle('active', tab === 'fechamento');
    document.getElementById('panel-views').style.display      = tab === 'views'      ? 'flex' : 'none';
    document.getElementById('panel-sql').style.display        = tab === 'sql'        ? 'flex' : 'none';
    document.getElementById('panel-fechamento').style.display = tab === 'fechamento' ? 'flex' : 'none';
    mainContent.style.display = tab === 'fechamento' ? 'none' : 'flex';
    document.getElementById('view-list').style.display        = tab === 'views'      ? 'flex' : 'none';
    if (tab === 'sql') document.getElementById('sql-input').focus();
}
window.switchSidebarTab = switchSidebarTab;

// ── SQL Editor ─────────────────────────────────────────────────────────────
const sqlInput       = document.getElementById('sql-input');
const sqlTableWrapper = document.getElementById('sql-table-wrapper');
const sqlRowCount    = document.getElementById('sql-row-count');

function populateSqlHint(views) {
    const hint = document.getElementById('sql-views-hint');
    hint.innerHTML = '<span class="hint-label">Views disponíveis:</span> ' +
        views.map(v => `<code class="hint-view" title="${v.label}" onclick="insertViewName('${v.name}')">${v.name}</code>`).join(' ');
}
window.insertViewName = (name) => {
    const ta = sqlInput;
    const pos = ta.selectionStart;
    const before = ta.value.substring(0, pos);
    const after  = ta.value.substring(ta.selectionEnd);
    ta.value = before + name + after;
    ta.selectionStart = ta.selectionEnd = pos + name.length;
    ta.focus();
};

async function runSqlQuery() {
    const sql = sqlInput.value.trim();
    if (!sql) return;

    sqlTableWrapper.style.display = 'flex';
    sqlTableWrapper.innerHTML = '<div class="loader"></div>';
    sqlRowCount.textContent = '';

    try {
        const res = await apiFetch('/api/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql })
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Erro desconhecido');

        const { data, total, elapsed } = json;
        sqlRowCount.textContent = `${total} linha${total !== 1 ? 's' : ''} · ${elapsed}ms`;
        updateStatus(true);
        renderSqlTable(data);
    } catch (err) {
        updateStatus(false);
        sqlTableWrapper.style.display = 'flex';
        sqlTableWrapper.innerHTML = `<div class="welcome-message"><h3 style="color:var(--error)">Erro</h3><p>${err.message}</p></div>`;
        showToast(err.message, 'error');
    }
}

function renderSqlTable(data) {
    if (!data || data.length === 0) {
        sqlTableWrapper.style.display = 'flex';
        sqlTableWrapper.innerHTML = '<div class="welcome-message"><p>Nenhum resultado encontrado.</p></div>';
        return;
    }
    const columns = Object.keys(data[0]);
    let html = '<table><thead><tr>';
    columns.forEach(col => { html += `<th>${col}</th>`; });
    html += '</tr></thead><tbody>';
    data.forEach(row => {
        html += '<tr>';
        columns.forEach(col => {
            let val = row[col];
            if (val instanceof Date) val = val.toLocaleDateString('pt-BR');
            if (val === null || val === undefined) val = '-';
            html += `<td>${String(val).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>`;
        });
        html += '</tr>';
    });
    html += '</tbody></table>';
    sqlTableWrapper.style.display = 'block';
    sqlTableWrapper.innerHTML = html;
}

document.getElementById('sql-run-btn').onclick = runSqlQuery;
document.getElementById('sql-clear-btn').onclick = () => {
    sqlInput.value = '';
    sqlTableWrapper.style.display = 'flex';
    sqlTableWrapper.innerHTML = '<div class="welcome-message"><p>Escreva uma query SELECT e clique em Executar.</p></div>';
    sqlRowCount.textContent = '';
    sqlInput.focus();
};

sqlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); runSqlQuery(); }
    // Tab inserts 2 spaces
    if (e.key === 'Tab') {
        e.preventDefault();
        const s = sqlInput.selectionStart;
        sqlInput.value = sqlInput.value.substring(0, s) + '  ' + sqlInput.value.substring(sqlInput.selectionEnd);
        sqlInput.selectionStart = sqlInput.selectionEnd = s + 2;
    }
});

// ── Fechamento de Lote ────────────────────────────────────────────────────
const fechamentoSelect = document.getElementById('fechamento-lote-select');
const fechamentoRunBtn = document.getElementById('fechamento-run-btn');
const fechamentoExport = document.getElementById('fechamento-export-btn');
const fechamentoStatus = document.getElementById('fechamento-status');
const fechamentoKpis = document.getElementById('fechamento-kpis');
const fechamentoWrapper = document.getElementById('fechamento-table-wrapper');
const fechamentoScroll = document.querySelector('.fechamento-scroll');
const fechamentoDiagnostic = document.getElementById('fechamento-diagnostico');
const fechamentoSuppliersSection = document.getElementById('fechamento-fornecedores-section');
const fechamentoSuppliers = document.getElementById('fechamento-fornecedores');
const fechamentoRowCount = document.getElementById('fechamento-row-count');
const fechamentoModePlan = document.getElementById('fechamento-mode-planilha');
const fechamentoModeTrace = document.getElementById('fechamento-mode-rastreado');
const calculationTooltip = document.getElementById('calculation-tooltip');

let fechamentoData = null;
let fechamentoMode = 'planilha';
const calculationTooltipRegistry = new Map();
let calculationTooltipSequence = 0;
let activeCalculationTarget = null;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function fmt(val, dec = 2) {
    if (val === null || val === undefined || Number.isNaN(Number(val))) return '-';
    return Number(val).toLocaleString('pt-BR', {
        minimumFractionDigits: dec,
        maximumFractionDigits: dec,
    });
}

function fmtDate(value) {
    if (!value) return '-';
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function resetCalculationTooltips() {
    calculationTooltipRegistry.clear();
    calculationTooltipSequence = 0;
    activeCalculationTarget = null;
    calculationTooltip.hidden = true;
}

function calculationTooltipAttributes(details) {
    const id = `calc-${++calculationTooltipSequence}`;
    calculationTooltipRegistry.set(id, details);
    return `data-calc-tooltip="${id}" tabindex="0"`;
}

function limitTooltipComponents(components, limit = 8) {
    if (!Array.isArray(components) || components.length <= limit) return components || [];
    return [
        ...components.slice(0, limit),
        ['Demais parcelas', `+ ${fmt(components.length - limit, 0)} itens`],
    ];
}

function calculationTooltipHtml(details) {
    const values = (details.values || [])
        .map(([label, value]) => `
            <li class="calculation-tooltip-row">
                <span>${escapeHtml(label)}</span>
                <span>${escapeHtml(value)}</span>
            </li>
        `)
        .join('');
    const components = limitTooltipComponents(details.components)
        .map(([label, value]) => `
            <li class="calculation-tooltip-row">
                <span>${escapeHtml(label)}</span>
                <span>${escapeHtml(value)}</span>
            </li>
        `)
        .join('');

    return `
        <div class="calculation-tooltip-title">${escapeHtml(details.title || 'Memória do cálculo')}</div>
        ${details.source ? `<div class="calculation-tooltip-source">${escapeHtml(details.source)}</div>` : ''}
        ${details.formula ? `<div class="calculation-tooltip-formula">${escapeHtml(details.formula)}</div>` : ''}
        ${values ? `<ul class="calculation-tooltip-values">${values}</ul>` : ''}
        ${details.note ? `<div class="calculation-tooltip-note">${escapeHtml(details.note)}</div>` : ''}
        ${components ? `<ul class="calculation-tooltip-components">${components}</ul>` : ''}
    `;
}

function positionCalculationTooltip(target) {
    const targetRect = target.getBoundingClientRect();
    const margin = 12;
    const gap = 8;
    const tooltipRect = calculationTooltip.getBoundingClientRect();

    let left = targetRect.left;
    if (left + tooltipRect.width > window.innerWidth - margin) {
        left = window.innerWidth - tooltipRect.width - margin;
    }
    left = Math.max(margin, left);

    let top = targetRect.bottom + gap;
    if (top + tooltipRect.height > window.innerHeight - margin) {
        top = targetRect.top - tooltipRect.height - gap;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - tooltipRect.height - margin));

    calculationTooltip.style.left = `${left}px`;
    calculationTooltip.style.top = `${top}px`;
}

function showCalculationTooltip(target) {
    const details = calculationTooltipRegistry.get(target.dataset.calcTooltip);
    if (!details) return;
    activeCalculationTarget = target;
    calculationTooltip.innerHTML = calculationTooltipHtml(details);
    calculationTooltip.hidden = false;
    positionCalculationTooltip(target);
}

function hideCalculationTooltip(target) {
    if (target && activeCalculationTarget !== target) return;
    activeCalculationTarget = null;
    calculationTooltip.hidden = true;
}

document.addEventListener('mouseover', event => {
    const target = event.target.closest?.('[data-calc-tooltip]');
    if (target && target !== activeCalculationTarget) showCalculationTooltip(target);
});

document.addEventListener('mouseout', event => {
    const target = event.target.closest?.('[data-calc-tooltip]');
    if (target && !target.contains(event.relatedTarget)) hideCalculationTooltip(target);
});

document.addEventListener('focusin', event => {
    const target = event.target.closest?.('[data-calc-tooltip]');
    if (target) showCalculationTooltip(target);
});

document.addEventListener('focusout', event => {
    const target = event.target.closest?.('[data-calc-tooltip]');
    if (target) hideCalculationTooltip(target);
});

window.addEventListener('resize', () => {
    hideCalculationTooltip();
    fitFechamentoTableToViewport();
});
document.addEventListener('scroll', () => hideCalculationTooltip(), true);

function fitFechamentoTableToViewport() {
    if (!fechamentoWrapper || fechamentoWrapper.style.display === 'none') return;

    const tableTop = fechamentoWrapper.getBoundingClientRect().top;
    const scrollBottom = fechamentoScroll
        ? Math.min(window.innerHeight, fechamentoScroll.getBoundingClientRect().bottom)
        : window.innerHeight;
    const availableHeight = Math.floor(scrollBottom - tableTop - 12);
    const preferredHeight = Math.floor(window.innerHeight * 0.62);
    const maxHeight = Math.max(240, Math.min(preferredHeight, availableHeight));

    fechamentoWrapper.style.setProperty('--fechamento-table-max-height', `${maxHeight}px`);
}

async function loadLotesFechamento() {
    try {
        const res = await apiFetch('/api/lotes-fechamento');
        const lotes = await res.json();
        if (!res.ok) throw new Error(lotes.error || 'Erro ao carregar lotes');
        fechamentoSelect.innerHTML = '<option value="">Selecione um lote</option>';
        lotes.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.lote;
            opt.textContent = `${item.lote} · ${fmt(item.tanques_origem, 0)} tanques · ${fmt(item.quantidade_inicial, 0)} peixes`;
            fechamentoSelect.appendChild(opt);
        });
    } catch (err) {
        fechamentoSelect.innerHTML = '<option value="">Erro ao carregar</option>';
        showToast(err.message, 'error');
    }
}

async function gerarFechamento() {
    const lote = fechamentoSelect.value;
    if (!lote) { showToast('Selecione um lote', 'error'); return; }

    fechamentoStatus.textContent = 'Rastreando ciclos...';
    fechamentoKpis.hidden = true;
    fechamentoDiagnostic.hidden = true;
    fechamentoSuppliersSection.hidden = true;
    fechamentoWrapper.style.display = 'flex';
    fechamentoWrapper.innerHTML = '<div class="loader"></div>';

    try {
        const params = new URLSearchParams({ lote, refresh: '1' });
        const res = await apiFetch(`/api/fechamento?${params}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Erro ao gerar fechamento');

        fechamentoData = json;
        updateStatus(true);
        renderFechamento();
        fechamentoStatus.textContent = `${json.lote} · ${json.diagnostico.ciclos} ciclos`;
    } catch (err) {
        updateStatus(false);
        fechamentoWrapper.innerHTML = `<div class="welcome-message"><h3 class="text-error">Erro</h3><p>${escapeHtml(err.message)}</p></div>`;
        fechamentoStatus.textContent = 'Falha no fechamento';
        showToast(err.message, 'error');
    }
}

const PLAN_COLS = [
    { key: 'tanque', label: 'Tanque', type: 'text' },
    { key: 'fornecedor', label: 'Fornecedor', type: 'text' },
    { key: 'metodo_planilha', label: 'Método', type: 'method' },
    { key: 'data_entrada', label: 'Entrada', type: 'date' },
    { key: 'data_encerramento_planilha', label: 'Encerramento', type: 'date' },
    { key: 'dias_planilha', label: 'Dias', decimals: 0 },
    { key: 'qtd_inicial', label: 'Qtd. inicial', decimals: 0 },
    { key: 'saldo_final', label: 'Saldo final', decimals: 0 },
    { key: 'diferenca', label: 'Diferença', decimals: 0 },
    { key: 'bio_inicial', label: 'Bio. inicial (kg)' },
    { key: 'bio_final_planilha', label: 'Bio. final (kg)' },
    { key: 'ganho_biomassa_planilha', label: 'Ganho bio (kg)' },
    { key: 'racao_planilha', label: 'Ração (kg)' },
    { key: 'ca_planilha', label: 'C.A.' },
    { key: 'pm_entrada_g', label: 'PM entrada (g)' },
    { key: 'pm_saida_planilha_g', label: 'PM final pond. (g)', type: 'weighted-pm' },
    { key: 'gpd_planilha', label: 'GPD (g/dia)' },
    { key: 'sobrevivencia_planilha', label: 'Sobrevivência (%)' },
    { key: 'mortalidade_total_planilha', label: 'Mortalidade total', type: 'loss-total' },
    { key: 'correcao_total_planilha', label: 'Correção total', type: 'loss-total' },
];

const TRACE_COLS = [
    { key: 'tanque', label: 'Tanque', type: 'text' },
    { key: 'fornecedor', label: 'Fornecedor', type: 'text' },
    { key: 'status_rastreio', label: 'Conciliação', type: 'trace' },
    { key: 'confianca', label: 'Confiança', type: 'confidence' },
    { key: 'ciclos_na_linhagem', label: 'Ciclos', decimals: 0 },
    { key: 'profundidade_linhagem', label: 'Níveis', decimals: 0 },
    { key: 'destinos', label: 'Destinos', type: 'list' },
    { key: 'qtd_vendida_rastreada', label: 'Qtd. vendida', decimals: 0 },
    { key: 'bio_vendida_rastreada', label: 'Bio. vendida (kg)' },
    { key: 'racao_rastreada', label: 'Ração rateada (kg)' },
    { key: 'ca_rastreada', label: 'C.A. rastreada' },
    { key: 'pm_saida_rastreado_g', label: 'PM venda (g)' },
    { key: 'gpd_rastreado', label: 'GPD (g/dia)' },
    { key: 'sobrevivencia_comercial', label: 'Sobrev. comercial (%)' },
    { key: 'cobertura_rastreio', label: 'Cobertura (%)' },
    { key: 'mortalidade_rastreada', label: 'Mortalidade', decimals: 0 },
    { key: 'correcao_rastreada', label: 'Correção', decimals: 0 },
    { key: 'qtd_transferencia_sem_destino', label: 'Sem destino', decimals: 0 },
    { key: 'custo_racao_rastreado', label: 'Custo ração (R$)', type: 'money' },
    { key: 'custo_peixe', label: 'Custo peixe (R$)', type: 'money' },
    { key: 'custo_total_rastreado', label: 'Custo total (R$)', type: 'money' },
    { key: 'custo_por_kg_rastreado', label: 'Custo/kg (R$)', type: 'money' },
];

function rowSource(row, field = '') {
    const suffix = field ? ` · campo ${field}` : '';
    return `IEFish · ${row.lote || '-'} · ID do ciclo ${row.id_lote}${suffix}`;
}

function componentLabel(item) {
    return `${item.tanque || '-'} · ${item.lote || 'lote não informado'}`;
}

function sortedComponents(items, valueKey) {
    return [...(items || [])]
        .filter(item => Math.abs(Number(item[valueKey] || 0)) > 1e-9)
        .sort((left, right) => Math.abs(Number(right[valueKey])) - Math.abs(Number(left[valueKey])));
}

function usesWeightedFinalPm(row) {
    return row.metodo_planilha === 'Média ponderada por classificação'
        && (row.componentes_pm_final || []).length > 0;
}

function weightedPmValues(row) {
    if (!usesWeightedFinalPm(row)) return [];
    const components = row.componentes_pm_final || [];
    const weightedSum = components.reduce((sum, item) => (
        sum + Number(item.quantidade_ponderacao || 0) * Number(item.pm_saida_g || 0)
    ), 0);
    const totalQuantity = components.reduce(
        (sum, item) => sum + Number(item.quantidade_ponderacao || 0),
        0,
    );
    return [
        ['Soma (PM × peixes)', `${fmt(weightedSum)} g × peixe`],
        ['Peixes usados na média', `${fmt(totalQuantity, 0)} peixes`],
    ];
}

function weightedPmNote(row) {
    if (!usesWeightedFinalPm(row)) {
        return row.metodo_planilha === 'Fechamento direto'
            ? 'Como houve venda direta, o PM final vem da biomassa vendida dividida pela quantidade vendida; não existe média entre destinos.'
            : 'Não foi possível formar uma média ponderada com vendas rastreadas; neste caso, o sistema usa o PM disponível no próprio ciclo do IEFish.';
    }

    const components = [...(row.componentes_pm_final || [])]
        .sort((left, right) => Number(right.quantidade_ponderacao) - Number(left.quantidade_ponderacao));
    const largest = components[0];
    const smallest = components.at(-1);
    const influence = largest && smallest && largest !== smallest
        ? ` ${largest.tanque} influencia mais (${fmt(largest.quantidade_ponderacao, 0)} peixes; ${fmt(largest.participacao_pct)}%), enquanto ${smallest.tanque} influencia menos (${fmt(smallest.quantidade_ponderacao, 0)} peixes; ${fmt(smallest.participacao_pct)}%).`
        : '';
    return `Não é uma média simples entre tanques: cada peso é multiplicado pela quantidade de peixes que ele representa.${influence}`;
}

function pmComponents(row) {
    return (row.componentes_pm_final || []).map(item => [
        componentLabel(item),
        `${fmt(item.quantidade_ponderacao, 0)} peixes × ${fmt(item.pm_saida_g)} g = ${fmt(Number(item.quantidade_ponderacao) * Number(item.pm_saida_g))} g × peixe (${fmt(item.participacao_pct)}%)`,
    ]);
}

function feedComponents(row, traced = false) {
    const items = traced
        ? sortedComponents(row.componentes_rastreio, 'racao_atribuida')
        : sortedComponents(row.componentes_racao_planilha, 'racao_atribuida');
    return items.map(item => [
        componentLabel(item),
        `${fmt(item.racao_ciclo)} kg × ${fmt(item.participacao_pct)}% = ${fmt(item.racao_atribuida)} kg`,
    ]);
}

function saleComponentRows(row, biomass = false) {
    const key = biomass ? 'biomassa_atribuida' : 'quantidade_atribuida';
    return sortedComponents(row.componentes_venda, key).map(item => [
        componentLabel(item),
        biomass
            ? `${fmt(item.biomassa_vendida_ciclo)} kg × ${fmt(item.participacao_pct)}% = ${fmt(item.biomassa_atribuida)} kg`
            : `${fmt(item.quantidade_vendida_ciclo, 0)} × ${fmt(item.participacao_pct)}% = ${fmt(item.quantidade_atribuida, 0)} peixes`,
    ]);
}

function lossComponentRows(row, kind) {
    const valueKey = kind === 'mortalidade' ? 'mortalidade_atribuida' : 'correcao_atribuida';
    const cycleKey = kind === 'mortalidade' ? 'mortalidade_ciclo' : 'correcao_ciclo';
    return sortedComponents(row.componentes_rastreio, valueKey).map(item => [
        componentLabel(item),
        `${fmt(item[cycleKey], 0)} × ${fmt(item.participacao_pct)}% = ${fmt(item[valueKey], 0)} peixes`,
    ]);
}

function costComponentRows(row) {
    return [...(row.componentes_rastreio || [])]
        .filter(item => (
            Math.abs(Number(item.custo_racao_atribuido || 0)) > 1e-9
            || Math.abs(Number(item.custo_indireto_atribuido || 0)) > 1e-9
        ))
        .sort((left, right) => (
            Number(right.custo_racao_atribuido || 0) + Number(right.custo_indireto_atribuido || 0)
            - Number(left.custo_racao_atribuido || 0) - Number(left.custo_indireto_atribuido || 0)
        ))
        .map(item => [
            componentLabel(item),
            `ração R$ ${fmt(item.custo_racao_atribuido)} + indireto R$ ${fmt(item.custo_indireto_atribuido)}`,
        ]);
}

function planCellExplanation(row, column) {
    const source = rowSource(row);
    const common = {
        tanque: {
            title: `Tanque de origem ${row.tanque}`,
            source: 'Entrada do tipo Estoque/Avulsa + visão geral do IEFish',
            formula: 'Este é o ciclo raiz usado para reconstruir toda a linhagem.',
            values: [
                ['Lote', row.lote || '-'],
                ['ID do ciclo', String(row.id_lote)],
                ['Grupo de origem', row.grupo_origem || 'não informado'],
            ],
        },
        fornecedor: {
            title: `Fornecedor de ${row.tanque}`,
            source: rowSource(row, 'Fornecedor Origem'),
            formula: 'Fornecedor = cadastro de origem do peixe no ciclo inicial.',
            values: [['Resultado', row.fornecedor || '-']],
        },
        metodo_planilha: {
            title: `Método aplicado em ${row.tanque}`,
            source,
            formula: row.metodo_planilha === 'Fechamento direto'
                ? 'Houve venda no próprio tanque de origem; a fase é fechada diretamente.'
                : 'Sem venda direta: o sistema segue as classificações e pondera os PMs finais pelas quantidades da origem.',
            values: [
                ['Método', row.metodo_planilha],
                ['Ciclos na linhagem', fmt(row.ciclos_na_linhagem, 0)],
                ['Cobertura do PM', `${fmt(row.cobertura_pm_final_pct)}%`],
            ],
            components: pmComponents(row),
            note: weightedPmNote(row),
        },
        data_entrada: {
            title: `Data de entrada de ${row.tanque}`,
            source: rowSource(row, 'Data Entrada'),
            formula: 'Data inicial = primeiro registro do ciclo de origem.',
            values: [['Resultado', fmtDate(row.data_entrada)]],
        },
        data_encerramento_planilha: {
            title: `Encerramento considerado em ${row.tanque}`,
            source: 'Saídas de venda/bonificação da linhagem no IEFish',
            formula: row.metodo_planilha === 'Fechamento direto'
                ? 'Encerramento = última venda do tanque de origem.'
                : 'Encerramento = data mais recente entre as vendas dos destinos rastreados.',
            values: [['Resultado', fmtDate(row.data_encerramento_planilha)]],
            components: (row.componentes_venda || []).map(item => [
                componentLabel(item),
                (item.datas || []).map(fmtDate).join(', ') || 'sem data de venda',
            ]),
        },
        dias_planilha: {
            title: `Dias de cultivo de ${row.tanque}`,
            source,
            formula: 'Dias = data de encerramento − data de entrada.',
            values: [
                ['Entrada', fmtDate(row.data_entrada)],
                ['Encerramento', fmtDate(row.data_encerramento_planilha)],
                ['Resultado', `${fmt(row.dias_planilha, 0)} dias`],
            ],
        },
        qtd_inicial: {
            title: `Quantidade inicial de ${row.tanque}`,
            source: rowSource(row, 'Quantidade Inicial'),
            formula: 'Quantidade registrada quando o ciclo de origem foi povoado.',
            values: [['Resultado', `${fmt(row.qtd_inicial, 0)} peixes`]],
        },
        saldo_final: {
            title: `Saldo final da fase inicial de ${row.tanque}`,
            source: rowSource(row, 'Saldo Final'),
            formula: 'Saldo final = peixes que restaram no ciclo de origem antes da venda ou classificação.',
            values: [['Resultado', `${fmt(row.saldo_final, 0)} peixes`]],
            note: 'Quando existe classificação, este saldo não é a sobrevivência até a despesca; as perdas posteriores aparecem na sobrevivência.',
        },
        diferenca: {
            title: `Diferença de quantidade em ${row.tanque}`,
            source,
            formula: 'Diferença = quantidade inicial − saldo final.',
            values: [
                ['Quantidade inicial', fmt(row.qtd_inicial, 0)],
                ['Saldo final', fmt(row.saldo_final, 0)],
                ['Resultado', fmt(row.diferenca, 0)],
            ],
        },
        bio_inicial: {
            title: `Biomassa inicial de ${row.tanque}`,
            source: rowSource(row, 'Biomassa Inicial'),
            formula: 'Biomassa inicial = quantidade inicial × PM de entrada ÷ 1.000.',
            values: [
                ['Quantidade inicial', `${fmt(row.qtd_inicial, 0)} peixes`],
                ['PM de entrada', `${fmt(row.pm_entrada_g)} g`],
                ['Resultado', `${fmt(row.bio_inicial)} kg`],
            ],
        },
        bio_final_planilha: {
            title: `Biomassa final de ${row.tanque}`,
            source: row.metodo_planilha === 'Fechamento direto'
                ? rowSource(row, 'Biomassa Final')
                : 'Saldo da origem + PMs das vendas nos tanques classificados',
            formula: row.metodo_planilha === 'Fechamento direto'
                ? 'Biomassa final = biomassa registrada na venda direta do ciclo.'
                : '1) PM ponderado = Σ(PM do destino × peixes da origem) ÷ Σ peixes. 2) Biomassa final = saldo final × PM ponderado ÷ 1.000.',
            values: [
                ['Saldo final', `${fmt(row.saldo_final, 0)} peixes`],
                ...weightedPmValues(row),
                [usesWeightedFinalPm(row) ? 'PM final ponderado' : 'PM final', `${fmt(row.pm_saida_planilha_g)} g`],
                ['Resultado', `${fmt(row.bio_final_planilha)} kg`],
            ],
            components: pmComponents(row),
            note: weightedPmNote(row),
        },
        ganho_biomassa_planilha: {
            title: `Ganho de biomassa de ${row.tanque}`,
            source,
            formula: usesWeightedFinalPm(row)
                ? '1) Calcula o PM final ponderado. 2) Biomassa final = saldo final × PM ponderado ÷ 1.000. 3) Ganho = biomassa final − biomassa inicial.'
                : 'Ganho de biomassa = biomassa final − biomassa inicial.',
            values: [
                ...weightedPmValues(row),
                [usesWeightedFinalPm(row) ? 'PM final ponderado' : 'PM final', `${fmt(row.pm_saida_planilha_g)} g`],
                ['Biomassa final', `${fmt(row.bio_final_planilha)} kg`],
                ['Biomassa inicial', `${fmt(row.bio_inicial)} kg`],
                ['Resultado', `${fmt(row.ganho_biomassa_planilha)} kg`],
            ],
            components: pmComponents(row),
            note: weightedPmNote(row),
        },
        racao_planilha: {
            title: `Ração atribuída a ${row.tanque}`,
            source: 'Campo Ração Real de cada ciclo da linhagem no IEFish',
            formula: 'Ração = soma da ração de cada ciclo × participação da origem naquele ciclo.',
            values: [['Resultado', `${fmt(row.racao_planilha)} kg`]],
            components: feedComponents(row),
            note: 'A participação é calculada pela quantidade da origem que entrou no destino. É um rateio proporcional da ração, não uma média de pesos.',
        },
        ca_planilha: {
            title: `C.A. de ${row.tanque}`,
            source: usesWeightedFinalPm(row)
                ? 'Ração atribuída + biomassa final reconstruída com média ponderada'
                : 'Ração atribuída + ganho de biomassa calculado',
            formula: usesWeightedFinalPm(row)
                ? '1) PM ponderado = Σ(PM do destino × peixes da origem) ÷ Σ peixes. 2) Biomassa final = saldo final × PM ponderado ÷ 1.000. 3) C.A. = ração ÷ (biomassa final − biomassa inicial).'
                : 'C.A. = ração consumida ÷ (biomassa final − biomassa inicial).',
            values: [
                ...weightedPmValues(row),
                [usesWeightedFinalPm(row) ? 'PM final ponderado' : 'PM final', `${fmt(row.pm_saida_planilha_g)} g`],
                ['Biomassa final', `${fmt(row.bio_final_planilha)} kg`],
                ['Biomassa inicial', `${fmt(row.bio_inicial)} kg`],
                ['Ração consumida', `${fmt(row.racao_planilha)} kg`],
                ['Ganho de biomassa', `${fmt(row.ganho_biomassa_planilha)} kg`],
                ['Resultado', fmt(row.ca_planilha)],
            ],
            components: pmComponents(row),
            note: `${weightedPmNote(row)} A C.A. em si não é uma média: ela divide a ração pelo ganho de biomassa.`,
        },
        pm_entrada_g: {
            title: `PM de entrada de ${row.tanque}`,
            source: rowSource(row, 'Biomassa Inicial e Quantidade Inicial'),
            formula: 'PM de entrada = biomassa inicial × 1.000 ÷ quantidade inicial.',
            values: [
                ['Biomassa inicial', `${fmt(row.bio_inicial)} kg`],
                ['Quantidade inicial', fmt(row.qtd_inicial, 0)],
                ['Resultado', `${fmt(row.pm_entrada_g)} g`],
            ],
        },
        pm_saida_planilha_g: {
            title: `${usesWeightedFinalPm(row) ? 'PM final ponderado' : 'PM final'} de ${row.tanque}`,
            source: 'Vendas dos tanques de destino rastreados no IEFish',
            formula: row.metodo_planilha === 'Fechamento direto'
                ? 'PM final = biomassa vendida × 1.000 ÷ quantidade vendida.'
                : 'PM final = Σ(PM do destino × quantidade da origem) ÷ Σ quantidades.',
            values: [
                ...weightedPmValues(row),
                ['Base ponderada', `${fmt(row.qtd_ponderada_pm_final, 0)} peixes`],
                ['Cobertura', `${fmt(row.cobertura_pm_final_pct)}%`],
                ['Resultado', `${fmt(row.pm_saida_planilha_g)} g`],
            ],
            components: pmComponents(row),
            note: weightedPmNote(row),
        },
        gpd_planilha: {
            title: `GPD de ${row.tanque}`,
            source,
            formula: usesWeightedFinalPm(row)
                ? '1) Calcula o PM final ponderado pelas quantidades. 2) GPD = (PM final ponderado − PM de entrada) ÷ dias de cultivo.'
                : 'GPD = (PM final − PM de entrada) ÷ dias de cultivo.',
            values: [
                ...weightedPmValues(row),
                ['PM final', `${fmt(row.pm_saida_planilha_g)} g`],
                ['PM de entrada', `${fmt(row.pm_entrada_g)} g`],
                ['Dias', fmt(row.dias_planilha, 0)],
                ['Resultado', `${fmt(row.gpd_planilha)} g/dia`],
            ],
            components: pmComponents(row),
            note: weightedPmNote(row),
        },
        sobrevivencia_planilha: {
            title: `Sobrevivência de ${row.tanque}`,
            source: 'Mortalidades e correções proporcionais de toda a linhagem',
            formula: 'Sobrevivência = (inicial − mortalidade total − correção total) ÷ inicial × 100.',
            values: [
                ['Quantidade inicial', fmt(row.qtd_inicial, 0)],
                ['Mortalidade total', fmt(row.mortalidade_total_planilha, 0)],
                ['Correção total', fmt(row.correcao_total_planilha, 0)],
                ['Sobreviventes estimados', fmt(row.saldo_sobrevivente_estimado, 0)],
                ['Resultado', `${fmt(row.sobrevivencia_planilha)}%`],
            ],
            note: 'As mortes e correções depois da classificação são rateadas pela participação da origem em cada tanque, usando a mesma proporção aplicada à ração.',
        },
        mortalidade_total_planilha: {
            title: `Mortalidade atribuída a ${row.tanque}`,
            source: 'Saídas do tipo Morte em todos os ciclos rastreados',
            formula: 'Mortalidade total = Σ(mortes do ciclo × participação da origem).',
            values: [
                ['Na origem', fmt(row.mortalidade, 0)],
                ['Pós-classificação', fmt(row.mortalidade_pos_classificacao, 0)],
                ['Resultado', fmt(row.mortalidade_total_planilha, 0)],
            ],
            components: lossComponentRows(row, 'mortalidade'),
        },
        correcao_total_planilha: {
            title: `Correção atribuída a ${row.tanque}`,
            source: 'Saídas do tipo Correção de Saldo em todos os ciclos rastreados',
            formula: 'Correção total = Σ(correção do ciclo × participação da origem).',
            values: [
                ['Na origem', fmt(row.correcao_saldo, 0)],
                ['Pós-classificação', fmt(row.correcao_pos_classificacao, 0)],
                ['Resultado', fmt(row.correcao_total_planilha, 0)],
            ],
            components: lossComponentRows(row, 'correcao'),
        },
    };
    return common[column.key] || {
        title: `${column.label} de ${row.tanque}`,
        source,
        formula: 'Valor consolidado a partir da linhagem do tanque no IEFish.',
        values: [['Resultado', String(row[column.key] ?? '-')]],
    };
}

function traceCellExplanation(row, column) {
    if (column.key === 'tanque' || column.key === 'fornecedor') {
        return planCellExplanation(row, column);
    }
    const source = rowSource(row);
    const explanations = {
        status_rastreio: {
            title: `Conciliação de ${row.tanque}`,
            source: 'Diagnóstico automático da árvore de transferências',
            formula: 'Completo quando há venda rastreada, nenhuma transferência sem destino e cobertura entre 85% e 115%.',
            values: [
                ['Status', row.status_rastreio],
                ['Cobertura', `${fmt(row.cobertura_rastreio)}%`],
                ['Sem destino', fmt(row.qtd_transferencia_sem_destino, 0)],
            ],
        },
        confianca: {
            title: `Confiança do rastreio de ${row.tanque}`,
            source: 'Resultado do diagnóstico de conciliação',
            formula: 'Alta = rastreio completo; Média = cobertura fora da faixa; Baixa = venda ausente ou transferência sem destino.',
            values: [['Resultado', row.confianca]],
        },
        ciclos_na_linhagem: {
            title: `Ciclos rastreados de ${row.tanque}`,
            source,
            formula: 'Contagem dos ciclos alcançados ao seguir as transferências da origem.',
            values: [['Resultado', fmt(row.ciclos_na_linhagem, 0)]],
            components: (row.componentes_rastreio || []).map(item => [
                componentLabel(item),
                `${fmt(item.participacao_pct)}% da origem`,
            ]),
        },
        profundidade_linhagem: {
            title: `Níveis da linhagem de ${row.tanque}`,
            source,
            formula: 'Maior número de transferências sucessivas entre a origem e um destino final.',
            values: [['Resultado', fmt(row.profundidade_linhagem, 0)]],
        },
        destinos: {
            title: `Destinos de ${row.tanque}`,
            source: 'Transferências resolvidas no IEFish',
            formula: 'Lista sem repetição dos tanques encontrados depois da origem.',
            values: [['Resultado', (row.destinos || []).join(', ') || 'nenhum']],
        },
        qtd_vendida_rastreada: {
            title: `Quantidade vendida atribuída a ${row.tanque}`,
            source: 'Vendas/bonificações dos ciclos descendentes',
            formula: 'Quantidade atribuída = Σ(quantidade vendida no ciclo × participação da origem).',
            values: [['Resultado', `${fmt(row.qtd_vendida_rastreada, 0)} peixes`]],
            components: saleComponentRows(row),
        },
        bio_vendida_rastreada: {
            title: `Biomassa vendida atribuída a ${row.tanque}`,
            source: 'Vendas/bonificações dos ciclos descendentes',
            formula: 'Biomassa atribuída = Σ(biomassa vendida no ciclo × participação da origem).',
            values: [['Resultado', `${fmt(row.bio_vendida_rastreada)} kg`]],
            components: saleComponentRows(row, true),
        },
        racao_rastreada: {
            title: `Ração rastreada de ${row.tanque}`,
            source: 'Ração Real dos ciclos da linhagem',
            formula: 'Ração rastreada = Σ(ração do ciclo × participação da origem).',
            values: [['Resultado', `${fmt(row.racao_rastreada)} kg`]],
            components: feedComponents(row, true),
        },
        ca_rastreada: {
            title: `C.A. rastreada de ${row.tanque}`,
            source,
            formula: 'C.A. rastreada = ração rastreada ÷ (biomassa vendida atribuída − biomassa inicial).',
            values: [
                ['Ração rastreada', `${fmt(row.racao_rastreada)} kg`],
                ['Biomassa vendida', `${fmt(row.bio_vendida_rastreada)} kg`],
                ['Biomassa inicial', `${fmt(row.bio_inicial)} kg`],
                ['Resultado', fmt(row.ca_rastreada)],
            ],
        },
        pm_saida_rastreado_g: {
            title: `PM de venda rastreado de ${row.tanque}`,
            source: 'Vendas atribuídas na linhagem',
            formula: 'PM de venda = biomassa vendida × 1.000 ÷ quantidade vendida.',
            values: [
                ['Biomassa vendida', `${fmt(row.bio_vendida_rastreada)} kg`],
                ['Quantidade vendida', fmt(row.qtd_vendida_rastreada, 0)],
                ['Resultado', `${fmt(row.pm_saida_rastreado_g)} g`],
            ],
        },
        gpd_rastreado: {
            title: `GPD rastreado de ${row.tanque}`,
            source,
            formula: 'GPD = (PM de venda − PM de entrada) ÷ dias até a última venda.',
            values: [
                ['PM de venda', `${fmt(row.pm_saida_rastreado_g)} g`],
                ['PM de entrada', `${fmt(row.pm_entrada_g)} g`],
                ['Dias', fmt(row.dias_rastreado, 0)],
                ['Resultado', `${fmt(row.gpd_rastreado)} g/dia`],
            ],
        },
        sobrevivencia_comercial: {
            title: `Sobrevivência comercial de ${row.tanque}`,
            source,
            formula: 'Sobrevivência comercial = quantidade vendida atribuída ÷ quantidade inicial × 100.',
            values: [
                ['Quantidade vendida', fmt(row.qtd_vendida_rastreada, 0)],
                ['Quantidade inicial', fmt(row.qtd_inicial, 0)],
                ['Resultado', `${fmt(row.sobrevivencia_comercial)}%`],
            ],
        },
        cobertura_rastreio: {
            title: `Cobertura do rastreio de ${row.tanque}`,
            source,
            formula: 'Cobertura = saídas terminais atribuídas ÷ quantidade inicial × 100.',
            values: [
                ['Saídas terminais', fmt(row.saidas_terminais_rastreadas, 0)],
                ['Quantidade inicial', fmt(row.qtd_inicial, 0)],
                ['Resultado', `${fmt(row.cobertura_rastreio)}%`],
            ],
        },
        mortalidade_rastreada: {
            title: `Mortalidade rastreada de ${row.tanque}`,
            source: 'Eventos de morte da linhagem',
            formula: 'Mortalidade = Σ(mortes do ciclo × participação da origem).',
            values: [['Resultado', fmt(row.mortalidade_rastreada, 0)]],
            components: lossComponentRows(row, 'mortalidade'),
        },
        correcao_rastreada: {
            title: `Correção rastreada de ${row.tanque}`,
            source: 'Eventos de correção de saldo da linhagem',
            formula: 'Correção = Σ(correção do ciclo × participação da origem).',
            values: [['Resultado', fmt(row.correcao_rastreada, 0)]],
            components: lossComponentRows(row, 'correcao'),
        },
        qtd_transferencia_sem_destino: {
            title: `Transferências sem destino de ${row.tanque}`,
            source: 'Conciliação entre saídas e entradas do IEFish',
            formula: 'Soma proporcional das transferências que não encontraram ciclo de entrada correspondente.',
            values: [['Resultado', `${fmt(row.qtd_transferencia_sem_destino, 0)} peixes`]],
        },
        custo_racao_rastreado: {
            title: `Custo de ração atribuído a ${row.tanque}`,
            source: 'Campo Custo Ração dos ciclos da linhagem',
            formula: 'Custo de ração = Σ(custo do ciclo × participação da origem).',
            values: [['Resultado', `R$ ${fmt(row.custo_racao_rastreado)}`]],
            components: costComponentRows(row),
        },
        custo_peixe: {
            title: `Custo de aquisição do peixe de ${row.tanque}`,
            source: rowSource(row, 'Custo Peixe para Cultivo'),
            formula: 'O custo de aquisição entra somente no tanque de origem para não duplicar nas classificações.',
            values: [['Resultado', `R$ ${fmt(row.custo_peixe)}`]],
        },
        custo_total_rastreado: {
            title: `Custo total rastreado de ${row.tanque}`,
            source,
            formula: 'Custo total = custo de ração + custo indireto + custo de aquisição do peixe.',
            values: [
                ['Custo de ração', `R$ ${fmt(row.custo_racao_rastreado)}`],
                ['Custo indireto', `R$ ${fmt(row.custo_indireto_rastreado)}`],
                ['Custo do peixe', `R$ ${fmt(row.custo_peixe)}`],
                ['Resultado', `R$ ${fmt(row.custo_total_rastreado)}`],
            ],
            components: costComponentRows(row),
        },
        custo_por_kg_rastreado: {
            title: `Custo por kg de ${row.tanque}`,
            source,
            formula: 'Custo por kg = custo total rastreado ÷ biomassa vendida atribuída.',
            values: [
                ['Custo total', `R$ ${fmt(row.custo_total_rastreado)}`],
                ['Biomassa vendida', `${fmt(row.bio_vendida_rastreada)} kg`],
                ['Resultado', `R$ ${fmt(row.custo_por_kg_rastreado)}/kg`],
            ],
        },
    };
    return explanations[column.key] || {
        title: `${column.label} de ${row.tanque}`,
        source,
        formula: 'Valor calculado a partir da linhagem rastreada no IEFish.',
        values: [['Resultado', String(row[column.key] ?? '-')]],
    };
}

function tankTotalComponents(rows, key, suffix = '', decimals = 2) {
    return [...rows]
        .filter(row => Number.isFinite(Number(row[key])))
        .sort((left, right) => Math.abs(Number(right[key])) - Math.abs(Number(left[key])))
        .map(row => [row.tanque, `${fmt(row[key], decimals)}${suffix}`]);
}

function finalBiomassComponents(rows) {
    return [...rows]
        .filter(row => Number.isFinite(Number(row.bio_final_planilha)))
        .sort((left, right) => Number(right.bio_final_planilha) - Number(left.bio_final_planilha))
        .map(row => {
            if (usesWeightedFinalPm(row)) {
                return [
                    row.tanque,
                    `${fmt(row.saldo_final, 0)} peixes × ${fmt(row.pm_saida_planilha_g)} g ÷ 1.000 = ${fmt(row.bio_final_planilha)} kg · PM ponderado em ${(row.componentes_pm_final || []).length} destinos`,
                ];
            }
            return [
                row.tanque,
                `${fmt(row.bio_final_planilha)} kg registrados no ciclo · ${row.metodo_planilha}`,
            ];
        });
}

function lotWeightedPmComponents(rows) {
    return [...rows]
        .filter(row => (
            Number.isFinite(Number(row.bio_final_planilha))
            && Number.isFinite(Number(row.saldo_final))
            && Number(row.saldo_final) > 0
        ))
        .sort((left, right) => Number(right.saldo_final) - Number(left.saldo_final))
        .map(row => {
            const equivalentPm = Number(row.bio_final_planilha) * 1000 / Number(row.saldo_final);
            return [
                row.tanque,
                `${fmt(row.saldo_final, 0)} peixes × ${fmt(equivalentPm)} g = ${fmt(Number(row.bio_final_planilha) * 1000)} g × peixe`,
            ];
        });
}

function planKpiExplanation(key, totals, rows) {
    const source = `Consolidação de ${fmt(rows.length, 0)} tanques de origem de ${fechamentoData.lote}`;
    const weightedTankCount = rows.filter(usesWeightedFinalPm).length;
    const map = {
        tanques: {
            title: 'Tanques de origem',
            source,
            formula: 'Total = quantidade de ciclos raiz do lote.',
            values: [['Resultado', fmt(totals.tanques, 0)]],
        },
        qtd_inicial: {
            title: 'Quantidade inicial do lote',
            source,
            formula: 'Quantidade inicial total = Σ quantidade inicial de cada tanque.',
            values: [['Resultado', `${fmt(totals.qtd_inicial_total, 0)} peixes`]],
            components: tankTotalComponents(rows, 'qtd_inicial', ' peixes', 0),
        },
        saldo_final: {
            title: 'Saldo final das fases iniciais',
            source,
            formula: 'Saldo final total = Σ saldo final dos tanques de origem.',
            values: [['Resultado', `${fmt(totals.saldo_final_total, 0)} peixes`]],
            components: tankTotalComponents(rows, 'saldo_final', ' peixes', 0),
            note: 'É o saldo das fases de origem; a sobrevivência também considera perdas pós-classificação.',
        },
        quebra: {
            title: 'Quebra total do lote',
            source,
            formula: 'Quebra = (mortalidade total + correção total) ÷ quantidade inicial × 100.',
            values: [
                ['Mortalidade', fmt(totals.mortalidade_total, 0)],
                ['Correção', fmt(totals.correcao_total, 0)],
                ['Quantidade inicial', fmt(totals.qtd_inicial_total, 0)],
                ['Resultado', `${fmt(totals.quebra_pct)}%`],
            ],
            components: [...rows]
                .sort((left, right) => (
                    Number(right.mortalidade_total_planilha) + Number(right.correcao_total_planilha)
                    - Number(left.mortalidade_total_planilha) - Number(left.correcao_total_planilha)
                ))
                .map(row => [
                    row.tanque,
                    `${fmt(Number(row.mortalidade_total_planilha) + Number(row.correcao_total_planilha), 0)} peixes`,
                ]),
        },
        bio_final: {
            title: 'Biomassa final do lote',
            source,
            formula: '1) Em cada tanque classificado, calcula o PM ponderado pelas quantidades dos destinos. 2) Biomassa do tanque = saldo final × PM final ÷ 1.000. 3) Biomassa do lote = Σ biomassas dos tanques.',
            values: [
                ['Tanques com PM ponderado', `${fmt(weightedTankCount, 0)} de ${fmt(rows.length, 0)}`],
                ['Resultado', `${fmt(totals.bio_final_total)} kg`],
            ],
            components: finalBiomassComponents(rows),
            note: 'Os destinos com mais peixes influenciam mais o PM de cada tanque e, por consequência, sua biomassa final.',
        },
        racao: {
            title: 'Ração total do lote',
            source,
            formula: 'Ração total = Σ ração atribuída a cada tanque de origem.',
            values: [['Resultado', `${fmt(totals.racao_total)} kg`]],
            components: tankTotalComponents(rows, 'racao_planilha', ' kg'),
        },
        ca: {
            title: 'C.A. consolidada do lote',
            source,
            formula: '1) Reconstrói as biomassas finais usando os PMs ponderados. 2) Ganho total = biomassa final total − biomassa inicial total. 3) C.A. = ração total ÷ ganho total.',
            values: [
                ['Tanques com PM ponderado', `${fmt(weightedTankCount, 0)} de ${fmt(rows.length, 0)}`],
                ['Ração total', `${fmt(totals.racao_total)} kg`],
                ['Biomassa final', `${fmt(totals.bio_final_total)} kg`],
                ['Biomassa inicial', `${fmt(totals.bio_inicial_total)} kg`],
                ['Ganho de biomassa', `${fmt(totals.bio_final_total - totals.bio_inicial_total)} kg`],
                ['Resultado', fmt(totals.ca_real)],
            ],
            components: finalBiomassComponents(rows),
            note: 'A C.A. consolidada não é a média dos C.As dos tanques. Ela divide toda a ração por todo o ganho de biomassa; a média ponderada entra antes, na construção das biomassas finais.',
        },
        pm_final: {
            title: 'Peso médio final consolidado',
            source,
            formula: '1) Dentro de cada tanque, pondera os PMs dos destinos pela quantidade de peixes. 2) No lote, pondera novamente o PM de cada tanque pelo seu saldo final: PM = Σ(PM × peixes) ÷ Σ peixes.',
            values: [
                ['Tanques com PM ponderado', `${fmt(weightedTankCount, 0)} de ${fmt(rows.length, 0)}`],
                ['Biomassa final', `${fmt(totals.bio_final_total)} kg`],
                ['Saldo final', fmt(totals.saldo_final_total, 0)],
                ['Resultado', `${fmt(totals.pm_saida_medio_g)} g`],
            ],
            components: lotWeightedPmComponents(rows),
            note: `Não é a média simples dos ${fmt(rows.length, 0)} pesos médios. Um tanque com mais peixes tem mais influência no resultado.`,
        },
        gpd: {
            title: 'GPD médio do lote',
            source,
            formula: 'GPD médio = Σ GPD dos tanques ÷ quantidade de tanques com GPD.',
            values: [['Resultado', `${fmt(totals.gpd_medio)} g/dia`]],
            components: tankTotalComponents(rows, 'gpd_planilha', ' g/dia'),
            note: 'O PM final usado dentro de cada GPD é ponderado pelas quantidades dos destinos. Depois disso, este KPI faz a média simples dos GPDs válidos dos tanques.',
        },
        sobrevivencia: {
            title: 'Sobrevivência consolidada do lote',
            source,
            formula: 'Sobrevivência = (inicial − mortalidade − correção) ÷ inicial × 100.',
            values: [
                ['Quantidade inicial', fmt(totals.qtd_inicial_total, 0)],
                ['Mortalidade total', fmt(totals.mortalidade_total, 0)],
                ['Correção total', fmt(totals.correcao_total, 0)],
                ['Resultado', `${fmt(totals.sobrevivencia_media)}%`],
            ],
            components: tankTotalComponents(rows, 'sobrevivencia_planilha', '%'),
        },
        dias: {
            title: 'Dias médios do lote',
            source,
            formula: 'Dias médios = Σ dias dos tanques ÷ quantidade de tanques com data válida.',
            values: [['Resultado', `${fmt(totals.dias_medio, 0)} dias`]],
            components: tankTotalComponents(rows, 'dias_planilha', ' dias', 0),
        },
        correcao: {
            title: 'Correção de saldo total',
            source,
            formula: 'Correção total = Σ correções proporcionais de todos os tanques e fases.',
            values: [['Resultado', `${fmt(totals.correcao_total, 0)} peixes`]],
            components: tankTotalComponents(rows, 'correcao_total_planilha', ' peixes', 0),
        },
    };
    return map[key];
}

function traceKpiExplanation(key, totals, rows) {
    const source = `Consolidação rastreada de ${fechamentoData.lote}`;
    const map = {
        ciclos: {
            title: 'Ciclos rastreados',
            source,
            formula: 'Quantidade de ciclos únicos alcançados pela árvore do lote.',
            values: [['Resultado', fmt(totals.ciclos_rastreados, 0)]],
        },
        qtd_vendida: {
            title: 'Quantidade vendida atribuída',
            source,
            formula: 'Total = Σ quantidades vendidas atribuídas às origens.',
            values: [['Resultado', `${fmt(totals.qtd_vendida_total, 0)} peixes`]],
            components: tankTotalComponents(rows, 'qtd_vendida_rastreada', ' peixes', 0),
        },
        bio_vendida: {
            title: 'Biomassa vendida atribuída',
            source,
            formula: 'Total = Σ biomassas vendidas atribuídas às origens.',
            values: [['Resultado', `${fmt(totals.bio_vendida_total)} kg`]],
            components: tankTotalComponents(rows, 'bio_vendida_rastreada', ' kg'),
        },
        racao: {
            title: 'Ração rastreada total',
            source,
            formula: 'Total = Σ ração rastreada de cada origem.',
            values: [['Resultado', `${fmt(totals.racao_total)} kg`]],
            components: tankTotalComponents(rows, 'racao_rastreada', ' kg'),
        },
        ca: {
            title: 'C.A. rastreada do lote',
            source,
            formula: 'C.A. = ração rastreada total ÷ (biomassa vendida total − biomassa inicial total).',
            values: [
                ['Ração', `${fmt(totals.racao_total)} kg`],
                ['Biomassa vendida', `${fmt(totals.bio_vendida_total)} kg`],
                ['Biomassa inicial', `${fmt(totals.bio_inicial_total)} kg`],
                ['Resultado', fmt(totals.ca_real)],
            ],
        },
        pm: {
            title: 'PM de venda consolidado',
            source,
            formula: 'PM = biomassa vendida total × 1.000 ÷ quantidade vendida total.',
            values: [
                ['Biomassa', `${fmt(totals.bio_vendida_total)} kg`],
                ['Quantidade', fmt(totals.qtd_vendida_total, 0)],
                ['Resultado', `${fmt(totals.pm_saida_medio_g)} g`],
            ],
        },
        sobrevivencia: {
            title: 'Sobrevivência comercial consolidada',
            source,
            formula: 'Sobrevivência = quantidade vendida atribuída ÷ quantidade inicial × 100.',
            values: [
                ['Quantidade vendida', fmt(totals.qtd_vendida_total, 0)],
                ['Quantidade inicial', fmt(totals.qtd_inicial_total, 0)],
                ['Resultado', `${fmt(totals.sobrevivencia_comercial)}%`],
            ],
        },
        cobertura: {
            title: 'Cobertura consolidada do rastreio',
            source,
            formula: 'Cobertura = saídas terminais atribuídas ÷ quantidade inicial × 100.',
            values: [['Resultado', `${fmt(totals.cobertura_rastreio)}%`]],
            components: tankTotalComponents(rows, 'cobertura_rastreio', '%'),
        },
        custo_racao: {
            title: 'Custo total de ração',
            source,
            formula: 'Total = Σ custos de ração atribuídos às origens.',
            values: [['Resultado', `R$ ${fmt(totals.custo_racao_total)}`]],
            components: tankTotalComponents(rows, 'custo_racao_rastreado', '', 2),
        },
        custo_total: {
            title: 'Custo total estimado',
            source,
            formula: 'Custo total = ração + custos indiretos + aquisição dos peixes.',
            values: [
                ['Custo de ração', `R$ ${fmt(totals.custo_racao_total)}`],
                ['Custo do peixe', `R$ ${fmt(totals.custo_peixe_total)}`],
                ['Custo indireto', `R$ ${fmt(totals.custo_indireto_total)}`],
                ['Resultado', `R$ ${fmt(totals.custo_total)}`],
            ],
            components: tankTotalComponents(rows, 'custo_total_rastreado', '', 2),
        },
        custo_kg: {
            title: 'Custo consolidado por kg',
            source,
            formula: 'Custo por kg = custo total estimado ÷ biomassa vendida total.',
            values: [
                ['Custo total', `R$ ${fmt(totals.custo_total)}`],
                ['Biomassa vendida', `${fmt(totals.bio_vendida_total)} kg`],
                ['Resultado', `R$ ${fmt(totals.custo_por_kg)}/kg`],
            ],
        },
        sem_destino: {
            title: 'Transferências sem destino',
            source,
            formula: 'Soma das quantidades transferidas que não encontraram entrada correspondente.',
            values: [['Resultado', `${fmt(totals.qtd_transferencia_sem_destino, 0)} peixes`]],
            components: tankTotalComponents(rows, 'qtd_transferencia_sem_destino', ' peixes', 0),
        },
    };
    return map[key];
}

function kpi(label, value, sub = '', tone = '', explanation = null) {
    const attrs = explanation ? calculationTooltipAttributes(explanation) : '';
    return `<div class="kpi-card ${tone}" ${attrs}><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
}

function renderKpis() {
    const t = fechamentoMode === 'planilha' ? fechamentoData.totais_planilha : fechamentoData.totais_rastreados;
    const rows = fechamentoData.porTanque || [];
    const cards = fechamentoMode === 'planilha'
        ? [
            kpi('Tanques de origem', fmt(t.tanques, 0), '', '', planKpiExplanation('tanques', t, rows)),
            kpi('Quantidade inicial', fmt(t.qtd_inicial_total, 0), '', '', planKpiExplanation('qtd_inicial', t, rows)),
            kpi('Saldo final', fmt(t.saldo_final_total, 0), '', '', planKpiExplanation('saldo_final', t, rows)),
            kpi('Quebra', `${fmt(t.quebra_pct)}%`, `${fmt(t.mortalidade_total + t.correcao_total, 0)} peixes`, 'tone-warning', planKpiExplanation('quebra', t, rows)),
            kpi('Biomassa final', `${fmt(t.bio_final_total)} kg`, '', '', planKpiExplanation('bio_final', t, rows)),
            kpi('Ração total', `${fmt(t.racao_total)} kg`, '', '', planKpiExplanation('racao', t, rows)),
            kpi('C.A. do lote', fmt(t.ca_real), '', t.ca_real > 2 ? 'tone-warning' : 'tone-success', planKpiExplanation('ca', t, rows)),
            kpi('Peso médio final', `${fmt(t.pm_saida_medio_g)} g`, '', '', planKpiExplanation('pm_final', t, rows)),
            kpi('GPD médio', `${fmt(t.gpd_medio)} g/dia`, '', '', planKpiExplanation('gpd', t, rows)),
            kpi('Sobrevivência média', `${fmt(t.sobrevivencia_media)}%`, '', 'tone-success', planKpiExplanation('sobrevivencia', t, rows)),
            kpi('Dias médios', fmt(t.dias_medio, 0), '', '', planKpiExplanation('dias', t, rows)),
            kpi('Correção de saldo', fmt(t.correcao_total, 0), '', 'tone-warning', planKpiExplanation('correcao', t, rows)),
        ]
        : [
            kpi('Ciclos rastreados', fmt(t.ciclos_rastreados, 0), '', '', traceKpiExplanation('ciclos', t, rows)),
            kpi('Quantidade vendida', fmt(t.qtd_vendida_total, 0), '', '', traceKpiExplanation('qtd_vendida', t, rows)),
            kpi('Biomassa vendida', `${fmt(t.bio_vendida_total)} kg`, '', '', traceKpiExplanation('bio_vendida', t, rows)),
            kpi('Ração rateada', `${fmt(t.racao_total)} kg`, '', '', traceKpiExplanation('racao', t, rows)),
            kpi('C.A. rastreada', fmt(t.ca_real), '', t.ca_real > 2 ? 'tone-warning' : 'tone-success', traceKpiExplanation('ca', t, rows)),
            kpi('Peso médio de venda', `${fmt(t.pm_saida_medio_g)} g`, '', '', traceKpiExplanation('pm', t, rows)),
            kpi('Sobrevivência comercial', `${fmt(t.sobrevivencia_comercial)}%`, '', 'tone-success', traceKpiExplanation('sobrevivencia', t, rows)),
            kpi('Cobertura do rastreio', `${fmt(t.cobertura_rastreio)}%`, '', t.cobertura_rastreio < 90 ? 'tone-warning' : '', traceKpiExplanation('cobertura', t, rows)),
            kpi('Custo da ração', `R$ ${fmt(t.custo_racao_total)}`, '', '', traceKpiExplanation('custo_racao', t, rows)),
            kpi('Custo total estimado', `R$ ${fmt(t.custo_total)}`, '', '', traceKpiExplanation('custo_total', t, rows)),
            kpi('Custo por kg', `R$ ${fmt(t.custo_por_kg)}`, '', 'tone-accent', traceKpiExplanation('custo_kg', t, rows)),
            kpi('Transferência sem destino', fmt(t.qtd_transferencia_sem_destino, 0), '', t.qtd_transferencia_sem_destino ? 'tone-danger' : '', traceKpiExplanation('sem_destino', t, rows)),
        ];
    fechamentoKpis.innerHTML = cards.join('');
    fechamentoKpis.hidden = false;
}

function renderDiagnostics() {
    const d = fechamentoData.diagnostico;
    const pct = d.transferencias ? d.transferencias_resolvidas / d.transferencias * 100 : 100;
    const healthy = d.transferencias_sem_destino === 0
        && d.composicoes_acima_de_105_pct === 0
        && d.pm_ponderado_cobertura_baixa === 0;
    fechamentoDiagnostic.className = `diagnostic-summary ${healthy ? 'diagnostic-ok' : 'diagnostic-warn'}`;
    fechamentoDiagnostic.innerHTML = `
        <span class="diagnostic-dot"></span>
        <strong>${fmt(pct, 0)}% das transferências resolvidas</strong>
        <span>${fmt(d.transferencias_resolvidas, 0)} de ${fmt(d.transferencias, 0)}</span>
        ${d.transferencias_sem_destino ? `<span>${fmt(d.transferencias_sem_destino, 0)} sem destino</span>` : ''}
        ${d.pm_ponderado_cobertura_baixa ? `<span>${fmt(d.pm_ponderado_cobertura_baixa, 0)} PMs com base parcial</span>` : ''}
    `;
    fechamentoDiagnostic.hidden = false;
}

function supplierCellExplanation(row, key, supplierRows) {
    if (key === 'fornecedor') {
        return {
            title: `Fornecedor ${row.fornecedor}`,
            source: `Tanques de origem de ${fechamentoData.lote}`,
            formula: 'Agrupa os tanques pelo fornecedor registrado no povoamento inicial.',
            values: [['Tanques encontrados', fmt(row.tanques, 0)]],
        };
    }

    const kpiKeyByColumn = {
        tanques: 'tanques',
        povoado: 'qtd_inicial',
        ca: 'ca',
        pm_final: 'pm_final',
        gpd: 'gpd',
        sobrevivencia: 'sobrevivencia',
        quebra: 'quebra',
    };
    const labels = {
        tanques: 'Tanques',
        povoado: 'Quantidade inicial',
        ca: 'C.A.',
        pm_final: 'Peso médio final',
        gpd: 'GPD médio',
        sobrevivencia: 'Sobrevivência',
        quebra: 'Quebra',
    };
    const explanation = planKpiExplanation(kpiKeyByColumn[key], row, supplierRows);
    return {
        ...explanation,
        title: `${labels[key]} de ${row.fornecedor}`,
        source: `Consolidação de ${fmt(supplierRows.length, 0)} tanques deste fornecedor em ${fechamentoData.lote}`,
    };
}

function renderSuppliers() {
    const rows = fechamentoData.fornecedores || [];
    if (!rows.length) { fechamentoSuppliersSection.hidden = true; return; }
    let html = '<table><thead><tr><th>Fornecedor</th><th>Tanques</th><th>Povoado</th><th>C.A.</th><th>PM final</th><th>GPD</th><th>Sobrevivência</th><th>Quebra</th></tr></thead><tbody>';
    rows.forEach(row => {
        const supplierRows = (fechamentoData.porTanque || [])
            .filter(item => item.fornecedor === row.fornecedor);
        const cell = (key, value) => (
            `<td ${calculationTooltipAttributes(supplierCellExplanation(row, key, supplierRows))}>${value}</td>`
        );
        html += `<tr>
            ${cell('fornecedor', escapeHtml(row.fornecedor))}
            ${cell('tanques', fmt(row.tanques, 0))}
            ${cell('povoado', fmt(row.qtd_inicial_total, 0))}
            ${cell('ca', fmt(row.ca_real))}
            ${cell('pm_final', `${fmt(row.pm_saida_medio_g)} g`)}
            ${cell('gpd', `${fmt(row.gpd_medio)} g/dia`)}
            ${cell('sobrevivencia', `${fmt(row.sobrevivencia_media)}%`)}
            ${cell('quebra', `${fmt(row.quebra_pct)}%`)}
        </tr>`;
    });
    html += '</tbody></table>';
    fechamentoSuppliers.innerHTML = html;
    fechamentoSuppliersSection.hidden = false;
}

function formatFechamentoCell(row, column) {
    const value = row[column.key];
    if (column.type === 'date') return escapeHtml(fmtDate(value));
    if (column.type === 'text') return escapeHtml(value || '-');
    if (column.type === 'list') return escapeHtml(Array.isArray(value) && value.length ? value.join(', ') : '-');
    if (column.type === 'money') return value === null || value === undefined ? '-' : `R$ ${fmt(value)}`;
    if (column.type === 'weighted-pm') return value === null || value === undefined ? '-' : fmt(value);
    if (column.type === 'loss-total') return value === null || value === undefined ? '-' : fmt(value, 0);
    if (column.type === 'method') {
        const badgeClass = value === 'Fechamento direto' ? 'badge-ok' : 'badge-neutral';
        return `<span class="badge ${badgeClass}">${escapeHtml(value)}</span>`;
    }
    if (column.type === 'trace') {
        const badgeClass = value === 'Completo' ? 'badge-ok' : value === 'Revisar conciliação' ? 'badge-warn' : 'badge-danger';
        return `<span class="badge ${badgeClass}">${escapeHtml(value)}</span>`;
    }
    if (column.type === 'confidence') {
        const badgeClass = value === 'Alta' ? 'badge-ok' : value === 'Média' ? 'badge-warn' : 'badge-danger';
        return `<span class="badge ${badgeClass}">${escapeHtml(value)}</span>`;
    }
    return fmt(value, column.decimals ?? 2);
}

function renderFechamentoTable() {
    const rows = fechamentoData.porTanque || [];
    const columns = fechamentoMode === 'planilha' ? PLAN_COLS : TRACE_COLS;
    fechamentoRowCount.textContent = `${fmt(rows.length, 0)} tanques`;
    if (!rows.length) {
        fechamentoWrapper.innerHTML = '<div class="welcome-message"><p>Nenhum tanque encontrado.</p></div>';
        return;
    }

    let html = '<table><thead><tr>';
    columns.forEach(column => { html += `<th>${column.label}</th>`; });
    html += '</tr></thead><tbody>';
    rows.forEach(row => {
        html += '<tr>';
        columns.forEach(column => {
            const explanation = fechamentoMode === 'planilha'
                ? planCellExplanation(row, column)
                : traceCellExplanation(row, column);
            html += `<td ${calculationTooltipAttributes(explanation)}>${formatFechamentoCell(row, column)}</td>`;
        });
        html += '</tr>';
    });
    html += '</tbody></table>';
    fechamentoWrapper.style.display = 'block';
    fechamentoWrapper.innerHTML = html;
    requestAnimationFrame(fitFechamentoTableToViewport);
}

function renderFechamento() {
    resetCalculationTooltips();
    renderDiagnostics();
    renderKpis();
    renderSuppliers();
    renderFechamentoTable();
}

function setFechamentoMode(mode) {
    fechamentoMode = mode;
    fechamentoModePlan.classList.toggle('active', mode === 'planilha');
    fechamentoModeTrace.classList.toggle('active', mode === 'rastreado');
    if (fechamentoData) {
        resetCalculationTooltips();
        renderKpis();
        renderFechamentoTable();
    }
}

function csvCell(value) {
    const text = Array.isArray(value) ? value.join(', ') : String(value ?? '');
    return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportFechamentoCSV() {
    if (!fechamentoData) { showToast('Gere o fechamento primeiro', 'error'); return; }
    const columns = fechamentoMode === 'planilha' ? PLAN_COLS : TRACE_COLS;
    const headers = columns.map(column => csvCell(column.label)).join(';');
    const lines = fechamentoData.porTanque.map(row => columns.map(column => csvCell(row[column.key])).join(';'));
    const csv = '\uFEFF' + [headers, ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const anchor = document.createElement('a');
    const url = URL.createObjectURL(blob);
    anchor.href = url;
    anchor.download = `fechamento_${fechamentoData.lote.replace(/\s+/g, '_')}_${fechamentoMode}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
}

fechamentoRunBtn.onclick = gerarFechamento;
fechamentoExport.onclick = exportFechamentoCSV;
fechamentoModePlan.onclick = () => setFechamentoMode('planilha');
fechamentoModeTrace.onclick = () => setFechamentoMode('rastreado');
logoutBtn.onclick = async () => {
    logoutBtn.disabled = true;
    logoutBtn.textContent = 'Saindo...';
    try {
        const response = await fetch('/api/auth/logout', { method: 'POST' });
        if (!response.ok && response.status !== 401) {
            throw new Error('Não foi possível encerrar a sessão.');
        }
        window.location.replace('/login');
    } catch (error) {
        logoutBtn.disabled = false;
        logoutBtn.textContent = 'Sair';
        showToast(error.message, 'error');
    }
};

init();
