const DEFAULT_BASE_URL = 'https://auth.iefishapp.com.br';
const REQUEST_INTERVAL_MS = 500;
const MAX_RATE_LIMIT_RETRIES = 4;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function required(name, value) {
    if (!value) throw new Error(`Configure a variável ${name} para usar a API IEFish.`);
    return value;
}

function parseTokenExpiry(token) {
    try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
        return Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
    } catch {
        return null;
    }
}

function isoToday() {
    return new Date().toISOString().slice(0, 10);
}

export class IefishApi {
    constructor({
        baseUrl = process.env.IEFISH_API_BASE_URL || DEFAULT_BASE_URL,
        company = process.env.IEFISH_API_COMPANY,
        username = process.env.IEFISH_API_USERNAME,
        password = process.env.IEFISH_API_PASSWORD,
        fetchImpl = fetch,
    } = {}) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.company = company;
        this.username = username;
        this.password = password;
        this.fetchImpl = fetchImpl;
        this.token = null;
        this.tokenExpiresAt = 0;
        this.nextRequestAt = 0;
    }

    async fetchJson(url, options) {
        for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
            const waitMs = Math.max(0, this.nextRequestAt - Date.now());
            this.nextRequestAt = Math.max(Date.now(), this.nextRequestAt) + REQUEST_INTERVAL_MS;
            if (waitMs) await sleep(waitMs);

            const response = await this.fetchImpl(url, options);
            const text = await response.text();
            const rateLimited = response.status === 429 || /rate exceeded/i.test(text);
            if (rateLimited && attempt < MAX_RATE_LIMIT_RETRIES) {
                await sleep(1000 * (attempt + 1));
                continue;
            }

            let payload;
            try {
                payload = text ? JSON.parse(text) : {};
            } catch {
                throw new Error(rateLimited
                    ? 'A API IEFish atingiu o limite de consultas. Tente novamente em alguns segundos.'
                    : 'A API IEFish retornou uma resposta inválida. Tente novamente.');
            }
            if (!response.ok || payload?.error) {
                throw new Error(payload?.error || payload?.message || `Falha ao consultar a API IEFish (${response.status}).`);
            }
            return payload;
        }
        throw new Error('A API IEFish atingiu o limite de consultas. Tente novamente em alguns segundos.');
    }

    async authenticate() {
        if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;

        const body = new URLSearchParams({
            company: required('IEFISH_API_COMPANY', this.company),
            u: required('IEFISH_API_USERNAME', this.username),
            p: required('IEFISH_API_PASSWORD', this.password),
        });
        const payload = await this.fetchJson(`${this.baseUrl}/authForm`, {
            method: 'POST',
            body,
        });
        if (!payload?.token) {
            throw new Error(payload?.message || payload?.error || 'Não foi possível autenticar na API IEFish.');
        }

        this.token = payload.token;
        this.tokenExpiresAt = parseTokenExpiry(payload.token) || Date.now() + 10 * 60_000;
        return this.token;
    }

    async request(path, { body, form = false } = {}) {
        const token = await this.authenticate();
        const headers = { Authorization: `Bearer ${token}` };
        let requestBody;
        if (body !== undefined) {
            if (form) {
                requestBody = new URLSearchParams(Object.entries(body)
                    .filter(([, value]) => value !== undefined && value !== null)
                    .map(([key, value]) => [key, String(value)]));
            } else {
                headers['Content-Type'] = 'application/json';
                requestBody = JSON.stringify(body);
            }
        }

        const payload = await this.fetchJson(`${this.baseUrl}${path}`, {
            method: 'POST',
            headers,
            body: requestBody,
        });
        return payload;
    }

    async searchOrigins() {
        const payload = await this.request('/tracability/search', { body: { mode: 'origin' } });
        return payload.data || [];
    }

    async cards(loteIds) {
        const payload = await this.request('/tracability/cards', { body: { loteIds: loteIds.map(String) } });
        return payload.cards || [];
    }

    async cardDetails(batchIds, roots) {
        return this.request('/tracability/cardDetails', {
            body: {
                batchIds: batchIds.map(String),
                roots: roots.map(String),
                mode: 'un',
                scope: 'origin',
            },
        });
    }

    async outputTypes() {
        const payload = await this.request('/saidas-lote/listtypes', { body: {}, form: true });
        return new Map((payload.data || []).map(item => [Number(item.tipo), item.tipo_descricao]));
    }

    async lotOutputs(loteIds, from, to = isoToday()) {
        const results = [];
        const ids = loteIds.map(String);
        for (let index = 0; index < ids.length; index += 100) {
            const idlote = ids.slice(index, index + 100).join(',');
            let fetchedForBatch = 0;
            for (let page = 1; ; page += 1) {
                const payload = await this.request('/saidas-lote/list', {
                    form: true,
                    body: { idlote, dt_from: from, dt_to: to, page },
                });
                const pageRows = payload.data || [];
                results.push(...pageRows);
                fetchedForBatch += pageRows.length;
                if ((payload.page_records || 0) < 300 || fetchedForBatch >= (payload.total_records || Infinity)) break;
            }
        }
        return results;
    }
}
