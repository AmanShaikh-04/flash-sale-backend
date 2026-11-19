export interface OrderMessage {
  userId: string;
  idempotencyKey: string;
}

export interface QueueMessage {
  body: OrderMessage;
  ack: () => Promise<void>; // delete the message after successful processing
}

export interface Queue {
  publish(msg: OrderMessage): Promise<void>;
  consume(handler: (m: QueueMessage) => Promise<void>): Promise<void>;
}