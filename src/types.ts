export enum OrderStatus {
  PENDING = 'pending',
  ROUTING = 'routing',
  BUILDING = 'building',
  SUBMITTED = 'submitted',
  CONFIRMED = 'confirmed',
  FAILED = 'failed'
}
export interface OrderRequest {
  tokenIn: string;
  tokenOut: string;
  amount: number;
  userId: string;
}

export interface OrderState {
  orderId: string;
  status: OrderStatus;
  txHash?: string;
  error?: string;
  executionPrice?: number;
  venue?: 'Raydium' | 'Meteora';
  logs: string[];
}

export interface Quote {
  venue: 'Raydium' | 'Meteora';
  price: number;
  fee: number;
}