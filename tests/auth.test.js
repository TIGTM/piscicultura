import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createAuth } from '../src/auth.js';

function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server));
    });
}

test('protege a API durante login, sessão e logout', async t => {
    const auth = createAuth({
        username: 'teste',
        password: 'teste',
        sessionTtlMs: 60_000,
    });
    t.after(() => auth.dispose());
    const app = express();
    app.use(express.json());
    app.post('/api/auth/login', auth.login);
    app.post('/api/auth/logout', auth.logout);
    app.get('/api/auth/session', auth.session);
    app.use(auth.requireAuth);
    app.get('/api/private', (_req, res) => res.json({ protected: true }));

    const server = await listen(app);
    t.after(() => new Promise(resolve => server.close(resolve)));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const blocked = await fetch(`${baseUrl}/api/private`, { redirect: 'manual' });
    assert.equal(blocked.status, 401);

    const invalid = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'teste', password: 'errada' }),
    });
    assert.equal(invalid.status, 401);
    assert.equal(invalid.headers.get('set-cookie'), null);

    const valid = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'teste', password: 'teste' }),
    });
    assert.equal(valid.status, 200);
    const setCookie = valid.headers.get('set-cookie');
    assert.match(setCookie, /^iefish_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    const cookie = setCookie.split(';')[0];

    const session = await fetch(`${baseUrl}/api/auth/session`, {
        headers: { Cookie: cookie },
    });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).username, 'teste');

    const allowed = await fetch(`${baseUrl}/api/private`, {
        headers: { Cookie: cookie },
    });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { protected: true });

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { Cookie: cookie },
    });
    assert.equal(logout.status, 204);

    const blockedAgain = await fetch(`${baseUrl}/api/private`, {
        headers: { Cookie: cookie },
    });
    assert.equal(blockedAgain.status, 401);
});
