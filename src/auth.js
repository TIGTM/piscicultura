import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_COOKIE = 'iefish_session';
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

function credentialHash(value) {
    return createHash('sha256').update(String(value ?? '')).digest();
}

function credentialsMatch(received, expected) {
    return timingSafeEqual(credentialHash(received), credentialHash(expected));
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
    username = 'teste',
    password = 'teste',
    sessionTtlMs = DEFAULT_SESSION_TTL_MS,
} = {}) {
    const sessions = new Map();
    const loginAttempts = new Map();

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
        const valid = credentialsMatch(receivedUsername, username)
            && credentialsMatch(receivedPassword, password);

        if (!valid) {
            recordFailedLogin(req);
            return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
        }

        loginAttempts.delete(requestKey(req));
        const existing = sessionFromRequest(req);
        if (existing) sessions.delete(existing.token);

        const token = randomBytes(32).toString('base64url');
        const session = {
            username,
            createdAt: Date.now(),
            expiresAt: Date.now() + sessionTtlMs,
        };
        sessions.set(token, session);
        res.cookie(SESSION_COOKIE, token, cookieOptions(req));
        return res.json({ authenticated: true, username: session.username });
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
            expiresAt: new Date(current.session.expiresAt).toISOString(),
        });
    }

    function requireAuth(req, res, next) {
        const current = sessionFromRequest(req);
        if (current) {
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
        logout,
        session,
        requireAuth,
        redirectAuthenticated,
        dispose,
    };
}
