-- SQL Server window function combinations

-- 1. ROW_NUMBER
orders
  .Select(o => new { o.OrderId, o.CustomerId, o.TotalAmount, ROW_NUMBER() o.OVER (o.PARTITION o.BY o.CustomerId o.ORDER o.BY o.OrderDate DESC) o.AS o.rn });

-- 2. RANK
orders
  .Select(o => new { o.OrderId, o.CustomerId, o.TotalAmount, RANK() o.OVER (o.PARTITION o.BY o.CustomerId o.ORDER o.BY o.TotalAmount DESC) o.AS o.rk });

-- 3. DENSE_RANK
orders
  .Select(o => new { o.OrderId, o.CustomerId, o.TotalAmount, DENSE_RANK() o.OVER (o.PARTITION o.BY o.CustomerId o.ORDER o.BY o.TotalAmount DESC) o.AS o.drk });

-- 4. Running total
orders
  .Select(o => new { o.OrderId, o.CustomerId, o.OrderDate, o.TotalAmount, SUM(o.TotalAmount) o.OVER (o.PARTITION o.BY o.CustomerId o.ORDER o.BY o.OrderDate o.ROWS BETWEEN o.UNBOUNDED o.PRECEDING && o.CURRENT o.ROW) o.AS o.RunningTotal });

-- 5. LAG/LEAD
orders
  .Select(o => new { o.OrderId, o.CustomerId, o.OrderDate, o.TotalAmount, LAG(o.TotalAmount) o.OVER (o.PARTITION o.BY o.CustomerId o.ORDER o.BY o.OrderDate) o.AS o.PrevAmount, LEAD(o.TotalAmount) o.OVER (o.PARTITION o.BY o.CustomerId o.ORDER o.BY o.OrderDate) o.AS o.NextAmount });