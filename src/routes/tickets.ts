import express, { Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { identifyOrganization, OrgRequest, verifyOrganizationAccess, requireOrgAdmin, getOrganizationFromUser } from '../middleware/organization';
import { sendTicketStatusChangeEmail, sendTicketCommentEmail, sendTicketAssignmentEmail, sendTicketSubmissionEmail } from '../utils/email';
import { logTicketChange, logTicketAction } from '../utils/activityLog';
import { createNotification, createNotificationsForUsers } from '../utils/notifications';
import { upload, deleteFile } from '../utils/fileUpload';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

const router = express.Router();

const createTicketSchema = z.object({
  title: z.string().min(3),
  description: z.string().min(10),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  categoryId: z.string().optional(),
  submitterName: z.string().optional(), // For public submissions
  submitterEmail: z.string().email().optional(), // For public submissions (required for public tickets)
});

// Schema for public ticket submission (requires submitterEmail and submitterName)
const createPublicTicketSchema = z.object({
  title: z.string().min(3),
  description: z.string().min(10),
  categoryId: z.string().optional(),
  submitterName: z.string().min(2, { message: 'Name is required (min 2 characters)' }),
  submitterEmail: z.string().email({ message: 'Valid email is required for ticket submission' }), // Required for public tickets
});

const updateTicketSchema = z.object({
  title: z.string().min(3).optional(),
  description: z.string().min(10).optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assignedTo: z.string().optional(),
  categoryId: z.string().optional().nullable(),
});

// Get all tickets (organization-scoped) with search, filtering, and sorting
router.get('/', authenticate, identifyOrganization, getOrganizationFromUser, verifyOrganizationAccess, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const userRole = req.userRole!;
    const organizationId = req.organizationId!;

    // Query parameters for search, filtering, and sorting
    const {
      search,
      status,
      priority,
      categoryId,
      assignedTo,
      userId: filterUserId,
      dateFrom,
      dateTo,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    // Check if user is org admin or global admin
    const userOrg = await prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
    });

    const isOrgAdmin = userOrg?.role === 'ADMIN' || userRole === 'ADMIN';

    // Build where clause
    const where: any = { organizationId };

    // Access control: non-admins only see their tickets
    if (!isOrgAdmin) {
      where.userId = userId;
    }

    // Search filter (searches in title, description, comments, submitter name, and submitter email)
    if (search && typeof search === 'string') {
      const searchTerm = search.toLowerCase();
      where.OR = [
        { title: { contains: searchTerm, mode: 'insensitive' } },
        { description: { contains: searchTerm, mode: 'insensitive' } },
        { submitterName: { contains: searchTerm, mode: 'insensitive' } },
        { submitterEmail: { contains: searchTerm, mode: 'insensitive' } },
        {
          comments: {
            some: {
              content: { contains: searchTerm, mode: 'insensitive' },
            },
          },
        },
        {
          user: {
            OR: [
              { name: { contains: searchTerm, mode: 'insensitive' } },
              { email: { contains: searchTerm, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    // Status filter
    if (status && typeof status === 'string' && status !== 'all') {
      where.status = status;
    }

    // Priority filter
    if (priority && typeof priority === 'string') {
      where.priority = priority;
    }

    // Category filter
    if (categoryId && typeof categoryId === 'string') {
      where.categoryId = categoryId;
    }

    // Assigned to filter
    if (assignedTo && typeof assignedTo === 'string') {
      if (assignedTo === 'unassigned') {
        where.assignedTo = null;
      } else {
        where.assignedTo = assignedTo;
      }
    }

    // User filter (for admins)
    if (filterUserId && typeof filterUserId === 'string' && isOrgAdmin) {
      where.userId = filterUserId;
    }

    // Date range filter
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        where.createdAt.gte = new Date(dateFrom as string);
      }
      if (dateTo) {
        where.createdAt.lte = new Date(dateTo as string);
      }
    }

    // Build orderBy clause
    const orderBy: any = {};
    const validSortFields = ['createdAt', 'updatedAt', 'title', 'priority', 'status'];
    const sortField = (typeof sortBy === 'string' && validSortFields.includes(sortBy)) ? sortBy : 'createdAt';
    orderBy[sortField] = sortOrder === 'asc' ? 'asc' : 'desc';

    const tickets = await prisma.ticket.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        category: true,
        comments: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
            attachments: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        attachments: true,
        _count: {
          select: {
            comments: true,
            attachments: true,
          },
        },
      },
      orderBy,
    });

    res.json(tickets);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Get single ticket (organization-scoped)
router.get('/:id', authenticate, identifyOrganization, getOrganizationFromUser, verifyOrganizationAccess, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const userRole = req.userRole!;
    const organizationId = req.organizationId!;

    const ticket = await prisma.ticket.findFirst({
      where: { 
        id,
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
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        category: true,
        comments: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
            attachments: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        attachments: true,
        activityLogs: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
        timeEntries: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: {
            date: 'desc',
          },
        },
      },
    });

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    // Check if user is org admin
    const userOrg = await prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
    });

    const isOrgAdmin = userOrg?.role === 'ADMIN' || userRole === 'ADMIN';

    if (!isOrgAdmin && ticket.userId !== userId && ticket.assignedTo !== userId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(ticket);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Public ticket tracking (no auth required) - token as query parameter
router.get('/public', identifyOrganization, async (req: OrgRequest, res: Response) => {
  try {
    const token = req.query.token as string;
    const organizationId = req.organizationId!;
    
    if (!token) {
      return res.status(400).json({ message: 'Tracking token is required' });
    }

    const ticket = await prisma.ticket.findFirst({
      where: { 
        publicToken: token,
        organizationId,
      },
      include: {
        category: true,
        comments: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    // Return limited info for public view
    res.json({
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      category: ticket.category,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      comments: ticket.comments,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Create ticket (authenticated)
router.post('/', authenticate, identifyOrganization, getOrganizationFromUser, verifyOrganizationAccess, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const organizationId = req.organizationId!;
    const { title, description, priority, categoryId } = createTicketSchema.parse(req.body);

    // Verify category belongs to organization if provided
    let category = null;
    if (categoryId) {
      category = await prisma.category.findFirst({
        where: {
          id: categoryId,
          organizationId,
        },
      });
      if (!category) {
        return res.status(400).json({ message: 'Category not found in this organization' });
      }
    }

    // Generate a simple 8-character alphanumeric token
    const generateSimpleToken = () => {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars like 0, O, I, 1
      let token = '';
      for (let i = 0; i < 8; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return token;
    };
    
    // Ensure token is unique
    let publicToken = generateSimpleToken();
    let tokenExists = await prisma.ticket.findUnique({ where: { publicToken } });
    let attempts = 0;
    while (tokenExists && attempts < 10) {
      publicToken = generateSimpleToken();
      tokenExists = await prisma.ticket.findUnique({ where: { publicToken } });
      attempts++;
    }

    // Auto-assign ticket based on category assignment (get first assigned user for ticket assignment)
    let assignedUserId: string | null = null;
    let allAssignedUsers: Array<{ id: string; email: string; name: string }> = [];
    if (categoryId) {
      const assignments = await prisma.userCategoryAssignment.findMany({
        where: {
          categoryId,
          organizationId,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
      });

      if (assignments.length > 0) {
        assignedUserId = assignments[0].userId; // Assign to first user
        allAssignedUsers = assignments.map(a => a.user);
      }
    }

    const ticket = await prisma.ticket.create({
      data: {
        title,
        description,
        priority: priority || 'MEDIUM',
        categoryId: categoryId || null,
        userId,
        organizationId,
        publicToken,
        assignedTo: assignedUserId || null,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        category: true,
        comments: true,
        organization: {
          select: {
            slug: true,
          },
        },
      },
    });

    // Log ticket creation
    await logTicketAction(ticket.id, userId, 'TICKET_CREATED', {
      title: ticket.title,
      priority: ticket.priority,
      categoryId: ticket.categoryId,
    });

    // Create notification for ticket creator
    await createNotification({
      userId,
      type: 'TICKET_CREATED',
      title: 'Ticket Created',
      message: `Your ticket "${ticket.title}" has been created successfully.`,
      ticketId: ticket.id,
    });

    // Send email notification to ticket submitter
    if (ticket.user?.email) {
      sendTicketSubmissionEmail(
        ticket.user.email,
        ticket.title,
        ticket.id,
        ticket.publicToken,
        ticket.organization.slug,
        'en' // TODO: Get user's preferred language
      ).catch(err => console.error('Failed to send ticket submission email:', err));
    }

    // Send email notification to ALL assigned users if ticket was auto-assigned
    if (allAssignedUsers.length > 0 && category) {
      allAssignedUsers.forEach(assignedUser => {
        sendTicketAssignmentEmail(
          assignedUser.email,
          ticket.title,
          ticket.id,
          category.name,
          ticket.organization.slug,
          'en' // TODO: Get user's preferred language
        ).catch(err => console.error(`Failed to send ticket assignment email to ${assignedUser.email}:`, err));

        // Create in-app notification for each assigned user
        createNotification({
          userId: assignedUser.id,
          type: 'TICKET_ASSIGNED',
          title: 'Ticket Assigned',
          message: `You have been assigned to ticket "${ticket.title}".`,
          ticketId: ticket.id,
        }).catch(err => console.error(`Failed to create notification for user ${assignedUser.id}:`, err));
      });
    }

    res.status(201).json(ticket);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Public ticket submission (no auth required)
router.post('/public', identifyOrganization, async (req: OrgRequest, res: Response) => {
  try {
    const organizationId = req.organizationId!;
    const { title, description, categoryId, submitterName, submitterEmail } = createPublicTicketSchema.parse(req.body);

    // Verify category belongs to organization if provided
    let category = null;
    if (categoryId) {
      category = await prisma.category.findFirst({
        where: {
          id: categoryId,
          organizationId,
        },
      });
      if (!category) {
        return res.status(400).json({ message: 'Category not found in this organization' });
      }
    }

    // Generate a simple 8-character alphanumeric token
    const generateSimpleToken = () => {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars like 0, O, I, 1
      let token = '';
      for (let i = 0; i < 8; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return token;
    };
    
    // Ensure token is unique
    let publicToken = generateSimpleToken();
    let tokenExists = await prisma.ticket.findUnique({ where: { publicToken } });
    let attempts = 0;
    while (tokenExists && attempts < 10) {
      publicToken = generateSimpleToken();
      tokenExists = await prisma.ticket.findUnique({ where: { publicToken } });
      attempts++;
    }

    // Auto-assign ticket based on category assignment (get first assigned user for ticket assignment)
    let assignedUserId: string | null = null;
    let allAssignedUsers: Array<{ id: string; email: string; name: string }> = [];
    if (categoryId) {
      const assignments = await prisma.userCategoryAssignment.findMany({
        where: {
          categoryId,
          organizationId,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
      });

      if (assignments.length > 0) {
        assignedUserId = assignments[0].userId; // Assign to first user
        allAssignedUsers = assignments.map(a => a.user);
      }
    }

    // Create ticket without userId (public submission)
    // Priority defaults to MEDIUM for public tickets (users can't set priority)
    const ticket = await prisma.ticket.create({
      data: {
        title,
        description,
        priority: 'MEDIUM', // Default priority for public tickets
        categoryId: categoryId || null,
        organizationId,
        publicToken,
        submitterName: submitterName || null, // Store submitter name for public tickets
        submitterEmail: submitterEmail || null, // Store submitter email for public tickets
        assignedTo: assignedUserId || null,
      },
      include: {
        category: true,
        organization: {
          select: {
            slug: true,
          },
        },
      },
    });

    // Send email notification to ticket submitter
    if (submitterEmail) {
      sendTicketSubmissionEmail(
        submitterEmail,
        ticket.title,
        ticket.id,
        publicToken,
        ticket.organization.slug,
        'en' // TODO: Get user's preferred language
      ).catch(err => console.error('Failed to send ticket submission email:', err));
    }

    // Send email notification to ALL assigned users if ticket was auto-assigned
    if (allAssignedUsers.length > 0 && category) {
      allAssignedUsers.forEach(assignedUser => {
        sendTicketAssignmentEmail(
          assignedUser.email,
          ticket.title,
          ticket.id,
          category.name,
          ticket.organization.slug,
          'en' // TODO: Get user's preferred language
        ).catch(err => console.error(`Failed to send ticket assignment email to ${assignedUser.email}:`, err));
      });
    }

    res.status(201).json({
      ...ticket,
      publicToken, // Return token so user can track the ticket
      message: 'Ticket submitted successfully. Use the publicToken to track your ticket.',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Update ticket (organization-scoped)
router.put('/:id', authenticate, identifyOrganization, getOrganizationFromUser, verifyOrganizationAccess, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const userRole = req.userRole!;
    const organizationId = req.organizationId!;
    const data = updateTicketSchema.parse(req.body);

    const ticket = await prisma.ticket.findFirst({
      where: { 
        id,
        organizationId,
      },
      include: {
        organization: {
          select: {
            slug: true,
          },
        },
      },
    });

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    // Check if user is org admin
    const userOrg = await prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
    });

    const isOrgAdmin = userOrg?.role === 'ADMIN' || userRole === 'ADMIN';

    if (!isOrgAdmin && ticket.userId !== userId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Verify category belongs to organization if provided and handle auto-assignment
    let category = null;
    if (data.categoryId !== undefined) {
      if (data.categoryId) {
        category = await prisma.category.findFirst({
          where: {
            id: data.categoryId,
            organizationId,
          },
        });
        if (!category) {
          return res.status(400).json({ message: 'Category not found in this organization' });
        }

        // Auto-assign if category changed and ticket is not already assigned
        if (!ticket.assignedTo) {
          const assignment = await prisma.userCategoryAssignment.findFirst({
            where: {
              categoryId: data.categoryId,
              organizationId,
            },
          });

          if (assignment) {
            data.assignedTo = assignment.userId;
          }
        }
      }
    }

    // Store old values for activity logging
    const oldStatus = ticket.status;
    const oldPriority = ticket.priority;
    const oldAssignedTo = ticket.assignedTo;
    const oldCategoryId = ticket.categoryId;
    const oldTitle = ticket.title;
    const oldDescription = ticket.description;

    const statusChanged = data.status !== undefined && data.status !== oldStatus;
    const priorityChanged = data.priority !== undefined && data.priority !== oldPriority;
    const assignmentChanged = data.assignedTo !== undefined && data.assignedTo !== oldAssignedTo;
    const categoryChanged = data.categoryId !== undefined && data.categoryId !== oldCategoryId;
    const titleChanged = data.title !== undefined && data.title !== oldTitle;
    const descriptionChanged = data.description !== undefined && data.description !== oldDescription;

    const updatedTicket = await prisma.ticket.update({
      where: { id },
      data: {
        ...data,
        categoryId: data.categoryId === undefined ? undefined : (data.categoryId || null),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        category: true,
        comments: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
              },
            },
            attachments: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        attachments: true,
      },
    });

    // Log all changes
    if (statusChanged) {
      await logTicketChange(id, userId, 'status', oldStatus, updatedTicket.status);
    }
    if (priorityChanged) {
      await logTicketChange(id, userId, 'priority', oldPriority, updatedTicket.priority);
    }
    if (assignmentChanged) {
      await logTicketChange(id, userId, 'assignedTo', oldAssignedTo, updatedTicket.assignedTo);
    }
    if (categoryChanged) {
      await logTicketChange(id, userId, 'categoryId', oldCategoryId, updatedTicket.categoryId);
    }
    if (titleChanged) {
      await logTicketChange(id, userId, 'title', oldTitle, updatedTicket.title);
    }
    if (descriptionChanged) {
      await logTicketChange(id, userId, 'description', oldDescription, updatedTicket.description);
    }

    // Create notifications
    const submitterUserId = updatedTicket.user?.id;
    if (statusChanged && submitterUserId) {
      await createNotification({
        userId: submitterUserId,
        type: 'TICKET_STATUS_CHANGED',
        title: 'Ticket Status Updated',
        message: `Ticket "${updatedTicket.title}" status changed from ${oldStatus} to ${updatedTicket.status}.`,
        ticketId: updatedTicket.id,
      });
    }

    if (assignmentChanged && updatedTicket.assignedTo) {
      await createNotification({
        userId: updatedTicket.assignedTo,
        type: 'TICKET_ASSIGNED',
        title: 'Ticket Assigned',
        message: `You have been assigned to ticket "${updatedTicket.title}".`,
        ticketId: updatedTicket.id,
      });
    }

    // Send email notification if status changed and ticket has a submitter
    const submitterEmail = updatedTicket.user?.email || ticket.submitterEmail;
    if (statusChanged && submitterEmail) {
      sendTicketStatusChangeEmail(
        submitterEmail,
        updatedTicket.title,
        oldStatus,
        updatedTicket.status,
        updatedTicket.id,
        ticket.publicToken,
        ticket.organization.slug,
        'en'
      ).catch(err => console.error('Failed to send status change email:', err));
    }

    // Send email notification if ticket was assigned to a user
    if (assignmentChanged && updatedTicket.assignedTo && category) {
      const assignedUser = await prisma.user.findUnique({
        where: { id: updatedTicket.assignedTo },
        select: { email: true },
      });

      if (assignedUser) {
        sendTicketAssignmentEmail(
          assignedUser.email,
          updatedTicket.title,
          updatedTicket.id,
          category.name,
          ticket.organization.slug,
          'en'
        ).catch(err => console.error('Failed to send ticket assignment email:', err));
      }
    }

    res.json(updatedTicket);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Delete ticket (organization-scoped, org admin only)
router.delete('/:id', authenticate, identifyOrganization, getOrganizationFromUser, requireOrgAdmin, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const organizationId = req.organizationId!;

    const ticket = await prisma.ticket.findFirst({
      where: { 
        id,
        organizationId,
      },
      include: {
        attachments: true,
      },
    });

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    // Delete all attachments
    for (const attachment of ticket.attachments) {
      deleteFile(attachment.filename);
    }

    // Log deletion
    await logTicketAction(id, userId, 'TICKET_DELETED', {
      title: ticket.title,
    });

    await prisma.ticket.delete({
      where: { id },
    });

    res.json({ message: 'Ticket deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Add comment (organization-scoped)
router.post('/:id/comments', authenticate, identifyOrganization, getOrganizationFromUser, verifyOrganizationAccess, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const organizationId = req.organizationId!;
    const { content } = z.object({ content: z.string().min(1) }).parse(req.body);

    const ticket = await prisma.ticket.findFirst({
      where: { 
        id,
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
        organization: {
          select: {
            slug: true,
          },
        },
      },
    });

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    // Get comment author info
    const commentAuthor = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
      },
    });

    const comment = await prisma.comment.create({
      data: {
        content,
        ticketId: id,
        userId,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
          },
        },
        attachments: true,
      },
    });

    // Log comment creation
    await logTicketAction(id, userId, 'COMMENT_ADDED', {
      commentId: comment.id,
      commentAuthor: commentAuthor?.name,
    });

    // Create notifications for ticket owner and assigned user
    const notifyUserIds: string[] = [];
    if (ticket.userId && ticket.userId !== userId) {
      notifyUserIds.push(ticket.userId);
    }
    if (ticket.assignedTo && ticket.assignedTo !== userId && !notifyUserIds.includes(ticket.assignedTo)) {
      notifyUserIds.push(ticket.assignedTo);
    }

    if (notifyUserIds.length > 0) {
      await createNotificationsForUsers(notifyUserIds, {
        type: 'COMMENT_ADDED',
        title: 'New Comment',
        message: `${commentAuthor?.name || 'Someone'} added a comment to ticket "${ticket.title}".`,
        ticketId: ticket.id,
      });
    }

    // Send email notification to ticket submitter if they exist and are not the comment author
    const submitterEmail = ticket.user?.email || ticket.submitterEmail;
    if (submitterEmail && ticket.userId !== userId) {
      sendTicketCommentEmail(
        submitterEmail,
        ticket.title,
        content,
        commentAuthor?.name || 'Support Team',
        ticket.id,
        ticket.publicToken,
        ticket.organization.slug,
        'en'
      ).catch(err => console.error('Failed to send comment email:', err));
    }

    res.status(201).json(comment);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Edit comment
router.put('/:id/comments/:commentId', authenticate, identifyOrganization, getOrganizationFromUser, verifyOrganizationAccess, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { id, commentId } = req.params;
    const userId = req.userId!;
    const organizationId = req.organizationId!;
    const { content } = z.object({ content: z.string().min(1) }).parse(req.body);

    const ticket = await prisma.ticket.findFirst({
      where: { id, organizationId },
    });

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const comment = await prisma.comment.findFirst({
      where: { id: commentId, ticketId: id },
    });

    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    // Only comment author can edit
    if (comment.userId !== userId) {
      return res.status(403).json({ message: 'You can only edit your own comments' });
    }

    const updatedComment = await prisma.comment.update({
      where: { id: commentId },
      data: {
        content,
        isEdited: true,
        editedAt: new Date(),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
          },
        },
        attachments: true,
      },
    });

    await logTicketAction(id, userId, 'COMMENT_EDITED', {
      commentId: commentId,
    });

    res.json(updatedComment);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Delete comment
router.delete('/:id/comments/:commentId', authenticate, identifyOrganization, getOrganizationFromUser, verifyOrganizationAccess, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { id, commentId } = req.params;
    const userId = req.userId!;
    const organizationId = req.organizationId!;

    const ticket = await prisma.ticket.findFirst({
      where: { id, organizationId },
    });

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const comment = await prisma.comment.findFirst({
      where: { id: commentId, ticketId: id },
      include: { attachments: true },
    });

    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    // Check permissions: comment author or org admin
    const userOrg = await prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
    });

    const isOrgAdmin = userOrg?.role === 'ADMIN';
    if (comment.userId !== userId && !isOrgAdmin) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Delete attachments
    for (const attachment of comment.attachments) {
      deleteFile(attachment.filename);
    }

    await prisma.comment.delete({
      where: { id: commentId },
    });

    await logTicketAction(id, userId, 'COMMENT_DELETED', {
      commentId: commentId,
    });

    res.json({ message: 'Comment deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Upload attachment to ticket (public - for public ticket submissions)
router.post('/:id/attachments/public', identifyOrganization, upload.single('file'), async (req: OrgRequest, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.organizationId!;

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const ticket = await prisma.ticket.findFirst({
      where: { 
        id, 
        organizationId,
        publicToken: { not: null }, // Only allow for public tickets
      },
    });

    if (!ticket) {
      deleteFile(req.file.filename);
      return res.status(404).json({ message: 'Ticket not found or not a public ticket' });
    }

    const attachment = await prisma.attachment.create({
      data: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        path: req.file.path,
        ticketId: id,
        uploadedBy: null, // No user for public submissions
      },
    });

    res.status(201).json(attachment);
  } catch (error) {
    if (req.file) {
      deleteFile(req.file.filename);
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Upload attachment to ticket (authenticated)
router.post('/:id/attachments', authenticate, identifyOrganization, getOrganizationFromUser, verifyOrganizationAccess, upload.single('file'), async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const organizationId = req.organizationId!;

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const ticket = await prisma.ticket.findFirst({
      where: { id, organizationId },
    });

    if (!ticket) {
      deleteFile(req.file.filename);
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const attachment = await prisma.attachment.create({
      data: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        path: req.file.path,
        ticketId: id,
        uploadedBy: userId,
      },
    });

    await logTicketAction(id, userId, 'ATTACHMENT_ADDED', {
      attachmentId: attachment.id,
      filename: attachment.originalName,
    });

    res.status(201).json(attachment);
  } catch (error) {
    if (req.file) {
      deleteFile(req.file.filename);
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Upload attachment to comment
router.post('/:id/comments/:commentId/attachments', authenticate, identifyOrganization, getOrganizationFromUser, verifyOrganizationAccess, upload.single('file'), async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { id, commentId } = req.params;
    const userId = req.userId!;
    const organizationId = req.organizationId!;

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const ticket = await prisma.ticket.findFirst({
      where: { id, organizationId },
    });

    if (!ticket) {
      deleteFile(req.file.filename);
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const comment = await prisma.comment.findFirst({
      where: { id: commentId, ticketId: id },
    });

    if (!comment) {
      deleteFile(req.file.filename);
      return res.status(404).json({ message: 'Comment not found' });
    }

    const attachment = await prisma.attachment.create({
      data: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        path: req.file.path,
        commentId: commentId,
        uploadedBy: userId,
      },
    });

    res.status(201).json(attachment);
  } catch (error) {
    if (req.file) {
      deleteFile(req.file.filename);
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Delete attachment
router.delete('/attachments/:attachmentId', authenticate, identifyOrganization, getOrganizationFromUser, verifyOrganizationAccess, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { attachmentId } = req.params;
    const userId = req.userId!;
    const organizationId = req.organizationId!;

    const attachment = await prisma.attachment.findFirst({
      where: { id: attachmentId },
      include: {
        ticket: true,
        comment: {
          include: {
            ticket: true,
          },
        },
      },
    });

    if (!attachment) {
      return res.status(404).json({ message: 'Attachment not found' });
    }

    // Check organization access
    const ticketOrgId = attachment.ticket?.organizationId || attachment.comment?.ticket.organizationId;
    if (ticketOrgId !== organizationId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check permissions: uploader or org admin
    const userOrg = await prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
    });

    const isOrgAdmin = userOrg?.role === 'ADMIN';
    if (attachment.uploadedBy !== userId && !isOrgAdmin) {
      return res.status(403).json({ message: 'Access denied' });
    }

    deleteFile(attachment.filename);

    const ticketId = attachment.ticketId || attachment.comment?.ticketId;
    if (ticketId) {
      await logTicketAction(ticketId, userId, 'ATTACHMENT_DELETED', {
        attachmentId: attachment.id,
        filename: attachment.originalName,
      });
    }

    await prisma.attachment.delete({
      where: { id: attachmentId },
    });

    res.json({ message: 'Attachment deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Get attachment file
router.get('/attachments/:attachmentId/file', authenticate, identifyOrganization, getOrganizationFromUser, verifyOrganizationAccess, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { attachmentId } = req.params;
    const organizationId = req.organizationId!;

    const attachment = await prisma.attachment.findFirst({
      where: { id: attachmentId },
      include: {
        ticket: true,
        comment: {
          include: {
            ticket: true,
          },
        },
      },
    });

    if (!attachment) {
      return res.status(404).json({ message: 'Attachment not found' });
    }

    const ticketOrgId = attachment.ticket?.organizationId || attachment.comment?.ticket.organizationId;
    if (ticketOrgId !== organizationId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const filePath = path.join(process.cwd(), 'uploads', attachment.filename);
    res.download(filePath, attachment.originalName);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Bulk operations
router.post('/bulk', authenticate, identifyOrganization, getOrganizationFromUser, verifyOrganizationAccess, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const organizationId = req.organizationId!;
    const { ticketIds, action, data } = z.object({
      ticketIds: z.array(z.string()),
      action: z.enum(['update', 'delete', 'assign', 'changeStatus', 'changePriority']),
      data: z.record(z.any()).optional(),
    }).parse(req.body);

    // Check if user is org admin
    const userOrg = await prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
    });

    const isOrgAdmin = userOrg?.role === 'ADMIN';
    if (!isOrgAdmin) {
      return res.status(403).json({ message: 'Only admins can perform bulk operations' });
    }

    // Verify all tickets belong to organization
    const tickets = await prisma.ticket.findMany({
      where: {
        id: { in: ticketIds },
        organizationId,
      },
    });

    if (tickets.length !== ticketIds.length) {
      return res.status(400).json({ message: 'Some tickets not found or access denied' });
    }

    let result;
    switch (action) {
      case 'update':
        result = await prisma.ticket.updateMany({
          where: { id: { in: ticketIds } },
          data: data || {},
        });
        // Log bulk update
        for (const ticketId of ticketIds) {
          await logTicketAction(ticketId, userId, 'BULK_UPDATE', data);
        }
        break;

      case 'delete':
        // Delete attachments first
        const attachments = await prisma.attachment.findMany({
          where: { ticketId: { in: ticketIds } },
        });
        for (const attachment of attachments) {
          deleteFile(attachment.filename);
        }
        result = await prisma.ticket.deleteMany({
          where: { id: { in: ticketIds } },
        });
        break;

      case 'assign':
        result = await prisma.ticket.updateMany({
          where: { id: { in: ticketIds } },
          data: { assignedTo: data?.assignedTo || null },
        });
        for (const ticketId of ticketIds) {
          await logTicketChange(ticketId, userId, 'assignedTo', null, data?.assignedTo);
        }
        break;

      case 'changeStatus':
        result = await prisma.ticket.updateMany({
          where: { id: { in: ticketIds } },
          data: { status: data?.status },
        });
        for (const ticketId of ticketIds) {
          await logTicketChange(ticketId, userId, 'status', null, data?.status);
        }
        break;

      case 'changePriority':
        result = await prisma.ticket.updateMany({
          where: { id: { in: ticketIds } },
          data: { priority: data?.priority },
        });
        for (const ticketId of ticketIds) {
          await logTicketChange(ticketId, userId, 'priority', null, data?.priority);
        }
        break;

      default:
        return res.status(400).json({ message: 'Invalid action' });
    }

    res.json({ message: `Bulk ${action} completed`, count: result.count });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Get activity logs for a ticket
router.get('/:id/activity', authenticate, identifyOrganization, getOrganizationFromUser, verifyOrganizationAccess, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.organizationId!;

    const ticket = await prisma.ticket.findFirst({
      where: { id, organizationId },
    });

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const logs = await prisma.activityLog.findMany({
      where: { ticketId: id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json(logs);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Add time entry
router.post('/:id/time', authenticate, identifyOrganization, getOrganizationFromUser, verifyOrganizationAccess, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const organizationId = req.organizationId!;
    const { hours, minutes, description, date } = z.object({
      hours: z.number().min(0),
      minutes: z.number().min(0).max(59).optional(),
      description: z.string().optional(),
      date: z.string().optional(),
    }).parse(req.body);

    const ticket = await prisma.ticket.findFirst({
      where: { id, organizationId },
    });

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const timeEntry = await prisma.timeEntry.create({
      data: {
        ticketId: id,
        userId,
        hours,
        minutes: minutes || 0,
        description: description || null,
        date: date ? new Date(date) : new Date(),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    await logTicketAction(id, userId, 'TIME_LOGGED', {
      timeEntryId: timeEntry.id,
      hours: timeEntry.hours,
      minutes: timeEntry.minutes,
    });

    res.status(201).json(timeEntry);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Get time entries for a ticket
router.get('/:id/time', authenticate, identifyOrganization, getOrganizationFromUser, verifyOrganizationAccess, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.organizationId!;

    const ticket = await prisma.ticket.findFirst({
      where: { id, organizationId },
    });

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const timeEntries = await prisma.timeEntry.findMany({
      where: { ticketId: id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        date: 'desc',
      },
    });

    res.json(timeEntries);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

// Delete time entry
router.delete('/time/:timeEntryId', authenticate, identifyOrganization, getOrganizationFromUser, verifyOrganizationAccess, async (req: AuthRequest & OrgRequest, res: Response) => {
  try {
    const { timeEntryId } = req.params;
    const userId = req.userId!;
    const organizationId = req.organizationId!;

    const timeEntry = await prisma.timeEntry.findFirst({
      where: { id: timeEntryId },
      include: {
        ticket: true,
      },
    });

    if (!timeEntry) {
      return res.status(404).json({ message: 'Time entry not found' });
    }

    if (timeEntry.ticket.organizationId !== organizationId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Only time entry creator or org admin can delete
    const userOrg = await prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
    });

    const isOrgAdmin = userOrg?.role === 'ADMIN';
    if (timeEntry.userId !== userId && !isOrgAdmin) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await prisma.timeEntry.delete({
      where: { id: timeEntryId },
    });

    await logTicketAction(timeEntry.ticketId, userId, 'TIME_DELETED', {
      timeEntryId: timeEntryId,
    });

    res.json({ message: 'Time entry deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error });
  }
});

export default router;

