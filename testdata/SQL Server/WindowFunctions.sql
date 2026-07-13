-- SQL Server window function combinations

-- 1. ROW_NUMBER
SELECT o.OrderId,
       o.CustomerId,
       o.TotalAmount,
       ROW_NUMBER() OVER (PARTITION BY o.CustomerId ORDER BY o.OrderDate DESC) AS rn
FROM dbo.Orders AS o;

-- 2. RANK
SELECT o.OrderId,
       o.CustomerId,
       o.TotalAmount,
       RANK() OVER (PARTITION BY o.CustomerId ORDER BY o.TotalAmount DESC) AS rk
FROM dbo.Orders AS o;

-- 3. DENSE_RANK
SELECT o.OrderId,
       o.CustomerId,
       o.TotalAmount,
       DENSE_RANK() OVER (PARTITION BY o.CustomerId ORDER BY o.TotalAmount DESC) AS drk
FROM dbo.Orders AS o;

-- 4. Running total
SELECT o.OrderId,
       o.CustomerId,
       o.OrderDate,
       o.TotalAmount,
       SUM(o.TotalAmount) OVER (PARTITION BY o.CustomerId ORDER BY o.OrderDate ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS RunningTotal
FROM dbo.Orders AS o;

-- 5. LAG/LEAD
SELECT o.OrderId,
       o.CustomerId,
       o.OrderDate,
       o.TotalAmount,
       LAG(o.TotalAmount) OVER (PARTITION BY o.CustomerId ORDER BY o.OrderDate) AS PrevAmount,
       LEAD(o.TotalAmount) OVER (PARTITION BY o.CustomerId ORDER BY o.OrderDate) AS NextAmount
FROM dbo.Orders AS o;
