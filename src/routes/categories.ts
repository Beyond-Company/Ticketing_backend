import express, { Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { identifyOrganization, OrgRequest, verifyOrganizationAccess, requireOrgAdmin, getOrganizationFromUser } from '../middleware/organization';

const router = express.Router();

const createCategorySchema = z.object({
  name: z.string().min(2),
  nameAr: z.string().optional(),
});

const updateCategorySchema = z.object({
  name: z.string().min(2).optional(),
  nameAr: z.string().optional(),
});

// Get all categories (organization-scoped, public endpoint)
// For public endpoints, organization must be specified
router.get('/', identifyOrganization, async (req: OrgRequest, res: Response) => {
  try {
    const organizationId = req.organizationId!;
    const categories = await prisma.category.findMany({
      where: { organizationId },
      orderBy: {
        name: 'asc',
      },
    });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Get single category (organization-scoped)
router.get('/:id', identifyOrganization, async (req: OrgRequest, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.organizationId!;
    const category = await prisma.category.findFirst({
      where: { 
        id,
        organizationId,
      },
      include: {
        _count: {
          select: { tickets: true },
        },
      },
    });

    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    res.json(category);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Create category (org admin only)
router.post('/', authenticate, identifyOrganization, getOrganizationFromUser, requireOrgAdmin, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const organizationId = req.organizationId!;
    const data = createCategorySchema.parse(req.body);

    const category = await prisma.category.create({
      data: {
        ...data,
        organizationId,
      },
    });

    res.status(201).json(category);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    if ((error as any).code === 'P2002') {
      return res.status(400).json({ message: 'Category name already exists in this organization' });
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Update category (org admin only)
router.put('/:id', authenticate, identifyOrganization, getOrganizationFromUser, requireOrgAdmin, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.organizationId!;
    const data = updateCategorySchema.parse(req.body);

    const category = await prisma.category.findFirst({
      where: { 
        id,
        organizationId,
      },
    });

    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const updatedCategory = await prisma.category.update({
      where: { id },
      data,
    });

    res.json(updatedCategory);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    if ((error as any).code === 'P2002') {
      return res.status(400).json({ message: 'Category name already exists in this organization' });
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Delete category (org admin only)
router.delete('/:id', authenticate, identifyOrganization, getOrganizationFromUser, requireOrgAdmin, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.organizationId!;

    const category = await prisma.category.findFirst({
      where: { 
        id,
        organizationId,
      },
    });

    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    await prisma.category.delete({
      where: { id },
    });

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Assign category to user (org admin only)
router.post('/:id/assign-user', authenticate, identifyOrganization, getOrganizationFromUser, requireOrgAdmin, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { id: categoryId } = req.params;
    const organizationId = req.organizationId!;
    const { userId } = z.object({
      userId: z.string(),
    }).parse(req.body);

    // Verify category belongs to organization
    const category = await prisma.category.findFirst({
      where: { 
        id: categoryId,
        organizationId,
      },
    });

    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    // Verify user belongs to organization
    const userOrg = await prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
    });

    if (!userOrg) {
      return res.status(404).json({ message: 'User is not a member of this organization' });
    }

    // Check if assignment already exists
    const existingAssignment = await prisma.userCategoryAssignment.findUnique({
      where: {
        userId_categoryId: {
          userId,
          categoryId,
        },
      },
    });

    if (existingAssignment) {
      return res.status(400).json({ message: 'User is already assigned to this category' });
    }

    const assignment = await prisma.userCategoryAssignment.create({
      data: {
        userId,
        categoryId,
        organizationId,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
            nameAr: true,
          },
        },
      },
    });

    res.status(201).json(assignment);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    if ((error as any).code === 'P2002') {
      return res.status(400).json({ message: 'User is already assigned to this category' });
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Remove category assignment from user (org admin only)
router.delete('/:id/assign-user/:userId', authenticate, identifyOrganization, getOrganizationFromUser, requireOrgAdmin, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { id: categoryId, userId } = req.params;
    const organizationId = req.organizationId!;

    // Verify category belongs to organization
    const category = await prisma.category.findFirst({
      where: { 
        id: categoryId,
        organizationId,
      },
    });

    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const assignment = await prisma.userCategoryAssignment.findUnique({
      where: {
        userId_categoryId: {
          userId,
          categoryId,
        },
      },
    });

    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }

    await prisma.userCategoryAssignment.delete({
      where: {
        userId_categoryId: {
          userId,
          categoryId,
        },
      },
    });

    res.json({ message: 'Category assignment removed successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Get users assigned to a category
router.get('/:id/assigned-users', authenticate, identifyOrganization, getOrganizationFromUser, verifyOrganizationAccess, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { id: categoryId } = req.params;
    const organizationId = req.organizationId!;

    // Verify category belongs to organization
    const category = await prisma.category.findFirst({
      where: { 
        id: categoryId,
        organizationId,
      },
    });

    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const assignments = await prisma.userCategoryAssignment.findMany({
      where: {
        categoryId,
        organizationId,
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

    res.json(assignments.map(a => ({
      ...a.user,
      assignedAt: a.createdAt,
    })));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Get categories assigned to a user
router.get('/user/:userId/assignments', authenticate, identifyOrganization, getOrganizationFromUser, verifyOrganizationAccess, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const organizationId = req.organizationId!;

    // Verify user belongs to organization
    const userOrg = await prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
    });

    if (!userOrg) {
      return res.status(404).json({ message: 'User is not a member of this organization' });
    }

    const assignments = await prisma.userCategoryAssignment.findMany({
      where: {
        userId,
        organizationId,
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            nameAr: true,
          },
        },
      },
    });

    res.json(assignments.map(a => ({
      ...a.category,
      assignedAt: a.createdAt,
    })));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

export default router;

