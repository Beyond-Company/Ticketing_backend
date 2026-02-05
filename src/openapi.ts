/**
 * OpenAPI 3.0 specification for Ticketing System API
 */
export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Ticketing System API',
    description: 'A multi-tenant ticketing system with organization support, public ticket submission, and role-based access control.',
    version: '1.0.0',
  },
  servers: [
    { url: 'http://localhost:5000', description: 'Development' },
    { url: '/', description: 'Current host' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token from login/verify-otp',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          errors: { type: 'array', items: { type: 'object' } },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
          name: { type: 'string' },
          role: { type: 'string', enum: ['USER', 'ADMIN', 'ORG_ADMIN', 'SUPERADMIN'] },
        },
      },
      Organization: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          slug: { type: 'string' },
          subdomain: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'EXPIRED'] },
        },
      },
      Ticket: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
          publicToken: { type: 'string', nullable: true },
          status: { type: 'object' },
          category: { type: 'object', nullable: true },
          user: { type: 'object', nullable: true },
          assignedUser: { type: 'object', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Category: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          nameAr: { type: 'string', nullable: true },
          organizationId: { type: 'string' },
        },
      },
      TicketStatus: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          nameAr: { type: 'string', nullable: true },
          color: { type: 'string', nullable: true },
          order: { type: 'integer' },
        },
      },
    },
    parameters: {
      orgParam: {
        name: 'org',
        in: 'query',
        description: 'Organization slug (required for org-scoped endpoints)',
        schema: { type: 'string' },
        example: 'acme',
      },
      orgHeader: {
        name: 'X-Organization-Slug',
        in: 'header',
        description: 'Organization slug (alternative to query param)',
        schema: { type: 'string' },
      },
    },
  },
  tags: [
    { name: 'Auth', description: 'Authentication endpoints' },
    { name: 'Organizations', description: 'Organization management' },
    { name: 'Tickets', description: 'Ticket CRUD and operations' },
    { name: 'Categories', description: 'Ticket categories' },
    { name: 'Statuses', description: 'Ticket statuses' },
    { name: 'Notifications', description: 'In-app notifications' },
    { name: 'Reports', description: 'Analytics and export' },
    { name: 'Admin', description: 'SuperAdmin only' },
  ],
  paths: {
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        responses: {
          200: {
            description: 'Server is running',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    message: { type: 'string', example: 'Server is running' },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ========== AUTH ==========
    '/api/auth/signup': {
      post: {
        tags: ['Auth'],
        summary: 'Create account',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'name'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 6 },
                  name: { type: 'string', minLength: 2 },
                  organizationName: { type: 'string' },
                  organizationSlug: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'User created', content: { 'application/json': { schema: { type: 'object' } } } },
          400: { description: 'Validation error or user exists', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/auth/request-otp': {
      post: {
        tags: ['Auth'],
        summary: 'Request OTP for login',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                  lang: { type: 'string', default: 'en' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'OTP sent to email' },
          401: { description: 'Invalid credentials' },
        },
      },
    },
    '/api/auth/verify-otp': {
      post: {
        tags: ['Auth'],
        summary: 'Verify OTP and complete login',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'otp'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  otp: { type: 'string', minLength: 6, maxLength: 6 },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                    user: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
          401: { description: 'Invalid or expired OTP' },
        },
      },
    },
    '/api/auth/forgot-password': {
      post: {
        tags: ['Auth'],
        summary: 'Request password reset',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  lang: { type: 'string', default: 'en' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Reset link sent (if email exists)' } },
      },
    },
    '/api/auth/reset-password': {
      post: {
        tags: ['Auth'],
        summary: 'Reset password with token',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token', 'password'],
                properties: {
                  token: { type: 'string' },
                  password: { type: 'string', minLength: 6 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Password reset successfully' },
          400: { description: 'Invalid or expired token' },
        },
      },
    },
    '/api/auth/change-password': {
      post: {
        tags: ['Auth'],
        summary: 'Change password (authenticated)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['currentPassword', 'newPassword'],
                properties: {
                  currentPassword: { type: 'string' },
                  newPassword: { type: 'string', minLength: 6 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Password changed' },
          401: { description: 'Current password incorrect' },
        },
      },
    },

    // ========== ORGANIZATIONS ==========
    '/api/organizations/my-organizations': {
      get: {
        tags: ['Organizations'],
        summary: 'Get current user\'s organizations',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'List of organizations' } },
      },
    },
    '/api/organizations/{orgSlug}/public': {
      get: {
        tags: ['Organizations'],
        summary: 'Get organization (public)',
        parameters: [{ name: 'orgSlug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Organization details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Organization' } } } },
          404: { description: 'Organization not found' },
        },
      },
    },
    '/api/organizations/{orgSlug}': {
      get: {
        tags: ['Organizations'],
        summary: 'Get organization details',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'orgSlug', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Organization details' } },
      },
      put: {
        tags: ['Organizations'],
        summary: 'Update organization',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'orgSlug', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  subdomain: { type: 'string' },
                  settings: { type: 'object' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Organization updated' } },
      },
    },
    '/api/organizations': {
      post: {
        tags: ['Organizations'],
        summary: 'Create organization',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'slug'],
                properties: {
                  name: { type: 'string' },
                  slug: { type: 'string' },
                  subdomain: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Organization created' } },
      },
    },
    '/api/organizations/{orgSlug}/members': {
      get: {
        tags: ['Organizations'],
        summary: 'Get organization members',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'orgSlug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'List of members' } },
      },
      post: {
        tags: ['Organizations'],
        summary: 'Add member',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'orgSlug', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'role'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  role: { type: 'string', enum: ['MEMBER', 'ADMIN'] },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Member added' } },
      },
    },
    '/api/organizations/{orgSlug}/members/{userId}': {
      put: {
        tags: ['Organizations'],
        summary: 'Update member role',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'orgSlug', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { role: { type: 'string', enum: ['MEMBER', 'ADMIN'] } },
              },
            },
          },
        },
        responses: { 200: { description: 'Member updated' } },
      },
      delete: {
        tags: ['Organizations'],
        summary: 'Remove member',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'orgSlug', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Member removed' } },
      },
    },

    // ========== TICKETS ==========
    '/api/tickets': {
      get: {
        tags: ['Tickets'],
        summary: 'List tickets',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/orgParam' },
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Full-text search' },
          { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Status ID filter' },
          { name: 'priority', in: 'query', schema: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] } },
          { name: 'categoryId', in: 'query', schema: { type: 'string' } },
          { name: 'assignedTo', in: 'query', schema: { type: 'string' }, description: 'User ID or "unassigned"' },
          { name: 'dateFrom', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'dateTo', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'sortBy', in: 'query', schema: { type: 'string', enum: ['createdAt', 'updatedAt', 'title', 'priority', 'statusId'] } },
          { name: 'sortOrder', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
        ],
        responses: { 200: { description: 'List of tickets' } },
      },
      post: {
        tags: ['Tickets'],
        summary: 'Create ticket',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/orgParam' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'description'],
                properties: {
                  title: { type: 'string', minLength: 3 },
                  description: { type: 'string', minLength: 10 },
                  priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
                  categoryId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Ticket created' } },
      },
    },
    '/api/tickets/public': {
      get: {
        tags: ['Tickets'],
        summary: 'Track ticket by public token (no auth)',
        parameters: [
          { $ref: '#/components/parameters/orgParam' },
          { name: 'token', in: 'query', required: true, schema: { type: 'string' }, description: 'Public tracking token' },
        ],
        responses: {
          200: { description: 'Ticket details (limited)' },
          404: { description: 'Ticket not found' },
        },
      },
      post: {
        tags: ['Tickets'],
        summary: 'Submit ticket publicly (no auth)',
        parameters: [{ $ref: '#/components/parameters/orgParam' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'description', 'submitterName', 'submitterEmail'],
                properties: {
                  title: { type: 'string', minLength: 3 },
                  description: { type: 'string', minLength: 10 },
                  categoryId: { type: 'string' },
                  submitterName: { type: 'string', minLength: 2 },
                  submitterEmail: { type: 'string', format: 'email' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Ticket created, returns publicToken for tracking' },
          400: { description: 'Validation error' },
        },
      },
    },
    '/api/tickets/{id}': {
      get: {
        tags: ['Tickets'],
        summary: 'Get ticket by ID',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/orgParam' },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Ticket details' } },
      },
      put: {
        tags: ['Tickets'],
        summary: 'Update ticket',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/orgParam' },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                  statusId: { type: 'string' },
                  priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
                  assignedTo: { type: 'string', nullable: true },
                  categoryId: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Ticket updated' } },
      },
      delete: {
        tags: ['Tickets'],
        summary: 'Delete ticket',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/orgParam' },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Ticket deleted' } },
      },
    },
    '/api/tickets/{id}/comments': {
      post: {
        tags: ['Tickets'],
        summary: 'Add comment',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/orgParam' },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['content'],
                properties: { content: { type: 'string' } },
              },
            },
          },
        },
        responses: { 201: { description: 'Comment added' } },
      },
    },
    '/api/tickets/{id}/comments/{commentId}': {
      put: {
        tags: ['Tickets'],
        summary: 'Edit comment',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/orgParam' },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'commentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { content: { type: 'string' } },
              },
            },
          },
        },
        responses: { 200: { description: 'Comment updated' } },
      },
      delete: {
        tags: ['Tickets'],
        summary: 'Delete comment',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/orgParam' },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'commentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Comment deleted' } },
      },
    },
    '/api/tickets/{id}/attachments': {
      post: {
        tags: ['Tickets'],
        summary: 'Upload attachment',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/orgParam' },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: { file: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
        responses: { 201: { description: 'Attachment uploaded' } },
      },
    },
    '/api/tickets/bulk': {
      post: {
        tags: ['Tickets'],
        summary: 'Bulk operations',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/orgParam' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['ticketIds', 'action'],
                properties: {
                  ticketIds: { type: 'array', items: { type: 'string' } },
                  action: { type: 'string', enum: ['update', 'delete', 'assign', 'changeStatus', 'changePriority'] },
                  data: { type: 'object', description: 'Action-specific payload' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Bulk operation result' } },
      },
    },
    '/api/tickets/{id}/activity': {
      get: {
        tags: ['Tickets'],
        summary: 'Get ticket activity log',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/orgParam' },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Activity log entries' } },
      },
    },
    '/api/tickets/{id}/time': {
      get: {
        tags: ['Tickets'],
        summary: 'Get time entries',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/orgParam' },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Time entries' } },
      },
      post: {
        tags: ['Tickets'],
        summary: 'Add time entry',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/orgParam' },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['hours'],
                properties: {
                  hours: { type: 'number' },
                  minutes: { type: 'integer' },
                  description: { type: 'string' },
                  date: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Time entry added' } },
      },
    },

    // ========== CATEGORIES ==========
    '/api/categories': {
      get: {
        tags: ['Categories'],
        summary: 'List categories',
        parameters: [{ $ref: '#/components/parameters/orgParam' }],
        responses: { 200: { description: 'List of categories' } },
      },
      post: {
        tags: ['Categories'],
        summary: 'Create category',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/orgParam' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', minLength: 2 },
                  nameAr: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Category created' } },
      },
    },
    '/api/categories/{id}': {
      get: {
        tags: ['Categories'],
        summary: 'Get category',
        parameters: [
          { $ref: '#/components/parameters/orgParam' },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Category details' } },
      },
      put: {
        tags: ['Categories'],
        summary: 'Update category',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/orgParam' },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  nameAr: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Category updated' } },
      },
      delete: {
        tags: ['Categories'],
        summary: 'Delete category',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/orgParam' },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Category deleted' } },
      },
    },

    // ========== STATUSES ==========
    '/api/statuses': {
      get: {
        tags: ['Statuses'],
        summary: 'List ticket statuses',
        parameters: [{ $ref: '#/components/parameters/orgParam' }],
        responses: { 200: { description: 'List of statuses' } },
      },
      post: {
        tags: ['Statuses'],
        summary: 'Create status',
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/orgParam' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', minLength: 2 },
                  nameAr: { type: 'string' },
                  color: { type: 'string' },
                  order: { type: 'integer' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Status created' } },
      },
    },
    '/api/statuses/{id}': {
      get: {
        tags: ['Statuses'],
        summary: 'Get status',
        parameters: [
          { $ref: '#/components/parameters/orgParam' },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Status details' } },
      },
      put: {
        tags: ['Statuses'],
        summary: 'Update status',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/orgParam' },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  nameAr: { type: 'string' },
                  color: { type: 'string' },
                  order: { type: 'integer' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Status updated' } },
      },
      delete: {
        tags: ['Statuses'],
        summary: 'Delete status',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/orgParam' },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Status deleted' } },
      },
    },

    // ========== NOTIFICATIONS ==========
    '/api/notifications': {
      get: {
        tags: ['Notifications'],
        summary: 'List notifications',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'unreadOnly', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: { 200: { description: 'List of notifications' } },
      },
    },
    '/api/notifications/unread-count': {
      get: {
        tags: ['Notifications'],
        summary: 'Get unread count',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: '{ count: number }' } },
      },
    },
    '/api/notifications/{id}/read': {
      put: {
        tags: ['Notifications'],
        summary: 'Mark as read',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Notification updated' } },
      },
    },
    '/api/notifications/read-all': {
      put: {
        tags: ['Notifications'],
        summary: 'Mark all as read',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'All marked as read' } },
      },
    },
    '/api/notifications/{id}': {
      delete: {
        tags: ['Notifications'],
        summary: 'Delete notification',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Notification deleted' } },
      },
    },

    // ========== REPORTS ==========
    '/api/reports/analytics': {
      get: {
        tags: ['Reports'],
        summary: 'Get analytics',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/orgParam' },
          { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: { 200: { description: 'Analytics data' } },
      },
    },
    '/api/reports/export': {
      get: {
        tags: ['Reports'],
        summary: 'Export tickets (CSV)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/orgParam' },
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['csv', 'json'] } },
          { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'priority', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'CSV or JSON export' } },
      },
    },

    // ========== ADMIN (SuperAdmin) ==========
    '/api/admin/organizations': {
      get: {
        tags: ['Admin'],
        summary: 'List all organizations (SuperAdmin)',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'All organizations' } },
      },
    },
    '/api/admin/users': {
      get: {
        tags: ['Admin'],
        summary: 'List all users (SuperAdmin)',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'All users' } },
      },
    },
    '/api/admin/categories': {
      get: {
        tags: ['Admin'],
        summary: 'List all categories (SuperAdmin)',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'All categories' } },
      },
    },
    '/api/admin/analytics': {
      get: {
        tags: ['Admin'],
        summary: 'SuperAdmin analytics',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Platform-wide analytics' } },
      },
    },
    '/api/admin/organizations/{orgId}/status': {
      put: {
        tags: ['Admin'],
        summary: 'Update organization status',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'EXPIRED'] } },
              },
            },
          },
        },
        responses: { 200: { description: 'Status updated' } },
      },
    },
    '/api/admin/organizations/{orgId}': {
      delete: {
        tags: ['Admin'],
        summary: 'Delete organization',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Organization deleted' } },
      },
    },
  },
};
