import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { auth } from './lib/auth';
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
import * as bodyParser from 'body-parser';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: '.env',
      isGlobal: true,
    }),
    AuthModule.forRoot({ auth, disableGlobalAuthGuard: true }),
    CustomAuthModule,
    PrismaModule,
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
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply JSON body parser to all routes except /api/auth/*
    // Auth routes need raw body for better-auth to handle
    consumer
      .apply(bodyParser.json(), bodyParser.urlencoded({ extended: true }))
      .exclude('api/auth/(.*)')
      .forRoutes('*');
  }
}
