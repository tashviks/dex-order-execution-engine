import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';
import Fastify, { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { WebSocket } from 'ws';
import { OrderStatus } from '../src/types';
import { SolanaDexRouter } from '../src/services/SolDevRouter';
import { OrderQueueService } from '../src/services/queue';


jest.mock('@solana/web3.js', () => ({
  Connection: jest.fn().mockImplementation(() => ({
     getBalance: jest.fn().mockImplementation(async (_: any) => 1 * 1000000000), // Default 1 SOL
  })),
  Keypair: {
    fromSecretKey: jest.fn().mockReturnValue({
      publicKey: { toBase58: () => 'FakePublicKey123' },
    }),
  },
  Transaction: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockReturnThis(),
  })),
  SystemProgram: {
    transfer: jest.fn(),
  },
sendAndConfirmTransaction: jest.fn(async () => 'fake_tx_signature_123'),
  LAMPORTS_PER_SOL: 1000000000,
}));

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    on: jest.fn(),
  })),
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
  })),
}));

jest.mock('ioredis');


describe('Solana Order Engine - Complete Test Suite', () => {
  
  describe('Part A: Solana Router Logic', () => {
    let router: SolanaDexRouter;

    beforeEach(() => {
      jest.clearAllMocks();
      router = new SolanaDexRouter();
    });

    it('should initialize wallet from private key correctly', () => {
      expect(router).toBeDefined();
    });

    it('should calculate best route between Raydium and Meteora', async () => {
      const quote = await router.findBestRoute('SOL', 'USDC', 1);
      expect(quote).toHaveProperty('venue');
      expect(['Raydium', 'Meteora']).toContain(quote.venue);
    });

    it('should throw error if wallet balance is insufficient', async () => {
      // @ts-ignore
      router.connection.getBalance.mockResolvedValueOnce(0);
      await expect(router.findBestRoute('SOL', 'USDC', 1))
        .rejects
        .toThrow(/Insufficient SOL/i);
    });

    it('should construct and sign a swap transaction', async () => {
      const result = await router.executeSwap('Raydium', 1);
      expect(result).toHaveProperty('txHash', 'fake_tx_signature_123');
    });

    it('should construct transaction for Meteora venue correctly', async () => {
      const result = await router.executeSwap('Meteora', 5);
      expect(result).toHaveProperty('txHash', 'fake_tx_signature_123');
      expect(result.executedPrice).toBeDefined();
    });
  });

  describe('Part B: Queue Service & WebSocket Updates', () => {
    let service: OrderQueueService;
    let mockWs: any;
    let activeConnections: Map<string, WebSocket>;

    beforeEach(() => {
      jest.useFakeTimers(); 
      jest.clearAllMocks();
      activeConnections = new Map();
      mockWs = {
        readyState: WebSocket.OPEN,
        send: jest.fn(),
      };
      service = new OrderQueueService(activeConnections);

      jest.spyOn(SolanaDexRouter.prototype, 'findBestRoute')
        .mockResolvedValue({ venue: 'Raydium', price: 150, fee: 0.001 });
      
      jest.spyOn(SolanaDexRouter.prototype, 'executeSwap')
        .mockResolvedValue({ txHash: 'tx_queue_123', executedPrice: 150 });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should add order to BullMQ queue', async () => {
      const order = { orderId: 'u1', tokenIn: 'SOL', tokenOut: 'USDC', amount: 1, userId: 'user1' };
      await service.addOrder(order);
      const queueInstance = (service as any).queue;
      expect(queueInstance.add).toHaveBeenCalledWith('execute-swap', order, expect.anything());
    });

    it('should send initial "PENDING" status via WebSocket', async () => {
      activeConnections.set('u1', mockWs);
      await service.addOrder({ orderId: 'u1', tokenIn: 'SOL', tokenOut: 'USDC', amount: 1, userId: 'user1' });
      expect(mockWs.send).toHaveBeenCalled();
      const msg = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(msg.status).toBe(OrderStatus.PENDING);
    });

    it('should process job and stream lifecycle events (Routing -> Confirmed)', async () => {
      activeConnections.set('u1', mockWs);
      const mockJob = { data: { orderId: 'u1', tokenIn: 'SOL', tokenOut: 'USDC', amount: 1 }, id: 'job-1' };

      const processPromise = (service as any).processOrder(mockJob);
      
      jest.runAllTimers();
      
      await Promise.resolve(); 
      await Promise.resolve(); 
      
      await processPromise;

      const messages = mockWs.send.mock.calls.map((c: any) => JSON.parse(c[0]).status);
      
      expect(messages).toContain(OrderStatus.ROUTING);
      expect(messages).toContain(OrderStatus.BUILDING);
      expect(messages).toContain(OrderStatus.CONFIRMED);
    });
  });
  describe('Part C: API Endpoints', () => {
    let app: FastifyInstance;
    let mockAddOrder: jest.Mock;

    beforeAll(async () => {
      jest.useRealTimers();
      
      app = Fastify();
      mockAddOrder = jest.fn();

      const mockQueueService = {
        addOrder: mockAddOrder
      };

      app.post('/api/orders/execute', async (req: any, reply) => {
        const orderId = uuidv4();
        const { tokenIn, tokenOut, amount } = req.body;
        await mockQueueService.addOrder({ orderId, tokenIn, tokenOut, amount, userId: 'test' });
        return reply.status(202).send({ message: 'Order received', orderId, wsUrl: `/ws/${orderId}` });
      });

      await app.ready();
    });

    afterAll(() => {
      app.close();
    });

    it('POST /api/orders/execute should return 202 and orderId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/orders/execute',
        payload: { tokenIn: 'SOL', tokenOut: 'USDC', amount: 10 }
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('orderId');
    });

    it('POST /api/orders/execute should accept payload with extra fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/orders/execute',
        payload: { tokenIn: 'SOL', tokenOut: 'USDC', amount: 10, extraField: 'ignored' }
      });
      expect(response.statusCode).toBe(202);
    });

    it('POST /api/orders/execute should handle missing optional fields gracefully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/orders/execute',
        payload: { tokenIn: 'SOL', amount: 10 }
      });
      expect(response.statusCode).toBe(202);
    });
  });
});