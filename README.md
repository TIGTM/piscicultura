# Piscicultura - Fechamento de Lotes

Aplicacao Node.js que consulta as views do IEFish e automatiza o fechamento
dos lotes da piscicultura.

## Requisitos

- Node.js 20 ou superior
- Acesso de leitura ao banco MySQL do IEFish

## Execucao local

1. Copie `.env.example` para `.env` e informe as credenciais locais.
2. Instale as dependencias com `npm ci`.
3. Inicie com `npm start`.
4. Acesse `http://127.0.0.1:3001`.

O acesso inicial usa os usuários `Pedro` e `Matheus`, ambos com a senha
temporária `123456`. No primeiro login, cada usuário deve criar sua própria
senha. As senhas alteradas ficam armazenadas como hash em
`data/auth-users.json`, que não faz parte do repositorio.

## Testes

```bash
npm test
```

## Producao

O processo e gerenciado pelo PM2 por meio de `ecosystem.config.cjs`. A
aplicacao deve escutar apenas em uma porta local e ser publicada por um proxy
reverso com HTTPS.

As credenciais do banco e do login ficam somente no arquivo `.env` do
servidor. Planilhas, transcricoes e outros dados operacionais nao fazem parte
do repositorio.
