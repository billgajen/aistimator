/**
 * T-173: the two roles a profile can hold (`user_profiles.role`).
 *
 * Every sign-up is an owner: the account of one business. 'admin' is the
 * platform's own role, for the /admin area. It is granted only by the service
 * role (scripts/set-platform-admin.sh), and migration 43 stops a signed-in
 * user changing its own role or business.
 */
export const OWNER_ROLE = 'owner'
export const PLATFORM_ADMIN_ROLE = 'admin'
