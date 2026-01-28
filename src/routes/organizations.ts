import express, { Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { identifyOrganization, OrgRequest, verifyOrganizationAccess, requireOrgAdmin } from '../middleware/organization';

const router = express.Router();

const createOrganizationSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2),
  subdomain: z.string().optional(),
});

const updateOrganizationSchema = z.object({
  name: z.string().min(2).optional(),
  subdomain: z.string().optional(),
  settings: z.record(z.any()).optional(),
});

// Get user's organizations
router.get('/my-organizations', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;

    const userOrgs = await prisma.userOrganization.findMany({
      where: { userId },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            subdomain: true,
            joinDate: true,
            expiryDate: true,
            status: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(userOrgs.map(uo => ({
      ...uo.organization,
      role: uo.role,
    })));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Get organization details (public - for public ticket submission)
router.get('/:orgSlug/public', identifyOrganization, async (req: OrgRequest, res: Response) => {
  try {
    const organizationId = req.organizationId!;

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        subdomain: true,
      },
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    res.json(organization);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Get organization details (authenticated - full details)
router.get('/:orgSlug', identifyOrganization, authenticate, verifyOrganizationAccess, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const organizationId = req.organizationId!;

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        _count: {
          select: {
            users: true,
            tickets: true,
            categories: true,
          },
        },
        users: {
          where: {
            role: 'ADMIN',
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          take: 1,
        },
      },
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    res.json(organization);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Create organization (authenticated users can create, but only one per user)
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { name, slug, subdomain } = createOrganizationSchema.parse(req.body);

    // Check if user already has an organization as admin (one org per admin)
    const existingUserOrg = await prisma.userOrganization.findFirst({
      where: {
        userId,
        role: 'ADMIN',
      },
      include: {
        organization: true,
      },
    });

    if (existingUserOrg) {
      return res.status(400).json({ 
        message: 'You already have an organization. Each admin can only have one organization.' 
      });
    }

    // Check if slug already exists
    const existingOrg = await prisma.organization.findFirst({
      where: {
        OR: [
          { slug: slug.toLowerCase().replace(/[^a-z0-9-]/g, '-') },
          ...(subdomain ? [{ subdomain: subdomain.toLowerCase() }] : []),
        ],
      },
    });

    if (existingOrg) {
      return res.status(400).json({ message: 'Organization slug or subdomain already exists' });
    }

    // Set expiry date to 1 year from now
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);

    const organization = await prisma.organization.create({
      data: {
        name,
        slug: slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        subdomain: subdomain?.toLowerCase() || null,
        joinDate: new Date(),
        expiryDate,
        status: 'ACTIVE',
      },
    });

    // Add creator as admin
    await prisma.userOrganization.create({
      data: {
        userId,
        organizationId: organization.id,
        role: 'ADMIN',
      },
    });

    res.status(201).json(organization);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    if ((error as any).code === 'P2002') {
      return res.status(400).json({ message: 'Organization slug or subdomain already exists' });
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Update organization (org admin only)
router.put('/:orgSlug', identifyOrganization, authenticate, requireOrgAdmin, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const organizationId = req.organizationId!;
    const data = updateOrganizationSchema.parse(req.body);

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    // Check if subdomain is being changed and if it's available
    if (data.subdomain && data.subdomain !== organization.subdomain) {
      const existingOrg = await prisma.organization.findUnique({
        where: { subdomain: data.subdomain },
      });
      if (existingOrg) {
        return res.status(400).json({ message: 'Subdomain already in use' });
      }
    }

    const updatedOrganization = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...data,
        subdomain: data.subdomain?.toLowerCase() || undefined,
      },
    });

    res.json(updatedOrganization);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    if ((error as any).code === 'P2002') {
      return res.status(400).json({ message: 'Subdomain already in use' });
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Get organization members
router.get('/:orgSlug/members', identifyOrganization, authenticate, verifyOrganizationAccess, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const organizationId = req.organizationId!;

    const members = await prisma.userOrganization.findMany({
      where: { organizationId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(members.map(m => ({
      ...m.user,
      role: m.role,
      joinedAt: m.createdAt,
    })));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Add member to organization (org admin only)
router.post('/:orgSlug/members', identifyOrganization, authenticate, requireOrgAdmin, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const organizationId = req.organizationId!;
    const { email, role } = z.object({
      email: z.string().email(),
      role: z.enum(['MEMBER', 'ADMIN']).optional().default('MEMBER'),
    }).parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if user is already a member
    const existingMember = await prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId,
        },
      },
    });

    if (existingMember) {
      return res.status(400).json({ message: 'User is already a member of this organization' });
    }

    const userOrg = await prisma.userOrganization.create({
      data: {
        userId: user.id,
        organizationId,
        role: role || 'MEMBER',
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.status(201).json({
      ...userOrg.user,
      role: userOrg.role,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    if ((error as any).code === 'P2002') {
      return res.status(400).json({ message: 'User is already a member' });
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Update member role (org admin only)
router.put('/:orgSlug/members/:userId', identifyOrganization, authenticate, requireOrgAdmin, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { userId: targetUserId } = req.params;
    const organizationId = req.organizationId!;
    const { role } = z.object({
      role: z.enum(['MEMBER', 'ADMIN']),
    }).parse(req.body);

    const userOrg = await prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId: targetUserId,
          organizationId,
        },
      },
    });

    if (!userOrg) {
      return res.status(404).json({ message: 'Member not found' });
    }

    const updated = await prisma.userOrganization.update({
      where: {
        userId_organizationId: {
          userId: targetUserId,
          organizationId,
        },
      },
      data: { role },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.json({
      ...updated.user,
      role: updated.role,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Remove member from organization (org admin only)
router.delete('/:orgSlug/members/:userId', identifyOrganization, authenticate, requireOrgAdmin, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { userId: targetUserId } = req.params;
    const organizationId = req.organizationId!;

    const userOrg = await prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId: targetUserId,
          organizationId,
        },
      },
    });

    if (!userOrg) {
      return res.status(404).json({ message: 'Member not found' });
    }

    await prisma.userOrganization.delete({
      where: {
        userId_organizationId: {
          userId: targetUserId,
          organizationId,
        },
      },
    });

    res.json({ message: 'Member removed successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

export default router;

