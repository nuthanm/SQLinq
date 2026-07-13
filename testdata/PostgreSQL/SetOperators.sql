-- PostgreSQL set-operator combinations

-- 1. UNION
SELECT customer_id, name
FROM public.customers_2025
UNION
SELECT customer_id, name
FROM public.customers_2026;

-- 2. UNION ALL
SELECT customer_id, name
FROM public.customers_2025
UNION ALL
SELECT customer_id, name
FROM public.customers_2026;

-- 3. INTERSECT
SELECT customer_id
FROM public.vip_customers
INTERSECT
SELECT customer_id
FROM public.customers_with_open_orders;

-- 4. EXCEPT
SELECT customer_id
FROM public.customers
EXCEPT
SELECT customer_id
FROM public.blocked_customers;
