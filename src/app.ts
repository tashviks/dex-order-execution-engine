import Fastify, { FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import { v4 as uuidv4 } from 'uuid';
import { OrderQueueService } from './services/queue';
import { OrderRequest, OrderStatus } from './types';
import { WebSocket } from 'ws';

console.log('🚀 Starting Order Execution Engine (Fastify v5 Mode)...');

// State
const activeConnections = new Map<string, WebSocket>();

// Initialize Fastify
const fastify = Fastify({ logger: true });

const initializeServer = async () => {
  try {
    // Register WebSocket plugin BEFORE defining routes
    console.log('🔌 Registering WebSocket plugin...');
    await fastify.register(websocket);

    const queueService = new OrderQueueService(activeConnections);

    // HTTP Route - POST to submit orders
    fastify.post<{ Body: Omit<OrderRequest, 'userId'> }>(
      '/api/orders/execute',
      async (request, reply) => {
        const orderId = uuidv4();
        const { tokenIn, tokenOut, amount } = request.body;
        const userId = 'user_123';

        await queueService.addOrder({
          orderId,
          tokenIn,
          tokenOut,
          amount,
          userId,
        });

        return reply.status(202).send({
          message: 'Order received',
          orderId,
          wsUrl: `https://dex-order-execution-engine-app.onrender.com/api/orders/${orderId}/status`,
        });
      }
    );

    // WebSocket Route - GET to establish WebSocket connection
    interface OrderParams {
      orderId: string;
    }

    fastify.get<{ Params: OrderParams }>(
      '/api/orders/:orderId/status',
      { websocket: true },
      async (connection, req) => {
        const request = req as FastifyRequest<{ Params: OrderParams }>;
        const { orderId } = request.params;

        if (!orderId) {
          console.error('❌ Order ID not provided');
          connection.socket.close(1008, 'Order ID required');
          return;
        }

        console.log(`✅ Client connected for order: ${orderId}`);
        activeConnections.set(orderId, connection.socket);

        // Send initial connection message
        connection.socket.send(
          JSON.stringify({
            orderId,
            status: OrderStatus.PENDING,
            message: 'Connection established. Waiting for order execution...',
          })
        );

        // Handle incoming messages
        connection.socket.on('message', (data) => {
          console.log(`📨 Message from ${orderId}:`, data.toString());
        });

        // Handle connection close
        connection.socket.on('close', () => {
          console.log(`🔌 Client disconnected: ${orderId}`);
          activeConnections.delete(orderId);
        });

        // Handle errors
        connection.socket.on('error', (err) => {
          console.error(`❌ WebSocket error for ${orderId}:`, err.message);
          activeConnections.delete(orderId);
        });
      }
    );

    // Health check endpoint
    fastify.get('/health', async (request, reply) => {
      return reply.status(200).send({
        status: 'healthy',
        uptime: process.uptime(),
        activeConnections: activeConnections.size,
      });
    });

    // Start server
    console.log('⏳ Attempting to listen on port 3000...');
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('✅ Order Engine running on port 3000');
    console.log('📝 POST /api/orders/execute - Submit orders');
    console.log('🔌 WS /api/orders/:orderId/status - WebSocket status updates');
    console.log('❤️  GET /health - Health check');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Start the server
initializeServer();