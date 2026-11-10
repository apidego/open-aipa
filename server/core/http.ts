import type { Request, Response, NextFunction } from 'express';
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
}
declare global {
  namespace Express {
    interface Request {
      user?: User;
      sessionToken?: string;
    }
  }
}
export function authenticated(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw new HttpError(401, 'Bitte melde dich an.');
  next();
}
export function admin(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin')
    throw new HttpError(403, 'Nur Administratoren können diese Aktion ausführen.');
  next();
}
