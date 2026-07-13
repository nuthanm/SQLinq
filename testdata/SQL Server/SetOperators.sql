-- SQL Server set-operator combinations

-- 1. UNION
SELECT CustomerId, Name
FROM dbo.Customers_2025
UNION
SELECT CustomerId, Name
FROM dbo.Customers_2026;

-- 2. UNION ALL
SELECT CustomerId, Name
FROM dbo.Customers_2025
UNION ALL
SELECT CustomerId, Name
FROM dbo.Customers_2026;

-- 3. INTERSECT
SELECT CustomerId
FROM dbo.VIPCustomers
INTERSECT
SELECT CustomerId
FROM dbo.CustomersWithOpenOrders;

-- 4. EXCEPT
SELECT CustomerId
FROM dbo.Customers
EXCEPT
SELECT CustomerId
FROM dbo.BlockedCustomers;
