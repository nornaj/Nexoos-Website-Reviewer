import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// Lazy initialization: avoid crashing during Next.js static page generation
// when env vars may not be available yet (e.g., Docker build step)
let _supabase = null;
export const supabase = new Proxy({}, {
  get(_, prop) {
    if (!_supabase) {
      if (!supabaseUrl || !supabaseKey) {
        throw new Error("Supabase env vars not set — NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required");
      }
      _supabase = createClient(supabaseUrl, supabaseKey);
    }
    return _supabase[prop];
  }
});
