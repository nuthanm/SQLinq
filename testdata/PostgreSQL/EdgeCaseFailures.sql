-- PostgreSQL edge-case queries (intentionally challenging patterns)
-- These are useful for failure tracking and regression hardening.

-- 1. LATERAL join with LIMIT
SELECT c.customer_id, c.name, x.last_order_date
FROM public.customers AS c
LEFT JOIN LATERAL (
  SELECT o.order_date AS last_order_date
  FROM public.orders AS o
  WHERE o.customer_id = c.customer_id
  ORDER BY o.order_date DESC
  LIMIT 1
) AS x ON TRUE;

-- 2. Recursive CTE with path accumulation
WITH RECURSIVE emp_tree AS (
  SELECT e.employee_id,
         e.manager_id,
         e.employee_name,
         ARRAY[e.employee_id] AS path,
         0 AS lvl
  FROM public.employees AS e
  WHERE e.manager_id IS NULL
  UNION ALL
  SELECT c.employee_id,
         c.manager_id,
         c.employee_name,
         p.path || c.employee_id,
         p.lvl + 1
  FROM public.employees AS c
  INNER JOIN emp_tree AS p ON c.manager_id = p.employee_id
)
SELECT employee_id, manager_id, employee_name, lvl
FROM emp_tree
WHERE lvl <= 4;

-- 3. DISTINCT ON + ordering
SELECT DISTINCT ON (o.customer_id)
       o.customer_id,
       o.order_id,
       o.order_date,
       o.total_amount
FROM public.orders AS o
ORDER BY o.customer_id, o.order_date DESC;

-- 4. Window function + filter over ranked subquery
SELECT t.order_id, t.customer_id, t.total_amount
FROM (
  SELECT o.order_id,
         o.customer_id,
         o.total_amount,
         DENSE_RANK() OVER (PARTITION BY o.customer_id ORDER BY o.total_amount DESC) AS rk
  FROM public.orders AS o
) AS t
WHERE t.rk <= 3;

-- 5. JSON extraction + predicate
SELECT c.customer_id,
       c.name,
       c.profile ->> 'region' AS region
FROM public.customers AS c
WHERE COALESCE(c.profile ->> 'region', '') = 'EMEA';

-- 6. FILTER clause in aggregate
SELECT o.customer_id,
       COUNT(*) AS total_orders,
       COUNT(*) FILTER (WHERE o.total_amount > 1000) AS high_value_orders
FROM public.orders AS o
GROUP BY o.customer_id;
