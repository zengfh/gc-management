import { forbidden } from '../http/errors.js';

export const roles = {
  owner: 'owner',
  admin: 'admin',
  operator: 'operator',
  viewer: 'viewer',
} as const;

export type Role = (typeof roles)[keyof typeof roles];

export const adminRoles = new Set([roles.owner, roles.admin]);
export const operatorRoles = new Set([roles.owner, roles.admin, roles.operator]);
export const viewerRoles = new Set([roles.owner, roles.admin, roles.operator, roles.viewer]);

export function requireRole(allowedRoles) {
  return function roleMiddleware(req, _res, next) {
    if (!allowedRoles.has(req.auth?.role)) {
      next(forbidden('INSUFFICIENT_ROLE', 'Your role does not allow this action.'));
      return;
    }
    next();
  };
}

export const requireAdminRole = requireRole(adminRoles);
export const requireOperatorRole = requireRole(operatorRoles);
export const requireViewerRole = requireRole(viewerRoles);
