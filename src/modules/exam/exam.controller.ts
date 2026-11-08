import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ExamService } from './exam.service';
import { Observable } from 'rxjs';
import { AuthGuard } from '../../guards/auth.guard';
import { MessageEvent } from './interfaces';

@Controller('exam')
@UseGuards(AuthGuard)
export class ExamController {
  constructor(private readonly examService: ExamService) {}

  @Post(':tryoutId/start')
  async startExam(
    @Param('tryoutId') tryoutId: string,
    @Body('userId') userId: string,
  ) {
    return this.examService.startExam(tryoutId, userId);
  }

  @Post(':attemptId/start-subtest')
  async startSubtest(
    @Param('attemptId') attemptId: string,
    @Body('subtestOrder') subtestOrder: number,
  ) {
    return this.examService.startSubtest(attemptId, subtestOrder);
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
  ) {
    return this.examService.saveAnswer(
      attemptId,
      answerData.questionId,
      answerData.answerId,
      answerData.inputText,
    );
  }

  @Sse(':attemptId/stream/:order') // Tambahkan :order di sini
  streamExamStatus(
    @Param('attemptId') attemptId: string,
    @Param('order') order: string, // Ambil parameter order
  ): Observable<MessageEvent> {
    return this.examService.getExamStream(attemptId, Number(order));
  }



  @Post(':attemptId/finish')
  async finish(@Param('attemptId') attemptId: string) {
    return this.examService.finishExam(attemptId);
  }

  @Get('ping')
  ping() {
    return 'pong';
  }
}
