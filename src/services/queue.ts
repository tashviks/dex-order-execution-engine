import { Queue, Worker, Job } from 'bullmq';
import { OrderRequest, OrderStatus, OrderState } from '../types';
import { MockDexRouter } from './mockDexRouter';
import { WebSocket } from 'ws';

// Redis Config - CHANGED: Use 127.0.0.1 to avoid Node.js IPv6 localhost issues
const redisOptions = { 
  host: '127.0.0.1', 
  port: 6379,
  maxRetriesPerRequest: null
};

export class OrderQueueService {
  private queue: Queue;
  private worker: Worker;
  private router: MockDexRouter;
  private activeConnections: Map<string, WebSocket>;

  constructor(activeConnections: Map<string, WebSocket>) {
    console.log('🔌 Initializing Queue Service...'); // Debug Log
    this.router = new MockDexRouter();
    this.activeConnections = activeConnections;

    // 1. Initialize Queue
    this.queue = new Queue('order-execution-queue', { connection: redisOptions });

    // 2. Initialize Worker
    this.worker = new Worker('order-execution-queue', async (job: Job) => {
      await this.processOrder(job);
    }, {
      connection: redisOptions,
      concurrency: 10,
      limiter: {
        max: 100,
        duration: 60000
      }
    });

    // Error Listeners
    this.worker.on('error', (err) => console.error('❌ Worker connection error:', err.message));
    this.queue.on('error', (err) => console.error('❌ Queue connection error:', err.message));
    this.worker.on('ready', () => console.log('✅ Worker connected to Redis'));
  }

  async addOrder(order: OrderRequest & { orderId: string }) {
    await this.queue.add('execute-swap', order, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 }
    });
    this.updateStatus(order.orderId, OrderStatus.PENDING, { logs: ['Order queued'] });
  }

  private async processOrder(job: Job) {
    const { orderId, tokenIn, tokenOut, amount } = job.data;

    try {
      this.updateStatus(orderId, OrderStatus.ROUTING, { logs: ['Fetching quotes...'] });
      const bestQuote = await this.router.findBestRoute(tokenIn, tokenOut, amount);
      
      this.updateStatus(orderId, OrderStatus.ROUTING, { 
        venue: bestQuote.venue,
        logs: [`Best route: ${bestQuote.venue} @ $${bestQuote.price.toFixed(4)}`] 
      });

      this.updateStatus(orderId, OrderStatus.BUILDING, { logs: ['Constructing transaction...'] });
      await new Promise(r => setTimeout(r, 500)); 

      this.updateStatus(orderId, OrderStatus.SUBMITTED, { logs: ['Transaction sent...'] });
      
      const result = await this.router.executeSwap(bestQuote.venue, amount);
      
      this.updateStatus(orderId, OrderStatus.CONFIRMED, {
        txHash: result.txHash,
        executionPrice: result.executedPrice,
        logs: ['Transaction confirmed']
      });

    } catch (error: any) {
      console.error(`Job ${job.id} failed:`, error);
      throw error;
    }
  }

  private updateStatus(orderId: string, status: OrderStatus, data: Partial<OrderState> = {}) {
    const ws = this.activeConnections.get(orderId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        orderId, status, timestamp: new Date().toISOString(), ...data
      }));
    }
  }
}