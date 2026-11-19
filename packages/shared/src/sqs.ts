import {
  SQSClient,
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import type { Queue, OrderMessage, QueueMessage } from './queue';

const endpoint = process.env.SQS_ENDPOINT ?? 'http://localhost:9324';
const client = new SQSClient({
  region: process.env.AWS_REGION ?? 'ap-south-1',
  endpoint,
  credentials: { accessKeyId: 'x', secretAccessKey: 'x' }, // ElasticMQ ignores these
});

export const QUEUE_NAME = 'orders';
export const DLQ_NAME = 'orders-dlq';

async function ensureQueues(): Promise<string> {
  const dlq = await client.send(new CreateQueueCommand({ QueueName: DLQ_NAME }));
  const attrs = await client.send(
    new GetQueueAttributesCommand({ QueueUrl: dlq.QueueUrl!, AttributeNames: ['QueueArn'] })
  );
  const dlqArn = attrs.Attributes!.QueueArn!;
  const main = await client.send(
    new CreateQueueCommand({
      QueueName: QUEUE_NAME,
      Attributes: {
        VisibilityTimeout: '30',
        RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: 3 }),
      },
    })
  );
  return main.QueueUrl!;
}

export async function createSqsQueue(): Promise<Queue> {
  const queueUrl = await ensureQueues();

  return {
    async publish(msg: OrderMessage) {
      await client.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(msg) }));
    },

    async consume(handler: (m: QueueMessage) => Promise<void>) {
      while (true) {
        const res = await client.send(
          new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 5 })
        );
        for (const m of res.Messages ?? []) {
          try {
            await handler({
              body: JSON.parse(m.Body!) as OrderMessage,
              ack: async () => {
                await client.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle! }));
              },
            });
          } catch (e) {
            console.error('handler failed, message will be retried', e);
          }
        }
      }
    },
  };
}