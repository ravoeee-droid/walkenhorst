export type WorkspaceUser = {
  id: string;
  app_metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export function asWorkspaceUser<T extends WorkspaceUser | null | undefined>(user: T): T {
  if (!user) return user;
  const owner = typeof user.app_metadata?.workspace_owner_id === "string"
    ? user.app_metadata.workspace_owner_id.trim()
    : "";
  if (!owner || owner === user.id) return user;
  return {
    ...user,
    id: owner,
    app_metadata: {
      ...(user.app_metadata || {}),
      login_user_id: user.id,
    },
  } as T;
}
