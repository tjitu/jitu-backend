export class CreateEWalletPaymentDto {
  packageId: string;
}

export class EWalletChargeResponse {
  status_code: string;
  status_message: string;
  transaction_id: string;
  order_id: string;
  gross_amount: string;
  currency: string;
  payment_type: string;
  transaction_time: string;
  transaction_status: string;
  fraud_status: string;
  actions: Array<{
    name: string;
    method: string;
    url: string;
  }>;
}

export class MidtransNotificationDto {
  transaction_time?: string;
  transaction_status?: string;
  transaction_id?: string;
  status_message?: string;
  status_code?: string;
  signature_key?: string;
  payment_type?: string;
  order_id: string;
  merchant_id?: string;
  gross_amount?: string;
  fraud_status?: string;
  currency?: string;
}

export class EWalletPaymentResponse {
  transactionId: string;
  orderId: string;
  amount: number;
  tokenAmount: number;
  status: string;
  paymentMethod: string;
  qrCodeUrl?: string;
  deeplinkUrl?: string;
  expiryTime?: string;
  packageName: string;
  snapToken?: string;
  redirectUrl?: string;
  originalAmount?: number;
  discountAmount?: number;
  voucherCode?: string;
}

export class ValidateVoucherDto {
  code: string;
  packageId: string;
}

export class ValidateVoucherResponse {
  valid: boolean;
  voucherId: string;
  code: string;
  discountPercent: number;
  discountAmount: number;
  originalPrice: number;
  finalPrice: number;
  description?: string | null;
  referrerName?: string | null;
}
