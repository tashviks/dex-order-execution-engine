import { Queue, Worker, Job } from 'bullmq';
import { OrderRequest, OrderStatus, OrderState } from '../types';
import { MockDexRouter } from './mockDexRouter';
import { WebSocket } from 'ws';

const redisOptions = { host: 'localhost', port: 6379 };

export class OrderQueueService {
  private queue: Queue;
  private worker: Worker;
  private router: MockDexRouter;
  // In-memory map for active WebSocket connections
  private activeConnections: Map<string, WebSocket>;

  constructor(activeConnections: Map<string, WebSocket>) {
    this.router = new MockDexRouter();
    this.activeConnections = activeConnections;

    // 1. Initialize Queue
    this.queue = new Queue('order-execution-queue', { connection: redisOptions });

    // 2. Initialize Worker with Concurrency & Rate Limiting
    this.worker = new Worker('order-execution-queue', async (job: Job) => {
      await this.processOrder(job);
    }, {
      connection: redisOptions,
      concurrency: 10, // Requirement: Process 10 concurrent orders
      limiter: {
        max: 100,      // Requirement: 100 orders per minute
        duration: 60000
      }
    });

    this.worker.on('failed', (job, err) => {
      if (job) this.updateStatus(job.data.orderId, OrderStatus.FAILED, { error: err.message });
    });
  }

  async addOrder(order: OrderRequest & { orderId: string }) {
    await this.queue.add('execute-swap', order, {
      attempts: 3, // Requirement: Exponential back-off retry
      backoff: {
        type: 'exponential',
        delay: 1000
      }
    });
    this.updateStatus(order.orderId, OrderStatus.PENDING, { logs: ['Order queued'] });
  }

  private async processOrder(job: Job) {
    const { orderId, tokenIn, tokenOut, amount } = job.data;

    try {
      // Step 1: Routing
      this.updateStatus(orderId, OrderStatus.ROUTING, { logs: ['Fetching quotes from Raydium & Meteora...'] });
      const bestQuote = await this.router.findBestRoute(tokenIn, tokenOut, amount);
      
      this.updateStatus(orderId, OrderStatus.ROUTING, { 
        venue: bestQuote.venue,
        logs: [`Best route found: ${bestQuote.venue} @ $${bestQuote.price.toFixed(4)}`] 
      });

      // Step 2: Building Transaction
      this.updateStatus(orderId, OrderStatus.BUILDING, { logs: ['Constructing transaction...'] });
      await new Promise(r => setTimeout(r, 500)); 

      this.updateStatus(orderId, OrderStatus.SUBMITTED, { logs: ['Transaction sent to Solana network...'] });
      
      const result = await this.router.executeSwap(bestQuote.venue, amount);
      
      this.updateStatus(orderId, OrderStatus.CONFIRMED, {
        txHash: result.txHash,
        executionPrice: result.executedPrice,
        logs: ['Transaction confirmed on-chain']
      });

    } catch (error: any) {
      throw error;
    }
  }

  private updateStatus(orderId: string, status: OrderStatus, data: Partial<OrderState> = {}) {
    const ws = this.activeConnections.get(orderId);
    
    const payload = {
      orderId,
      status,
      timestamp: new Date().toISOString(),
      ...data
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    } else {
      console.log(`[Queue] No active WS for order ${orderId}, status: ${status}`);
    }
  }
}