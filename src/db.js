import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const config = {
    host: process.env.DB_SERVER,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || '3306'),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ssl: {
        rejectUnauthorized: false // Often needed for RDS/Lightsail
    }
};

let pool;

export async function connectDB() {
    try {
        if (!pool) {
            pool = mysql.createPool(config);
        }
        // Test connection
        const connection = await pool.getConnection();
        console.log('Connected to MySQL/MariaDB');
        connection.release();
        return pool;
    } catch (err) {
        console.error('Database connection failed:', err);
        throw err;
    }
}

export { mysql };
