-- PostgreSQL subquery combinations

-- 1. Scalar subquery in SELECT
SELECT o.order_id,
       (SELECT c.name FROM public.customers AS c WHERE c.customer_id = o.customer_id) AS customer_name
FROM public.orders AS o;

-- 2. Subquery in WHERE (IN)
SELECT customer_id, name
FROM public.customers
WHERE customer_id IN (
  SELECT DISTINCT customer_id
  FROM public.orders
  WHERE total_amount > 500
);

-- 3. Subquery in WHERE (EXISTS)
SELECT c.customer_id, c.name
FROM public.customers AS c
WHERE EXISTS (
  SELECT 1
  FROM public.orders AS o
  WHERE o.customer_id = c.customer_id
);

-- 4. Correlated subquery
SELECT o.order_id, o.customer_id, o.total_amount
FROM public.orders AS o
WHERE o.total_amount > (
  SELECT AVG(o2.total_amount)
  FROM public.orders AS o2
  WHERE o2.customer_id = o.customer_id
);

-- 5. NOT EXISTS
SELECT c.customer_id, c.name
FROM public.customers AS c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.orders AS o
  WHERE o.customer_id = c.customer_id
);

-- 6. Derived table subquery in FROM
SELECT x.customer_id, x.order_count
FROM (
  SELECT o.customer_id, COUNT(*) AS order_count
  FROM public.orders AS o
  GROUP BY o.customer_id
) AS x
WHERE x.order_count >= 3;
