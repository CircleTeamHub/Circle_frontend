import { apiClient } from '@/services/api/client';

export type Wallet = {
  id: string;
  userID: string;
  balance: number;
  updatedAt: string;
};

export type CoinTransaction = {
  id: string;
  type: string;
  amount: number;
  balance: number;
  note: string | null;
  relatedID: string | null;
  createdAt: string;
};

export async function fetchWallet() {
  return apiClient<Wallet>('/coin/wallet');
}

export async function fetchCoinTransactions() {
  return apiClient<CoinTransaction[]>('/coin/transactions');
}

export async function rechargePoints(amount: number) {
  return apiClient<Wallet>('/coin/recharge', {
    method: 'POST',
    body: { amount },
  });
}
