module.exports = {
    apps: [
        {
            name: 'piscicultura',
            cwd: __dirname,
            script: 'src/index.js',
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            watch: false,
            max_memory_restart: '512M',
            env: {
                NODE_ENV: 'production',
                HOST: '127.0.0.1',
                PORT: 3025,
            },
        },
    ],
};
