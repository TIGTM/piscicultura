import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const config = {
    host: process.env.DB_SERVER,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '3306'),
    ssl: {
        rejectUnauthorized: false
    }
};

async function test() {
    try {
        console.log('Connecting to server on port 3306...');
        const connection = await mysql.createConnection(config);
        console.log('Connection successful!');

        console.log('Listing databases...');
        const [rows] = await connection.query("SHOW DATABASES");
        console.log('Available databases:');
        console.table(rows);

        await connection.end();
    } catch (err) {
        console.error('Connection failed:', err.message);
    }
}

test();
