import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { z } from 'zod';
import prisma from '../config/database';
import { sendPasswordResetEmail, sendLoginOTPEmail } from '../utils/email';
import crypto from 'crypto';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = express.Router();

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2),
  organizationName: z.string().min(2).optional(),
  organizationSlug: z.string().min(2).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
  lang: z.string().optional().default('en'),
});

const resetPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(6),
});

const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(6),
});

const requestOTPSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  lang: z.string().optional().default('en'),
});

const verifyOTPSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
});

// Signup
router.post('/signup', async (req: Request, res: Response) => {
  try {
    const { email, password, name, organizationName, organizationSlug } = signupSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user and optionally create organization
    let organizationId: string | undefined;
    
    if (organizationName && organizationSlug) {
      // Check if organization slug already exists
      const existingOrg = await prisma.organization.findUnique({
        where: { slug: organizationSlug },
      });

      if (existingOrg) {
        return res.status(400).json({ message: 'Organization slug already exists' });
      }

      // Note: We'll check this after user creation since we need the user ID

      // Set expiry date to 1 year from now
      const expiryDate = new Date();
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);

      // Create organization
      const organization = await prisma.organization.create({
        data: {
          name: organizationName,
          slug: organizationSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          joinDate: new Date(),
          expiryDate,
          status: 'ACTIVE',
        },
      });
      organizationId = organization.id;
    }

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });

    // If organization was created, check if user already has an organization as admin
    if (organizationId) {
      const existingUserOrg = await prisma.userOrganization.findFirst({
        where: {
          userId: user.id,
          role: 'ADMIN',
        },
      });

      if (existingUserOrg) {
        // Delete the organization we just created
        await prisma.organization.delete({
          where: { id: organizationId },
        });
        return res.status(400).json({ 
          message: 'You already have an organization. Each admin can only have one organization.' 
        });
      }

      // Link user as admin to the organization
      await prisma.userOrganization.create({
        data: {
          userId: user.id,
          organizationId,
          role: 'ADMIN',
        },
      });
    }

    // Get user's organizations
    const userOrgs = await prisma.userOrganization.findMany({
      where: { userId: user.id },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    const jwtSecret: string = process.env.JWT_SECRET || 'secret';
    const expiresIn: string = process.env.JWT_EXPIRES_IN || '7d';
    
    const payload = { 
      userId: user.id, 
      role: user.role,
      organizationId: organizationId || undefined,
    };
    
    const token = jwt.sign(payload, jwtSecret, { expiresIn } as SignOptions);

    res.status(201).json({
      message: 'User created successfully',
      user: {
        ...user,
        organizations: userOrgs.map(uo => uo.organization),
      },
      token,
      organizationId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Request OTP for login
router.post('/request-otp', async (req: Request, res: Response) => {
  try {
    const { email, password, lang } = requestOTPSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 10); // OTP expires in 10 minutes

    // Delete any existing OTPs for this email
    await prisma.loginOTP.deleteMany({
      where: { email },
    });

    // Create new OTP
    await prisma.loginOTP.create({
      data: {
        email,
        otp,
        expiresAt,
      },
    });

    // Send OTP email
    await sendLoginOTPEmail(email, otp, lang);

    res.json({ message: 'OTP sent to your email' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    
    // Handle email sending errors
    const errorMessage = error instanceof Error ? error.message : 'Server error';
    console.error('Error in request-otp:', error);
    
    // Check if it's an email configuration error
    if (errorMessage.includes('POSTMARK_API_TOKEN')) {
      return res.status(500).json({ 
        message: 'Email service is not configured. Please contact the administrator.',
        error: 'POSTMARK_API_TOKEN is missing or invalid'
      });
    }
    
    // Handle inactive recipient error specifically
    if (errorMessage.includes('marked as inactive') || errorMessage.includes('InactiveRecipientsError')) {
      return res.status(422).json({ 
        message: errorMessage,
        error: 'inactive_recipient',
        note: process.env.NODE_ENV === 'development' 
          ? 'Check server console for OTP (development mode only). Remove email suppression in Postmark dashboard to enable email delivery.'
          : 'Please remove the email suppression in Postmark dashboard or contact support.'
      });
    }
    
    res.status(500).json({ 
      message: errorMessage.includes('Email sending failed') 
        ? 'Failed to send OTP email. Please try again later or contact support.'
        : 'Server error. Please try again later.',
      error: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
});

// Verify OTP and complete login
router.post('/verify-otp', async (req: Request, res: Response) => {
  try {
    const { email, otp } = verifyOTPSchema.parse(req.body);

    const otpRecord = await prisma.loginOTP.findFirst({
      where: {
        email,
        otp,
        used: false,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!otpRecord) {
      return res.status(401).json({ message: 'Invalid or expired OTP' });
    }

    // Mark OTP as used
    await prisma.loginOTP.update({
      where: { id: otpRecord.id },
      data: { used: true },
    });

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Get user's organizations
    const userOrgs = await prisma.userOrganization.findMany({
      where: { userId: user.id },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    // Use first organization as default, or null if none
    const defaultOrgId = userOrgs.length > 0 ? userOrgs[0].organization.id : undefined;

    const jwtSecret: string = process.env.JWT_SECRET || 'secret';
    const expiresIn: string = process.env.JWT_EXPIRES_IN || '7d';
    
    const payload = { 
      userId: user.id, 
      role: user.role,
      organizationId: defaultOrgId,
    };
    
    const token = jwt.sign(payload, jwtSecret, { expiresIn } as SignOptions);

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizations: userOrgs.map(uo => ({
          ...uo.organization,
          role: uo.role,
        })),
      },
      token,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Login (legacy - kept for backward compatibility, but now requires OTP)
router.post('/login', async (req: Request, res: Response) => {
  // Redirect to OTP flow
  return res.status(400).json({ 
    message: 'Please use /auth/request-otp endpoint to initiate login',
    requiresOTP: true 
  });
});

// Forgot Password
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email, lang } = forgotPasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Don't reveal if user exists for security
      return res.json({ message: 'If the email exists, a password reset link has been sent' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    await prisma.passwordReset.create({
      data: {
        email,
        token,
        expiresAt,
      },
    });

    await sendPasswordResetEmail(email, token, lang);

    res.json({ message: 'If the email exists, a password reset link has been sent' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Reset Password
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, password } = resetPasswordSchema.parse(req.body);

    const resetRequest = await prisma.passwordReset.findUnique({
      where: { token },
    });

    if (!resetRequest || resetRequest.expiresAt < new Date()) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.user.update({
      where: { email: resetRequest.email },
      data: { password: hashedPassword },
    });

    await prisma.passwordReset.delete({
      where: { token },
    });

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

// Change Password (authenticated users)
router.post('/change-password', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isValidPassword = await bcrypt.compare(currentPassword, user.password);

    if (!isValidPassword) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Validation error', errors: error.errors });
    }
    res.status(500).json({ message: 'Server error', error });
  }
});

export default router;

