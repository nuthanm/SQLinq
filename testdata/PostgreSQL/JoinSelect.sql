-- PostgreSQL JOIN SELECT combinations

-- 1. INNER JOIN
SELECT o.order_id, c.name AS customer_name
FROM public.orders AS o
INNER JOIN public.customers AS c ON c.customer_id = o.customer_id;

-- 2. LEFT JOIN
SELECT o.order_id, c.name AS customer_name
FROM public.orders AS o
LEFT JOIN public.customers AS c ON c.customer_id = o.customer_id;

-- 3. RIGHT JOIN
SELECT o.order_id, c.name AS customer_name
FROM public.orders AS o
RIGHT JOIN public.customers AS c ON c.customer_id = o.customer_id;

-- 4. FULL OUTER JOIN
SELECT o.order_id, c.name AS customer_name
FROM public.orders AS o
FULL OUTER JOIN public.customers AS c ON c.customer_id = o.customer_id;

-- 5. JOIN with filter
SELECT o.order_id, c.name, o.total_amount
FROM public.orders AS o
INNER JOIN public.customers AS c ON c.customer_id = o.customer_id
WHERE o.total_amount > 1000;

-- 6. Multiple JOINs
SELECT o.order_id, c.name, e.employee_name
FROM public.orders AS o
INNER JOIN public.customers AS c ON c.customer_id = o.customer_id
INNER JOIN public.employees AS e ON e.employee_id = o.employee_id;

-- 7. Self JOIN
SELECT c1.customer_id, c1.name, c2.name AS referred_by
FROM public.customers AS c1
LEFT JOIN public.customers AS c2 ON c2.customer_id = c1.referred_by_customer_id;

-- 8. JOIN + GROUP BY
SELECT c.customer_id, c.name, COUNT(*) AS order_count
FROM public.customers AS c
INNER JOIN public.orders AS o ON o.customer_id = c.customer_id
GROUP BY c.customer_id, c.name;
