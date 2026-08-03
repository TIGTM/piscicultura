const form = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const showPassword = document.getElementById('show-password');
const submitButton = document.getElementById('login-button');
const errorBox = document.getElementById('login-error');

function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
}

function safeDestination() {
    const destination = new URLSearchParams(window.location.search).get('next');
    return destination && destination.startsWith('/') && !destination.startsWith('//')
        ? destination
        : '/';
}

showPassword.addEventListener('change', () => {
    passwordInput.type = showPassword.checked ? 'text' : 'password';
});

form.addEventListener('submit', async event => {
    event.preventDefault();
    errorBox.hidden = true;

    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) {
        showError('Informe o usuário e a senha.');
        return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Entrando...';
    form.setAttribute('aria-busy', 'true');

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Não foi possível entrar.');
        window.location.replace(data.mustChange ? '/change-password' : safeDestination());
    } catch (error) {
        showError(error.message);
        passwordInput.focus();
        passwordInput.select();
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Entrar';
        form.removeAttribute('aria-busy');
    }
});
