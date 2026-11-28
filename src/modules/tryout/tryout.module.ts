import { Module, forwardRef } from '@nestjs/common';
import { TryoutController } from './tryout.controller';
import { TryoutService } from './tryout.service';
import { ExamModule } from '../exam/exam.module';
import { TryoutGrowthController } from './tryout-growth.controller';

@Module({
  imports: [forwardRef(() => ExamModule)],
  controllers: [TryoutController, TryoutGrowthController],
  providers: [TryoutService],
  exports: [TryoutService],
})
export class TryoutModule {}
