// Fake payment: 50-150 ms delay, succeeds about 80% of the time.
export async function fakePayment(): Promise<boolean> {
  await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
  return Math.random() < 0.8;
}