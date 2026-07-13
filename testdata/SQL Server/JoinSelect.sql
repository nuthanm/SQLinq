-- SQL Server JOIN SELECT combinations

-- 1. INNER JOIN
SELECT o.OrderId, c.Name AS CustomerName
FROM dbo.Orders AS o
INNER JOIN dbo.Customers AS c ON c.CustomerId = o.CustomerId;

-- 2. LEFT JOIN
SELECT o.OrderId, c.Name AS CustomerName
FROM dbo.Orders AS o
LEFT JOIN dbo.Customers AS c ON c.CustomerId = o.CustomerId;

-- 3. RIGHT JOIN
SELECT o.OrderId, c.Name AS CustomerName
FROM dbo.Orders AS o
RIGHT JOIN dbo.Customers AS c ON c.CustomerId = o.CustomerId;

-- 4. FULL OUTER JOIN
SELECT o.OrderId, c.Name AS CustomerName
FROM dbo.Orders AS o
FULL OUTER JOIN dbo.Customers AS c ON c.CustomerId = o.CustomerId;

-- 5. JOIN with filter
SELECT o.OrderId, c.Name, o.TotalAmount
FROM dbo.Orders AS o
INNER JOIN dbo.Customers AS c ON c.CustomerId = o.CustomerId
WHERE o.TotalAmount > 1000;

-- 6. JOIN with date predicate
SELECT o.OrderId, c.Name, o.OrderDate
FROM dbo.Orders AS o
INNER JOIN dbo.Customers AS c ON c.CustomerId = o.CustomerId
WHERE o.OrderDate >= '2026-01-01';

-- 7. Multiple JOINs
SELECT o.OrderId, c.Name, e.EmployeeName
FROM dbo.Orders AS o
INNER JOIN dbo.Customers AS c ON c.CustomerId = o.CustomerId
INNER JOIN dbo.Employees AS e ON e.EmployeeId = o.EmployeeId;

-- 8. Self JOIN
SELECT c1.CustomerId, c1.Name, c2.Name AS ReferredBy
FROM dbo.Customers AS c1
LEFT JOIN dbo.Customers AS c2 ON c2.CustomerId = c1.ReferredByCustomerId;

-- 9. JOIN + GROUP BY
SELECT c.CustomerId, c.Name, COUNT(*) AS OrderCount
FROM dbo.Customers AS c
INNER JOIN dbo.Orders AS o ON o.CustomerId = c.CustomerId
GROUP BY c.CustomerId, c.Name;

-- 10. JOIN + ORDER BY
SELECT o.OrderId, c.Name, o.TotalAmount
FROM dbo.Orders AS o
INNER JOIN dbo.Customers AS c ON c.CustomerId = o.CustomerId
ORDER BY o.TotalAmount DESC;
