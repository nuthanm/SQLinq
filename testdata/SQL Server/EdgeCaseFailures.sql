-- SQL Server edge-case queries (intentionally challenging patterns)
-- These are useful for failure tracking and regression hardening.

-- 1. Nested SELECT with computed projection and alias reuse
SELECT q.CustomerId,
       q.TotalSpent,
       CASE WHEN q.TotalSpent > 10000 THEN 'VIP' ELSE 'REGULAR' END AS Segment
FROM (
  SELECT o.CustomerId, SUM(o.TotalAmount) AS TotalSpent
  FROM dbo.Orders AS o
  GROUP BY o.CustomerId
) AS q
WHERE q.TotalSpent > 250
ORDER BY q.TotalSpent DESC;

-- 2. CROSS APPLY with TOP
SELECT c.CustomerId, c.Name, x.LastOrderDate
FROM dbo.Customers AS c
CROSS APPLY (
  SELECT TOP (1) o.OrderDate AS LastOrderDate
  FROM dbo.Orders AS o
  WHERE o.CustomerId = c.CustomerId
  ORDER BY o.OrderDate DESC
) AS x;

-- 3. OUTER APPLY with nullable result
SELECT c.CustomerId, c.Name, x.LastInvoiceTotal
FROM dbo.Customers AS c
OUTER APPLY (
  SELECT TOP (1) i.TotalAmount AS LastInvoiceTotal
  FROM dbo.Invoices AS i
  WHERE i.CustomerId = c.CustomerId
  ORDER BY i.InvoiceDate DESC
) AS x;

-- 4. Recursive CTE with additional filter + aggregate
WITH EmployeeTree AS (
  SELECT e.EmployeeId, e.ManagerId, e.EmployeeName, 0 AS Lvl
  FROM dbo.Employees AS e
  WHERE e.ManagerId IS NULL
  UNION ALL
  SELECT c.EmployeeId, c.ManagerId, c.EmployeeName, p.Lvl + 1
  FROM dbo.Employees AS c
  INNER JOIN EmployeeTree AS p ON c.ManagerId = p.EmployeeId
)
SELECT Lvl, COUNT(*) AS EmployeesAtLevel
FROM EmployeeTree
WHERE Lvl <= 4
GROUP BY Lvl
ORDER BY Lvl ASC;

-- 5. Window function in subquery + outer filter
SELECT t.OrderId, t.CustomerId, t.TotalAmount
FROM (
  SELECT o.OrderId,
         o.CustomerId,
         o.TotalAmount,
         ROW_NUMBER() OVER (PARTITION BY o.CustomerId ORDER BY o.TotalAmount DESC) AS rn
  FROM dbo.Orders AS o
) AS t
WHERE t.rn <= 2;

-- 6. Pivot pattern (often unsupported)
SELECT *
FROM (
  SELECT DATENAME(month, OrderDate) AS OrderMonth, TotalAmount
  FROM dbo.Orders
) AS src
PIVOT (
  SUM(TotalAmount)
  FOR OrderMonth IN ([January], [February], [March], [April], [May], [June])
) AS p;
