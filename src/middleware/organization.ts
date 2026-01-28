import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';

export interface OrgRequest extends Request {
  organizationId?: string;
  organization?: {
    id: string;
    name: string;
    slug: string;
    subdomain?: string;
  };
}

/**
 * Middleware to identify organization from:
 * 1. Subdomain (e.g., orgname.yourdomain.com)
 * 2. Slug in path (e.g., /org/orgname/...)
 * 3. Query parameter (e.g., ?org=orgname)
 * 4. Header (X-Organization-Slug)
 */
export const identifyOrganization = async (
  req: OrgRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    let organizationSlug: string | undefined;

    // Method 1: Check subdomain
    const host = req.get('host') || '';
    const subdomain = host.split('.')[0];
    if (subdomain && subdomain !== 'www' && subdomain !== 'localhost' && !subdomain.includes(':')) {
      organizationSlug = subdomain;
    }

    // Method 2: Check path parameter (e.g., /org/:slug)
    if (!organizationSlug && req.params.orgSlug) {
      organizationSlug = req.params.orgSlug;
    }

    // Method 3: Check query parameter
    if (!organizationSlug && req.query.org) {
      organizationSlug = req.query.org as string;
    }

    // Method 4: Check header
    if (!organizationSlug && req.headers['x-organization-slug']) {
      organizationSlug = req.headers['x-organization-slug'] as string;
    }

    // If no organization found, continue (getOrganizationFromUser will handle it)
    if (!organizationSlug) {
      return next();
    }

    // Find organization by slug or subdomain
    const organization = await prisma.organization.findFirst({
      where: {
        OR: [
          { slug: organizationSlug },
          { subdomain: organizationSlug },
        ],
      },
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    req.organizationId = organization.id;
    req.organization = {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      subdomain: organization.subdomain || undefined,
    };

    next();
  } catch (error) {
    return res.status(500).json({ message: 'Error identifying organization', error });
  }
};

/**
 * Middleware to verify user belongs to the organization
 */
export const verifyOrganizationAccess = async (
  req: OrgRequest & { userId?: string },
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.organizationId || !req.userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const userOrg = await prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId: req.userId,
          organizationId: req.organizationId,
        },
      },
    });

    if (!userOrg) {
      return res.status(403).json({ message: 'Access denied: User does not belong to this organization' });
    }

    next();
  } catch (error) {
    return res.status(500).json({ message: 'Error verifying organization access', error });
  }
};

/**
 * Middleware to verify user is organization admin
 */
export const requireOrgAdmin = async (
  req: OrgRequest & { userId?: string; userRole?: string },
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.organizationId || !req.userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const userOrg = await prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId: req.userId,
          organizationId: req.organizationId,
        },
      },
    });

    if (!userOrg || (userOrg.role !== 'ADMIN' && req.userRole !== 'ADMIN')) {
      return res.status(403).json({ message: 'Organization admin access required' });
    }

    next();
  } catch (error) {
    return res.status(500).json({ message: 'Error verifying admin access', error });
  }
};

/**
 * Middleware to get organization from authenticated user's first organization
 * Used as fallback when organization is not specified in request
 */
export const getOrganizationFromUser = async (
  req: OrgRequest & { userId?: string },
  res: Response,
  next: NextFunction
) => {
  try {
    // If organization already identified, skip
    if (req.organizationId) {
      return next();
    }

    if (!req.userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // Get user's first organization
    const userOrg = await prisma.userOrganization.findFirst({
      where: { userId: req.userId },
      include: {
        organization: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (!userOrg) {
      return res.status(400).json({ message: 'User is not a member of any organization' });
    }

    req.organizationId = userOrg.organization.id;
    req.organization = {
      id: userOrg.organization.id,
      name: userOrg.organization.name,
      slug: userOrg.organization.slug,
      subdomain: userOrg.organization.subdomain || undefined,
    };

    next();
  } catch (error) {
    return res.status(500).json({ message: 'Error getting user organization', error });
  }
};

