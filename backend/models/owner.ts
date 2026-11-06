import type { Transaction } from './store';

export interface OwnerDashboard {
  totalProducts: number;
  todaySales: number;
  availableStock: number;
  lowStock: number;
  totalEmployees: number;
  recentSales: Transaction[];
  recentPurchases: Transaction[];
  stockSummary: {
    totalProducts: number;
    availableUnits: number;
    lowStock: number;
    outOfStock: number;
  };
  employeeSummary: {
    active: number;
    inactive: number;
    total: number;
  };
}
