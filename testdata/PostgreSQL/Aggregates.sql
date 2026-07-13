-- PostgreSQL aggregate/query-summary combinations

-- 1. Basic COUNT
SELECT COUNT(*) AS total_customers
FROM public.customers;

-- 2. SUM by filter
SELECT SUM(total_amount) AS total_sales
FROM public.orders
WHERE order_date >= DATE '2026-01-01';

-- 3. AVG grouped
SELECT customer_id, AVG(total_amount) AS avg_order_amount
FROM public.orders
GROUP BY customer_id;

-- 4. MIN/MAX grouped
SELECT customer_id, MIN(total_amount) AS min_order, MAX(total_amount) AS max_order
FROM public.orders
GROUP BY customer_id;

-- 5. HAVING clause
SELECT customer_id, COUNT(*) AS order_count
FROM public.orders
GROUP BY customer_id
HAVING COUNT(*) >= 5;

-- 6. Distinct count
SELECT COUNT(DISTINCT customer_id) AS distinct_customers
FROM public.orders;
