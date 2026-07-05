-- Enable Row Level Security (RLS) on sensitive tables
ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Opportunity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalesActivity" ENABLE ROW LEVEL SECURITY;

-- Create policies that enforce Zero-Trust branch isolation
-- 1. Order Policy
CREATE POLICY branch_isolation_policy_order ON "Order"
FOR ALL
USING (
  current_setting('app.current_branch_id', true) = "branchId"::text 
  OR 
  current_setting('app.bypass_rls', true) = 'true'
);

-- 2. Lead Policy
CREATE POLICY branch_isolation_policy_lead ON "Lead"
FOR ALL
USING (
  current_setting('app.current_branch_id', true) = "branchId"::text 
  OR 
  current_setting('app.bypass_rls', true) = 'true'
);

-- 3. Opportunity Policy
CREATE POLICY branch_isolation_policy_opportunity ON "Opportunity"
FOR ALL
USING (
  current_setting('app.current_branch_id', true) = "branchId"::text 
  OR 
  current_setting('app.bypass_rls', true) = 'true'
);

-- 4. SalesActivity Policy
CREATE POLICY branch_isolation_policy_sales_activity ON "SalesActivity"
FOR ALL
USING (
  current_setting('app.current_branch_id', true) = "branchId"::text 
  OR 
  current_setting('app.bypass_rls', true) = 'true'
);
