import type { NextFunction, Request, Response } from 'express';
import type { Role, User } from '../models/store';

export interface AuthenticatedRequest extends Request {
  user?: User;
}

export function allowRoles(...allowed: Role[]) {
  return (request: AuthenticatedRequest, _response: Response, next: NextFunction) => {
    if (!request.user || !allowed.includes(request.user.role)) return next(Object.assign(new Error('Your account does not have permission to perform this action.'), { status: 403 }));
    return next();
  };
}
