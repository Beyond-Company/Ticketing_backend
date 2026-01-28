import prisma from '../config/database';
import { NotificationType } from '@prisma/client';

export interface CreateNotificationData {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  ticketId?: string;
}

export const createNotification = async (data: CreateNotificationData): Promise<void> => {
  try {
    await prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
        ticketId: data.ticketId,
      },
    });
  } catch (error) {
    console.error('Failed to create notification:', error);
    // Don't throw - notification creation shouldn't break the main flow
  }
};

export const createNotificationsForUsers = async (
  userIds: string[],
  data: Omit<CreateNotificationData, 'userId'>
): Promise<void> => {
  try {
    await prisma.notification.createMany({
      data: userIds.map(userId => ({
        userId,
        type: data.type,
        title: data.title,
        message: data.message,
        ticketId: data.ticketId,
      })),
    });
  } catch (error) {
    console.error('Failed to create notifications:', error);
  }
};
