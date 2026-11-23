// db.js - Conexión a MySQL (se comparte entre app.js e importar_pdfs.js)
// Local: usa los valores de abajo. En Render/nube: define las variables de entorno
// DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME y (si el proveedor lo exige) DB_SSL=true
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || "12345",
    database: process.env.DB_NAME || 'repositorio_inifap', // Apunta a la nueva base de datos
    charset: 'utf8mb4',
    // Los MySQL en la nube (Aiven, TiDB, Railway...) normalmente exigen conexión cifrada
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool;
