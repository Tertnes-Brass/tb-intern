export function canModerateForum(permissions: string[]): boolean {
  return permissions.includes('*') || permissions.includes('forum.moderate')
}

export function canEditForumText(me: { id: string; permissions: string[] }, authorId: string | null, locked: boolean): boolean {
  return canModerateForum(me.permissions) || (!locked && authorId === me.id)
}
