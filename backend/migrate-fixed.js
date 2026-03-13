const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');

const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'peter368', // CHANGE TO YOUR PASSWORD
    database: 'food_delivery_db'
});

connection.connect();

// Read JSON file
const jsonPath = path.join(__dirname, 'database', 'users.json');
const jsonData = fs.readFileSync(jsonPath, 'utf8');
const data = JSON.parse(jsonData);

console.log('Migrating users...');

// Insert each user WITHOUT specifying ID (let MySQL auto-generate)
data.users.forEach(user => {
    const query = 'INSERT INTO users (name, email, password, phone, address, created_at) VALUES (?, ?, ?, ?, ?, ?)';
    connection.query(query, 
        [user.name, user.email, user.password, user.phone, user.address, new Date(user.createdAt)],
        function(err, result) {
            if (err) {
                console.log('❌ Error for', user.email, ':', err.message);
            } else {
                console.log('✅ Migrated:', user.email, 'with new ID:', result.insertId);
            }
        }
    );
});

setTimeout(() => {
    connection.end();
    console.log('Migration completed!');
}, 1000);