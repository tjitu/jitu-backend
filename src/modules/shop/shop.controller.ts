import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  UseGuards,
  Body,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '../../guards/auth.guard';
import { Session } from '../../decorators/session.decorator';
import type { UserSession } from '../../decorators/session.decorator'; // Gunakan import type!
import { ShopService } from './shop.service';
import type {
  CreateEWalletPaymentDto,
  MidtransNotificationDto,
} from './dto/ewallet.dto';

@Controller('shop')
export class ShopController {
  constructor(
    private readonly shopService: ShopService,
    private readonly configService: ConfigService,
  ) {}

  private assertDevPaymentEndpointEnabled() {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Payment dev endpoint is disabled');
    }
  }

  @Get('packages')
  @UseGuards(AuthGuard)
  async getPackages() {
    return this.shopService.getPackages();
  }

  /**
   * Get current pending e-wallet payment
   */
  @Get('pending-payment')
  @UseGuards(AuthGuard)
  async getPendingPayment(@Session() session: UserSession) {
    const pending = await this.shopService.getPendingEWalletPayment(
      session.user.id,
    );
    return { pending };
  }

  /**
   * Cancel a pending payment
   */
  @Post('cancel/:paymentId')
  @UseGuards(AuthGuard)
  async cancelPayment(
    @Session() session: UserSession,
    @Param('paymentId') paymentId: string,
  ) {
    return this.shopService.cancelPayment(session.user.id, paymentId);
  }

  @Post('voucher/validate')
  @UseGuards(AuthGuard)
  async validateVoucher(
    @Session() session: UserSession,
    @Body() body: { code: string; packageId: string },
  ) {
    if (!body?.code || !body?.packageId) {
      throw new BadRequestException('Kode voucher dan ID paket wajib diisi');
    }
    return this.shopService.validateVoucher(
      body.code,
      body.packageId,
      session.user.id,
    );
  }

  @Post('create/:packageId')
  @UseGuards(AuthGuard)
  async createTransaction(
    @Session() session: UserSession,
    @Param('packageId') packageId: string,
    @Body() body?: { voucherCode?: string },
    @Query('callback_url') callbackUrl?: string,
    @Query('voucher_code') voucherCodeQuery?: string,
  ) {
    if (!packageId) {
      throw new BadRequestException('Package ID required');
    }

    const voucherCode = body?.voucherCode || voucherCodeQuery;

    // Now uses Midtrans e-wallet instead of static QRIS
    const res = await this.shopService.createEWalletPayment(
      session.user.id,
      packageId,
      callbackUrl,
      voucherCode,
    );
    return res;
  }

  @Post('check/:transactionId')
  @UseGuards(AuthGuard)
  checkTransactionStatus(
    @Session() session: UserSession,
    @Param('transactionId') transactionId: string,
  ) {
    return this.shopService.checkTransactionStatus(
      session.user.id,
      transactionId,
    );
  }

  @Post('webhook')
  @UseGuards(AuthGuard)
  async handlePaymentWebhook(@Body() body: { transactionId: string }) {
    this.assertDevPaymentEndpointEnabled();

    if (!body.transactionId) {
      throw new BadRequestException('transactionId is required');
    }
    return this.shopService.setPaid(body.transactionId);
  }

  /**
   * Create E-Wallet payment (GoPay/QRIS)
   */
  @Post('ewallet/create/:packageId')
  @UseGuards(AuthGuard)
  async createEWalletPayment(
    @Session() session: UserSession,
    @Param('packageId') packageId: string,
    @Query('callback_url') callbackUrl?: string,
  ) {
    if (!packageId) {
      throw new BadRequestException('Package ID required');
    }

    return this.shopService.createEWalletPayment(
      session.user.id,
      packageId,
      callbackUrl,
    );
  }

  /**
   * Midtrans webhook notification handler
   */
  @Post('midtrans/notification')
  async handleMidtransNotification(
    @Body() notification: MidtransNotificationDto,
  ) {
    return this.shopService.handleMidtransNotification(notification);
  }

  /**
   * Manually check status with Midtrans and confirm if paid
   */
  @Post('midtrans/check-status/:orderId')
  @UseGuards(AuthGuard)
  async checkMidtransStatus(
    @Session() session: UserSession,
    @Param('orderId') orderId: string,
  ) {
    return this.shopService.checkMidtransAndConfirm(orderId, session.user.id);
  }

  /**
   * MANUAL CONFIRMATION FOR LOCAL DEV
   * ---
   * This endpoint is for local development only to simulate a
   * successful payment webhook from Midtrans.
   */
  @Post('manual-confirm/:orderId')
  @UseGuards(AuthGuard)
  async manualConfirm(@Param('orderId') orderId: string) {
    this.assertDevPaymentEndpointEnabled();

    return this.shopService.setPaidByOrderId(orderId);
  }

  @Get('pending')
  @UseGuards(AuthGuard)
  async getPendingTransactions(@Session() session: UserSession) {
    return this.shopService.getPendingTransactions(session.user.id);
  }

  @Get('past')
  @UseGuards(AuthGuard)
  async getPastTransactions(@Session() session: UserSession) {
    return this.shopService.getPastTransactions(session.user.id);
  }

  @Get('data/:transactionId')
  @UseGuards(AuthGuard)
  async getTransactionData(
    @Session() session: UserSession,
    @Param('transactionId') transactionId: string,
  ) {
    return this.shopService.getData(session.user.id, transactionId);
  }
}
