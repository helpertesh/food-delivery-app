const mysql = require('mysql2');
const bcrypt = require('bcryptjs');

// Database connection
const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'peter368', // Change if needed
    database: 'food_delivery_db'
});

connection.connect(function(err) {
    if (err) {
        console.error('❌ Connection Error:', err.message);
        return;
    }
    
    console.log('✅ Connected to database!\n');
    
    // Check if user exists
    const email = 'collins@gmail.com'; // Change this to the email you're trying to login with
    
    connection.query(
        'SELECT id, name, email, password FROM users WHERE email = ?',
        [email],
        async function(err, results) {
            if (err) {
                console.error('❌ Error:', err.message);
                connection.end();
                return;
            }
            
            if (results.length === 0) {
                console.log(`❌ User with email "${email}" NOT FOUND in database.\n`);
                console.log('💡 Solution: Sign up first at http://localhost:3000/signup.html');
                connection.end();
                return;
            }
            
            const user = results[0];
            console.log(`✅ User found: ${user.name} (ID: ${user.id})`);
            console.log(`📧 Email: ${user.email}\n`);
            
            // Check if password is hashed
            const passwordHash = user.password;
            const isHashed = passwordHash.startsWith('$2a$') || passwordHash.startsWith('$2b$') || passwordHash.startsWith('$2y$');
            
            if (isHashed) {
                console.log('✅ Password is properly hashed');
                console.log(`🔐 Hash: ${passwordHash.substring(0, 20)}...`);
                console.log('\n💡 If login still fails, the password you\'re entering doesn\'t match.');
                console.log('   Make sure you\'re using the same password you used when signing up.');
            } else {
                console.log('❌ Password is NOT hashed! This is the problem.');
                console.log(`🔐 Current value: ${passwordHash}`);
                console.log('\n💡 Solution: You need to hash the password.');
                console.log('   Enter the password you want to use:');
                
                // For manual hashing, you can use this:
                console.log('\n📝 To hash a password, create a file hash-password.js and run it.');
            }
            
            connection.end();
        }
    );
});

