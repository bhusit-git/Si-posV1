/** Shared TypeScript interfaces used across multiple pages */

export type ProductFamily = "block" | "large_tube" | "small_tube" | "iceberg";
export type ProductForm = "standard" | "crushed";
export type ProductPackageType = "loose" | "returnable_bag" | "clear_bag" | "basket";
export type ProductSizeUnit = "piece" | "kg" | "basket";

export interface ProductType {
  id: number;
  name: string;
  nameEn: string | null;
  hasBag: boolean;
  decreasesBag: boolean;
  isActive: boolean;
  sortOrder: number;
  catalogCode?: number | null;
  family?: ProductFamily | null;
  form?: ProductForm | null;
  packageType?: ProductPackageType | null;
  sizeValue?: number | null;
  sizeUnit?: ProductSizeUnit | null;
  sizeLabel?: string | null;
}

export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  credit: boolean;
  transferCustomer?: boolean;
  bagBalance?: number;
}

export interface CustomerPrice {
  productTypeId: number;
  unitPrice: number;
  bagDeposit: number;
  productType: ProductType;
}

export interface SaleItem {
  productTypeId: number;
  productName: string;
  catalogCode?: number | null;
  hasBag: boolean;
  decreasesBag: boolean;
  quantity: number;
  unitPrice: number;
  baseUnitPrice?: number;
  subtotal: number;
  isAdded: boolean; // true = manually added, price editable; false = from customer prices, read-only
}

export interface BagReturn {
  productTypeId: number;
  productName: string;
  quantity: number;
}

export interface BagBalance {
  customerId: number;
  customerName: string;
  phone: string | null;
  totalOut: number;
  totalReturn: number;
  totalAdjust: number;
  balance: number;
}

export interface BagEntry {
  id: number;
  type: string;
  quantity: number;
  note: string | null;
  createdAt: string;
  productType: { id: number; name: string };
  transaction: {
    id: number;
    billNumber?: string;
    saleDate: string;
    saleTime?: string;
  } | null;
}

export interface ReturnItem {
  productTypeId: number;
  productName: string;
  hasBag: boolean;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface TransactionWarning {
  code: string;
  message: string;
  invoiceIds?: number[];
}

export interface TransactionBackdateMetadata {
  effectiveSaleDate: string;
  effectiveSaleTime: string;
  isBackdated: boolean;
  warnings: TransactionWarning[];
}
