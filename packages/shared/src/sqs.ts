import {
  SQSClient,
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import type { Queue, OrderMessage, QueueMessage } from './queue';

// SQS_ENDPOINT unset -> local ElasticMQ (default).
// SQS_ENDPOINT=""    -> real AWS SQS, default credential chain (IRSA on EKS).
// SQS_ENDPOINT=<url> -> any other SQS-compatible endpoint.
export function createSqsClient(): SQSClient {
  const endpoint = process.env.SQS_ENDPOINT ?? 'http://localhost:9324';
  const region = process.env.AWS_REGION ?? 'ap-south-1';
  if (!endpoint) return new SQSClient({ region });
  return new SQSClient({ region, endpoint, credentials: { accessKeyId: 'x', secretAccessKey: 'x' } });
}
const client = createSqsClient();

export const QUEUE_NAME = 'orders';
export const DLQ_NAME = 'orders-dlq';

async function ensureQueues(): Promise<string> {
  // On AWS, Terraform owns the queues: use the given URL and skip CreateQueue.
  if (process.env.SQS_QUEUE_URL) return process.env.SQS_QUEUE_URL;
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