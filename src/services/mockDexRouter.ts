    
    import { Quote, OrderState } from '../types';

    export class MockDexRouter {
    private basePriceMap: Record<string, number> = {
        'SOL': 150.00,
    };

    private sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Radium fetch sim
    async getRaydiumQuote(tokenIn: string, tokenOut: string, amount: number): Promise<Quote> {
        await this.sleep(200 + Math.random() * 100); // 200-300ms latency
        
        const basePrice = this.basePriceMap[tokenIn] || 100;
        // Raydium price variance: 0.98 - 1.02
        const variance = 0.98 + Math.random() * 0.04; 
        
        return {
        venue: 'Raydium',
        price: basePrice * variance,
        fee: 0.0025 // 0.25%
        };
    }

    // Meteora fetch sim
    async getMeteoraQuote(tokenIn: string, tokenOut: string, amount: number): Promise<Quote> {
        await this.sleep(200 + Math.random() * 100); 
        
        const basePrice = this.basePriceMap[tokenIn] || 100;
        // Meteora price variance: 0.97 - 1.03
        const variance = 0.97 + Math.random() * 0.06;
        
        return {
        venue: 'Meteora',
        price: basePrice * variance,
        fee: 0.001 // Dynamic fee models often lower
        };
    }

    // Router Logic: Select best price
    async findBestRoute(tokenIn: string, tokenOut: string, amount: number): Promise<Quote> {
        const [raydium, meteora] = await Promise.all([
        this.getRaydiumQuote(tokenIn, tokenOut, amount),
        this.getMeteoraQuote(tokenIn, tokenOut, amount)
        ]);

        console.log(`[Router] Quotes - Raydium: $${raydium.price.toFixed(4)} | Meteora: $${meteora.price.toFixed(4)}`);

        // Assuming we are SELLING tokenIn, we want the HIGHER price
        return raydium.price > meteora.price ? raydium : meteora;
    }

    async executeSwap(venue: string, amount: number): Promise<{ txHash: string, executedPrice: number }> {
        // Simulate transaction building and submission time
        await this.sleep(1500 + Math.random() * 1000); // 1.5s - 2.5s
        
        // Simulate slippage (execution price slightly different from quote)
        const slippage = 1 - (Math.random() * 0.005); // Max 0.5% slippage
        
        return {
        txHash: `sol_tx_${Math.random().toString(36).substring(2, 15)}_${Date.now()}`,
        executedPrice: (this.basePriceMap['SOL'] * slippage)
        };
    }
    }