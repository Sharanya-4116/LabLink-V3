import type { NextFunction, Request, Response } from 'express';
import type { Role, User } from '../../shared/types.ts';
import type { ServerConfig } from '../config.ts';
import { ForbiddenError, UnauthorizedError } from '../errors.ts';
import { getFirebaseAdminAuth } from '../firebaseAdmin.ts';
import type { IDataRepository } from '../repositories/IDataRepository.ts';

export interface AuthenticatedRequest extends Request {
  user?: User;
}

export async function resolveRequestUser(
  req: Request,
  repo: IDataRepository,
  config: ServerConfig
): Promise<User | null> {
  const authHeader = req.headers.authorization;

  // Production mode: strictly Firebase ID token verification; unconditionally ignore demo headers
  if (config.appMode === 'production') {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    const idToken = authHeader.slice(7).trim();
    if (!idToken) return null;

    try {
      const auth = getFirebaseAdminAuth(config);
      const decoded = await auth.verifyIdToken(idToken);
      const email = decoded.email;
      if (!email) return null;

      const user = await repo.getUserByEmail(email);
      if (user) return user;

      // Never trust client-supplied roles; only honor server-verified Firebase custom claims or default to STUDENT
      const claimRole = decoded.role as Role | undefined;
      const role: Role =
        claimRole === 'ADMIN' || claimRole === 'FACULTY' || claimRole === 'STUDENT'
          ? claimRole
          : 'STUDENT';

      return {
        id: decoded.uid,
        email,
        name: decoded.name || email.split('@')[0],
        role,
        departmentId: 'dept-csai',
        certifications: ['LAB_SAFETY_101'],
        rolling30DayHoursUsed: 0,
        createdAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  // Competition Demo Mode: ONLY active when APP_MODE === 'demo' AND ALLOW_DEMO_ROLE_SWITCH === true
  if (config.appMode === 'demo' && config.allowDemoRoleSwitch) {
    const demoUserId = req.headers['x-demo-user-id'];
    if (typeof demoUserId === 'string' && demoUserId.trim().length > 0) {
      const user = await repo.getUserById(demoUserId.trim());
      if (user) return user;
    }
  }

  // Fallback to Bearer token if provided in demo mode
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const idToken = authHeader.slice(7).trim();
    try {
      const auth = getFirebaseAdminAuth(config);
      const decoded = await auth.verifyIdToken(idToken);
      if (decoded.email) {
        return await repo.getUserByEmail(decoded.email);
      }
    } catch {
      return null;
    }
  }

  return null;
}

export function createRequireAuth(repo: IDataRepository, config: ServerConfig) {
  return async (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    try {
      const user = await resolveRequestUser(req, repo, config);
      if (!user) {
        return next(new UnauthorizedError('Authentication required'));
      }
      req.user = user;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export function requireRole(...allowedRoles: Role[]) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new ForbiddenError(
          `Role ${req.user.role} is not authorized. Required: ${allowedRoles.join(' or ')}.`
        )
      );
    }
    return next();
  };
}
