-- PostgreSQL window function combinations

-- 1. ROW_NUMBER
SELECT o.order_id,
       o.customer_id,
       o.total_amount,
       ROW_NUMBER() OVER (PARTITION BY o.customer_id ORDER BY o.order_date DESC) AS rn
FROM public.orders AS o;

-- 2. RANK
SELECT o.order_id,
       o.customer_id,
       o.total_amount,
       RANK() OVER (PARTITION BY o.customer_id ORDER BY o.total_amount DESC) AS rk
FROM public.orders AS o;

-- 3. DENSE_RANK
SELECT o.order_id,
       o.customer_id,
       o.total_amount,
       DENSE_RANK() OVER (PARTITION BY o.customer_id ORDER BY o.total_amount DESC) AS drk
FROM public.orders AS o;

-- 4. Running total
SELECT o.order_id,
       o.customer_id,
       o.order_date,
       o.total_amount,
       SUM(o.total_amount) OVER (
         PARTITION BY o.customer_id
         ORDER BY o.order_date
         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
       ) AS running_total
FROM public.orders AS o;

-- 5. LAG/LEAD
SELECT o.order_id,
       o.customer_id,
       o.order_date,
       o.total_amount,
       LAG(o.total_amount) OVER (PARTITION BY o.customer_id ORDER BY o.order_date) AS prev_amount,
       LEAD(o.total_amount) OVER (PARTITION BY o.customer_id ORDER BY o.order_date) AS next_amount
FROM public.orders AS o;
