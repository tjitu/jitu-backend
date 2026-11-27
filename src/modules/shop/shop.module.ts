import { Module } from '@nestjs/common';
import { ShopController } from './shop.controller';
import { ShopService } from './shop.service';
import { MidtransService } from './services/midtrans.service';
import { AffiliatePricingService } from './services/affiliate-pricing.service';

@Module({
  controllers: [ShopController],
  providers: [ShopService, MidtransService, AffiliatePricingService],
  exports: [MidtransService],
})
export class ShopModule {}
