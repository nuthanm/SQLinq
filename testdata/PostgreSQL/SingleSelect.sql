-- PostgreSQL single-table SELECT combinations

-- 1. Basic projection
SELECT customer_id, name
FROM public.customers;

-- 2. Select all columns
SELECT *
FROM public.customers;

-- 3. Projection with alias
SELECT c.customer_id, c.name
FROM public.customers AS c;

-- 4. Basic filter
SELECT customer_id, name
FROM public.customers
WHERE is_active = TRUE;

-- 5. Filter + order ascending
SELECT customer_id, name
FROM public.customers
WHERE is_active = TRUE
ORDER BY name ASC;

-- 6. Filter + order descending
SELECT customer_id, name
FROM public.customers
WHERE is_active = TRUE
ORDER BY name DESC;

-- 7. DISTINCT projection
SELECT DISTINCT name
FROM public.customers;

-- 8. LIKE starts with
SELECT customer_id, name
FROM public.customers
WHERE name LIKE 'A%';

-- 9. ILIKE contains
SELECT customer_id, name
FROM public.customers
WHERE name ILIKE '%tech%';

-- 10. NULL check
SELECT customer_id, name
FROM public.customers
WHERE middle_name IS NULL;

-- 11. NOT NULL check
SELECT customer_id, name
FROM public.customers
WHERE middle_name IS NOT NULL;

-- 12. Multi-condition filter
SELECT customer_id, name
FROM public.customers
WHERE is_active = TRUE AND customer_id > 100;

-- 13. Multi-column order with directions
SELECT customer_id, name
FROM public.customers
ORDER BY name ASC, customer_id DESC;

-- 14. LIMIT + OFFSET paging
SELECT customer_id, name
FROM public.customers
ORDER BY customer_id
LIMIT 10 OFFSET 20;

-- 15. IN predicate
SELECT customer_id, name
FROM public.customers
WHERE customer_id IN (1001, 1002, 1003);

-- 16. BETWEEN predicate
SELECT customer_id, name
FROM public.customers
WHERE created_on BETWEEN DATE '2025-01-01' AND DATE '2025-12-31';
