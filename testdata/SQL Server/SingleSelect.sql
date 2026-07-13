-- SQL Server single-table SELECT combinations

-- 1. Basic projection
SELECT CustomerId, Name
FROM dbo.Customers;

-- 2. Select all columns
SELECT *
FROM dbo.Customers;

-- 3. Projection with alias
SELECT c.CustomerId, c.Name
FROM dbo.Customers AS c;

-- 4. Basic filter
SELECT CustomerId, Name
FROM dbo.Customers
WHERE IsActive = 1;

-- 5. Filter + order ascending
SELECT CustomerId, Name
FROM dbo.Customers
WHERE IsActive = 1
ORDER BY Name ASC;

-- 6. Filter + order descending
SELECT CustomerId, Name
FROM dbo.Customers
WHERE IsActive = 1
ORDER BY Name DESC;

-- 7. DISTINCT projection
SELECT DISTINCT Name
FROM dbo.Customers;

-- 8. LIKE starts with
SELECT CustomerId, Name
FROM dbo.Customers
WHERE Name LIKE 'A%';

-- 9. LIKE ends with
SELECT CustomerId, Name
FROM dbo.Customers
WHERE Name LIKE '%son';

-- 10. LIKE contains
SELECT CustomerId, Name
FROM dbo.Customers
WHERE Name LIKE '%tech%';

-- 11. NULL check
SELECT CustomerId, Name
FROM dbo.Customers
WHERE MiddleName IS NULL;

-- 12. NOT NULL check
SELECT CustomerId, Name
FROM dbo.Customers
WHERE MiddleName IS NOT NULL;

-- 13. Multi-condition filter
SELECT CustomerId, Name
FROM dbo.Customers
WHERE IsActive = 1 AND CustomerId > 100;

-- 14. Multi-column order with directions
SELECT CustomerId, Name
FROM dbo.Customers
ORDER BY Name ASC, CustomerId DESC;

-- 15. TOP + filter + order
SELECT TOP (25) CustomerId, Name
FROM dbo.Customers
WHERE IsActive = 1
ORDER BY CustomerId DESC;

-- 16. IN predicate
SELECT CustomerId, Name
FROM dbo.Customers
WHERE CustomerId IN (1001, 1002, 1003);

-- 17. BETWEEN predicate
SELECT CustomerId, Name
FROM dbo.Customers
WHERE CreatedOn BETWEEN '2025-01-01' AND '2025-12-31';

-- 18. CASE expression
SELECT CustomerId,
       CASE WHEN IsActive = 1 THEN 'Active' ELSE 'Inactive' END AS StatusName
FROM dbo.Customers;

-- 19. Computed expression
SELECT CustomerId, Name, DATEDIFF(day, CreatedOn, GETDATE()) AS AgeInDays
FROM dbo.Customers;

-- 20. Paging
SELECT CustomerId, Name
FROM dbo.Customers
ORDER BY CustomerId
OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY;
