import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { resolveServiceKey } from '../_shared/serviceKey.ts'
import { createSnapshotHandler } from './handler.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const jobSecret = (Deno.env.get('SNAPSHOT_JOB_SECRET') ?? '').trim()
let serviceKey = ''
try {
  serviceKey = resolveServiceKey(Deno.env.toObject())
} catch {
  // The handler returns a configuration failure without exposing secret detail.
}

const handler = createSnapshotHandler({ supabaseUrl, serviceKey, jobSecret })

Deno.serve((request: Request) => {
  if (!supabaseUrl || !serviceKey || !jobSecret) {
    return new Response(JSON.stringify({ ok: false, error: 'function is not configured' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
  return handler(request)
})
