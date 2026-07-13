-- SQL Server aggregate/query-summary combinations

-- 1. Basic COUNT
SELECT COUNT(*) AS TotalCustomers
FROM dbo.Customers;

-- 2. SUM by filter
SELECT SUM(TotalAmount) AS TotalSales
FROM dbo.Orders
WHERE OrderDate >= '2026-01-01';

-- 3. AVG grouped
SELECT CustomerId, AVG(TotalAmount) AS AvgOrderAmount
FROM dbo.Orders
GROUP BY CustomerId;

-- 4. MIN/MAX grouped
SELECT CustomerId, MIN(TotalAmount) AS MinOrder, MAX(TotalAmount) AS MaxOrder
FROM dbo.Orders
GROUP BY CustomerId;

-- 5. HAVING clause
SELECT CustomerId, COUNT(*) AS OrderCount
FROM dbo.Orders
GROUP BY CustomerId
HAVING COUNT(*) >= 5;

-- 6. Distinct count
SELECT COUNT(DISTINCT CustomerId) AS DistinctCustomers
FROM dbo.Orders;

-- 7. Group by date part
SELECT YEAR(OrderDate) AS OrderYear, MONTH(OrderDate) AS OrderMonth, COUNT(*) AS Orders
FROM dbo.Orders
GROUP BY YEAR(OrderDate), MONTH(OrderDate)
ORDER BY OrderYear, OrderMonth;
