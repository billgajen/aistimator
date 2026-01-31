import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface AdminContext {
  supabase: SupabaseClient
  userId: string
  userEmail: string
}

/**
 * Verify that the current user is an admin
 * Returns admin context if authorized, null otherwise
 */
export async function verifyAdmin(): Promise<AdminContext | null> {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return null
  }

  // Check admin role
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return null
  }

  return {
    supabase,
    userId: user.id,
    userEmail: user.email || '',
  }
}

/**
 * Log admin activity for audit trail
 */
export async function logAdminActivity(
  supabase: SupabaseClient,
  params: {
    adminUserId: string
    action: string
    resourceType: 'quote' | 'tenant' | 'user' | 'subscription'
    resourceId: string
    details?: Record<string, unknown>
  }
): Promise<void> {
  try {
    await supabase.from('admin_activity_logs').insert({
      admin_user_id: params.adminUserId,
      action: params.action,
      resource_type: params.resourceType,
      resource_id: params.resourceId,
      details_json: params.details || {},
    })
  } catch (error) {
    // Log but don't fail the operation
    console.error('Failed to log admin activity:', error)
  }
}
