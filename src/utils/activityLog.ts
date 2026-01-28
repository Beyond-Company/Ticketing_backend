import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { OrgRequest } from '../middleware/organization';

export interface ActivityLogData {
  ticketId: string;
  userId: string | null;
  action: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  metadata?: any;
}

export const createActivityLog = async (data: ActivityLogData): Promise<void> => {
  try {
    await prisma.activityLog.create({
      data: {
        ticketId: data.ticketId,
        userId: data.userId,
        action: data.action,
        field: data.field,
        oldValue: data.oldValue,
        newValue: data.newValue,
        metadata: data.metadata || {},
      },
    });
  } catch (error) {
    console.error('Failed to create activity log:', error);
    // Don't throw - activity logging shouldn't break the main flow
  }
};

export const logTicketChange = async (
  ticketId: string,
  userId: string | null,
  field: string,
  oldValue: any,
  newValue: any
): Promise<void> => {
  await createActivityLog({
    ticketId,
    userId,
    action: `${field.toUpperCase()}_CHANGED`,
    field,
    oldValue: typeof oldValue === 'object' ? JSON.stringify(oldValue) : String(oldValue),
    newValue: typeof newValue === 'object' ? JSON.stringify(newValue) : String(newValue),
  });
};

export const logTicketAction = async (
  ticketId: string,
  userId: string | null,
  action: string,
  metadata?: any
): Promise<void> => {
  await createActivityLog({
    ticketId,
    userId,
    action,
    metadata,
  });
};
