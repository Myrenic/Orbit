import { UserSummary } from "@/lib/types";

export function getUserFromHeaders(source: Headers): UserSummary {
  const groupsHeader = source.get("x-auth-request-groups");
  return {
    user: source.get("x-auth-request-user") ?? undefined,
    email: source.get("x-auth-request-email") ?? undefined,
    preferredUsername:
      source.get("x-auth-request-preferred-username") ?? undefined,
    groups: groupsHeader
      ? groupsHeader
          .split(",")
          .map((group) => group.trim())
          .filter(Boolean)
      : [],
  };
}

export function getRequestedBy(source: Headers): string {
  const user = getUserFromHeaders(source);
  return (
    user.email ??
    user.preferredUsername ??
    user.user ??
    "oauth2-proxy-user"
  );
}
