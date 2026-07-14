-- SQL Server single-table SELECT combinations

-- 1. Basic projection
customers
  .Select(c => new { c.CustomerId, c.Name });

-- 2. Select all columns
customers;
-- 3. Projection with alias
customers
  .Select(c => new { c.CustomerId, c.Name });
-- 4. Basic filter
customers
  .Where(c => c.IsActive == 1)
  .Select(c => new { c.CustomerId, c.Name });
-- 5. Filter + order ascending
customers
  .Where(c => c.IsActive == 1)
  .OrderBy(c => c.Name)
  .Select(c => new { c.CustomerId, c.Name });
-- 6. Filter + order descending
customers
  .Where(c => c.IsActive == 1)
  .OrderByDescending(c => c.Name)
  .Select(c => new { c.CustomerId, c.Name });

-- 7. DISTINCT projection
customers
  .Select(c => new { c.Name });

-- 8. LIKE starts with
customers
  .Where(c => c.Name.StartsWith("c.A"))
  .Select(c => new { c.CustomerId, c.Name });

-- 9. LIKE ends with
customers
  .Where(c => c.Name.EndsWith("c.son"))
  .Select(c => new { c.CustomerId, c.Name });

-- 10. LIKE contains
customers
  .Where(c => c.Name.Contains("c.tech"))
  .Select(c => new { c.CustomerId, c.Name });

-- 11. NULL check
customers
  .Where(c => c.MiddleName == null)
  .Select(c => new { c.CustomerId, c.Name });

-- 12. NOT NULL check
customers
  .Where(c => c.MiddleName != null)
  .Select(c => new { c.CustomerId, c.Name });

-- 13. Multi-condition filter
customers
  .Where(c => c.IsActive == 1 && c.CustomerId > 100)
  .Select(c => new { c.CustomerId, c.Name });

-- 14. Multi-column order with directions
customers
  .OrderBy(c => c.Name)
  .ThenByDescending(c => c.CustomerId)
  .Select(c => new { c.CustomerId, c.Name });

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
