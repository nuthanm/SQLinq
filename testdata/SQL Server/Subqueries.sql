-- SQL Server subquery combinations

-- 1. Scalar subquery in SELECT
customers
  .Where(c => c.CustomerId == c.o.CustomerId) c.AS c.CustomerName c.FROM c.dbo.Orders c.AS c.o)
  .Select(c => new { c.OrderId, (c.SELECT c.Name });

-- 2. Subquery in WHERE (IN)
SELECT CustomerId, Name
FROM dbo.Customers
WHERE CustomerId IN (
  SELECT DISTINCT CustomerId
  FROM dbo.Orders
  WHERE TotalAmount > 500
);

-- 3. Subquery in WHERE (EXISTS)
customers
  .Where(c => c.EXISTS ( c.SELECT 1 c.FROM c.dbo.Orders c.AS c.o c.WHERE c.o.CustomerId == c.CustomerId ))
  .Select(c => new { c.CustomerId, c.Name });

-- 4. Correlated subquery
orders
  .Where(o => o.TotalAmount > ( o.SELECT AVG(o.o2.TotalAmount) o.FROM o.dbo.Orders o.AS o.o2 o.WHERE o.o2.CustomerId == o.CustomerId ))
  .Select(o => new { o.OrderId, o.CustomerId, o.TotalAmount });

-- 5. NOT EXISTS
customers
  .Where(c => ! c.EXISTS ( c.SELECT 1 c.FROM c.dbo.Orders c.AS c.o c.WHERE c.o.CustomerId == c.CustomerId ))
  .Select(c => new { c.CustomerId, c.Name });

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
orders
  .Where(o => o.TotalAmount >= o.ALL ( o.SELECT o.o2.TotalAmount o.FROM o.dbo.Orders o.AS o.o2 o.WHERE o.o2.CustomerId == o.CustomerId ))
  .Select(o => new { o.OrderId, o.TotalAmount });
