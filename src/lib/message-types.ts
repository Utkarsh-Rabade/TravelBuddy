/** Server-action contracts for the trip conversation. */

export type MessageType = 'text' | 'image' | 'location';

export interface MessageDTO {
  id: string;
  trip_id: string;
  sender_clerk_id: string;
  content: string;
  image_storage_path: string | null;
  message_type: MessageType;
  created_at: string;
  /** Whether the current authenticated participant has read this message. */
  is_read: boolean;
}

export interface ListMessagesInput {
  tripId: string;
  limit?: number;
  before?: string;
}

export interface SendMessageInput {
  tripId: string;
  content: string;
  messageType?: MessageType;
  imageStoragePath?: string | null;
  idempotencyKey?: string;
}

export interface MarkMessageReadInput {
  messageId: string;
  tripId?: string;
}

export type MessageErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'PERSISTENCE';

export interface MessageActionError {
  success: false;
  code: MessageErrorCode;
  error: string;
}

export type MessageResult =
  | { success: true; message: MessageDTO; created: boolean }
  | MessageActionError;

export type MessageListResult =
  | { success: true; messages: MessageDTO[] }
  | MessageActionError;
