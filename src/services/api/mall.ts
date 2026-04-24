import { apiClient } from '@/services/api/client';

export type MallProduct = {
  id: string;
  name: string;
  icon: string;
  color: string;
  action: string;
};

export type MallSection = {
  id: string;
  title: string;
  products: MallProduct[];
};

export async function fetchMallSections() {
  return apiClient<MallSection[]>('/mall/sections');
}
