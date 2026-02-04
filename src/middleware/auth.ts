import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { OrgRequest } from './organization';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  organizationId?: string;
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as { 
      userId: string; 
      role: string;
      organizationId?: string;
    };
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    if (decoded.organizationId) {
      req.organizationId = decoded.organizationId;
    }

    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

/** Sets req.userId/req.userRole if token is valid; does not 401 when no token (for org fallback on public-style routes). */
export const optionalAuthenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return next();

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as { 
      userId: string; 
      role: string;
      organizationId?: string;
    };
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    if (decoded.organizationId) {
      req.organizationId = decoded.organizationId;
    }
    next();
  } catch {
    next();
  }
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.userRole !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

export const requireSuperAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.userRole !== 'SUPERADMIN') {
    return res.status(403).json({ message: 'Super admin access required' });
  }
  next();
};
