import {
  Controller,
  Get,
  Headers,
  Post,
  Body,
  Param,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ExamService } from './exam.service';
import { Observable } from 'rxjs';
import { AuthGuard } from '../../guards/auth.guard';
import { Session } from '../../decorators/session.decorator';
import type { UserSession } from '../../decorators/session.decorator';
import { MessageEvent } from './interfaces';

@Controller('exam')
@UseGuards(AuthGuard)
export class ExamController {
  constructor(private readonly examService: ExamService) {}

  @Post(':tryoutId/start')
  async startExam(
    @Param('tryoutId') tryoutId: string,
    @Session() session: UserSession,
    @Body('userId') bodyUserId?: string,
    @Query('sandboxToken') sandboxTokenQuery?: string,
    @Headers('x-sandbox-token') sandboxTokenHeader?: string,
  ) {
    return this.examService.startExam(
      tryoutId,
      session.user.id || bodyUserId || '',
      sandboxTokenQuery || sandboxTokenHeader,
    );
  }

  @Get(':attemptId/timer/:order')
  async getTimerState(
    @Param('attemptId') attemptId: string,
    @Param('order') order: string,
    @Session() session: UserSession,
  ) {
    return this.examService.getTimerSnapshot(
      attemptId,
      Number(order),
      session.user.id,
    );
  }

  @Post(':attemptId/start-subtest')
  async startSubtest(
    @Param('attemptId') attemptId: string,
    @Body('subtestOrder') subtestOrder: number,
    @Session() session: UserSession,
  ) {
    return this.examService.startSubtest(attemptId, subtestOrder, session.user.id);
  }

  @Post(':attemptId/answer')
  async submitAnswer(
    @Param('attemptId') attemptId: string,
    @Body()
    answerData: {
      questionId: string;
      answerId?: string;
      inputText?: string;
    },
    @Session() session: UserSession,
  ) {
    return this.examService.saveAnswer(
      attemptId,
      session.user.id,
      answerData.questionId,
      answerData.answerId,
      answerData.inputText,
    );
  }

  @Sse(':attemptId/stream/:order') // Tambahkan :order di sini
  streamExamStatus(
    @Param('attemptId') attemptId: string,
    @Param('order') order: string, // Ambil parameter order
    @Session() session: UserSession,
  ): Observable<MessageEvent> {
    return this.examService.getExamStream(attemptId, Number(order), session.user.id);
  }



  @Post(':attemptId/finish')
  async finish(@Param('attemptId') attemptId: string, @Session() session: UserSession) {
    return this.examService.finishExam(attemptId, session.user.id);
  }

  @Get('ping')
  ping() {
    return 'pong';
  }
}
