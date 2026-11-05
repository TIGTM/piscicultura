export function calcularKpisGerais(totals) {
    const number = value => value === null || value === undefined || value === ''
        ? null : Number.isFinite(Number(value)) ? Number(value) : null;
    const initial = number(totals.qtd_inicial_total);
    const biomass = number(totals.bio_final_total);
    const weight = number(totals.pm_saida_medio_g);
    const measured = number(totals.mortalidade_total);
    const final = biomass !== null && biomass >= 0 && weight > 0 ? biomass * 1000 / weight : null;
    const unmeasured = initial !== null && measured !== null && final !== null
        ? initial - measured - final : null;
    const deaths = unmeasured === null ? null : measured + unmeasured;
    return {
        ...totals,
        qtd_final_kpi: final,
        mortalidade_apurada_kpi: measured,
        mortalidade_nao_apurada_kpi: unmeasured,
        mortalidade_total_kpi: deaths,
        sobrevivencia_fechamento_kpi: initial > 0 && deaths !== null
            ? (initial - deaths) / initial * 100 : null,
        quebra_kpi: initial > 0 && deaths !== null ? deaths / initial * 100 : null,
    };
}
