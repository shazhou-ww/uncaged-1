-- Seed script for existing users and agents in Uncaged DB
-- Run after schema-v4.sql migration to populate slug + short_id fields

-- Update existing users with slugs and short IDs
-- Replace display_name and generated values as needed for actual data

-- Example user (replace with actual user data)
UPDATE users 
SET slug = 'scott-wei', short_id = 'u_sw1a2b3c' 
WHERE display_name = 'Scott Wei' AND slug IS NULL;

-- Example: Add more users as needed
-- UPDATE users 
-- SET slug = 'jane-doe', short_id = 'u_jd4e5f6g' 
-- WHERE display_name = 'Jane Doe' AND slug IS NULL;

-- Update existing agents with slugs and short IDs  
-- Use existing agent IDs as base slugs

-- doudou agent (common example)
UPDATE agents 
SET slug = 'doudou', short_id = 'a_dd7h8i9j' 
WHERE id = 'doudou' AND slug IS NULL;

-- xiaomai agent (if exists)
UPDATE agents 
SET slug = 'xiaomai', short_id = 'a_xm0k1l2m' 
WHERE id = 'xiaomai' AND slug IS NULL;

-- Add more agents as needed based on your actual agent IDs
-- UPDATE agents 
-- SET slug = 'agent-name', short_id = 'a_an3n4o5p' 
-- WHERE id = 'agent-name' AND slug IS NULL;

-- Verify the updates
SELECT 'Users with slugs:' as info;
SELECT id, display_name, slug, short_id FROM users WHERE slug IS NOT NULL;

SELECT 'Agents with slugs:' as info;  
SELECT id, slug, short_id FROM agents WHERE slug IS NOT NULL;