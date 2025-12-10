import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl) {
  console.warn("NEXT_PUBLIC_SUPABASE_URL is not configured")
}

if (!supabaseServiceKey) {
  console.warn("SUPABASE_SERVICE_ROLE_KEY is not configured")
}

// Server-side client with service role key for inserting data
export const supabaseAdmin = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null

// Types for job analytics
export interface JobAnalytics {
  id?: string
  request_id: string
  file_name: string
  file_size_bytes: number
  file_size_mb: number
  pdf_pages?: number
  model: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  input_cost_usd: number
  output_cost_usd: number
  total_cost_usd: number
  tools_configured: boolean
  tools_called: number
  tool_usage_summary: Record<string, string | number | boolean>
  iterations: number
  api_duration_ms: number
  total_duration_ms: number
  stop_reason: string
  analysis_length_chars: number
  analysis_length_words: number
  discrepancies_found?: number
  status: "success" | "error"
  error_message?: string
  created_at?: string
}

// Pricing for Gemini 2.5 Flash (per 1M tokens) - Paid Tier
const PRICING = {
  "gemini-2.5-flash": {
    input: 0.30,   // $0.30 per 1M input tokens (text/image/video)
    output: 2.50,  // $2.50 per 1M output tokens (including thinking tokens)
  },
  // Add other models as needed
  default: {
    input: 0.30,
    output: 2.50,
  },
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): { inputCost: number; outputCost: number; totalCost: number } {
  const pricing = PRICING[model as keyof typeof PRICING] || PRICING.default

  const inputCost = (inputTokens / 1_000_000) * pricing.input
  const outputCost = (outputTokens / 1_000_000) * pricing.output
  const totalCost = inputCost + outputCost

  return {
    inputCost: Math.round(inputCost * 10000) / 10000,  // Round to 4 decimal places
    outputCost: Math.round(outputCost * 10000) / 10000,
    totalCost: Math.round(totalCost * 10000) / 10000,
  }
}

export async function saveJobAnalytics(job: JobAnalytics): Promise<{ success: boolean; error?: string }> {
  if (!supabaseAdmin) {
    console.warn("Supabase not configured, skipping analytics save")
    return { success: false, error: "Supabase not configured" }
  }

  try {
    const { error } = await supabaseAdmin
      .from("job_analytics")
      .insert([job])

    if (error) {
      console.error("Failed to save job analytics:", error)
      return { success: false, error: error.message }
    }

    console.log(`Job analytics saved: ${job.request_id}`)
    return { success: true }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error"
    console.error("Error saving job analytics:", errorMessage)
    return { success: false, error: errorMessage }
  }
}
