-- PostgreSQL CTE combinations

-- 1. Simple CTE
WITH active_customers AS (
  SELECT customer_id, name
  FROM public.customers
  WHERE is_active = TRUE
)
SELECT customer_id, name
FROM active_customers;

-- 2. CTE with aggregation
WITH customer_order_totals AS (
  SELECT o.customer_id, SUM(o.total_amount) AS total_spent
  FROM public.orders AS o
  GROUP BY o.customer_id
)
SELECT c.customer_id, c.name, t.total_spent
FROM public.customers AS c
INNER JOIN customer_order_totals AS t ON t.customer_id = c.customer_id;

-- 3. Multiple CTEs
WITH base_orders AS (
  SELECT order_id, customer_id, total_amount
  FROM public.orders
  WHERE order_date >= DATE '2026-01-01'
),
high_value_orders AS (
  SELECT order_id, customer_id, total_amount
  FROM base_orders
  WHERE total_amount > 1000
)
SELECT *
FROM high_value_orders;

-- 4. Recursive CTE
WITH RECURSIVE employee_hierarchy AS (
  SELECT employee_id, manager_id, employee_name, 0 AS lvl
  FROM public.employees
  WHERE manager_id IS NULL
  UNION ALL
  SELECT e.employee_id, e.manager_id, e.employee_name, h.lvl + 1
  FROM public.employees AS e
  INNER JOIN employee_hierarchy AS h ON e.manager_id = h.employee_id
)
SELECT employee_id, manager_id, employee_name, lvl
FROM employee_hierarchy
ORDER BY lvl, employee_id;
