-- ============================================
-- COMPLETE SQL SCRIPT TO REMOVE DUPLICATES
-- This works even with Safe Mode enabled
-- ============================================

-- Step 1: Create temporary table with IDs to keep (lowest ID for each name)
CREATE TEMPORARY TABLE keep_ids AS
SELECT MIN(food_id) as food_id
FROM food_item
GROUP BY name;

-- Step 2: Delete all items NOT in the keep_ids table (removes duplicates)
DELETE FROM food_item
WHERE food_id NOT IN (SELECT food_id FROM keep_ids);

-- Step 3: Drop the temporary table
DROP TEMPORARY TABLE keep_ids;

-- Step 4: Verify - Check total count (should be 35 items)
SELECT COUNT(*) as total_items FROM food_item;

-- Step 5: Verify - Check for any remaining duplicates (should return 0 rows)
SELECT name, COUNT(*) as count 
FROM food_item 
GROUP BY name 
HAVING COUNT(*) > 1;

