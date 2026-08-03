import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDB } from './db.js';
import dotenv from 'dotenv';
import { getFechamento, listLotesFechamento } from './fechamento-repository.js';
import { createAuth } from './auth.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;
const host = process.env.HOST || '127.0.0.1';
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const configuredSessionHours = Number(process.env.APP_SESSION_HOURS);
const sessionHours = Number.isFinite(configuredSessionHours) && configuredSessionHours > 0
    ? configuredSessionHours
    : 12;
const auth = createAuth({
    users: [
        { username: 'Pedro', password: '123456', mustChange: true },
        { username: 'Matheus', password: '123456', mustChange: true },
    ],
    userStorePath: process.env.AUTH_USERS_FILE || path.resolve(process.cwd(), 'data', 'auth-users.json'),
    sessionTtlMs: sessionHours * 60 * 60 * 1000,
});

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));

app.get(['/login', '/login.html'], auth.redirectAuthenticated, (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'login.html'));
});
app.get('/login.css', (_req, res) => res.sendFile(path.join(publicDir, 'login.css')));
app.get('/login.js', (_req, res) => res.sendFile(path.join(publicDir, 'login.js')));
app.post('/api/auth/login', auth.login);
app.post('/api/auth/logout', auth.logout);
app.get('/api/auth/session', auth.session);
app.get('/change-password.css', (_req, res) => res.sendFile(path.join(publicDir, 'change-password.css')));
app.get('/change-password.js', (_req, res) => res.sendFile(path.join(publicDir, 'change-password.js')));
app.get('/change-password', auth.requireAuth, (req, res) => {
    if (!req.auth.mustChange) return res.redirect('/');
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'change-password.html'));
});
app.post('/api/auth/change-password', auth.changePassword);

app.use(auth.requireAuth);
app.use(express.static(publicDir));

const VIEWS = {
    visaogeral: { name: 'ies_TempDash_vwvisaogeral_CACHE', label: 'Visão Geral - Lotes' },
    insumos: { name: 'ies_TempDash_vwinsumosracaotanque_CACHE', label: 'Insumos Ração - Tanque' },
    previsto: { name: 'ies_TempDash_vwprevistoxrealizado_CACHE', label: 'Ração Previsto x Realizado' },
    entradas: { name: 'ies_TempDash_vwentradaslote_CACHE', label: 'Entradas Lote' },
    saidas: { name: 'ies_TempDash_vwrelatsaidaslote_CACHE', label: 'Saídas Lote' }
};

const SAFE_COL = /^[a-zA-Z0-9_]+$/;
const VALID_OPS = ['=', '!=', '<', '>', '<=', '>=', 'LIKE', 'NOT LIKE'];

app.get('/api/view/:name', async (req, res) => {
    const viewKey = req.params.name;
    const view = VIEWS[viewKey];

    if (!view) return res.status(404).json({ error: 'View not found' });

    const limit = Math.min(Math.max(parseInt(req.query.limit) || 500, 1), 5000);
    const orderBy = req.query.orderBy && SAFE_COL.test(req.query.orderBy) ? req.query.orderBy : null;
    const orderDir = req.query.orderDir === 'DESC' ? 'DESC' : 'ASC';

    let rawFilters = [];
    try { if (req.query.filters) rawFilters = JSON.parse(req.query.filters); } catch {}

    const params = [];
    const whereClauses = rawFilters
        .filter(f => f.col && SAFE_COL.test(f.col) && VALID_OPS.includes(f.op) && f.val !== undefined && f.val !== '')
        .map(f => { params.push(f.val); return `\`${f.col}\` ${f.op} ?`; });

    let sql = `SELECT * FROM \`${view.name}\``;
    if (whereClauses.length) sql += ` WHERE ${whereClauses.join(' AND ')}`;
    if (orderBy) sql += ` ORDER BY \`${orderBy}\` ${orderDir}`;
    sql += ` LIMIT ?`;
    params.push(limit);

    try {
        const pool = await connectDB();
        const [rows] = await pool.query(sql, params);
        res.json({ data: rows, total: rows.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/views', (req, res) => {
    res.json(Object.keys(VIEWS).map(key => ({
        id: key,
        name: VIEWS[key].name,
        label: VIEWS[key].label
    })));
});

// Raw SELECT-only query endpoint
const VIEW_NAMES = Object.values(VIEWS).map(v => v.name);
const BLOCKED = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE|EXEC|EXECUTE|CALL|LOAD|OUTFILE|DUMPFILE)\b/i;

app.post('/api/query', async (req, res) => {
    const { sql } = req.body || {};
    if (!sql || typeof sql !== 'string') return res.status(400).json({ error: 'SQL não informado.' });

    const clean = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();

    if (!clean.toUpperCase().startsWith('SELECT')) {
        return res.status(400).json({ error: 'Somente instruções SELECT são permitidas.' });
    }
    if (BLOCKED.test(clean)) {
        return res.status(400).json({ error: 'A query contém instrução não permitida.' });
    }
    // Block multiple statements
    const withoutStrings = clean.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
    if ((withoutStrings.match(/;/g) || []).length > 1 || (withoutStrings.endsWith(';') && withoutStrings.indexOf(';') < withoutStrings.length - 1)) {
        return res.status(400).json({ error: 'Múltiplos statements não são permitidos.' });
    }

    try {
        const pool = await connectDB();
        const start = Date.now();
        const [rows, fields] = await pool.query(clean);
        const elapsed = Date.now() - start;
        res.json({ data: rows, total: rows.length, elapsed });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/lotes-fechamento', async (_req, res) => {
    try {
        const pool = await connectDB();
        res.json(await listLotesFechamento(pool));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Compatibilidade com a interface anterior. Agora o identificador confiável é o lote.
app.get('/api/grupos', async (_req, res) => {
    try {
        const pool = await connectDB();
        const lotes = await listLotesFechamento(pool);
        res.json(lotes.map(item => ({
            grupo: item.lote,
            lote_nome: item.lote,
            data_inicio: item.data_inicio,
            tanques_origem: item.tanques_origem,
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

async function sendFechamento(req, res, lote) {
    if (!lote || typeof lote !== 'string' || lote.length > 80) {
        return res.status(400).json({ error: 'Lote inválido.' });
    }
    try {
        const pool = await connectDB();
        const fechamento = await getFechamento(pool, lote, { refresh: req.query.refresh === '1' });
        return res.json(fechamento);
    } catch (err) {
        const status = err.message.startsWith('Nenhum tanque') ? 404 : 500;
        return res.status(status).json({ error: err.message });
    }
}

app.get('/api/fechamento', (req, res) => sendFechamento(req, res, req.query.lote));

app.get('/api/fechamento/:identificador', async (req, res) => {
    const identificador = req.params.identificador;
    if (/^Lote\s/i.test(identificador)) return sendFechamento(req, res, identificador);

    try {
        const pool = await connectDB();
        const [rows] = await pool.query(`
            SELECT MIN(Lote) AS lote
            FROM ies_TempDash_vwvisaogeral_CACHE
            WHERE \`Grupo Origem\` = ?
        `, [identificador]);
        return sendFechamento(req, res, rows[0]?.lote);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

const server = app.listen(port, host, () => {
    console.log(`Server running at http://${host}:${port}`);
});
server.ref();
