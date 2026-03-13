# 🔍 Login Problem - Step-by-Step Debugging Guide

## Understanding the Problem

When you see "Invalid email or password", it could mean:
1. ❌ The email doesn't exist in the database
2. ❌ The password doesn't match (wrong password)
3. ❌ The password in database is not properly hashed

Let's debug this step by step!

---

## Step 1: Check if the User Exists in Database

### What to do:
1. Open **MySQL Workbench**
2. Connect to your database
3. Select the `food_delivery_db` database
4. Run this query:

```sql
SELECT id, name, email, phone FROM users WHERE email = 'collins@gmail.com';
```

### What to check:
- ✅ **If you see a row**: User exists, go to Step 2
- ❌ **If no rows**: User doesn't exist, go to Step 4 (Create User)

---

## Step 2: Check the Password in Database

### What to do:
Run this query in MySQL Workbench:

```sql
SELECT id, name, email, password FROM users WHERE email = 'collins@gmail.com';
```

### What to look for:
- The `password` field should look like: `$2a$10$...` (a long hash starting with $2a$)
- ❌ **If it looks like plain text** (e.g., "password123"): Password is NOT hashed - this is the problem!

---

## Step 3: Check Server Console Logs

### What to do:
1. Look at the terminal/command prompt where your server is running
2. Try logging in again with `collins@gmail.com`
3. Look for these messages in the console:

```
🔑 Login attempt received: collins@gmail.com
🔍 Finding user: collins@gmail.com
✅ User found: [Name]
🔐 Verifying password...
❌ Invalid password for: collins@gmail.com
```

### What this tells you:
- If you see "✅ User found": Email is correct, password is wrong
- If you see "❌ User not found": Email doesn't exist

---

## Step 4: Fix the Issue - Choose Your Solution

### Solution A: User Doesn't Exist - Create New User

**Option 1: Sign up through the app**
1. Go to: `http://localhost:3000/signup.html`
2. Fill in the form with:
   - Name: Collins
   - Email: collins@gmail.com
   - Password: [your password]
   - Phone: [your phone]
   - Address: [your address]
3. Click "Sign Up"
4. Try logging in again

**Option 2: Create user directly in database (NOT RECOMMENDED - password won't be hashed)**
- This won't work because password needs to be hashed!

---

### Solution B: Password Not Hashed - Re-hash the Password

If the password in database is plain text, you need to hash it.

**Step 1:** Open `backend/server.js` and find the signup endpoint (around line 38)

**Step 2:** Look at how password is hashed:
```javascript
const hashedPassword = await bcrypt.hash(password, 10);
```

**Step 3:** Create a script to hash your password:

Create a new file: `backend/hash-password.js`

```javascript
const bcrypt = require('bcryptjs');

async function hashPassword() {
    const plainPassword = 'your_password_here'; // Change this to your actual password
    const hashed = await bcrypt.hash(plainPassword, 10);
    console.log('Hashed password:', hashed);
    console.log('\nNow update the database with this hash:');
    console.log(`UPDATE users SET password = '${hashed}' WHERE email = 'collins@gmail.com';`);
}

hashPassword();
```

**Step 4:** Run it:
```bash
cd backend
node hash-password.js
```

**Step 5:** Copy the UPDATE query it shows and run it in MySQL Workbench

---

### Solution C: Wrong Password - Reset Password

**Option 1: Use the signup form** (if email doesn't exist, it will create new account)

**Option 2: Update password in database** (follow Solution B steps)

---

## Step 5: Test the Login

After fixing:

1. **Make sure server is running**
2. Go to: `http://localhost:3000/login.html`
3. Enter:
   - Email: `collins@gmail.com`
   - Password: [the password you used when creating/hashing]
4. Click "Login"

### Expected Result:
- ✅ Should redirect to dashboard
- ❌ If still fails, check server console for error messages

---

## Step 6: Add Better Error Messages (Optional Improvement)

To make debugging easier in the future, you can improve error messages.

### In `backend/server.js` (around line 100-170):

**Find this code:**
```javascript
if (users.length === 0) {
    console.log('❌ User not found:', email);
    return res.status(401).json({ 
        success: false, 
        message: 'Invalid email or password' 
    });
}
```

**You can change it to (for debugging only - remove later for security):**
```javascript
if (users.length === 0) {
    console.log('❌ User not found:', email);
    return res.status(401).json({ 
        success: false, 
        message: 'User not found. Please sign up first.' 
    });
}
```

**And for password:**
```javascript
if (!validPassword) {
    console.log('❌ Invalid password for:', email);
    return res.status(401).json({ 
        success: false, 
        message: 'Incorrect password. Please try again.' 
    });
}
```

⚠️ **Note:** More specific error messages help users, but can also help attackers. Use this only for development!

---

## Quick Checklist

Before asking for help, check:
- [ ] Is the server running? (Check terminal)
- [ ] Does the user exist in database? (Run SELECT query)
- [ ] Is the password hashed? (Check password field format)
- [ ] Are you using the correct password? (The one you signed up with)
- [ ] Check server console for error messages

---

## Common Issues & Solutions

| Problem | Solution |
|---------|----------|
| "User not found" | Sign up first or check email spelling |
| "Invalid password" | Password doesn't match - check if it's hashed correctly |
| "Network error" | Server is not running - start it with `node server.js` |
| Password in DB is plain text | Hash it using the script in Solution B |

---

## Need More Help?

If you're still stuck:
1. Check the server console output
2. Check browser console (F12 → Console tab)
3. Verify user exists and password is hashed in database
4. Try creating a new account with a different email to test

Good luck! 🚀

