const form = document.getElementById('change-password-form');
const newPassword = document.getElementById('new-password');
const confirmPassword = document.getElementById('confirm-password');
const showPassword = document.getElementById('show-password');
const button = document.getElementById('change-button');
const errorBox = document.getElementById('change-error');

function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
}

showPassword.addEventListener('change', () => {
    const type = showPassword.checked ? 'text' : 'password';
    newPassword.type = type;
    confirmPassword.type = type;
});

form.addEventListener('submit', async event => {
    event.preventDefault();
    errorBox.hidden = true;
    if (newPassword.value.length < 6) return showError('A nova senha deve ter pelo menos 6 caracteres.');
    if (newPassword.value !== confirmPassword.value) return showError('As senhas não são iguais.');

    button.disabled = true;
    button.textContent = 'Salvando...';
    try {
        const response = await fetch('/api/auth/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newPassword: newPassword.value }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Não foi possível trocar a senha.');
        window.location.replace('/');
    } catch (error) {
        showError(error.message);
    } finally {
        button.disabled = false;
        button.textContent = 'Salvar nova senha';
    }
});
