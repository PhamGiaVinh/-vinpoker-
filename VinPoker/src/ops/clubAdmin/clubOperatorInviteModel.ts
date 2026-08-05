export const operatorInviteRoles = ["floor", "cashier"] as const;
export type OperatorInviteRole = (typeof operatorInviteRoles)[number];
export function isOperatorInviteRole(
  value: string,
): value is OperatorInviteRole {
  return (operatorInviteRoles as readonly string[]).includes(value);
}
export function inviteStatusLabel(status: string): string {
  if (status === "pending") return "Đang chờ nhận lời mời";
  if (status === "revoked") return "Đã thu hồi";
  return "Đang có quyền";
}
