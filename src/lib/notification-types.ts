/** Server-action contracts for user notifications. */

export type NotificationType =
  | 'trip_update'
  | 'payment'
  | 'sos'
  | 'reminder'
  | 'promotional'
  | 'system';

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  title: string;
  /** Bodies are intentionally omitted from the current generic notification codec. */
  body: string | null;
  data: Record<string, unknown> | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface ListNotificationsInput {
  limit?: number;
  unreadOnly?: boolean;
}

export interface MarkNotificationReadInput {
  notificationId: string;
}

export type NotificationErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'PERSISTENCE';

export interface NotificationActionError {
  success: false;
  code: NotificationErrorCode;
  error: string;
}

export type NotificationListResult =
  | { success: true; notifications: NotificationDTO[] }
  | NotificationActionError;

export type NotificationResult =
  | { success: true; notification: NotificationDTO }
  | NotificationActionError;

export type TripNotificationResult =
  | { success: true; notificationIds: string[] }
  | NotificationActionError;
