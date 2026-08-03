import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SESSION_COOKIE = 'iefish_session';
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

function credentialHash(value) {
    return createHash('sha256').update(String(value ?? '')).digest();
}

function passwordHashMatches(received, storedHash) {
    const receivedHash = credentialHash(received);
    const expectedHash = Buffer.from(storedHash, 'hex');
    return expectedHash.length === receivedHash.length && timingSafeEqual(receivedHash, expectedHash);
}

function parseCookies(header = '') {
    return header.split(';').reduce((cookies, part) => {
        const separator = part.indexOf('=');
        if (separator < 0) return cookies;
        const name = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();
        if (!name) return cookies;
        try {
            cookies[name] = decodeURIComponent(value);
        } catch {
            cookies[name] = value;
        }
        return cookies;
    }, {});
}

function requestKey(req) {
    return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function createAuth({
    username,
    password,
    users,
    userStorePath = path.resolve(process.cwd(), 'data', 'auth-users.json'),
    sessionTtlMs = DEFAULT_SESSION_TTL_MS,
} = {}) {
    const sessions = new Map();
    const loginAttempts = new Map();
    const configuredUsers = users?.length
        ? users
        : [{ username: username || 'teste', password: password || 'teste', mustChange: false }];
    const userStore = new Map();

    try {
        const savedUsers = JSON.parse(fs.readFileSync(userStorePath, 'utf8'));
        for (const [savedUsername, savedUser] of Object.entries(savedUsers)) {
            if (savedUser?.passwordHash) userStore.set(savedUsername.toLowerCase(), savedUser);
        }
    } catch {
        // A new installation starts with the configured initial passwords.
    }

    for (const configuredUser of configuredUsers) {
        const key = String(configuredUser.username).trim().toLowerCase();
        if (!key) continue;
        if (!userStore.has(key)) {
            userStore.set(key, {
                username: String(configuredUser.username).trim(),
                passwordHash: credentialHash(configuredUser.password).toString('hex'),
                mustChange: configuredUser.mustChange ?? true,
            });
        }
    }

    function persistUsers() {
        const directory = path.dirname(userStorePath);
        fs.mkdirSync(directory, { recursive: true });
        const temporaryPath = `${userStorePath}.tmp`;
        const data = Object.fromEntries(userStore);
        fs.writeFileSync(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
        fs.renameSync(temporaryPath, userStorePath);
    }

    function sessionFromRequest(req) {
        const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
        if (!token) return null;
        const session = sessions.get(token);
        if (!session) return null;
        if (session.expiresAt <= Date.now()) {
            sessions.delete(token);
            return null;
        }
        return { token, session };
    }

    function cookieOptions(req) {
        return {
            httpOnly: true,
            sameSite: 'strict',
            secure: req.secure,
            maxAge: sessionTtlMs,
            path: '/',
        };
    }

    function isRateLimited(req) {
        const key = requestKey(req);
        const attempt = loginAttempts.get(key);
        if (!attempt) return false;
        if (Date.now() - attempt.startedAt >= LOGIN_WINDOW_MS) {
            loginAttempts.delete(key);
            return false;
        }
        return attempt.count >= MAX_LOGIN_ATTEMPTS;
    }

    function recordFailedLogin(req) {
        const key = requestKey(req);
        const current = loginAttempts.get(key);
        if (!current || Date.now() - current.startedAt >= LOGIN_WINDOW_MS) {
            loginAttempts.set(key, { count: 1, startedAt: Date.now() });
            return;
        }
        current.count += 1;
    }

    function login(req, res) {
        res.set('Cache-Control', 'no-store');
        if (isRateLimited(req)) {
            return res.status(429).json({
                error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.',
            });
        }

        const receivedUsername = req.body?.username;
        const receivedPassword = req.body?.password;
        const user = userStore.get(String(receivedUsername || '').trim().toLowerCase());
        const valid = Boolean(user)
            && passwordHashMatches(receivedPassword, user.passwordHash);

        if (!valid) {
            recordFailedLogin(req);
            return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
        }

        loginAttempts.delete(requestKey(req));
        const existing = sessionFromRequest(req);
        if (existing) sessions.delete(existing.token);

        const token = randomBytes(32).toString('base64url');
        const session = {
            username: user.username,
            mustChange: user.mustChange,
            createdAt: Date.now(),
            expiresAt: Date.now() + sessionTtlMs,
        };
        sessions.set(token, session);
        res.cookie(SESSION_COOKIE, token, cookieOptions(req));
        return res.json({ authenticated: true, username: session.username, mustChange: session.mustChange });
    }

    function changePassword(req, res) {
        res.set('Cache-Control', 'no-store');
        const current = sessionFromRequest(req);
        if (!current) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });

        const newPassword = String(req.body?.newPassword || '');
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
        }

        const key = current.session.username.toLowerCase();
        const user = userStore.get(key);
        if (!user) return res.status(401).json({ error: 'Usuário não encontrado.' });

        user.passwordHash = credentialHash(newPassword).toString('hex');
        user.mustChange = false;
        persistUsers();
        current.session.mustChange = false;
        return res.json({ authenticated: true, username: current.session.username, mustChange: false });
    }

    function logout(req, res) {
        res.set('Cache-Control', 'no-store');
        const current = sessionFromRequest(req);
        if (current) sessions.delete(current.token);
        res.clearCookie(SESSION_COOKIE, {
            httpOnly: true,
            sameSite: 'strict',
            secure: req.secure,
            path: '/',
        });
        return res.status(204).end();
    }

    function session(req, res) {
        res.set('Cache-Control', 'no-store');
        const current = sessionFromRequest(req);
        if (!current) return res.status(401).json({ authenticated: false });
        return res.json({
            authenticated: true,
            username: current.session.username,
            mustChange: current.session.mustChange,
            expiresAt: new Date(current.session.expiresAt).toISOString(),
        });
    }

    function requireAuth(req, res, next) {
        const current = sessionFromRequest(req);
        if (current) {
            if (current.session.mustChange && !req.path.startsWith('/change-password')) {
                if (req.originalUrl.startsWith('/api/')) {
                    return res.status(403).json({ error: 'PASSWORD_CHANGE_REQUIRED' });
                }
                return res.redirect(302, '/change-password');
            }
            res.set('Cache-Control', 'no-store');
            req.auth = current.session;
            return next();
        }

        if (req.originalUrl.startsWith('/api/')) {
            return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
        }

        const nextPath = req.originalUrl !== '/' ? `?next=${encodeURIComponent(req.originalUrl)}` : '';
        return res.redirect(302, `/login${nextPath}`);
    }

    function redirectAuthenticated(req, res, next) {
        return sessionFromRequest(req) ? res.redirect(302, '/') : next();
    }

    const cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [token, sessionData] of sessions) {
            if (sessionData.expiresAt <= now) sessions.delete(token);
        }
        for (const [key, attempt] of loginAttempts) {
            if (now - attempt.startedAt >= LOGIN_WINDOW_MS) loginAttempts.delete(key);
        }
    }, 15 * 60 * 1000);

    function dispose() {
        clearInterval(cleanupTimer);
        sessions.clear();
        loginAttempts.clear();
    }

    return {
        login,
        changePassword,
        logout,
        session,
        requireAuth,
        redirectAuthenticated,
        dispose,
    };
}
