import express, { Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { authenticate, AuthRequest, requireSuperAdmin } from '../middleware/auth';

const router = express.Router();

// Get all organizations (superadmin only)
router.get('/organizations', authenticate, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const organizations = await prisma.organization.findMany({
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
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(organizations.map(org => ({
      ...org,
      admin: org.users[0]?.user || null,
    })));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Get all users (superadmin only)
router.get('/users', authenticate, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        _count: {
          select: {
            organizations: true,
            tickets: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(users);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Get all categories (superadmin only)
router.get('/categories', authenticate, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const categories = await prisma.category.findMany({
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        _count: {
          select: {
            tickets: true,
            userAssignments: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Get analytics/dashboard data (superadmin only)
router.get('/analytics', authenticate, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const [
      totalUsers,
      totalOrganizations,
      totalTickets,
      activeOrganizations,
      inactiveOrganizations,
      expiredOrganizations,
      usersByRole,
      ticketsByStatus,
      recentOrganizations,
      recentUsers,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.organization.count(),
      prisma.ticket.count(),
      prisma.organization.count({ where: { status: 'ACTIVE' } }),
      prisma.organization.count({ where: { status: 'INACTIVE' } }),
      prisma.organization.count({ 
        where: { 
          OR: [
            { status: 'EXPIRED' },
            { 
              expiryDate: { 
                lt: new Date() 
              },
              status: { not: 'EXPIRED' }
            }
          ]
        } 
      }),
      prisma.user.groupBy({
        by: ['role'],
        _count: true,
      }),
      prisma.ticket.groupBy({
        by: ['status'],
        _count: true,
      }),
      prisma.organization.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: {
              users: true,
              tickets: true,
            },
          },
        },
      }),
      prisma.user.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
        },
      }),
    ]);

    res.json({
      overview: {
        totalUsers,
        totalOrganizations,
        totalTickets,
        activeOrganizations,
        inactiveOrganizations,
        expiredOrganizations,
      },
      usersByRole: usersByRole.reduce((acc, item) => {
        acc[item.role] = item._count;
        return acc;
      }, {} as Record<string, number>),
      ticketsByStatus: ticketsByStatus.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {} as Record<string, number>),
      recentOrganizations,
      recentUsers,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Update organization status (superadmin only)
router.put('/organizations/:orgId/status', authenticate, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { orgId } = req.params;
    const { status, expiryDate } = z.object({
      status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'EXPIRED']).optional(),
      expiryDate: z.union([z.string().datetime(), z.null()]).optional(),
    }).parse(req.body);

    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    const updateData: any = {};
    if (status !== undefined) {
      updateData.status = status;
    }
    if (expiryDate !== undefined) {
      updateData.expiryDate = expiryDate === null ? null : new Date(expiryDate);
    }

    const updated = await prisma.organization.update({
      where: { id: orgId },
      data: updateData,
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Delete organization (superadmin only)
router.delete('/organizations/:orgId', authenticate, requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { orgId } = req.params;

    await prisma.organization.delete({
      where: { id: orgId },
    });

    res.json({ message: 'Organization deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

export default router;

