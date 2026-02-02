import express, { Response } from 'express';
import prisma from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { identifyOrganization, OrgRequest, verifyOrganizationAccess, requireOrgAdmin, getOrganizationFromUser } from '../middleware/organization';

const router = express.Router();

// Get analytics/reports for organization
router.get('/analytics', authenticate, identifyOrganization, getOrganizationFromUser, requireOrgAdmin, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const organizationId = req.organizationId!;
    const { startDate, endDate } = req.query;

    const dateFilter: any = {};
    if (startDate) {
      dateFilter.gte = new Date(startDate as string);
    }
    if (endDate) {
      dateFilter.lte = new Date(endDate as string);
    }

    const where: any = { organizationId };
    if (Object.keys(dateFilter).length > 0) {
      where.createdAt = dateFilter;
    }

    // Get ticket counts by status (statusId)
    const ticketsByStatusRaw = await prisma.ticket.groupBy({
      by: ['statusId'],
      where,
      _count: true,
    });
    const statusIds = ticketsByStatusRaw.map(t => t.statusId).filter(Boolean) as string[];
    const statuses = await prisma.ticketStatus.findMany({
      where: { id: { in: statusIds } },
    });
    const ticketsByStatus = ticketsByStatusRaw.map(t => ({
      statusId: t.statusId,
      _count: t._count,
      status: statuses.find(s => s.id === t.statusId),
    }));

    // Get ticket counts by priority
    const ticketsByPriority = await prisma.ticket.groupBy({
      by: ['priority'],
      where,
      _count: true,
    });

    // Get ticket counts by category
    const ticketsByCategory = await prisma.ticket.groupBy({
      by: ['categoryId'],
      where,
      _count: true,
    });

    // Get category details
    const categoryIds = ticketsByCategory.map(t => t.categoryId).filter(Boolean) as string[];
    const categories = await prisma.category.findMany({
      where: { id: { in: categoryIds } },
    });

    const ticketsByCategoryWithNames = ticketsByCategory.map(t => ({
      categoryId: t.categoryId,
      count: t._count,
      category: categories.find(c => c.id === t.categoryId),
    }));

    // Get average resolution time (tickets with status name Resolved or Closed)
    const resolvedStatuses = await prisma.ticketStatus.findMany({
      where: {
        organizationId,
        name: { in: ['Resolved', 'Closed'] },
      },
      select: { id: true },
    });
    const resolvedStatusIds = resolvedStatuses.map(s => s.id);
    const resolvedTickets = await prisma.ticket.findMany({
      where: {
        ...where,
        statusId: resolvedStatusIds.length > 0 ? { in: resolvedStatusIds } : undefined,
        updatedAt: { not: null },
      },
      select: {
        createdAt: true,
        updatedAt: true,
      },
    });

    const resolutionTimes = resolvedTickets.map(ticket => {
      const created = new Date(ticket.createdAt).getTime();
      const updated = new Date(ticket.updatedAt).getTime();
      return (updated - created) / (1000 * 60 * 60); // Hours
    });

    const avgResolutionTime = resolutionTimes.length > 0
      ? resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length
      : 0;

    // Get tickets created over time (for trends)
    const ticketsOverTime = await prisma.ticket.findMany({
      where,
      select: {
        createdAt: true,
        statusId: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    // Group by date (byStatus key = statusId)
    const ticketsByDate: Record<string, { total: number; byStatus: Record<string, number> }> = {};
    ticketsOverTime.forEach(ticket => {
      const date = new Date(ticket.createdAt).toISOString().split('T')[0];
      if (!ticketsByDate[date]) {
        ticketsByDate[date] = { total: 0, byStatus: {} };
      }
      ticketsByDate[date].total++;
      const sid = ticket.statusId ?? '';
      ticketsByDate[date].byStatus[sid] = (ticketsByDate[date].byStatus[sid] || 0) + 1;
    });

    // Get top assignees
    const ticketsByAssignee = await prisma.ticket.groupBy({
      by: ['assignedTo'],
      where: {
        ...where,
        assignedTo: { not: null },
      },
      _count: true,
    });

    const assigneeIds = ticketsByAssignee.map(t => t.assignedTo).filter(Boolean) as string[];
    const assignees = await prisma.user.findMany({
      where: { id: { in: assigneeIds } },
      select: { id: true, name: true, email: true },
    });

    const ticketsByAssigneeWithNames = ticketsByAssignee.map(t => ({
      assignedTo: t.assignedTo,
      count: t._count,
      user: assignees.find(u => u.id === t.assignedTo),
    }));

    res.json({
      ticketsByStatus,
      ticketsByPriority,
      ticketsByCategory: ticketsByCategoryWithNames,
      ticketsByAssignee: ticketsByAssigneeWithNames,
      avgResolutionTime: Math.round(avgResolutionTime * 100) / 100, // Round to 2 decimals
      ticketsOverTime: Object.entries(ticketsByDate).map(([date, data]) => ({
        date,
        ...data,
      })),
      totalTickets: await prisma.ticket.count({ where }),
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Export tickets to CSV
router.get('/export', authenticate, identifyOrganization, getOrganizationFromUser, requireOrgAdmin, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const organizationId = req.organizationId!;
    const { format = 'csv', startDate, endDate, status, priority } = req.query;

    const where: any = { organizationId };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }
    if (status && status !== 'all') where.statusId = status;
    if (priority) where.priority = priority;

    const tickets = await prisma.ticket.findMany({
      where,
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
        assignedUser: {
          select: {
            name: true,
            email: true,
          },
        },
        category: true,
        status: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (format === 'csv') {
      const csvHeaders = ['ID', 'Title', 'Status', 'Priority', 'Category', 'Created By', 'Assigned To', 'Created At', 'Updated At'];
      const csvRows = tickets.map(ticket => [
        ticket.id,
        ticket.title,
        ticket.status?.name ?? '',
        ticket.priority,
        ticket.category?.name || '',
        ticket.user?.name || ticket.submitterEmail || '',
        ticket.assignedUser?.name || '',
        ticket.createdAt.toISOString(),
        ticket.updatedAt.toISOString(),
      ]);

      const csv = [
        csvHeaders.join(','),
        ...csvRows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=tickets-${Date.now()}.csv`);
      res.send(csv);
    } else {
      res.json(tickets);
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

export default router;
