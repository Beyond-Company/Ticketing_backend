import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // Clear existing data (optional - handles case where tables don't exist yet)
  console.log('🧹 Cleaning existing data...');
  try {
    await prisma.comment.deleteMany();
    await prisma.ticket.deleteMany();
    await prisma.category.deleteMany();
    await prisma.userOrganization.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.passwordReset.deleteMany();
    await prisma.user.deleteMany();
  } catch (error: any) {
    if (error.code === 'P2021') {
      console.log('⚠️  Tables do not exist yet. Run migrations first: npm run prisma:migrate');
      console.log('   Or the seed will create data in new tables.');
    } else {
      throw error;
    }
  }

  // Create superadmin user
  console.log('👑 Creating superadmin user...');
  const superadminPassword = await bcrypt.hash('superadmin123', 10);
  const superadmin = await prisma.user.create({
    data: {
      email: 'superadmin@ticketing.com',
      password: superadminPassword,
      name: 'Super Admin',
      role: 'SUPERADMIN',
    },
  });

  // Create admin users (each admin will have only one organization)
  console.log('👤 Creating admin users...');
  
  // Admin 1 with Organization 1
  const admin1Password = await bcrypt.hash('admin123', 10);
  const admin1 = await prisma.user.create({
    data: {
      email: 'admin1@ticketing.com',
      password: admin1Password,
      name: 'Admin One',
      role: 'ADMIN',
    },
  });

  // Admin 2 with Organization 2
  const admin2Password = await bcrypt.hash('admin123', 10);
  const admin2 = await prisma.user.create({
    data: {
      email: 'admin2@ticketing.com',
      password: admin2Password,
      name: 'Admin Two',
      role: 'ADMIN',
    },
  });

  // Admin 3 with Organization 3
  const admin3Password = await bcrypt.hash('admin123', 10);
  const admin3 = await prisma.user.create({
    data: {
      email: 'admin3@ticketing.com',
      password: admin3Password,
      name: 'Admin Three',
      role: 'ADMIN',
    },
  });

  // Create regular users
  console.log('👥 Creating regular users...');
  const user1Password = await bcrypt.hash('user123', 10);
  const user1 = await prisma.user.create({
    data: {
      email: 'john@example.com',
      password: user1Password,
      name: 'John Doe',
      role: 'USER',
    },
  });

  const user2Password = await bcrypt.hash('user123', 10);
  const user2 = await prisma.user.create({
    data: {
      email: 'jane@example.com',
      password: user2Password,
      name: 'Jane Smith',
      role: 'USER',
    },
  });

  // Create organizations (each with one admin)
  console.log('🏢 Creating organizations...');
  const org1Expiry = new Date();
  org1Expiry.setFullYear(org1Expiry.getFullYear() + 1);
  
  const org1 = await prisma.organization.create({
    data: {
      name: 'Acme Corporation',
      slug: 'acme-corp',
      subdomain: 'acme',
      joinDate: new Date(),
      expiryDate: org1Expiry,
      status: 'ACTIVE',
    },
  });

  const org2Expiry = new Date();
  org2Expiry.setFullYear(org2Expiry.getFullYear() + 1);
  
  const org2 = await prisma.organization.create({
    data: {
      name: 'Tech Solutions Inc',
      slug: 'tech-solutions',
      subdomain: 'tech',
      joinDate: new Date(),
      expiryDate: org2Expiry,
      status: 'ACTIVE',
    },
  });

  const org3Expiry = new Date();
  org3Expiry.setFullYear(org3Expiry.getFullYear() + 1);
  
  const org3 = await prisma.organization.create({
    data: {
      name: 'Digital Innovations',
      slug: 'digital-innovations',
      subdomain: 'digital',
      joinDate: new Date(),
      expiryDate: org3Expiry,
      status: 'ACTIVE',
    },
  });

  // Link users to organizations (each admin has only ONE organization)
  console.log('🔗 Linking users to organizations...');
  
  // Admin 1 -> Organization 1 (ADMIN role)
  await prisma.userOrganization.create({
    data: {
      userId: admin1.id,
      organizationId: org1.id,
      role: 'ADMIN',
    },
  });

  // Admin 2 -> Organization 2 (ADMIN role)
  await prisma.userOrganization.create({
    data: {
      userId: admin2.id,
      organizationId: org2.id,
      role: 'ADMIN',
    },
  });

  // Admin 3 -> Organization 3 (ADMIN role)
  await prisma.userOrganization.create({
    data: {
      userId: admin3.id,
      organizationId: org3.id,
      role: 'ADMIN',
    },
  });

  // Regular users as members
  await prisma.userOrganization.create({
    data: {
      userId: user1.id,
      organizationId: org1.id,
      role: 'MEMBER',
    },
  });

  await prisma.userOrganization.create({
    data: {
      userId: user2.id,
      organizationId: org1.id,
      role: 'MEMBER',
    },
  });

  await prisma.userOrganization.create({
    data: {
      userId: user1.id,
      organizationId: org2.id,
      role: 'MEMBER',
    },
  });

  // Create categories
  console.log('📁 Creating categories...');
  const category1 = await prisma.category.create({
    data: {
      name: 'Technical Support',
      nameAr: 'الدعم الفني',
      organizationId: org1.id,
    },
  });

  const category2 = await prisma.category.create({
    data: {
      name: 'Billing',
      nameAr: 'الفواتير',
      organizationId: org1.id,
    },
  });

  const category3 = await prisma.category.create({
    data: {
      name: 'Feature Request',
      nameAr: 'طلب ميزة',
      organizationId: org1.id,
    },
  });

  const category4 = await prisma.category.create({
    data: {
      name: 'Bug Report',
      nameAr: 'تقرير خطأ',
      organizationId: org2.id,
    },
  });

  const category5 = await prisma.category.create({
    data: {
      name: 'General Inquiry',
      nameAr: 'استفسار عام',
      organizationId: org3.id,
    },
  });

  const category6 = await prisma.category.create({
    data: {
      name: 'Sales',
      nameAr: 'المبيعات',
      organizationId: org3.id,
    },
  });

  // Create tickets
  console.log('🎫 Creating tickets...');
  const ticket1 = await prisma.ticket.create({
    data: {
      title: 'Unable to login to dashboard',
      description: 'I am unable to login to the dashboard. Getting an error message.',
      status: 'OPEN',
      priority: 'HIGH',
      categoryId: category1.id,
      userId: user1.id,
      organizationId: org1.id,
      assignedTo: admin1.id,
    },
  });

  const ticket2 = await prisma.ticket.create({
    data: {
      title: 'Payment processing issue',
      description: 'The payment is not being processed correctly for subscription renewals.',
      status: 'IN_PROGRESS',
      priority: 'URGENT',
      categoryId: category2.id,
      userId: user2.id,
      organizationId: org1.id,
      assignedTo: user1.id,
    },
  });

  const ticket3 = await prisma.ticket.create({
    data: {
      title: 'Add dark mode feature',
      description: 'It would be great to have a dark mode option for the application.',
      status: 'OPEN',
      priority: 'LOW',
      categoryId: category3.id,
      userId: user1.id,
      organizationId: org1.id,
    },
  });

  const ticket4 = await prisma.ticket.create({
    data: {
      title: 'Application crashes on mobile',
      description: 'The application crashes when opening on mobile devices.',
      status: 'RESOLVED',
      priority: 'HIGH',
      categoryId: category4.id,
      userId: user2.id,
      organizationId: org2.id,
      assignedTo: admin2.id,
    },
  });

  const ticket5 = await prisma.ticket.create({
    data: {
      title: 'Email notifications not working',
      description: 'I am not receiving email notifications for ticket updates.',
      status: 'OPEN',
      priority: 'MEDIUM',
      categoryId: category1.id,
      userId: user1.id,
      organizationId: org1.id,
    },
  });

  // Create comments
  console.log('💬 Creating comments...');
  await prisma.comment.create({
    data: {
      content: 'I have investigated the issue and found the root cause. Working on a fix.',
      ticketId: ticket1.id,
      userId: admin1.id,
    },
  });

  await prisma.comment.create({
    data: {
      content: 'Can you provide more details about when this happens?',
      ticketId: ticket2.id,
      userId: user1.id,
    },
  });

  await prisma.comment.create({
    data: {
      content: 'This is a great suggestion! We will add it to our roadmap.',
      ticketId: ticket3.id,
      userId: admin1.id,
    },
  });

  await prisma.comment.create({
    data: {
      content: 'Fixed in version 2.1.0. Please update your app.',
      ticketId: ticket4.id,
      userId: admin2.id,
    },
  });

  console.log('✅ Database seed completed successfully!');
  console.log('\n📋 Seed Summary:');
  console.log(`   - Users: 6 (1 superadmin, 3 admins, 2 regular)`);
  console.log(`   - Organizations: 3 (each with one admin)`);
  console.log(`   - Categories: 6`);
  console.log(`   - Tickets: 5`);
  console.log(`   - Comments: 4`);
  console.log('\n🔑 Login Credentials:');
  console.log('   Superadmin: superadmin@ticketing.com / superadmin123');
  console.log('   Admin 1: admin1@ticketing.com / admin123 (Acme Corporation)');
  console.log('   Admin 2: admin2@ticketing.com / admin123 (Tech Solutions Inc)');
  console.log('   Admin 3: admin3@ticketing.com / admin123 (Digital Innovations)');
  console.log('   User 1: john@example.com / user123');
  console.log('   User 2: jane@example.com / user123');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

