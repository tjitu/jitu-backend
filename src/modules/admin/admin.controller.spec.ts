import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from './admin.controller';
import { AdminService } from './services/admin.service';
import { AdminTryoutService } from './services/tryout.service';
import { AdminSubtestService } from './services/subtest.service';
import { AdminQuestionService } from './services/question.service';
import { AdminUserService } from './services/user.service';
import { AdminPaymentService } from './services/payment.service';
import { AdminPackageService } from './services/package.service';
import { AdminDailyService } from './services/daily.service';
import { AdminTryoutResultService } from './services/result.service';
import { AdminAiService } from './services/ai.service';
import { AuthIdentityService } from '../auth/auth-identity.service';

describe('AdminController', () => {
  let controller: AdminController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: AuthIdentityService, useValue: {} },
        { provide: AdminService, useValue: {} },
        { provide: AdminTryoutService, useValue: {} },
        { provide: AdminSubtestService, useValue: {} },
        { provide: AdminQuestionService, useValue: {} },
        { provide: AdminUserService, useValue: {} },
        { provide: AdminPaymentService, useValue: {} },
        { provide: AdminPackageService, useValue: {} },
        { provide: AdminDailyService, useValue: {} },
        { provide: AdminTryoutResultService, useValue: {} },
        { provide: AdminAiService, useValue: {} },
      ],
    }).compile();

    controller = module.get<AdminController>(AdminController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
