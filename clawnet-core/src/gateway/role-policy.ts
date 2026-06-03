import { isNodeRoleMethod } from "./method-scopes.js";

export const GATEWAY_ROLES = ["operator", "node", "unified"] as const;

export type GatewayRole = (typeof GATEWAY_ROLES)[number];

export function parseGatewayRole(roleRaw: unknown): GatewayRole | null {
  if (roleRaw === "operator" || roleRaw === "node" || roleRaw === "unified") {
    return roleRaw;
  }
  return null;
}

/** Returns true if this role has operator-level method access (operator or unified). */
export function isOperatorCapableRole(role: GatewayRole): boolean {
  return role === "operator" || role === "unified";
}

/** Returns true if this role has node-level method access (node or unified). */
export function isNodeCapableRole(role: GatewayRole): boolean {
  return role === "node" || role === "unified";
}

export function roleCanSkipDeviceIdentity(role: GatewayRole, sharedAuthOk: boolean): boolean {
  return (role === "operator" || role === "unified") && sharedAuthOk;
}

/** Methods accessible to both operator (with scopes) and node roles. */
const DUAL_ROLE_METHODS = new Set(["node.invoke.result"]);

export function isRoleAuthorizedForMethod(role: GatewayRole, method: string): boolean {

  if (DUAL_ROLE_METHODS.has(method)) {
    return true;
  }
  if (isNodeRoleMethod(method)) {
    return role === "node";
  }
  return role === "operator";
}
