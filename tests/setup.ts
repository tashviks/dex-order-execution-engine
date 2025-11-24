process.env.SOLANA_PRIVATE_KEY = JSON.stringify([139,45,56,252,173,219,108,67,239,45,71,142,110,10,3,32,251,132,195,57,77,78,90,26,203,153,6,43,218,175,184,177,36,113,68,33,51,38,3,66,224,119,232,152,253,182,62,26,255,117,174,206,7,193,174,115,169,136,88,116,0,197,136,233]);
process.env.SOLANA_RPC_URL = 'https://api.devnet.solana.com';
process.env.PORT = '3000';

global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
};