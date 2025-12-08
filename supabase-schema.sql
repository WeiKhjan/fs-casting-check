-- Supabase SQL Schema for Financial Statement Casting Check Analytics
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard/project/YOUR_PROJECT/sql)

-- Create the job_analytics table
CREATE TABLE IF NOT EXISTS job_analytics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL DEFAULT 0,
  file_size_mb DECIMAL(10, 2) NOT NULL DEFAULT 0,
  pdf_pages INTEGER,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  input_cost_usd DECIMAL(10, 4) NOT NULL DEFAULT 0,
  output_cost_usd DECIMAL(10, 4) NOT NULL DEFAULT 0,
  total_cost_usd DECIMAL(10, 4) NOT NULL DEFAULT 0,
  tools_configured BOOLEAN NOT NULL DEFAULT false,
  tools_called INTEGER NOT NULL DEFAULT 0,
  tool_usage_summary JSONB DEFAULT '{}',
  iterations INTEGER NOT NULL DEFAULT 0,
  api_duration_ms INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER NOT NULL DEFAULT 0,
  stop_reason TEXT,
  analysis_length_chars INTEGER NOT NULL DEFAULT 0,
  analysis_length_words INTEGER NOT NULL DEFAULT 0,
  discrepancies_found INTEGER DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_job_analytics_created_at ON job_analytics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_analytics_status ON job_analytics(status);
CREATE INDEX IF NOT EXISTS idx_job_analytics_file_name ON job_analytics(file_name);
CREATE INDEX IF NOT EXISTS idx_job_analytics_model ON job_analytics(model);

-- Enable Row Level Security (RLS)
ALTER TABLE job_analytics ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows the service role to insert (for server-side inserts)
CREATE POLICY "Service role can insert" ON job_analytics
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Create a policy that allows the service role to select (for querying analytics)
CREATE POLICY "Service role can select" ON job_analytics
  FOR SELECT
  TO service_role
  USING (true);

-- Optional: Create a policy for authenticated users to view analytics (if you add auth later)
-- CREATE POLICY "Authenticated users can view" ON job_analytics
--   FOR SELECT
--   TO authenticated
--   USING (true);

-- Create a view for daily analytics summary
CREATE OR REPLACE VIEW daily_analytics_summary AS
SELECT
  DATE(created_at) as date,
  COUNT(*) as total_jobs,
  COUNT(*) FILTER (WHERE status = 'success') as successful_jobs,
  COUNT(*) FILTER (WHERE status = 'error') as failed_jobs,
  SUM(total_tokens) as total_tokens_used,
  SUM(total_cost_usd) as total_cost_usd,
  AVG(total_duration_ms) as avg_duration_ms,
  AVG(file_size_mb) as avg_file_size_mb,
  SUM(discrepancies_found) as total_discrepancies_found,
  AVG(tools_called) as avg_tools_called
FROM job_analytics
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Create a view for model usage summary
CREATE OR REPLACE VIEW model_usage_summary AS
SELECT
  model,
  COUNT(*) as total_jobs,
  SUM(input_tokens) as total_input_tokens,
  SUM(output_tokens) as total_output_tokens,
  SUM(total_cost_usd) as total_cost_usd,
  AVG(api_duration_ms) as avg_api_duration_ms
FROM job_analytics
WHERE status = 'success'
GROUP BY model
ORDER BY total_jobs DESC;

-- Create a view for cost tracking
CREATE OR REPLACE VIEW cost_tracking AS
SELECT
  DATE_TRUNC('month', created_at) as month,
  COUNT(*) as total_jobs,
  SUM(input_cost_usd) as input_cost_usd,
  SUM(output_cost_usd) as output_cost_usd,
  SUM(total_cost_usd) as total_cost_usd,
  SUM(total_tokens) as total_tokens
FROM job_analytics
WHERE status = 'success'
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY month DESC;

-- Grant access to the views
GRANT SELECT ON daily_analytics_summary TO service_role;
GRANT SELECT ON model_usage_summary TO service_role;
GRANT SELECT ON cost_tracking TO service_role;

-- Example queries you can run:

-- Get all jobs from today
-- SELECT * FROM job_analytics WHERE DATE(created_at) = CURRENT_DATE ORDER BY created_at DESC;

-- Get total cost this month
-- SELECT * FROM cost_tracking WHERE month = DATE_TRUNC('month', CURRENT_DATE);

-- Get daily summary for the last 7 days
-- SELECT * FROM daily_analytics_summary WHERE date >= CURRENT_DATE - INTERVAL '7 days';

-- Get top 10 most expensive jobs
-- SELECT file_name, total_tokens, total_cost_usd, created_at
-- FROM job_analytics
-- WHERE status = 'success'
-- ORDER BY total_cost_usd DESC
-- LIMIT 10;

-- Get jobs with most discrepancies
-- SELECT file_name, discrepancies_found, created_at
-- FROM job_analytics
-- WHERE status = 'success' AND discrepancies_found > 0
-- ORDER BY discrepancies_found DESC
-- LIMIT 10;
