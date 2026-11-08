import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DailyModule } from './modules/daily/daily.module';
import { HistoryModule } from './modules/history/history.module';
import { ReferralModule } from './modules/referral/referral.module';
import { ShopModule } from './modules/shop/shop.module';
import { TryoutModule } from './modules/tryout/tryout.module';
import { PrismaModule } from './prisma.module';
import { ExamModule } from './modules/exam/exam.module';
import { AdminModule } from './modules/admin/admin.module';
import { ProfileModule } from './modules/profile/profile.module';
import { ArticlesModule } from './modules/articles/articles.module';
import { AuthModule as CustomAuthModule } from './modules/auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: '.env',
      isGlobal: true,
    }),
    PrismaModule,
    CustomAuthModule,
    DashboardModule,
    DailyModule,
    HistoryModule,
    ReferralModule,
    ShopModule,
    TryoutModule,
    ExamModule,
    AdminModule,
    ProfileModule,
    ArticlesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
