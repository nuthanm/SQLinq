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
vIPCustomers
  .Select(v => new { v.CustomerId });

-- 4. EXCEPT
customers
  .Select(c => new { c.CustomerId });
