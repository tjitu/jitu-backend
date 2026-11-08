import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseInterceptors,
  UploadedFile,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminService } from './services/admin.service';
import { AdminTryoutService } from './services/tryout.service';
import { AdminSubtestService } from './services/subtest.service';
import { AdminQuestionService } from './services/question.service';
import { CreateTryoutDto } from './dto/create-tryout.dto';
import { UpdateTryoutDto } from './dto/update-tryout.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { UpdateSubtestDto } from './dto/update-subtest.dto';
import { AdminUserService } from './services/user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { TopupTokenDto } from './dto/topup-token.dto';
import { AdminPaymentService } from './services/payment.service';
import { AdminPackageService } from './services/package.service';
import { CreatePackageDto, UpdatePackageDto } from './dto/package.dto';
import { AdminDailyService } from './services/daily.service';
import { AdminTryoutResultService } from './services/result.service';
import { AdminAiService } from './services/ai.service';
import { PaymentStatus } from 'generated/prisma/enums';
import { AdminAuthGuard } from '../../guards/auth.guard';

@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly tryoutService: AdminTryoutService,
    private readonly subtestService: AdminSubtestService,
    private readonly questionService: AdminQuestionService,
    private readonly userService: AdminUserService,
    private readonly paymentService: AdminPaymentService,
    private readonly packageService: AdminPackageService,
    private readonly dailyService: AdminDailyService,
    private readonly resultService: AdminTryoutResultService,
    private readonly aiService: AdminAiService,
  ) {}

  // --- DASHBOARD ---
  @Get('stats')
  getDashboardStats() {
    return this.adminService.getDashboardStats();
  }

  // --- TRYOUT ---
  @Get('tryouts')
  getTryouts(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
  ) {
    return this.tryoutService.getTryouts(Number(page), Number(limit));
  }

  @Post('tryouts')
  async createTryout(@Body() createTryoutDto: CreateTryoutDto) {
    return this.tryoutService.createTryout(createTryoutDto);
  }

  @Get('tryouts/:id')
  getTryoutById(@Param('id') id: string) {
    return this.tryoutService.getTryoutById(id);
  }

  @Get('tryouts/:id/preview')
  getTryoutPreview(@Param('id') id: string) {
    return this.tryoutService.getTryoutPreview(id);
  }

  @Patch('tryouts/:id')
  updateTryout(
    @Param('id') id: string,
    @Body() updateTryoutDto: UpdateTryoutDto,
  ) {
    return this.tryoutService.updateTryout(id, updateTryoutDto);
  }

  @Delete('tryouts/:id')
  deleteTryout(@Param('id') id: string) {
    return this.tryoutService.deleteTryout(id);
  }

  // --- SUBTEST ---
  @Post('subtests/:tryoutId')
  createSubtest(@Param('tryoutId') tryoutId: string) {
    return this.subtestService.createUtbkSubtests(tryoutId);
  }

  @Get('tryouts/:tryoutId/subtests')
  getSubtestsByTryout(@Param('tryoutId') tryoutId: string) {
    return this.subtestService.getSubtestsByTryoutId(tryoutId);
  }

  @Get('subtests/:id')
  getSubtestById(@Param('id') id: string) {
    return this.subtestService.getSubtestById(id);
  }

  @Patch('subtests/:id')
  updateSubtest(
    @Param('id') id: string,
    @Body() updateSubtestDto: UpdateSubtestDto,
  ) {
    return this.subtestService.updateSubtest(id, updateSubtestDto);
  }

  // --- QUESTION ---
  @Get('subtests/:subtestId/questions')
  getQuestionsBySubtest(@Param('subtestId') subtestId: string) {
    return this.questionService.getQuestionBySubtestId(subtestId);
  }

  @Post('subtests/:subtestId/questions')
  createQuestion(
    @Param('subtestId') subtestId: string,
    @Body() dto: CreateQuestionDto,
  ) {
    return this.questionService.createQuestion(dto, subtestId);
  }

  @Patch('questions/:id')
  updateQuestion(@Param('id') id: string, @Body() dto: UpdateQuestionDto) {
    return this.questionService.updateQuestion(dto, id);
  }

  @Delete('questions/:id')
  deleteQuestion(@Param('id') id: string) {
    return this.questionService.deleteQuestion(id);
  }

  // --- UPLOAD ---
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    const url =
      await this.questionService.uploadQuestionImageToCloudinary(file);
    return { url };
  }

  // --- USER ---
  @Get('user')
  getAllUsers(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('search') search?: string,
    @Query('role') role?: string,
  ) {
    return this.userService.getAllUser(
      Number(page),
      Number(limit),
      search,
      role,
    );
  }

  @Get('user/:id')
  getUserById(@Param('id') id: string) {
    return this.userService.getUserById(id);
  }

  @Get('user/:id/transactions')
  getUserTransactions(
    @Param('id') id: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
  ) {
    return this.userService.getUserTransactions(
      id,
      Number(page),
      Number(limit),
    );
  }

  @Get('user/:id/tryouts')
  getUserTryouts(
    @Param('id') id: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
  ) {
    return this.userService.getUserTryouts(id, Number(page), Number(limit));
  }

  @Patch('user/:id')
  updateUser(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.userService.updateUser(updateUserDto, id);
  }

  @Post('user/:id/token')
  manualTokenAdjustment(
    @Param('id') id: string,
    @Body() topupTokenDto: TopupTokenDto,
  ) {
    return this.userService.manualTokenAdjustment(id, topupTokenDto);
  }

  @Delete('user/attempt/:id')
  resetUserAttempt(@Param('id') id: string) {
    return this.userService.resetUserTryoutAttempt(id);
  }

  @Delete('user/:id')
  removeUser(@Param('id') id: string) {
    return this.userService.deleteUser(id);
  }

  @Get('payments')
  getPayments(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('status') status?: PaymentStatus,
    @Query('search') search?: string,
  ) {
    return this.paymentService.getAllPayments(
      Number(page),
      Number(limit),
      status,
      search,
    );
  }

  @Get('payments/stats')
  getPaymentStats() {
    return this.paymentService.getPaymentStats();
  }

  @Patch('payments/:id/confirm')
  confirmPayment(@Param('id') id: string) {
    return this.paymentService.confirmPayment(id);
  }

  @Patch('payments/:id/reject')
  rejectPayment(@Param('id') id: string) {
    return this.paymentService.rejectPayment(id);
  }

  // --- PACKAGE / SHOP ---
  @Get('shop/packages')
  getPackages() {
    return this.packageService.getAllPackages();
  }

  @Post('shop/packages')
  createPackage(@Body() dto: CreatePackageDto) {
    return this.packageService.createPackage(dto);
  }

  @Patch('shop/packages/:id')
  updatePackage(@Param('id') id: string, @Body() dto: UpdatePackageDto) {
    return this.packageService.updatePackage(id, dto);
  }

  @Patch('shop/packages/:id/status')
  togglePackageStatus(@Param('id') id: string) {
    return this.packageService.togglePackageStatus(id);
  }

  @Delete('shop/packages/:id')
  deletePackage(@Param('id') id: string) {
    return this.packageService.deletePackage(id);
  }

  // --- DAILY QUESTION ---
  @Get('daily/today')
  getTodayDailyQuestion() {
    return this.dailyService.getTodayQuestion();
  }

  // --- RESULTS / LEADERBOARD ---
  @Get('tryouts/:id/leaderboard')
  getTryoutLeaderboard(
    @Param('id') id: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ) {
    return this.resultService.getLeaderboard(id, Number(page), Number(limit));
  }

  @Get('tryouts/:id/stats')
  getTryoutStats(@Param('id') id: string) {
    return this.resultService.getTryoutStats(id);
  }

  @Get('tryouts/:id/export')
  exportTryoutResults(@Param('id') id: string) {
    return this.resultService.exportResults(id);
  }

  // --- AI GENERATOR ---
  @Get('ai/status')
  getAiStatus() {
    return this.aiService.getStatus();
  }

  @Post('ai/batches')
  createAiBatch(@Body() body: Record<string, unknown>) {
    return this.aiService.createBatch(body);
  }

  @Get('ai/batches')
  getAiBatches() {
    return this.aiService.getBatches();
  }

  @Get('ai/batches/:id')
  getAiBatch(@Param('id') id: string) {
    return this.aiService.getBatch(id);
  }

  @Post('ai/batches/:id/start')
  startAiBatch(@Param('id') id: string) {
    return this.aiService.startBatch(id);
  }

  @Post('ai/batches/:id/cancel')
  cancelAiBatch(@Param('id') id: string) {
    return this.aiService.cancelBatch(id);
  }

  @Get('ai/batches/:id/drafts')
  getAiBatchDrafts(@Param('id') id: string) {
    return this.aiService.getBatchDrafts(id);
  }

  @Get('ai/drafts/:id')
  getAiDraft(@Param('id') id: string) {
    return this.aiService.getDraft(id);
  }

  @Patch('ai/drafts/:id')
  updateAiDraft(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.aiService.updateDraft(id, body);
  }

  @Post('ai/drafts/:id/approve')
  approveAiDraft(@Param('id') id: string) {
    return this.aiService.approveDraft(id);
  }

  @Post('ai/drafts/:id/reject')
  rejectAiDraft(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.aiService.rejectDraft(id, body);
  }

  @Post('ai/drafts/:id/regenerate')
  regenerateAiDraft(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.aiService.regenerateDraft(id, body);
  }

  @Post('ai/drafts/:id/assets/image')
  generateAiDraftImage(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.aiService.generateDraftImage(id, body);
  }

  @Post('ai/drafts/:id/assets/video')
  generateAiDraftVideo(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.aiService.generateDraftVideo(id, body);
  }

  @Post('ai/publish/batches/:batchId')
  async publishAiBatch(@Param('batchId') batchId: string): Promise<unknown> {
    return this.aiService.publishBatch(batchId);
  }

  @Get('ai/usage/batches/:batchId')
  getAiBatchUsage(@Param('batchId') batchId: string) {
    return this.aiService.getBatchUsage(batchId);
  }
}
