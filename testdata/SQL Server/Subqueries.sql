-- SQL Server subquery combinations

-- 1. Scalar subquery in SELECT
SELECT o.OrderId,
       (SELECT c.Name FROM dbo.Customers AS c WHERE c.CustomerId = o.CustomerId) AS CustomerName
FROM dbo.Orders AS o;

-- 2. Subquery in WHERE (IN)
SELECT CustomerId, Name
FROM dbo.Customers
WHERE CustomerId IN (
  SELECT DISTINCT CustomerId
  FROM dbo.Orders
  WHERE TotalAmount > 500
);

-- 3. Subquery in WHERE (EXISTS)
SELECT c.CustomerId, c.Name
FROM dbo.Customers AS c
WHERE EXISTS (
  SELECT 1
  FROM dbo.Orders AS o
  WHERE o.CustomerId = c.CustomerId
);

-- 4. Correlated subquery
SELECT o.OrderId, o.CustomerId, o.TotalAmount
FROM dbo.Orders AS o
WHERE o.TotalAmount > (
  SELECT AVG(o2.TotalAmount)
  FROM dbo.Orders AS o2
  WHERE o2.CustomerId = o.CustomerId
);

-- 5. NOT EXISTS
SELECT c.CustomerId, c.Name
FROM dbo.Customers AS c
WHERE NOT EXISTS (
  SELECT 1
  FROM dbo.Orders AS o
  WHERE o.CustomerId = c.CustomerId
);

-- 6. Derived table subquery in FROM
SELECT x.CustomerId, x.OrderCount
FROM (
  SELECT o.CustomerId, COUNT(*) AS OrderCount
  FROM dbo.Orders AS o
  GROUP BY o.CustomerId
) AS x
WHERE x.OrderCount >= 3;

-- 7. Subquery with TOP
SELECT c.CustomerId, c.Name
FROM dbo.Customers AS c
WHERE c.CustomerId IN (
  SELECT TOP (10) o.CustomerId
  FROM dbo.Orders AS o
  ORDER BY o.TotalAmount DESC
);

-- 8. ANY/ALL style via comparison
SELECT o.OrderId, o.TotalAmount
FROM dbo.Orders AS o
WHERE o.TotalAmount >= ALL (
  SELECT o2.TotalAmount
  FROM dbo.Orders AS o2
  WHERE o2.CustomerId = o.CustomerId
);
