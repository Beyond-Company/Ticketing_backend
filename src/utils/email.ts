import { ServerClient } from 'postmark';
import nodemailer from 'nodemailer';

// Email configuration
const useMaildev = process.env.USE_MAILDEV === 'true' || process.env.NODE_ENV === 'development';
const postmarkApiToken = process.env.POSTMARK_API_TOKEN || '';
const postmarkClient = !useMaildev && postmarkApiToken ? new ServerClient(postmarkApiToken) : null;

// Initialize nodemailer for Maildev (local development)
let nodemailerTransporter: nodemailer.Transporter | null = null;

if (useMaildev) {
  // In Docker, use 'maildev' as hostname, otherwise 'localhost'
  const isDocker = process.env.NODE_ENV === 'production' || process.env.DATABASE_URL?.includes('postgres:5432');
  const maildevHost = process.env.MAILDEV_HOST || (isDocker ? 'maildev' : 'localhost');
  const maildevPort = parseInt(process.env.MAILDEV_SMTP_PORT || '1025');
  const maildevWebPort = process.env.MAILDEV_WEB_PORT || '1080';
  
  nodemailerTransporter = nodemailer.createTransport({
    host: maildevHost,
    port: maildevPort,
    secure: false, // Maildev doesn't use TLS
    ignoreTLS: true,
  });
  
  console.log(`📧 Using Maildev for email (${maildevHost}:${maildevPort})`);
  console.log(`📧 View emails at http://localhost:${maildevWebPort}`);
}

const getFromEmail = () => {
  return process.env.POSTMARK_FROM_EMAIL || process.env.EMAIL_USER || 'dev@beyondcompany.sa';
};

const checkEmailConfig = () => {
  if (useMaildev) {
    if (!nodemailerTransporter) {
      throw new Error('Maildev transporter is not initialized. Please check MAILDEV_HOST and MAILDEV_SMTP_PORT configuration.');
    }
    return;
  }
  
  if (!postmarkClient) {
    throw new Error('POSTMARK_API_TOKEN is not configured. Please set POSTMARK_API_TOKEN in your environment variables or set USE_MAILDEV=true for local development.');
  }
  if (!postmarkApiToken) {
    throw new Error('POSTMARK_API_TOKEN is empty. Please set a valid Postmark API token or set USE_MAILDEV=true for local development.');
  }
};

// Generic email sending function that uses either Postmark or Maildev
const sendEmail = async (to: string, subject: string, html: string) => {
  checkEmailConfig();
  
  if (useMaildev && nodemailerTransporter) {
    // Use Maildev (nodemailer)
    await nodemailerTransporter.sendMail({
      from: getFromEmail(),
      to,
      subject,
      html,
    });
    console.log(`✅ Email sent via Maildev to ${to}`);
  } else if (postmarkClient) {
    // Use Postmark
    await postmarkClient.sendEmail({
      From: getFromEmail(),
      To: to,
      Subject: subject,
      HtmlBody: html,
    });
  } else {
    throw new Error('No email service configured. Please set POSTMARK_API_TOKEN or USE_MAILDEV=true');
  }
};

export const sendPasswordResetEmail = async (email: string, token: string, lang: string = 'en') => {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
  
  const messages = {
    en: {
      subject: 'Password Reset Request',
      html: `
        <h2>Password Reset Request</h2>
        <p>You requested to reset your password. Click the link below to reset it:</p>
        <a href="${resetUrl}" style="background-color: #000057; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 10px 0;">Reset Password</a>
        <p>This link will expire in 1 hour.</p>
        <p>If you didn't request this, please ignore this email.</p>
      `,
    },
    ar: {
      subject: 'طلب إعادة تعيين كلمة المرور',
      html: `
        <h2>طلب إعادة تعيين كلمة المرور</h2>
        <p>لقد طلبت إعادة تعيين كلمة المرور. انقر على الرابط أدناه لإعادة تعيينها:</p>
        <a href="${resetUrl}" style="background-color: #000057; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 10px 0;">إعادة تعيين كلمة المرور</a>
        <p>سينتهي صلاحية هذا الرابط خلال ساعة واحدة.</p>
        <p>إذا لم تطلب هذا، يرجى تجاهل هذا البريد الإلكتروني.</p>
      `,
    },
  };

  const message = messages[lang as keyof typeof messages] || messages.en;

  await sendEmail(email, message.subject, message.html);
};

export const sendTicketStatusChangeEmail = async (
  email: string,
  ticketTitle: string,
  oldStatus: string,
  newStatus: string,
  ticketId: string,
  publicToken: string | null,
  organizationSlug: string | null,
  lang: string = 'en'
) => {
  // Determine tracking URL based on whether it's a public ticket or authenticated ticket
  let trackingUrl: string;
  let trackingNumber: string;
  
  if (publicToken && organizationSlug) {
    // Public ticket - use public tracking URL with token as query parameter
    trackingUrl = `${process.env.FRONTEND_URL}/org/${organizationSlug}/track?token=${publicToken}`;
    trackingNumber = publicToken;
  } else {
    // Authenticated ticket - use authenticated ticket URL
    trackingUrl = `${process.env.FRONTEND_URL}/tickets/${ticketId}`;
    trackingNumber = ticketId;
  }
  
  const statusLabels: Record<string, { en: string; ar: string }> = {
    OPEN: { en: 'Open', ar: 'مفتوح' },
    IN_PROGRESS: { en: 'In Progress', ar: 'قيد التنفيذ' },
    RESOLVED: { en: 'Resolved', ar: 'تم الحل' },
    CLOSED: { en: 'Closed', ar: 'مغلق' },
  };

  const messages = {
    en: {
      subject: `Ticket Status Updated: ${ticketTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #000057;">Ticket Status Updated</h2>
          <p>Your ticket "<strong>${ticketTitle}</strong>" status has been updated.</p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>Tracking Number:</strong> <code style="background-color: #fff; padding: 4px 8px; border-radius: 3px; font-family: monospace; font-size: 14px;">${trackingNumber}</code></p>
            <p style="margin: 5px 0;"><strong>Previous Status:</strong> <span style="color: #666;">${statusLabels[oldStatus]?.en || oldStatus}</span></p>
            <p style="margin: 5px 0;"><strong>New Status:</strong> <span style="color: #000057; font-weight: bold;">${statusLabels[newStatus]?.en || newStatus}</span></p>
          </div>
          <a href="${trackingUrl}" style="background-color: #000057; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 15px 0; font-weight: bold;">Track Your Ticket</a>
          <p style="color: #666; font-size: 12px; margin-top: 20px;">If you have any questions, please reply to this email.</p>
        </div>
      `,
    },
    ar: {
      subject: `تم تحديث حالة التذكرة: ${ticketTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; direction: rtl; text-align: right;">
          <h2 style="color: #000057;">تم تحديث حالة التذكرة</h2>
          <p>تم تحديث حالة تذكرتك "<strong>${ticketTitle}</strong>".</p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>رقم التتبع:</strong> <code style="background-color: #fff; padding: 4px 8px; border-radius: 3px; font-family: monospace; font-size: 14px;">${trackingNumber}</code></p>
            <p style="margin: 5px 0;"><strong>الحالة السابقة:</strong> <span style="color: #666;">${statusLabels[oldStatus]?.ar || oldStatus}</span></p>
            <p style="margin: 5px 0;"><strong>الحالة الجديدة:</strong> <span style="color: #000057; font-weight: bold;">${statusLabels[newStatus]?.ar || newStatus}</span></p>
          </div>
          <a href="${trackingUrl}" style="background-color: #000057; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 15px 0; font-weight: bold;">تتبع تذكرتك</a>
          <p style="color: #666; font-size: 12px; margin-top: 20px;">إذا كان لديك أي أسئلة، يرجى الرد على هذا البريد الإلكتروني.</p>
        </div>
      `,
    },
  };

  const message = messages[lang as keyof typeof messages] || messages.en;

  try {
    await sendEmail(email, message.subject, message.html);
  } catch (error) {
    console.error('Failed to send ticket status change email:', error);
    // Don't throw - email failures shouldn't break the API
  }
};

export const sendTicketCommentEmail = async (
  email: string,
  ticketTitle: string,
  commentContent: string,
  commentAuthor: string,
  ticketId: string,
  publicToken: string | null,
  organizationSlug: string | null,
  lang: string = 'en'
) => {
  // Determine tracking URL based on whether it's a public ticket or authenticated ticket
  let trackingUrl: string;
  let trackingNumber: string;
  
  if (publicToken && organizationSlug) {
    // Public ticket - use public tracking URL with token as query parameter
    trackingUrl = `${process.env.FRONTEND_URL}/org/${organizationSlug}/track?token=${publicToken}`;
    trackingNumber = publicToken;
  } else {
    // Authenticated ticket - use authenticated ticket URL
    trackingUrl = `${process.env.FRONTEND_URL}/tickets/${ticketId}`;
    trackingNumber = ticketId;
  }
  
  const messages = {
    en: {
      subject: `New Comment on Ticket: ${ticketTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #000057;">New Comment on Your Ticket</h2>
          <p>A new comment has been added to your ticket "<strong>${ticketTitle}</strong>".</p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0;"><strong>Tracking Number:</strong> <code style="background-color: #fff; padding: 4px 8px; border-radius: 3px; font-family: monospace; font-size: 14px;">${trackingNumber}</code></p>
          </div>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #000057;">
            <p style="margin: 0 0 10px 0;"><strong>${commentAuthor}</strong> commented:</p>
            <p style="margin: 0; white-space: pre-wrap;">${commentContent}</p>
          </div>
          <a href="${trackingUrl}" style="background-color: #000057; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 15px 0; font-weight: bold;">Track Your Ticket & Reply</a>
          <p style="color: #666; font-size: 12px; margin-top: 20px;">If you have any questions, please reply to this email.</p>
        </div>
      `,
    },
    ar: {
      subject: `تعليق جديد على التذكرة: ${ticketTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; direction: rtl; text-align: right;">
          <h2 style="color: #000057;">تعليق جديد على تذكرتك</h2>
          <p>تم إضافة تعليق جديد على تذكرتك "<strong>${ticketTitle}</strong>".</p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="margin: 0 0 10px 0;"><strong>رقم التتبع:</strong> <code style="background-color: #fff; padding: 4px 8px; border-radius: 3px; font-family: monospace; font-size: 14px;">${trackingNumber}</code></p>
          </div>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0; border-right: 4px solid #000057;">
            <p style="margin: 0 0 10px 0;"><strong>${commentAuthor}</strong> علق:</p>
            <p style="margin: 0; white-space: pre-wrap;">${commentContent}</p>
          </div>
          <a href="${trackingUrl}" style="background-color: #000057; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 15px 0; font-weight: bold;">تتبع تذكرتك والرد</a>
          <p style="color: #666; font-size: 12px; margin-top: 20px;">إذا كان لديك أي أسئلة، يرجى الرد على هذا البريد الإلكتروني.</p>
        </div>
      `,
    },
  };

  const message = messages[lang as keyof typeof messages] || messages.en;

  try {
    await sendEmail(email, message.subject, message.html);
  } catch (error) {
    console.error('Failed to send ticket comment email:', error);
    // Don't throw - email failures shouldn't break the API
  }
};

export const sendLoginOTPEmail = async (email: string, otp: string, lang: string = 'en') => {
  checkEmailConfig();

  const messages = {
    en: {
      subject: 'Your Login OTP Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #000057;">Login Verification Code</h2>
          <p>Your one-time password (OTP) for login is:</p>
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0; text-align: center;">
            <h1 style="color: #000057; font-size: 32px; letter-spacing: 8px; margin: 0;">${otp}</h1>
          </div>
          <p>This code will expire in 10 minutes.</p>
          <p style="color: #666; font-size: 12px; margin-top: 20px;">If you didn't request this code, please ignore this email.</p>
        </div>
      `,
    },
    ar: {
      subject: 'رمز التحقق لتسجيل الدخول',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; direction: rtl; text-align: right;">
          <h2 style="color: #000057;">رمز التحقق لتسجيل الدخول</h2>
          <p>رمز المرور لمرة واحدة (OTP) لتسجيل الدخول هو:</p>
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0; text-align: center;">
            <h1 style="color: #000057; font-size: 32px; letter-spacing: 8px; margin: 0;">${otp}</h1>
          </div>
          <p>سينتهي صلاحية هذا الرمز خلال 10 دقائق.</p>
          <p style="color: #666; font-size: 12px; margin-top: 20px;">إذا لم تطلب هذا الرمز، يرجى تجاهل هذا البريد الإلكتروني.</p>
        </div>
      `,
    },
  };

  const message = messages[lang as keyof typeof messages] || messages.en;

  try {
    await sendEmail(email, message.subject, message.html);
    
    // Log OTP in development mode for easy testing
    if (useMaildev || process.env.NODE_ENV === 'development') {
      console.log(`📧 OTP for ${email}: ${otp} (also sent via ${useMaildev ? 'Maildev' : 'email'})`);
    }
  } catch (error: any) {
    console.error('Failed to send login OTP email:', error);
    
    // Handle specific Postmark errors (only if using Postmark)
    if (!useMaildev && (error?.code === 406 || error?.name === 'InactiveRecipientsError')) {
      const inactiveEmails = error?.recipients || [email];
      const errorMsg = `Cannot send email to ${inactiveEmails.join(', ')}. This email address has been marked as inactive in Postmark (hard bounce, spam complaint, or manual suppression). Please remove the suppression in your Postmark dashboard or use a different email address.`;
      
      throw new Error(errorMsg);
    }
    
    const errorMessage = error?.message || 'Failed to send OTP email';
    const detailedError = new Error(`Email sending failed: ${errorMessage}. ${useMaildev ? 'Please check Maildev configuration.' : 'Please check your POSTMARK_API_TOKEN configuration or set USE_MAILDEV=true for local development.'}`);
    throw detailedError;
  }
};

export const sendTicketAssignmentEmail = async (
  email: string,
  ticketTitle: string,
  ticketId: string,
  categoryName: string,
  organizationSlug: string | null,
  lang: string = 'en'
) => {
  const ticketUrl = organizationSlug 
    ? `${process.env.FRONTEND_URL}/org/${organizationSlug}/tickets/${ticketId}`
    : `${process.env.FRONTEND_URL}/tickets/${ticketId}`;

  const messages = {
    en: {
      subject: `New Ticket Assigned: ${ticketTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #000057;">New Ticket Assigned to You</h2>
          <p>A new ticket has been assigned to you based on your category assignment.</p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>Ticket Title:</strong> ${ticketTitle}</p>
            <p style="margin: 5px 0;"><strong>Category:</strong> ${categoryName}</p>
            <p style="margin: 5px 0;"><strong>Ticket ID:</strong> <code style="background-color: #fff; padding: 4px 8px; border-radius: 3px; font-family: monospace; font-size: 14px;">${ticketId}</code></p>
          </div>
          <a href="${ticketUrl}" style="background-color: #000057; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 15px 0; font-weight: bold;">View Ticket</a>
          <p style="color: #666; font-size: 12px; margin-top: 20px;">This ticket was automatically assigned to you because you are assigned to handle the "${categoryName}" category.</p>
        </div>
      `,
    },
    ar: {
      subject: `تذكرة جديدة مخصصة: ${ticketTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; direction: rtl; text-align: right;">
          <h2 style="color: #000057;">تذكرة جديدة مخصصة لك</h2>
          <p>تم تخصيص تذكرة جديدة لك بناءً على تعيين الفئة الخاص بك.</p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>عنوان التذكرة:</strong> ${ticketTitle}</p>
            <p style="margin: 5px 0;"><strong>الفئة:</strong> ${categoryName}</p>
            <p style="margin: 5px 0;"><strong>معرف التذكرة:</strong> <code style="background-color: #fff; padding: 4px 8px; border-radius: 3px; font-family: monospace; font-size: 14px;">${ticketId}</code></p>
          </div>
          <a href="${ticketUrl}" style="background-color: #000057; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 15px 0; font-weight: bold;">عرض التذكرة</a>
          <p style="color: #666; font-size: 12px; margin-top: 20px;">تم تخصيص هذه التذكرة تلقائيًا لك لأنك مخصص للتعامل مع فئة "${categoryName}".</p>
        </div>
      `,
    },
  };

  const message = messages[lang as keyof typeof messages] || messages.en;

  try {
    await sendEmail(email, message.subject, message.html);
  } catch (error) {
    console.error('Failed to send ticket assignment email:', error);
    // Don't throw - email failures shouldn't break the API
  }
};

export const sendTicketSubmissionEmail = async (
  email: string,
  ticketTitle: string,
  ticketId: string,
  publicToken: string | null,
  organizationSlug: string | null,
  lang: string = 'en'
) => {
  // Determine tracking URL based on whether it's a public ticket or authenticated ticket
  let trackingUrl: string;
  let trackingNumber: string;
  
  if (publicToken && organizationSlug) {
    // Public ticket - use public tracking URL with token as query parameter
    trackingUrl = `${process.env.FRONTEND_URL}/org/${organizationSlug}/track?token=${publicToken}`;
    trackingNumber = publicToken;
  } else {
    // Authenticated ticket - use authenticated ticket URL
    trackingUrl = `${process.env.FRONTEND_URL}/tickets/${ticketId}`;
    trackingNumber = ticketId;
  }
  
  const messages = {
    en: {
      subject: `Ticket Submitted Successfully: ${ticketTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #000057;">Ticket Submitted Successfully</h2>
          <p>Thank you for submitting your ticket. We have received your request and will get back to you soon.</p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>Ticket Title:</strong> ${ticketTitle}</p>
            <p style="margin: 5px 0;"><strong>Tracking Number:</strong> <code style="background-color: #fff; padding: 4px 8px; border-radius: 3px; font-family: monospace; font-size: 14px;">${trackingNumber}</code></p>
            ${publicToken ? '<p style="margin: 5px 0; color: #d32f2f;"><strong>Important:</strong> Please save this tracking number. You will need it to track your ticket status.</p>' : ''}
          </div>
          <a href="${trackingUrl}" style="background-color: #000057; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 15px 0; font-weight: bold;">Track Your Ticket</a>
          <p style="color: #666; font-size: 12px; margin-top: 20px;">You will receive email notifications when there are updates to your ticket.</p>
        </div>
      `,
    },
    ar: {
      subject: `تم إرسال التذكرة بنجاح: ${ticketTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; direction: rtl; text-align: right;">
          <h2 style="color: #000057;">تم إرسال التذكرة بنجاح</h2>
          <p>شكرًا لتقديم تذكرتك. لقد استلمنا طلبك وسنعود إليك قريبًا.</p>
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>عنوان التذكرة:</strong> ${ticketTitle}</p>
            <p style="margin: 5px 0;"><strong>رقم التتبع:</strong> <code style="background-color: #fff; padding: 4px 8px; border-radius: 3px; font-family: monospace; font-size: 14px;">${trackingNumber}</code></p>
            ${publicToken ? '<p style="margin: 5px 0; color: #d32f2f;"><strong>مهم:</strong> يرجى حفظ رقم التتبع هذا. ستحتاجه لتتبع حالة تذكرتك.</p>' : ''}
          </div>
          <a href="${trackingUrl}" style="background-color: #000057; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 15px 0; font-weight: bold;">تتبع تذكرتك</a>
          <p style="color: #666; font-size: 12px; margin-top: 20px;">ستتلقى إشعارات بريد إلكتروني عند وجود تحديثات على تذكرتك.</p>
        </div>
      `,
    },
  };

  const message = messages[lang as keyof typeof messages] || messages.en;

  try {
    await sendEmail(email, message.subject, message.html);
  } catch (error) {
    console.error('Failed to send ticket submission email:', error);
    // Don't throw - email failures shouldn't break the API
  }
};

