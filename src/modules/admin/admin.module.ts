import { Module } from '@nestjs/common';
import { AdminService } from './services/admin.service';
import { AdminController } from './admin.controller';
import { AdminTryoutService } from './services/tryout.service';
import { AdminSubtestService } from './services/subtest.service';
import { AdminQuestionService } from './services/question.service';
import { AdminUserService } from './services/user.service';
import { AdminPaymentService } from './services/payment.service';
import { AdminPackageService } from './services/package.service';
import { AdminDailyService } from './services/daily.service';
import { AdminTryoutResultService } from './services/result.service';

@Module({
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminTryoutService,
    AdminSubtestService,
    AdminQuestionService,
    AdminUserService,
    AdminPaymentService,
    AdminPackageService,
    AdminDailyService,
    AdminTryoutResultService,
  ],
})
export class AdminModule {}
