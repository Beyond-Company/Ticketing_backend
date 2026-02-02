import express, { Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { identifyOrganization, OrgRequest, verifyOrganizationAccess, requireOrgAdmin, getOrganizationFromUser } from '../middleware/organization';

const router = express.Router();

const createStatusSchema = z.object({
  name: z.string().min(2),
  nameAr: z.string().optional(),
  color: z.string().optional(),
  order: z.number().int().optional(),
});

const updateStatusSchema = z.object({
  name: z.string().min(2).optional(),
  nameAr: z.string().optional(),
  color: z.string().optional(),
  order: z.number().int().optional(),
});

// Get all ticket statuses (organization-scoped, public for listing)
router.get('/', identifyOrganization, async (req: OrgRequest, res: Response) => {
  try {
    const organizationId = req.organizationId!;
    const statuses = await prisma.ticketStatus.findMany({
      where: { organizationId },
      orderBy: {
        order: 'asc',
      },
    });
    res.json(statuses);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Get single status (organization-scoped)
router.get('/:id', identifyOrganization, async (req: OrgRequest, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.organizationId!;
    const status = await prisma.ticketStatus.findFirst({
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

    if (!status) {
      return res.status(404).json({ message: 'Ticket status not found' });
    }

    res.json(status);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Create status (org admin only)
router.post('/', authenticate, identifyOrganization, getOrganizationFromUser, requireOrgAdmin, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const organizationId = req.organizationId!;
    const data = createStatusSchema.parse(req.body);

    const status = await prisma.ticketStatus.create({
      data: {
        ...data,
        organizationId,
      },
    });

    res.status(201).json(status);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    if ((error as any).code === 'P2002') {
      return res.status(400).json({ message: 'Status name already exists in this organization' });
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Update status (org admin only)
router.put('/:id', authenticate, identifyOrganization, getOrganizationFromUser, requireOrgAdmin, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.organizationId!;
    const data = updateStatusSchema.parse(req.body);

    const status = await prisma.ticketStatus.findFirst({
      where: {
        id,
        organizationId,
      },
    });

    if (!status) {
      return res.status(404).json({ message: 'Ticket status not found' });
    }

    const updatedStatus = await prisma.ticketStatus.update({
      where: { id },
      data,
    });

    res.json(updatedStatus);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    if ((error as any).code === 'P2002') {
      return res.status(400).json({ message: 'Status name already exists in this organization' });
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Delete status (org admin only) - only if no tickets use it, or reassign option
router.delete('/:id', authenticate, identifyOrganization, getOrganizationFromUser, requireOrgAdmin, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.organizationId!;

    const status = await prisma.ticketStatus.findFirst({
      where: {
        id,
        organizationId,
      },
      include: {
        _count: { select: { tickets: true } },
      },
    });

    if (!status) {
      return res.status(404).json({ message: 'Ticket status not found' });
    }

    if (status._count.tickets > 0) {
      return res.status(400).json({
        message: 'Cannot delete status: some tickets use it. Reassign those tickets to another status first.',
      });
    }

    await prisma.ticketStatus.delete({
      where: { id },
    });

    res.json({ message: 'Ticket status deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

export default router;
