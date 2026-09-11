import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

test('somente o administrador cadastra novos usuários', async t => {
    const userStorePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'iefish-auth-')), 'users.json');
    const auth = createAuth({
        users: [
            { username: 'Silas', password: '123456', mustChange: false, role: 'admin' },
            { username: 'Pedro', password: '123456', mustChange: false },
        ],
        userStorePath,
        sessionTtlMs: 60_000,
    });
    t.after(() => auth.dispose());
    t.after(() => fs.rmSync(path.dirname(userStorePath), { recursive: true, force: true }));

    const app = express();
    app.use(express.json());
    app.post('/api/auth/login', auth.login);
    app.use(auth.requireAuth);
    app.get('/api/admin/users', auth.requireAdmin, auth.listUsers);
    app.post('/api/admin/users', auth.requireAdmin, auth.createUser);
    const server = await listen(app);
    t.after(() => new Promise(resolve => server.close(resolve)));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    async function login(username) {
        const response = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password: '123456' }),
        });
        return response.headers.get('set-cookie').split(';')[0];
    }

    const pedroCookie = await login('Pedro');
    const denied = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: pedroCookie } });
    assert.equal(denied.status, 403);

    const silasCookie = await login('Silas');
    const created = await fetch(`${baseUrl}/api/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: silasCookie },
        body: JSON.stringify({ username: 'Ana', password: '123456' }),
    });
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { username: 'Ana', mustChange: true, isAdmin: false });

    const users = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: silasCookie } });
    assert.equal(users.status, 200);
    assert.deepEqual((await users.json()).users.map(user => user.username), ['Ana', 'Pedro', 'Silas']);
});
