-- ============================================
-- SETUP ADMIN USER
-- ============================================

-- Step 1: Add is_admin column to users table (if it doesn't exist)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS is_admin TINYINT(1) DEFAULT 0;

-- Step 2: Make a specific user admin (replace 'your-email@example.com' with actual email)
UPDATE users 
SET is_admin = 1 
WHERE email = 'your-email@example.com';

-- Step 3: Verify admin user
SELECT id, name, email, is_admin 
FROM users 
WHERE is_admin = 1;

-- Step 4: To make yourself admin, run this (replace with your email):
-- UPDATE users SET is_admin = 1 WHERE email = 'collins@gmail.com';





