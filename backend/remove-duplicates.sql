-- Remove duplicate menu items (keeps the one with lowest food_id)
-- This query works even with MySQL safe update mode enabled

-- Step 1: First, let's see what will be deleted (optional - just to check)
SELECT f1.food_id, f1.name, f1.price
FROM food_item f1
INNER JOIN food_item f2 
WHERE f1.food_id > f2.food_id 
AND f1.name = f2.name
ORDER BY f1.name;

-- Step 2: Delete the duplicates (run this after checking step 1)
DELETE FROM food_item
WHERE food_id IN (
    SELECT food_id FROM (
        SELECT f1.food_id
        FROM food_item f1
        INNER JOIN food_item f2 
        WHERE f1.food_id > f2.food_id 
        AND f1.name = f2.name
    ) AS temp
);

-- Step 3: Verify - check total count
SELECT COUNT(*) as total_items FROM food_item;

-- Step 4: Check for any remaining duplicates
SELECT name, COUNT(*) as count 
FROM food_item 
GROUP BY name 
HAVING COUNT(*) > 1;

