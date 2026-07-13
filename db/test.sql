-- Simple SELECT combinations first for converter smoke tests.
-- These stay within the current single-table SELECT shapes the parser can convert.

-- 1. Basic projection
SELECT CustomerId, Name
FROM Customers;

-- 2. Select all columns
SELECT *
FROM Customers;

-- 3. Table alias with projection
SELECT c.CustomerId, c.Name
FROM Customers c;

-- 4. Basic filter
SELECT CustomerId, Name
FROM Customers
WHERE IsActive = 1;

-- 5. Filter with alias
SELECT c.CustomerId, c.Name
FROM Customers c
WHERE c.IsActive = 1;

-- 6. Filter plus sort
SELECT CustomerId, Name
FROM Customers
WHERE IsActive = 1
ORDER BY Name ASC;

-- 7. Filter plus descending sort
SELECT CustomerId, Name
FROM Customers
WHERE IsActive = 1
ORDER BY Name DESC;

-- 8. DISTINCT projection
SELECT DISTINCT Name
FROM Customers;

-- 9. LIKE predicate
SELECT CustomerId, Name
FROM Customers
WHERE Name LIKE 'A%';

-- 10. Null check
SELECT CustomerId, Name
FROM Customers
WHERE MiddleName IS NULL;

-- 11. Not null check
SELECT CustomerId, Name
FROM Customers
WHERE MiddleName IS NOT NULL;

-- 12. Multi-condition filter
SELECT CustomerId, Name
FROM Customers
WHERE IsActive = 1 AND CustomerId > 100;

-- 13. Multi-column order
SELECT CustomerId, Name
FROM Customers
ORDER BY Name ASC, CustomerId DESC;

-- 14. Projection with filter and order
SELECT CustomerId, Name
FROM Customers
WHERE IsActive = 1
ORDER BY Name ASC, CustomerId DESC;

-- 15. Distinct with filter
SELECT DISTINCT Name
FROM Customers
WHERE IsActive = 1;

-- 16. Filter with alias and multi-column order
SELECT c.CustomerId, c.Name
FROM Customers c
WHERE c.IsActive = 1
ORDER BY c.Name ASC, c.CustomerId DESC;