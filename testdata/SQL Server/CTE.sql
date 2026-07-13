-- SQL Server CTE combinations

-- 1. Simple CTE
WITH ActiveCustomers AS (
  SELECT CustomerId, Name
  FROM dbo.Customers
  WHERE IsActive = 1
)
SELECT CustomerId, Name
FROM ActiveCustomers;

-- 2. CTE with aggregation
WITH CustomerOrderTotals AS (
  SELECT o.CustomerId, SUM(o.TotalAmount) AS TotalSpent
  FROM dbo.Orders AS o
  GROUP BY o.CustomerId
)
SELECT c.CustomerId, c.Name, t.TotalSpent
FROM dbo.Customers AS c
INNER JOIN CustomerOrderTotals AS t ON t.CustomerId = c.CustomerId;

-- 3. Multiple CTEs
WITH BaseOrders AS (
  SELECT OrderId, CustomerId, TotalAmount
  FROM dbo.Orders
  WHERE OrderDate >= '2026-01-01'
),
HighValueOrders AS (
  SELECT OrderId, CustomerId, TotalAmount
  FROM BaseOrders
  WHERE TotalAmount > 1000
)
SELECT *
FROM HighValueOrders;

-- 4. Recursive CTE
WITH EmployeeHierarchy AS (
  SELECT EmployeeId, ManagerId, EmployeeName, 0 AS Lvl
  FROM dbo.Employees
  WHERE ManagerId IS NULL
  UNION ALL
  SELECT e.EmployeeId, e.ManagerId, e.EmployeeName, h.Lvl + 1
  FROM dbo.Employees AS e
  INNER JOIN EmployeeHierarchy AS h ON e.ManagerId = h.EmployeeId
)
SELECT EmployeeId, ManagerId, EmployeeName, Lvl
FROM EmployeeHierarchy
ORDER BY Lvl, EmployeeId;

-- 5. CTE + window function
WITH RankedOrders AS (
  SELECT o.OrderId,
         o.CustomerId,
         o.TotalAmount,
         ROW_NUMBER() OVER (PARTITION BY o.CustomerId ORDER BY o.TotalAmount DESC) AS rn
  FROM dbo.Orders AS o
)
SELECT OrderId, CustomerId, TotalAmount
FROM RankedOrders
WHERE rn = 1;
