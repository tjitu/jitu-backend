import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { crc16ccitt } from 'crc';
import { PaymentStatus } from '../../../../generated/prisma/client';
import type {
  EWalletChargeResponse,
  MidtransNotificationDto,
} from '../dto/ewallet.dto';

@Injectable()
export class MidtransService {
  private readonly logger = new Logger(MidtransService.name);
  private readonly serverKey: string;
  private readonly clientKey: string;
  private readonly merchantId: string;
  private readonly isProduction: boolean;
  private readonly apiUrl: string;

  constructor(private readonly configService: ConfigService) {
    // 1. Get raw values
    const rawServerKey = this.configService.get<string>('SERVER_KEY') || '';
    const rawClientKey = this.configService.get<string>('CLIENT_KEY') || '';
    const rawMerchantId = this.configService.get<string>('MERCHANT_ID') || '';
    const rawNodeEnv = this.configService.get<string>('NODE_ENV') || '';
    const rawMidtransEnv = this.configService.get<string>(
      'MIDTRANS_IS_PRODUCTION',
    );

    // 2. Sanitize (remove accidental quotes and whitespace)
    this.serverKey = rawServerKey.replace(/['"\s]/g, '');
    this.clientKey = rawClientKey.replace(/['"\s]/g, '');
    this.merchantId = rawMerchantId.replace(/['"\s]/g, '');

    // 3. Determine mode (Production vs Sandbox)
    if (rawMidtransEnv !== undefined && rawMidtransEnv !== null) {
      this.isProduction = String(rawMidtransEnv).toLowerCase() === 'true';
    } else {
      const cleanNodeEnv = rawNodeEnv.replace(/['"\s]/g, '');
      this.isProduction = cleanNodeEnv === 'production';
    }

    this.apiUrl = this.isProduction
      ? 'https://api.midtrans.com'
      : 'https://api.sandbox.midtrans.com';

    this.logger.log(
      `Midtrans initialized: ${this.isProduction ? 'PRODUCTION' : 'SANDBOX'}`,
    );
  }

  /**
   * Get Base64 encoded authorization header
   */
  private getAuthHeader(): string {
    const encoded = Buffer.from(this.serverKey + ':').toString('base64');
    return `Basic ${encoded}`;
  }

  /**
   * Create Snap transaction for QRIS and GoPay
   */
  async createSnapTransaction(
    orderId: string,
    grossAmount: number,
    itemDetails?: Array<{ id: string; price: number; quantity: number; name: string }>,
    customerDetails?: { first_name?: string; email?: string },
  ): Promise<{ token: string; redirect_url: string }> {
    const snapUrl = this.isProduction
      ? 'https://app.midtrans.com/snap/v1/transactions'
      : 'https://app.sandbox.midtrans.com/snap/v1/transactions';

    const payload = {
      transaction_details: {
        order_id: orderId,
        gross_amount: Math.round(grossAmount),
      },
      enabled_payments: ['gopay', 'qris', 'other_qris'],
      item_details: itemDetails,
      customer_details: customerDetails,
    };

    const response = await fetch(snapUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: this.getAuthHeader(),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Midtrans Snap Error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<{ token: string; redirect_url: string }>;
  }

  /**
   * Create direct Snap QRIS transaction (returns raw qr_string and qris image url)
   */
  async createQrisTransaction(
    orderId: string,
    grossAmount: number,
    itemDetails?: Array<{ id: string; price: number; quantity: number; name: string }>,
    customerDetails?: { first_name?: string; email?: string },
  ): Promise<{ token: string; redirect_url: string; qr_string?: string; qr_url?: string; expiry_time: string }> {
    const snapResult = await this.createSnapTransaction(orderId, grossAmount, itemDetails, customerDetails);

    const chargeUrl = this.isProduction
      ? `https://app.midtrans.com/snap/v2/transactions/${snapResult.token}/charge`
      : `https://app.sandbox.midtrans.com/snap/v2/transactions/${snapResult.token}/charge`;

    try {
      const chargeRes = await fetch(chargeUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          payment_type: 'qris',
          payment_params: {
            acquirer: ['gopay'],
          },
        }),
      });

      if (chargeRes.ok) {
        const chargeData = await chargeRes.json();
        return {
          token: snapResult.token,
          redirect_url: snapResult.redirect_url,
          qr_string: chargeData.qr_string,
          qr_url: chargeData.qris_url,
          expiry_time: chargeData.expiry_time || new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        };
      }
    } catch (e) {
      this.logger.error('Failed to charge QRIS directly:', e);
    }

    return {
      token: snapResult.token,
      redirect_url: snapResult.redirect_url,
      expiry_time: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  /**
   * Create GoPay/E-Wallet charge
   */
  async createEWalletCharge(
    orderId: string,
    grossAmount: number,
    callbackUrl?: string,
  ): Promise<EWalletChargeResponse> {
    const url = `${this.apiUrl}/v2/charge`;

    interface GopayConfig {
      enable_callback: boolean;
      callback_url: string;
    }

    interface ChargePayload {
      payment_type: string;
      transaction_details: {
        order_id: string;
        gross_amount: number;
      };
      gopay?: GopayConfig;
    }

    const payload: ChargePayload = {
      payment_type: 'gopay',
      transaction_details: {
        order_id: orderId,
        gross_amount: grossAmount,
      },
    };

    // Add callback URL for mobile redirect
    if (callbackUrl) {
      payload.gopay = {
        enable_callback: true,
        callback_url: callbackUrl,
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: this.getAuthHeader(),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Midtrans API Error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<EWalletChargeResponse>;
  }

  /**
   * Get transaction status from Midtrans
   */
  async getTransactionStatus(orderId: string): Promise<any> {
    const url = `${this.apiUrl}/v2/${orderId}/status`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: this.getAuthHeader(),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Midtrans API Error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Cancel transaction
   */
  async cancelTransaction(orderId: string): Promise<any> {
    const url = `${this.apiUrl}/v2/${orderId}/cancel`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: this.getAuthHeader(),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Midtrans API Error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Verify notification signature from Midtrans webhook
   */
  verifySignature(notification: MidtransNotificationDto): boolean {
    const { order_id, status_code, gross_amount, signature_key } = notification;

    if (!signature_key) return false;

    // Create hash: SHA512(order_id + status_code + gross_amount + ServerKey)
    const hash = crypto
      .createHash('sha512')
      .update(order_id + status_code + gross_amount + this.serverKey)
      .digest('hex');

    return hash === signature_key;
  }

  verifyMerchant(notification: MidtransNotificationDto): boolean {
    return Boolean(
      this.merchantId &&
      notification.merchant_id &&
      notification.merchant_id === this.merchantId,
    );
  }

  /**
   * Map Midtrans transaction status to our payment status
   *
   * Note: This returns string literals (e.g. 'CONFIRMED') to match callers
   * that compare against raw strings, even though PaymentStatus is a string enum.
   */
  mapTransactionStatus(
    transactionStatus: string,
    fraudStatus?: string,
  ): 'CONFIRMED' | 'PENDING' | 'CANCELLED' | 'DECLINED' {
    // Handle fraud_status first
    if (fraudStatus === 'deny' || fraudStatus === 'challenge') {
      return 'DECLINED';
    }

    // Map transaction_status
    switch (transactionStatus) {
      case 'capture':
      case 'settlement':
        return 'CONFIRMED';
      case 'pending':
        return 'PENDING';
      case 'deny':
      case 'expire':
      case 'cancel':
      case 'failure':
        return 'CANCELLED';
      default:
        return 'PENDING';
    }
  }

  /**
   * Calculate CRC16-CCITT checksum for QRIS payload.
   * Uses the battle-tested 'crc' library instead of manual bitwise implementation.
   */
  calculateCRC16(input: string): string {
    return crc16ccitt(input).toString(16).toUpperCase().padStart(4, '0');
  }

  /**
   * Generate QRIS String with CRC16
   */
  generateQris(nominal: number | string, transactionId?: string): string {
    const qris = this.configService.get<string>('QRIS_ID');

    if (!qris) throw new Error('QRIS_ID belum dikonfigurasi.');
    if (!nominal) throw new Error('Nominal wajib diisi.');

    const nominalStr = String(nominal);
    const pad2 = (n: number) => (n < 10 ? '0' + n : String(n));

    let base = qris.slice(0, -4);
    base = base.includes('010211') ? base.replace('010211', '010212') : base;

    const splitMarker = '5802ID';
    const parts = base.split(splitMarker);
    if (parts.length < 2) throw new Error('QRIS Marker 5802ID not found');

    const amountTag = '54' + pad2(nominalStr.length) + nominalStr;
    let payload = parts[0] + amountTag + splitMarker + parts[1];

    if (transactionId) {
      // Truncate transactionId if too long for QRIS (max length tag 62)
      const safeId = transactionId.slice(0, 20);
      const tag62 = '62' + pad2(safeId.length) + safeId;
      payload += tag62;
    }

    payload += '6304';
    return payload + this.calculateCRC16(payload);
  }
}
