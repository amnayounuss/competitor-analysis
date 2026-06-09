import { SupabaseClient } from '@supabase/supabase-js';

export type UserRole = 'admin' | 'client' | 'viewer';

export interface UserProfile {
  role: UserRole;
  parent_user_id: string | null;
}

export async function getUserProfile(sb: SupabaseClient, userId: string): Promise<UserProfile> {
  const { data } = await sb.from('profiles').select('role, parent_user_id, is_admin').eq('id', userId).single();
  if (!data) return { role: 'client', parent_user_id: null };

  if (data.role && data.role !== 'client') {
    return { role: data.role as UserRole, parent_user_id: data.parent_user_id || null };
  }

  if (data.is_admin === true) return { role: 'admin', parent_user_id: null };
  if (data.is_admin === false) return { role: 'client', parent_user_id: null };

  return { role: data.role || 'client', parent_user_id: data.parent_user_id || null };
}

export function getEffectiveUserId(profile: UserProfile, userId: string): string {
  return profile.role === 'viewer' && profile.parent_user_id ? profile.parent_user_id : userId;
}
