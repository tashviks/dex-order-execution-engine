import { Queue, Worker, Job } from 'bullmq';
import { OrderRequest, OrderStatus, OrderState } from '../types';
import { SolanaDexRouter } from './SolDevRouter'; 
import { WebSocket } from 'ws';
import IORedis from 'ioredis';
import * as dotenv from 'dotenv';
dotenv.config();

export class OrderQueueService {
  private queue: Queue;
  private worker: Worker;
  private router: SolanaDexRouter; // CHANGED: Type
  private activeConnections: Map<string, WebSocket>;

  constructor(activeConnections: Map<string, WebSocket>) {
    console.log('🔌 Initializing Queue Service (Devnet Mode)...');
    
    this.router = new SolanaDexRouter(); 
    this.activeConnections = activeConnections;

    const connection = process.env.REDIS_URL 
      ? new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null }) 
      : { host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null };

    this.queue = new Queue('order-execution-queue', { connection });

    this.worker = new Worker('order-execution-queue', async (job: Job) => {
      await this.processOrder(job);
    }, {
      connection,
      concurrency: 5, 
      limiter: {
        max: 10,    
        duration: 1000
      }
    });

    this.worker.on('error', (err) => console.error('❌ Worker connection error:', err.message));
    this.worker.on('ready', () => console.log('✅ Worker connected to Redis'));
  }

  async addOrder(order: OrderRequest & { orderId: string }) {
    await this.queue.add('execute-swap', order, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 }
    });
    this.updateStatus(order.orderId, OrderStatus.PENDING, { logs: ['Order queued'] });
  }

  private async processOrder(job: Job) {
    const { orderId, tokenIn, tokenOut, amount } = job.data;
    try {
      this.updateStatus(orderId, OrderStatus.ROUTING, { logs: ['Checking Devnet Liquidity...'] });
      
      // REAL: Calls the SolanaRouter to check balance/price
      const bestQuote = await this.router.findBestRoute(tokenIn, tokenOut, amount);
      
      this.updateStatus(orderId, OrderStatus.ROUTING, { 
        venue: bestQuote.venue,
        logs: [`Route Selected: ${bestQuote.venue} (Price: $${bestQuote.price.toFixed(2)})`] 
      });

      this.updateStatus(orderId, OrderStatus.BUILDING, { logs: ['Building & Signing Transaction...'] });
      
      // REAL: Submits transaction to the blockchain
      const result = await this.router.executeSwap(bestQuote.venue, amount);
      
      this.updateStatus(orderId, OrderStatus.CONFIRMED, {
        txHash: result.txHash,
        executionPrice: result.executedPrice,
        logs: [`Confirmed on Devnet! Hash: ${result.txHash.substring(0, 8)}...`]
      });

    } catch (error: any) {
      console.error(`Job ${job.id} failed:`, error.message);
      this.updateStatus(orderId, OrderStatus.FAILED, { 
        error: error.message,
        logs: [`Failed: ${error.message}`] 
      });
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
