export const operatorInviteRoles = ["floor", "cashier"] as const;
export type OperatorInviteRole = (typeof operatorInviteRoles)[number];
export function isOperatorInviteRole(value: string): value is OperatorInviteRole { return (operatorInviteRoles as readonly string[]).includes(value); }
export function inviteStatusLabel(status: string): string { return status === "revoked" ? "Đã thu hồi" : "Đang có quyền"; }
